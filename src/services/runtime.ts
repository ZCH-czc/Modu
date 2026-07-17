import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Brightness from "expo-brightness";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import * as ScreenOrientation from "expo-screen-orientation";
import { Platform } from "react-native";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import type {
  Book,
  ReaderOrientation,
  ReaderPreferences,
  ReadingProgress,
} from "../types";

const PREFERENCES_KEY = "modu.preferences.v3";
const BOOKS_KEY = "modu.imported-books.v3";
const HIDDEN_SAMPLES_KEY = "modu.hidden-sample-books.v1";
const PROGRESS_KEY = "modu.reading-progress.v3";
const REMINDER_CHANNEL = "reading-reminder";
const REMINDER_ID_KEY = "modu.reading-reminder-id.v1";
const ONBOARDING_KEY = "modu.onboarding-complete.v1";
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export const defaultPreferences: ReaderPreferences = {
  theme: "paper",
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
        name: "每日阅读提醒",
        description: "提醒你每天留一点时间继续阅读",
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
        title: "今天也读一会儿",
        body: "打开墨读，继续上次停下的那一页。",
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
  return books.map((book) =>
    book.format === "epub" ? { ...book, pages: [], pageTitles: [] } : book,
  );
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
    return Promise.all(books.map(hydrateBook));
  } catch {
    return [];
  }
}

export async function hydrateBook(book: Book): Promise<Book> {
  if (book.format !== "epub" || !book.contentUri || book.pages.length > 0) {
    return book;
  }

  try {
    const content = await FileSystem.readAsStringAsync(book.contentUri);
    const parsed = JSON.parse(content) as {
      pages: string[];
      pageTitles: string[];
    };
    return { ...book, pages: parsed.pages, pageTitles: parsed.pageTitles };
  } catch {
    return {
      ...book,
      pages: ["这本书的已解析内容不可用，请从书架删除后重新导入。"],
      pageTitles: ["内容不可用"],
    };
  }
}

export async function importDocument(existingBooks: Book[]): Promise<Book | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/epub+zip", "application/pdf"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_FILE_SIZE) {
    throw new Error("文件超过 25 MB，请选择更小的 EPUB 或 PDF。");
  }

  const extension = asset.name.toLowerCase().endsWith(".pdf") ? "pdf" : "epub";
  const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const libraryDirectory = `${FileSystem.documentDirectory}library/`;
  await FileSystem.makeDirectoryAsync(libraryDirectory, { intermediates: true });
  const fileUri = `${libraryDirectory}${id}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: fileUri });

  let book: Book;
  if (extension === "pdf") {
    const header = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      length: 8,
      position: 0,
    });
    if (!header.startsWith("JVBER")) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      throw new Error("这个文件不是有效的 PDF。");
    }
    book = {
      id,
      title: asset.name.replace(/\.pdf$/i, ""),
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
    };
  } else {
    book = await parseEpub(id, fileUri, asset.name);
  }

  await persistBooks([...existingBooks, book]);
  return book;
}

export async function deleteImportedBook(book: Book, books: Book[]) {
  if (book.fileUri) {
    await FileSystem.deleteAsync(book.fileUri, { idempotent: true });
  }
  if (book.contentUri) {
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
): Promise<Book> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const zip = await JSZip.loadAsync(base64, { base64: true });
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
  for (const item of spineItems) {
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

  const pages: string[] = [];
  const pageTitles: string[] = [];
  chapters.forEach((chapter) => {
    paginate(chapter.text, 720).forEach((page) => {
      pages.push(page);
      pageTitles.push(chapter.title);
    });
  });

  const contentUri = `${FileSystem.documentDirectory}library/${id}.content.json`;
  await FileSystem.writeAsStringAsync(
    contentUri,
    JSON.stringify({ pages, pageTitles }),
  );

  return {
    id,
    title,
    author,
    category: "EPUB",
    currentChapter: pageTitles[0] ?? "开始阅读",
    lastRead: "刚刚导入",
    coverColors: ["#536B5D", "#25372D"],
    accent: "#91A996",
    progress: 0,
    pages,
    pageTitles,
    format: "epub" as const,
    fileUri,
    contentUri,
  };
}

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
