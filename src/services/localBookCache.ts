import * as FileSystem from "expo-file-system/legacy";

import type {
  Book,
  BookSearchResult,
  LocalChapterCacheEntry,
} from "../types";

export type LocalChapterCacheInput = {
  title: string;
  text: string;
  pages: string[];
};

type LocalChapterPayload = LocalChapterCacheInput & { version: 1 };
type LocalChapterManifestFile = {
  version: 2;
  bookId: string;
  chapters: LocalChapterCacheEntry[];
};
type LocalSearchIndexChapter = {
  title: string;
  pages: string[];
};

const payloadCache = new Map<string, LocalChapterPayload>();
const MAX_CACHED_CHAPTERS = 3;

function rememberPayload(uri: string, payload: LocalChapterPayload) {
  payloadCache.delete(uri);
  payloadCache.set(uri, payload);
  while (payloadCache.size > MAX_CACHED_CHAPTERS) {
    const oldest = payloadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    payloadCache.delete(oldest);
  }
}

async function readPayload(uri: string): Promise<LocalChapterPayload> {
  const cached = payloadCache.get(uri);
  if (cached) {
    rememberPayload(uri, cached);
    return cached;
  }
  const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as LocalChapterPayload;
  if (!Array.isArray(parsed.pages) || typeof parsed.text !== "string") {
    throw new Error("章节缓存已经损坏。");
  }
  const payload: LocalChapterPayload = {
    version: 1,
    title: parsed.title || "正文",
    text: parsed.text,
    pages: parsed.pages.length ? parsed.pages : [parsed.text],
  };
  rememberPayload(uri, payload);
  return payload;
}

async function writeManifest(
  uri: string,
  bookId: string,
  chapters: LocalChapterCacheEntry[],
) {
  const manifest: LocalChapterManifestFile = { version: 2, bookId, chapters };
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(manifest));
}

export async function readLocalChapterManifest(
  uri: string | undefined,
): Promise<LocalChapterCacheEntry[] | undefined> {
  if (!uri) return undefined;
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as Partial<LocalChapterManifestFile>;
    if (parsed.version !== 2 || !Array.isArray(parsed.chapters)) return undefined;
    return parsed.chapters.filter((entry): entry is LocalChapterCacheEntry =>
      Boolean(entry) &&
      typeof entry.title === "string" &&
      typeof entry.uri === "string" &&
      Number.isFinite(entry.pageCount),
    );
  } catch {
    return undefined;
  }
}

export async function createLocalChapterCache(
  bookId: string,
  chapters: LocalChapterCacheInput[],
) {
  if (!FileSystem.documentDirectory) throw new Error("本机存储目录不可用。");
  const directory = `${FileSystem.documentDirectory}library/${bookId}.chapters/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const manifest: LocalChapterCacheEntry[] = [];
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const uri = `${directory}${String(index).padStart(5, "0")}.json`;
    const payload: LocalChapterPayload = {
      version: 1,
      title: chapter.title || `第 ${index + 1} 章`,
      text: chapter.text,
      pages: chapter.pages.length ? chapter.pages : [chapter.text],
    };
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload));
    manifest.push({ title: payload.title, uri, pageCount: payload.pages.length });
    if ((index + 1) % 12 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const contentUri = `${directory}manifest.json`;
  await writeManifest(contentUri, bookId, manifest);
  await FileSystem.writeAsStringAsync(
    `${directory}search.json`,
    JSON.stringify(chapters.map((chapter) => ({
      title: chapter.title,
      pages: chapter.pages,
    }))),
  );
  return {
    contentUri,
    manifest,
    pageCount: manifest.reduce((total, entry) => total + entry.pageCount, 0),
  };
}

function resolveLegacyPosition(
  manifest: LocalChapterCacheEntry[],
  globalPageIndex: number,
) {
  let remaining = Math.max(0, globalPageIndex);
  for (let index = 0; index < manifest.length; index += 1) {
    const count = Math.max(1, manifest[index].pageCount);
    if (remaining < count) return { chapterIndex: index, pageIndex: remaining };
    remaining -= count;
  }
  const chapterIndex = Math.max(0, manifest.length - 1);
  return {
    chapterIndex,
    pageIndex: Math.max(0, (manifest[chapterIndex]?.pageCount ?? 1) - 1),
  };
}

export async function loadLocalChapterBook(
  book: Book,
  requestedChapterIndex?: number,
  legacyGlobalPageIndex = 0,
): Promise<Book> {
  const manifest = book.localChapterManifest?.length
    ? book.localChapterManifest
    : await readLocalChapterManifest(book.contentUri);
  if (!manifest?.length) throw new Error("没有找到可阅读的章节缓存。");
  const legacyPosition = requestedChapterIndex === undefined
    ? resolveLegacyPosition(manifest, legacyGlobalPageIndex)
    : undefined;
  const chapterIndex = Math.max(
    0,
    Math.min(requestedChapterIndex ?? legacyPosition?.chapterIndex ?? 0, manifest.length - 1),
  );
  const entry = manifest[chapterIndex];
  const payload = await readPayload(entry.uri);
  const localPageIndex = Math.max(
    0,
    Math.min(
      requestedChapterIndex === undefined ? legacyPosition?.pageIndex ?? 0 : legacyGlobalPageIndex,
      payload.pages.length - 1,
    ),
  );
  void preloadLocalChapterNeighbors(manifest, chapterIndex);
  return {
    ...book,
    contentUri: book.contentUri,
    currentChapter: entry.title,
    pages: payload.pages,
    pageCount: manifest.reduce((total, chapter) => total + chapter.pageCount, 0),
    pageTitles: payload.pages.map(() => entry.title),
    localChapters: [{ title: entry.title, text: payload.text }],
    localChapterManifest: manifest,
    localChapterIndex: chapterIndex,
    localPageIndex,
  };
}

export async function preloadLocalChapterNeighbors(
  manifest: LocalChapterCacheEntry[],
  chapterIndex: number,
) {
  await Promise.all(
    [chapterIndex - 1, chapterIndex + 1]
      .filter((index) => index >= 0 && index < manifest.length)
      .map((index) => readPayload(manifest[index].uri).catch(() => undefined)),
  );
}

export async function persistLocalChapterPagination(book: Book) {
  const manifest = book.localChapterManifest;
  const chapterIndex = book.localChapterIndex;
  const chapter = book.localChapters?.[0];
  if (!book.contentUri || !manifest?.length || chapterIndex === undefined || !chapter) return;
  const entry = manifest[chapterIndex];
  if (!entry) return;
  const payload: LocalChapterPayload = {
    version: 1,
    title: entry.title,
    text: chapter.text,
    pages: book.pages,
  };
  await FileSystem.writeAsStringAsync(entry.uri, JSON.stringify(payload));
  rememberPayload(entry.uri, payload);
  await writeManifest(book.contentUri, book.id, manifest);
}

function createSearchResult(
  text: string,
  pageIndex: number,
  chapterIndex: number,
  chapterTitle: string,
  query: string,
): BookSearchResult | undefined {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const match = normalizedText.indexOf(normalizedQuery);
  if (match < 0) return undefined;
  const start = Math.max(0, match - 34);
  const end = Math.min(text.length, match + query.length + 58);
  const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
  return {
    key: `${chapterIndex}:${pageIndex}:${match}`,
    pageIndex,
    chapterIndex,
    chapterTitle,
    excerpt,
    matchStart: Math.max(0, match - start + (start > 0 ? 1 : 0)),
    matchLength: query.length,
  };
}

async function loadSearchIndex(
  book: Book,
  manifest: LocalChapterCacheEntry[],
): Promise<LocalSearchIndexChapter[]> {
  const searchUri = book.contentUri?.endsWith("manifest.json")
    ? `${book.contentUri.slice(0, -"manifest.json".length)}search.json`
    : undefined;
  if (searchUri) {
    try {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(searchUri)) as LocalSearchIndexChapter[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Older chapter caches build the index once on first search.
    }
  }
  const chapters: LocalSearchIndexChapter[] = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const payload = await readPayload(manifest[index].uri);
    chapters.push({ title: manifest[index].title, pages: payload.pages });
    if ((index + 1) % 12 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (searchUri) {
    void FileSystem.writeAsStringAsync(searchUri, JSON.stringify(chapters));
  }
  return chapters;
}

export async function searchLocalChapterBook(
  book: Book,
  query: string,
  limit = 80,
): Promise<BookSearchResult[]> {
  const manifest = book.localChapterManifest?.length
    ? book.localChapterManifest
    : await readLocalChapterManifest(book.contentUri);
  if (!manifest?.length || !query.trim()) return [];
  const chapters = await loadSearchIndex(book, manifest);
  const results: BookSearchResult[] = [];
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
    const chapter = chapters[chapterIndex];
    for (let pageIndex = 0; pageIndex < chapter.pages.length; pageIndex += 1) {
      const result = createSearchResult(
        chapter.pages[pageIndex] ?? "",
        pageIndex,
        chapterIndex,
        chapter.title,
        query.trim(),
      );
      if (result) results.push(result);
      if (results.length >= limit) return results;
    }
    if ((chapterIndex + 1) % 40 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return results;
}
export async function deleteLocalChapterCache(book: Book) {
  const manifest = book.localChapterManifest?.length
    ? book.localChapterManifest
    : await readLocalChapterManifest(book.contentUri);
  manifest?.forEach((entry) => payloadCache.delete(entry.uri));
  const marker = ".chapters/manifest.json";
  if (book.contentUri?.endsWith(marker)) {
    const directory = book.contentUri.slice(0, -"manifest.json".length);
    await FileSystem.deleteAsync(directory, { idempotent: true });
    return true;
  }
  return false;
}