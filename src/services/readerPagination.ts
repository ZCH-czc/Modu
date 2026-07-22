import type { ReaderPreferences } from "../types";

export type ReaderPaginationLayout = {
  charactersPerLine: number;
  lineBudget: number;
  paragraphGapLines: number;
};

export type ReaderTextMeasurement = {
  lineLengths: number[];
  lineHeight: number;
  viewportHeight: number;
};

export function createMeasuredReaderPaginationLayout(
  measurement: ReaderTextMeasurement,
  preferences: ReaderPreferences,
): ReaderPaginationLayout {
  const completeLineLengths = measurement.lineLengths
    .filter((length) => Number.isFinite(length) && length > 0)
    .sort((left, right) => left - right);
  const middle = Math.floor(completeLineLengths.length / 2);
  const medianLength = completeLineLengths.length
    ? completeLineLengths[middle]
    : 10;
  const measuredLineHeight = Math.max(
    measurement.lineHeight,
    preferences.fontSize,
  );
  const readingHeight = Math.max(160, measurement.viewportHeight - 100);

  return {
    // Keep one glyph of reserve for punctuation and mixed-width Latin text.
    charactersPerLine: Math.max(8, Math.floor(medianLength) - 1),
    lineBudget: Math.max(6, Math.floor(readingHeight / measuredLineHeight) - 1),
    paragraphGapLines: Math.max(
      0,
      preferences.paragraphSpacing / measuredLineHeight,
    ),
  };
}

export function createReaderPaginationLayout(
  width: number,
  height: number,
  preferences: ReaderPreferences,
): ReaderPaginationLayout {
  const columnWidth = Math.min(Math.max(width, 280), 760);
  const textWidth = Math.max(180, columnWidth - preferences.horizontalPadding * 2);
  const glyphWidth = Math.max(preferences.fontSize * 1.04 + 0.25, 1);
  const lineHeight = Math.max(
    preferences.fontSize * preferences.lineHeight,
    preferences.fontSize,
  );
  const readingHeight = Math.max(260, height - 164);

  return {
    charactersPerLine: Math.max(10, Math.floor(textWidth / glyphWidth)),
    lineBudget: Math.max(8, Math.floor(readingHeight / lineHeight) - 1),
    paragraphGapLines: Math.max(0, preferences.paragraphSpacing / lineHeight),
  };
}

export function paginateTextForReader(
  text: string,
  layout: ReaderPaginationLayout,
): string[] {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const pages: string[] = [];
  let page: string[] = [];
  let usedLines = 0;

  const flush = () => {
    if (page.length) pages.push(page.join("\n\n"));
    page = [];
    usedLines = 0;
  };

  paragraphs.forEach((paragraph) => {
    let remaining = paragraph;
    while (remaining) {
      const gap = page.length ? layout.paragraphGapLines : 0;
      const availableLines = Math.floor(layout.lineBudget - usedLines - gap);
      if (availableLines < 1) {
        flush();
        continue;
      }

      const requiredLines = Math.max(
        1,
        Math.ceil(remaining.length / layout.charactersPerLine),
      );
      if (requiredLines <= availableLines) {
        page.push(remaining);
        usedLines += gap + requiredLines;
        remaining = "";
        continue;
      }

      const capacity = Math.max(1, availableLines * layout.charactersPerLine);
      const splitAt = findNaturalSplit(remaining, capacity);
      page.push(remaining.slice(0, splitAt).trim());
      remaining = remaining.slice(splitAt).trim();
      flush();
    }
  });

  flush();
  return pages.length ? pages : [""];
}

function findNaturalSplit(text: string, capacity: number) {
  if (text.length <= capacity) return text.length;
  const minimum = Math.floor(capacity * 0.72);
  for (let index = capacity - 1; index >= minimum; index -= 1) {
    if (/[,.;!?，。；！？、\s]/.test(text[index] ?? "")) return index + 1;
  }
  return capacity;
}
