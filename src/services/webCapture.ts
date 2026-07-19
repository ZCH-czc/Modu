import { paginateOnlineText } from "./bookSources";
import type { Book, ReaderPreferences, WebChapterExtraction, WebPageExtraction } from "../types";

export function createWebCaptureBook(extraction: WebPageExtraction, pageTarget = 520): Book {
  const chapters = extraction.chapters?.length
    ? extraction.chapters
    : [{ title: extraction.title || "正文", content: extraction.content, url: extraction.url }];
  const currentIndex = Math.max(0, chapters.findIndex((chapter) => chapter.url === extraction.url));
  const currentChapter = chapters[currentIndex] ?? chapters[0];
  const stableUrl = chapters[0]?.url || extraction.url;
  const pages: string[] = [];
  const pageTitles: string[] = [];

  chapters.forEach((chapter) => {
    const chapterPages = paginateOnlineText(chapter.content, pageTarget);
    pages.push(...chapterPages);
    pageTitles.push(...chapterPages.map(() => chapter.title || "正文"));
  });

  return {
    id: "webclip-" + hash(stableUrl),
    title: extraction.bookTitle || extraction.title || "网页摘录",
    author: extraction.author || "摘自网页",
    category: chapters.length > 1 || extraction.nextUrl ? "网页连载" : "网页摘录",
    progress: 0,
    currentChapter: currentChapter?.title || extraction.title || "正文",
    lastRead: chapters.length > 1 ? `已收录 ${chapters.length} 章` : "刚刚摘录",
    coverColors: ["#496758", "#21372D"],
    accent: "#8FA899",
    pages,
    pageTitles,
    format: "webclip",
    sourceUrl: stableUrl,
    tocUrl: extraction.tocUrl,
    webChapters: chapters,
    webNextUrl: extraction.nextUrl,
    webCurrentChapterIndex: currentIndex,
    importedAt: Date.now(),
  };
}

export function estimateWebCapturePageTarget(
  width: number,
  height: number,
  preferences: ReaderPreferences,
) {
  const columnWidth = Math.min(Math.max(width, 280), 760);
  const textWidth = Math.max(
    180,
    columnWidth - preferences.horizontalPadding * 2,
  );
  const glyphWidth = Math.max(preferences.fontSize * 1.04, 1);
  const charactersPerLine = Math.max(10, Math.floor(textWidth / glyphWidth));
  const lineHeight = Math.max(
    preferences.fontSize * preferences.lineHeight,
    preferences.fontSize,
  );
  const readingHeight = Math.max(260, height - 116);
  const estimatedParagraphs = Math.max(1, Math.floor(readingHeight / lineHeight / 5));
  const paragraphSpace = estimatedParagraphs * preferences.paragraphSpacing;
  const linesPerPage = Math.max(
    8,
    Math.floor((readingHeight - paragraphSpace) / lineHeight),
  );

  return Math.max(
    220,
    Math.min(1200, Math.floor(charactersPerLine * linesPerPage * 0.9)),
  );
}

export function repaginateWebCaptureBook(book: Book, pageTarget: number): Book {
  if (book.format !== "webclip" || !book.webChapters?.length) return book;

  const pages: string[] = [];
  const pageTitles: string[] = [];
  book.webChapters.forEach((chapter) => {
    const chapterPages = paginateOnlineText(chapter.content, pageTarget);
    pages.push(...chapterPages);
    pageTitles.push(...chapterPages.map(() => chapter.title));
  });

  return { ...book, pages, pageTitles };
}
export function createWebCaptureExtraction(book: Book): WebPageExtraction | undefined {
  if (book.format !== "webclip") return undefined;
  const chapters = book.webChapters?.length ? book.webChapters : recoverLegacyChapters(book);
  if (!chapters.length) return undefined;
  const currentIndex = Math.min(Math.max(book.webCurrentChapterIndex ?? 0, 0), chapters.length - 1);
  const current = chapters[currentIndex] ?? chapters[0];

  return {
    bookTitle: book.title,
    title: current.title,
    author: book.author,
    content: current.content,
    url: current.url,
    nextUrl: book.webNextUrl,
    tocUrl: book.tocUrl,
    chapters,
  };
}

function recoverLegacyChapters(book: Book): WebChapterExtraction[] {
  if (!book.pages.length) return [];
  const chapters: WebChapterExtraction[] = [];
  let activeTitle = book.pageTitles?.[0] || book.currentChapter || "正文";
  let activePages: string[] = [];

  const flush = () => {
    if (!activePages.length) return;
    const index = chapters.length;
    chapters.push({
      title: activeTitle,
      content: activePages.join("\n\n"),
      url: (book.sourceUrl || "about:blank") + (index ? "#modu-chapter-" + (index + 1) : ""),
    });
    activePages = [];
  };

  book.pages.forEach((page, index) => {
    const title = book.pageTitles?.[index] || activeTitle;
    if (title !== activeTitle) {
      flush();
      activeTitle = title;
    }
    activePages.push(page);
  });
  flush();
  return chapters;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}
