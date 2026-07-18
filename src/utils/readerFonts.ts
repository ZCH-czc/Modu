import type { ReaderFont } from "../types";

export const readerFontOptions: Array<{
  key: ReaderFont;
  label: string;
  sample: string;
}> = [
  { key: "serif", label: "书卷宋体", sample: "山川入卷" },
  { key: "sans", label: "清雅黑体", sample: "清风徐来" },
  { key: "system", label: "随系统", sample: "一页安然" },
];

export function getReaderFontFamily(font: ReaderFont): string | undefined {
  if (font === "serif") return "serif";
  if (font === "sans") return "sans-serif";
  return undefined;
}