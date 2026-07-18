import { paginateOnlineText } from "./bookSources";
import type { Book, WebChapterExtraction, WebPageExtraction } from "../types";

export function createWebCaptureBook(extraction: WebPageExtraction): Book {
  const chapters = extraction.chapters?.length
    ? extraction.chapters
    : [{ title: extraction.title || "正文", content: extraction.content, url: extraction.url }];
  const currentIndex = Math.max(0, chapters.findIndex((chapter) => chapter.url === extraction.url));
  const currentChapter = chapters[currentIndex] ?? chapters[0];
  const stableUrl = chapters[0]?.url || extraction.url;
  const pages: string[] = [];
  const pageTitles: string[] = [];

  chapters.forEach((chapter) => {
    const chapterPages = paginateOnlineText(chapter.content, 760);
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
