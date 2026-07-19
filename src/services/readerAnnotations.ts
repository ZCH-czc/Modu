import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import type { Book, ReaderAnnotation } from "../types";

const ANNOTATIONS_KEY = "modu.reader-annotations.v1";

export async function loadAnnotations(): Promise<ReaderAnnotation[]> {
  const stored = await AsyncStorage.getItem(ANNOTATIONS_KEY);
  if (!stored) return [];
  try {
    const annotations = JSON.parse(stored) as unknown;
    if (!Array.isArray(annotations)) return [];
    return annotations.filter((annotation): annotation is ReaderAnnotation =>
      Boolean(
        annotation &&
        typeof annotation === "object" &&
        typeof (annotation as ReaderAnnotation).id === "string" &&
        typeof (annotation as ReaderAnnotation).bookId === "string" &&
        typeof (annotation as ReaderAnnotation).quote === "string" &&
        Number.isInteger((annotation as ReaderAnnotation).pageIndex) &&
        Number.isInteger((annotation as ReaderAnnotation).paragraphIndex),
      ),
    );
  } catch {
    return [];
  }
}

export async function saveAnnotations(annotations: ReaderAnnotation[]) {
  await AsyncStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
}

export function migrateAnnotationsForPagination(
  annotations: ReaderAnnotation[],
  bookId: string,
  pages: string[],
) {
  return annotations.map((annotation) => {
    if (annotation.bookId !== bookId) return annotation;
    const pageIndex = pages.findIndex((page) => page.includes(annotation.quote));
    if (pageIndex < 0) {
      return {
        ...annotation,
        pageIndex: Math.min(annotation.pageIndex, Math.max(pages.length - 1, 0)),
      };
    }
    const paragraphs = pages[pageIndex]
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const paragraphIndex = Math.max(
      0,
      paragraphs.findIndex((paragraph) => paragraph.includes(annotation.quote)),
    );
    return { ...annotation, pageIndex, paragraphIndex };
  });
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}\[\]<>#])/g, "\\$1");
}

export async function exportAnnotationsMarkdown(
  annotations: ReaderAnnotation[],
  books: Book[],
) {
  if (!annotations.length) throw new Error("还没有可以导出的批注。");
  if (Platform.OS !== "android") {
    throw new Error("当前版本仅支持在 Android 上选择批注保存位置。");
  }
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { canceled: true as const };
  const bookMap = new Map(books.map((book) => [book.id, book]));
  const grouped = new Map<string, ReaderAnnotation[]>();
  [...annotations]
    .sort((left, right) => left.createdAt - right.createdAt)
    .forEach((annotation) => {
      grouped.set(annotation.bookId, [...(grouped.get(annotation.bookId) ?? []), annotation]);
    });

  const lines = ["# Modu Reading Notes", "", `Exported: ${new Date().toLocaleString()}`, ""];
  grouped.forEach((items, bookId) => {
    const book = bookMap.get(bookId);
    lines.push(`## ${escapeMarkdown(book?.title ?? items[0]?.chapterTitle ?? "Untitled")}`, "");
    items.forEach((annotation) => {
      lines.push(
        `### ${escapeMarkdown(annotation.chapterTitle)} · Page ${annotation.pageIndex + 1}`,
        "",
        `> ${annotation.quote.replace(/\n+/g, " ")}`,
        "",
      );
      if (annotation.note.trim()) lines.push(annotation.note.trim(), "");
      lines.push(`_${new Date(annotation.updatedAt).toLocaleString()}_`, "", "---", "");
    });
  });
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    `Modu-notes-${new Date().toISOString().slice(0, 10)}.md`,
    "text/markdown",
  );
  await FileSystem.writeAsStringAsync(uri, lines.join("\n"), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return { canceled: false as const, uri };
}