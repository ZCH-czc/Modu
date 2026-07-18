import type { Book } from "../types";
import type { ResolvedLanguage } from "../i18n";

const zhPages = [
  "雨从凌晨开始下，到清晨时已经变得很轻。窗沿积着一层薄薄的水，远处屋顶的颜色被洗得柔和，像一幅还没有完全干透的画。\n\n我把书摊开放在桌上，却迟迟没有翻页。那些句子安静地停在那里，仿佛知道一个人真正需要的并不是答案，而是一段可以慢下来的时间。",
  "后来我才明白，阅读并不总是为了抵达某处。更多时候，它像是在一条陌生的小路上散步。你不知道转角会遇见什么，但风、树影和偶然响起的鸟鸣，都在悄悄改变你看待世界的方式。",
  "午后的光线移过书页，纸张泛起温暖的颜色。我在一行字旁停下来，想起很久以前的某个夏天。我们以为自己在读别人的故事，其实常常是在故事里辨认自己。",
  "夜色落下来，城市的灯一盏盏亮起。合上书时，房间比开始阅读前更安静了一些。好的文字不会替你做决定，它只是把一扇窗推开，让你看见原来还有另一种光。",
];

const enPages = [
  "Rain had been falling since before dawn, but by morning it had softened to a whisper. A thin line of water rested on the sill, and the roofs beyond the window looked newly washed, like a painting still waiting to dry.\n\nI left the book open on the table without turning the page. The sentences waited quietly, as if they knew that what a person sometimes needs is not an answer, but a little time in which to slow down.",
  "I came to understand that reading is not always about arriving somewhere. More often it resembles a walk along an unfamiliar path. You cannot know what waits beyond the bend, yet the wind, the shadows of trees, and a sudden birdcall quietly change the way you see the world.",
  "Afternoon light moved across the page and warmed the paper. I paused beside a single line and remembered a summer from long ago. We think we are reading someone else’s story, but often we are learning to recognize ourselves.",
  "Night settled over the city and the lamps came on one by one. When I closed the book, the room felt quieter than before. Good writing does not make your choices for you. It opens a window and lets you discover another kind of light.",
];

export function getSampleBooks(language: ResolvedLanguage): Book[] {
  const english = language === "en";
  return [{
    id: "quiet-pages",
    title: english ? "Quiet Pages" : "静静的书页",
    author: english ? "Modu Editorial" : "墨读编辑部",
    category: english ? "Essay" : "随笔",
    progress: 0,
    currentChapter: english ? "Chapter 1 · Morning Rain" : "第一章 · 晨雨",
    lastRead: english ? "A sample for you" : "为你准备的样书",
    coverColors: ["#314D40", "#17271F", "#B99762"],
    accent: "#D5B77D",
    darkCover: true,
    pages: english ? enPages : zhPages,
    pageTitles: english
      ? ["Morning Rain", "The Unknown Path", "A Summer Line", "Another Kind of Light"]
      : ["晨雨", "陌生的小路", "夏日的一行字", "另一种光"],
    format: "sample",
  }];
}

export const sampleBookIds = ["quiet-pages"] as const;
