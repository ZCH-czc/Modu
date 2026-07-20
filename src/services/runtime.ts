import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Brightness from "expo-brightness";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import * as ScreenOrientation from "expo-screen-orientation";
import { Platform } from "react-native";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import { translate } from "../i18n";
import {
  paginateTextForReader,
  type ReaderPaginationLayout,
} from "./readerPagination";
import {
  createLocalChapterCache,
  deleteLocalChapterCache,
  loadLocalChapterBook,
  persistLocalChapterPagination,
  readLocalChapterManifest,
} from "./localBookCache";
import type {
  Book,
  ReaderOrientation,
  ReaderPreferences,
  ReaderBookmark,
  ReadingProgress,
} from "../types";

const PREFERENCES_KEY = "modu.preferences.v3";
const BOOKS_KEY = "modu.imported-books.v3";
const HIDDEN_SAMPLES_KEY = "modu.hidden-sample-books.v1";
const PROGRESS_KEY = "modu.reading-progress.v3";
const BOOKMARKS_KEY = "modu.reader-bookmarks.v1";
const REMINDER_CHANNEL = "reading-reminder";
const REMINDER_ID_KEY = "modu.reading-reminder-id.v1";
const ONBOARDING_KEY = "modu.onboarding-complete.v1";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export type ImportProgress = {
  progress: number;
  message: string;
};

type ImportProgressCallback = (progress: ImportProgress) => void;

function reportImportProgress(
  callback: ImportProgressCallback | undefined,
  progress: number,
  message: string,
) {
  callback?.({ progress: Math.max(0, Math.min(progress, 1)), message });
}

export const defaultPreferences: ReaderPreferences = {
  theme: "paper",
  fontFamily: "serif",
  fontSize: 19,
  lineHeight: 1.75,
  paragraphSpacing: 16,
  horizontalPadding: 28,
  textAlignment: "justify",
  pageTurn: "slide",
  tapToTurn: true,
  keepScreenAwake: true,
  volumeKeys: false,
  autoSync: true,
  notifications: false,
  reminderHour: 21,
  reminderMinute: 0,
  orientation: "auto",
  followSystemBrightness: true,
  brightness: 0.7,
  showProgress: true,
  immersiveMode: false,
  webReaderFlow: "paged",
};

export async function loadPreferences(): Promise<ReaderPreferences> {
  const stored = await AsyncStorage.getItem(PREFERENCES_KEY);
  if (!stored) return defaultPreferences;

  try {
    return { ...defaultPreferences, ...JSON.parse(stored) };
  } catch {
    return defaultPreferences;
  }
}

export async function savePreferences(preferences: ReaderPreferences) {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export async function loadOnboardingComplete() {
  return (await AsyncStorage.getItem(ONBOARDING_KEY)) === "true";
}

export async function saveOnboardingComplete() {
  await AsyncStorage.setItem(ONBOARDING_KEY, "true");
}

export async function applyOrientation(orientation: ReaderOrientation) {
  try {
    if (orientation === "auto") {
      await ScreenOrientation.unlockAsync();
      return;
    }

    await ScreenOrientation.lockAsync(
      orientation === "portrait"
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  } catch {
    // Android may briefly have no activity while returning from system settings.
  }
}

export async function applyBrightness(preferences: ReaderPreferences) {
  try {
    if (preferences.followSystemBrightness) {
      await Brightness.restoreSystemBrightnessAsync();
      return;
    }
    await Brightness.setBrightnessAsync(preferences.brightness);
  } catch {
    // Android may briefly have no activity while returning from system settings.
  }
}

export type ReminderResult = "configured" | "denied" | "unsupported";

export async function configureReminder(
  preferences: ReaderPreferences,
): Promise<ReminderResult> {
  try {
    const previousId = await AsyncStorage.getItem(REMINDER_ID_KEY);

    if (!preferences.notifications) {
      if (previousId) {
        await Notifications.cancelScheduledNotificationAsync(previousId);
        await AsyncStorage.removeItem(REMINDER_ID_KEY);
      }
      return "configured";
    }

    if (Platform.OS === "web") return "unsupported";

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
        name: translate("每日阅读提醒"),
        description: translate("提醒你每天留一点时间继续阅读"),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return "denied";

    if (previousId) {
      await Notifications.cancelScheduledNotificationAsync(previousId);
    }

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: translate("今天也读一会儿"),
        body: translate("打开墨读，继续上次停下的那一页。"),
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: preferences.reminderHour,
        minute: preferences.reminderMinute,
        channelId: Platform.OS === "android" ? REMINDER_CHANNEL : undefined,
      },
    });
    await AsyncStorage.setItem(REMINDER_ID_KEY, identifier);
    return "configured";
  } catch {
    return "unsupported";
  }
}

export async function loadProgress(): Promise<Record<string, ReadingProgress>> {
  const stored = await AsyncStorage.getItem(PROGRESS_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

export async function saveProgress(
  progress: Record<string, ReadingProgress>,
) {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export async function loadBookmarks(): Promise<ReaderBookmark[]> {
  const stored = await AsyncStorage.getItem(BOOKMARKS_KEY);
  if (!stored) return [];
  try {
    const bookmarks = JSON.parse(stored) as unknown;
    if (!Array.isArray(bookmarks)) return [];
    return bookmarks.filter((bookmark): bookmark is ReaderBookmark =>
      Boolean(
        bookmark &&
        typeof bookmark === "object" &&
        typeof (bookmark as ReaderBookmark).id === "string" &&
        typeof (bookmark as ReaderBookmark).bookId === "string" &&
        Number.isInteger((bookmark as ReaderBookmark).pageIndex),
      ),
    );
  } catch {
    return [];
  }
}

export async function saveBookmarks(bookmarks: ReaderBookmark[]) {
  await AsyncStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
}

export async function clearProgress() {
  await AsyncStorage.removeItem(PROGRESS_KEY);
}

export async function loadHiddenSampleBooks(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(HIDDEN_SAMPLES_KEY);
  if (!stored) return [];
  try {
    const ids = JSON.parse(stored) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function saveHiddenSampleBooks(ids: string[]) {
  await AsyncStorage.setItem(HIDDEN_SAMPLES_KEY, JSON.stringify(ids));
}

function storageBooks(books: Book[]) {
  return books.map(unloadImportedTextBook);
}

export function unloadImportedTextBook(book: Book): Book {
  if (book.format !== "epub" && book.format !== "txt") return book;
  const {
    localChapters: _localChapters,
    localPageIndex: _localPageIndex,
    ...stored
  } = book;
  const manifestPageCount = book.localChapterManifest?.reduce(
    (total, chapter) => total + Math.max(1, chapter.pageCount),
    0,
  );
  return {
    ...stored,
    pageCount: manifestPageCount || book.pageCount || book.pages.length || 0,
    pages: [],
    pageTitles: [],
  };
}

async function persistBooks(books: Book[]) {
  await AsyncStorage.setItem(BOOKS_KEY, JSON.stringify(storageBooks(books)));
}

export async function saveImportedBooks(books: Book[]) {
  await persistBooks(books);
}

export async function loadImportedBooks(): Promise<Book[]> {
  const stored = await AsyncStorage.getItem(BOOKS_KEY);
  if (!stored) return [];
  try {
    const books = JSON.parse(stored) as Book[];
    let migrated = false;
    const prepared = await Promise.all(books.map(async (book) => {
      if (
        book.format === "txt" &&
        !book.contentUri &&
        book.pages.length > 0
      ) {
        const chapters = reconstructTitledChapters(book.pages, book.pageTitles);
        const cache = await createLocalChapterCache(
          book.id,
          chapters.map((chapter) => ({
            ...chapter,
            pages: paginate(chapter.text, 720),
          })),
        );
        migrated = true;
        return {
          ...book,
          contentUri: cache.contentUri,
          localChapterManifest: cache.manifest,
          pageCount: cache.pageCount,
        };
      }
      return book;
    }));
    const compact = prepared.map(unloadImportedTextBook);
    if (migrated) await persistBooks(compact);
    return compact;
  } catch {
    return [];
  }
}

export async function hydrateBook(
  book: Book,
  requestedChapterIndex?: number,
  savedPageIndex = 0,
): Promise<Book> {
  if (
    (book.format !== "epub" && book.format !== "txt") ||
    !book.contentUri ||
    book.pages.length > 0
  ) {
    return book;
  }

  try {
    let prepared = book;
    let manifest = book.localChapterManifest?.length
      ? book.localChapterManifest
      : await readLocalChapterManifest(book.contentUri);
    if (!manifest?.length) {
      const legacyContentUri = book.contentUri;
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(legacyContentUri)) as {
        pages: string[];
        pageTitles: string[];
        chapters?: Array<{ title: string; text: string }>;
      };
      const chapters = parsed.chapters?.length
        ? parsed.chapters
        : reconstructTitledChapters(parsed.pages, parsed.pageTitles);
      const cache = await createLocalChapterCache(
        book.id,
        chapters.map((chapter) => ({
          ...chapter,
          pages: paginate(chapter.text, 720),
        })),
      );
      manifest = cache.manifest;
      prepared = {
        ...book,
        contentUri: cache.contentUri,
        localChapterManifest: manifest,
        pageCount: cache.pageCount,
      };
    }
    return await loadLocalChapterBook(
      { ...prepared, localChapterManifest: manifest },
      requestedChapterIndex,
      savedPageIndex,
    );
  } catch {
    return {
      ...book,
      pages: ["这本书的已解析内容不可用，请从书架删除后重新导入。"],
      pageCount: 1,
      pageTitles: ["内容不可用"],
    };
  }
}
export function repaginateImportedTextBook(
  book: Book,
  layout: ReaderPaginationLayout,
): Book {
  if (book.format !== "epub" && book.format !== "txt") return book;
  const chapters = book.localChapters?.length
    ? book.localChapters
    : reconstructTitledChapters(book.pages, book.pageTitles);
  const pages: string[] = [];
  const pageTitles: string[] = [];
  chapters.forEach((chapter) => {
    const chapterPages = paginateTextForReader(chapter.text, layout);
    pages.push(...chapterPages);
    pageTitles.push(...chapterPages.map(() => chapter.title));
  });
  if (book.localChapterManifest?.length && book.localChapterIndex !== undefined) {
    const localChapterManifest = book.localChapterManifest.map((entry, index) =>
      index === book.localChapterIndex ? { ...entry, pageCount: pages.length } : entry,
    );
    return {
      ...book,
      pages,
      pageCount: localChapterManifest.reduce(
        (total, chapter) => total + Math.max(1, chapter.pageCount),
        0,
      ),
      pageTitles,
      localChapters: chapters,
      localChapterManifest,
    };
  }
  return { ...book, pages, pageCount: pages.length, pageTitles, localChapters: chapters };
}

export async function persistEpubPagination(book: Book) {
  if ((book.format !== "epub" && book.format !== "txt") || !book.contentUri) return;
  if (book.localChapterManifest?.length) {
    await persistLocalChapterPagination(book);
    return;
  }
  await FileSystem.writeAsStringAsync(
    book.contentUri,
    JSON.stringify({
      pages: book.pages,
      pageTitles: book.pageTitles ?? [],
      chapters: book.localChapters ?? reconstructTitledChapters(book.pages, book.pageTitles),
    }),
  );
}
export async function importDocument(
  existingBooks: Book[],
  onProgress?: ImportProgressCallback,
): Promise<Book | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/epub+zip", "application/pdf", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  reportImportProgress(onProgress, 0.08, "正在读取文件信息");
  return importBookFromUri(asset.uri, asset.name, asset.size, existingBooks, onProgress);
}

export async function importBookFromUri(
  sourceUri: string,
  sourceName: string,
  sourceSize: number | undefined,
  existingBooks: Book[],
  onProgress?: ImportProgressCallback,
): Promise<Book> {
  if (sourceSize && sourceSize > MAX_FILE_SIZE) {
    throw new Error("文件超过 25 MB，请选择更小的 EPUB、TXT 或 PDF。");
  }

  reportImportProgress(onProgress, 0.1, "正在检查文件格式");
  const normalizedName = sourceName.trim() || `received-${Date.now()}.txt`;
  const extension = normalizedName.toLowerCase().match(/\.(epub|pdf|txt)$/)?.[1] as
    | "epub"
    | "pdf"
    | "txt"
    | undefined;
  if (!extension) throw new Error("仅支持 EPUB、TXT 和 PDF 文件。");

  const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const libraryDirectory = `${FileSystem.documentDirectory}library/`;
  await FileSystem.makeDirectoryAsync(libraryDirectory, { intermediates: true });
  const fileUri = `${libraryDirectory}${id}.${extension}`;
  const copySource = sourceUri.includes("://") ? sourceUri : `file://${sourceUri}`;
  reportImportProgress(onProgress, 0.14, "正在把书收进本机");
  await FileSystem.copyAsync({ from: copySource, to: fileUri });
  reportImportProgress(onProgress, 0.24, "文件已经安放妥当");

  let book: Book;
  if (extension === "pdf") {
    reportImportProgress(onProgress, 0.42, "正在校验 PDF");
    const header = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      length: 8,
      position: 0,
    });
    if (!header.startsWith("JVBER")) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      throw new Error("这个文件不是有效的 PDF。");
    }
    reportImportProgress(onProgress, 0.9, "PDF 已准备好");
    book = {
      id,
      title: normalizedName.replace(/\.pdf$/i, ""),
      author: "本地 PDF",
      category: "PDF",
      currentChapter: "PDF 文档",
      lastRead: "刚刚导入",
      coverColors: ["#59636D", "#283139"],
      accent: "#8DA0AC",
      progress: 0,
      pages: ["PDF 文档"],
      pageTitles: ["PDF"],
      format: "pdf",
      fileUri,
      sourceSize,
    };
  } else if (extension === "txt") {
    reportImportProgress(onProgress, 0.38, "正在读取文本");
    const content = (await FileSystem.readAsStringAsync(fileUri)).replace(/^\uFEFF/, "").trim();
    if (content.length < 20) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      throw new Error("这个 TXT 文件没有足够的正文内容。");
    }
    reportImportProgress(onProgress, 0.62, "正在辨认章节");
    const chapters = splitTextChapters(content);
    const chapterInputs = chapters.map((chapter) => ({
      ...chapter,
      pages: paginate(chapter.text, 720),
    }));
    reportImportProgress(onProgress, 0.78, "正在分章保存");
    const cache = await createLocalChapterCache(id, chapterInputs);
    const firstChapter = chapterInputs[0];
    reportImportProgress(onProgress, 0.9, "文本已经排好");
    book = {
      id,
      title: normalizedName.replace(/\.txt$/i, ""),
      author: "本地文本",
      category: "TXT",
      currentChapter: firstChapter.title,
      lastRead: "刚刚导入",
      coverColors: ["#6A725D", "#30372B"],
      accent: "#A3AD91",
      progress: 0,
      pages: firstChapter.pages,
      pageCount: cache.pageCount,
      pageTitles: firstChapter.pages.map(() => firstChapter.title),
      format: "txt",
      localChapters: [{ title: firstChapter.title, text: firstChapter.text }],
      localChapterManifest: cache.manifest,
      localChapterIndex: 0,
      fileUri,
      contentUri: cache.contentUri,
      sourceSize,
    };
  } else {
    book = await parseEpub(id, fileUri, normalizedName, onProgress);
    book.sourceSize = sourceSize;
  }

  reportImportProgress(onProgress, 0.97, "正在写入书架");
  await persistBooks([...existingBooks, book]);
  reportImportProgress(onProgress, 1, "导入完成");
  return book;
}
export async function deleteImportedBook(book: Book, books: Book[]) {
  if (book.fileUri) {
    await FileSystem.deleteAsync(book.fileUri, { idempotent: true });
  }
  const deletedChapterDirectory = await deleteLocalChapterCache(book);
  if (book.contentUri && !deletedChapterDirectory) {
    await FileSystem.deleteAsync(book.contentUri, { idempotent: true });
  }
  const next = books.filter((item) => item.id !== book.id);
  await persistBooks(next);
  return next;
}

export async function clearCache(): Promise<string> {
  if (!FileSystem.cacheDirectory) return "缓存目录不可用";
  const files = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
  await Promise.all(
    files.map((name) =>
      FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, {
        idempotent: true,
      }),
    ),
  );
  return files.length > 0 ? `已清理 ${files.length} 个缓存项目` : "缓存已经很干净";
}

async function parseEpub(
  id: string,
  fileUri: string,
  fallbackName: string,
  onProgress?: ImportProgressCallback,
): Promise<Book> {
  reportImportProgress(onProgress, 0.28, "正在读取 EPUB");
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(base64, { base64: true });
  reportImportProgress(onProgress, 0.36, "正在解开书页");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
  });

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("EPUB 缺少 container.xml。");
  const container = parser.parse(await containerFile.async("string"));
  const rootfile = first(container.container.rootfiles.rootfile);
  const opfPath = rootfile?.["@_full-path"];
  if (!opfPath) throw new Error("EPUB 无法定位内容清单。");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("EPUB 内容清单不存在。");
  const opf = parser.parse(await opfFile.async("string")).package;
  const metadata = opf.metadata ?? {};
  const title =
    textValue(metadata.title) || fallbackName.replace(/\.epub$/i, "");
  const author = textValue(metadata.creator) || "未知作者";
  const manifestItems = array(opf.manifest?.item);
  const manifest = new Map(
    manifestItems.map((item: Record<string, string>) => [
      item["@_id"],
      item["@_href"],
    ]),
  );
  const spineItems = array(opf.spine?.itemref);
  const opfDirectory = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1)
    : "";

  const chapters: { title: string; text: string }[] = [];
  for (let spineIndex = 0; spineIndex < spineItems.length; spineIndex += 1) {
    const item = spineItems[spineIndex];
    reportImportProgress(
      onProgress,
      0.42 + ((spineIndex + 1) / Math.max(spineItems.length, 1)) * 0.38,
      `正在解析章节 ${spineIndex + 1} / ${spineItems.length}`,
    );
    const href = manifest.get(item["@_idref"]);
    if (!href) continue;
    const path = normalizeZipPath(`${opfDirectory}${decodeURIComponent(href)}`);
    const chapterFile = zip.file(path);
    if (!chapterFile) continue;
    const html = await chapterFile.async("string");
    const heading =
      decodeEntities(
        html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ?? "",
      )
        .replace(/<[^>]+>/g, "")
        .trim() || `章节 ${chapters.length + 1}`;
    const text = htmlToText(html);
    if (text.length > 20) chapters.push({ title: heading, text });
  }
  if (chapters.length === 0) throw new Error("EPUB 中没有可读取的正文。");

  const chapterInputs = [] as Array<{ title: string; text: string; pages: string[] }>;
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    reportImportProgress(
      onProgress,
      0.82 + ((chapterIndex + 1) / chapters.length) * 0.1,
      `正在排版章节 ${chapterIndex + 1} / ${chapters.length}`,
    );
    chapterInputs.push({ ...chapter, pages: paginate(chapter.text, 720) });
    if ((chapterIndex + 1) % 8 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  reportImportProgress(onProgress, 0.94, "正在保存章节缓存");
  const cache = await createLocalChapterCache(id, chapterInputs);
  const firstChapter = chapterInputs[0];

  return {
    id,
    title,
    author,
    category: "EPUB",
    currentChapter: firstChapter.title || "开始阅读",
    lastRead: "刚刚导入",
    coverColors: ["#536B5D", "#25372D"],
    accent: "#91A996",
    progress: 0,
    pages: firstChapter.pages,
    pageCount: cache.pageCount,
    pageTitles: firstChapter.pages.map(() => firstChapter.title),
    format: "epub" as const,
    localChapters: [{ title: firstChapter.title, text: firstChapter.text }],
    localChapterManifest: cache.manifest,
    localChapterIndex: 0,
    fileUri,
    contentUri: cache.contentUri,
  };}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function splitTextChapters(text: string): Array<{ title: string; text: string }> {
  const headingPattern = /^\s*(?:第[〇零一二三四五六七八九十百千万两0-9]{1,12}[章节卷部篇回][^\n]{0,48}|chapter\s+\d+[^\n]{0,48}|#{1,3}\s+[^\n]{1,60})\s*$/i;
  const lines = text.split(/\r?\n/);
  const chapters: Array<{ title: string; text: string }> = [];
  let title = "正文";
  let body: string[] = [];
  const flush = () => {
    const chapterText = body.join("\n").trim();
    if (chapterText.length > 20) chapters.push({ title, text: chapterText });
    body = [];
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (headingPattern.test(trimmed)) {
      flush();
      title = trimmed.replace(/^#{1,3}\s+/, "") || `第 ${chapters.length + 1} 章`;
    }
    body.push(line);
  });
  flush();
  if (chapters.length > 1) return chapters;

  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks: Array<{ title: string; text: string }> = [];
  let current: string[] = [];
  let size = 0;
  const flushChunk = () => {
    if (!current.length) return;
    const index = chunks.length + 1;
    chunks.push({ title: `正文 · ${index}`, text: current.join("\n\n") });
    current = [];
    size = 0;
  };
  paragraphs.forEach((paragraph) => {
    if (current.length && size + paragraph.length > 48000) flushChunk();
    current.push(paragraph);
    size += paragraph.length;
  });
  flushChunk();
  return chunks.length ? chunks : [{ title: "正文", text }];
}
function paginate(text: string, target: number) {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const pages: string[] = [];
  let current = "";
  paragraphs.forEach((paragraph) => {
    if (current && current.length + paragraph.length > target) {
      pages.push(current.trim());
      current = "";
    }
    if (paragraph.length > target * 1.7) {
      for (let index = 0; index < paragraph.length; index += target) {
        const chunk = paragraph.slice(index, index + target);
        if (current) {
          pages.push(current.trim());
          current = "";
        }
        pages.push(chunk.trim());
      }
    } else {
      current += `${current ? "\n\n" : ""}${paragraph}`;
    }
  });
  if (current.trim()) pages.push(current.trim());
  return pages;
}

function reconstructTitledChapters(
  pages: string[],
  pageTitles?: string[],
): Array<{ title: string; text: string }> {
  const chapters: Array<{ title: string; text: string }> = [];
  let title = pageTitles?.[0]?.trim() || "正文";
  let chapterPages: string[] = [];
  const flush = () => {
    if (!chapterPages.length) return;
    chapters.push({ title, text: joinReconstructedPages(chapterPages) });
    chapterPages = [];
  };
  pages.forEach((page, index) => {
    const nextTitle = pageTitles?.[index]?.trim() || title;
    if (chapterPages.length && nextTitle !== title) {
      flush();
      title = nextTitle;
    }
    chapterPages.push(page);
  });
  flush();
  return chapters;
}
function joinReconstructedPages(pages: string[]) {
  return pages.reduce((text, page) => {
    if (!text) return page;
    const separator = /[。！？.!?…」』”’]$/.test(text.trim()) ? "\n\n" : "";
    return text + separator + page;
  }, "");
}
function normalizeZipPath(path: string) {
  const parts: string[] = [];
  path.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function array<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function first<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: unknown): string {
  const item = Array.isArray(value) ? value[0] : value;
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && "#text" in item) {
    return String((item as { "#text": unknown })["#text"]);
  }
  return "";
}
