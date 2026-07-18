export type AppTab = 'shelf' | 'settings';
export type ReaderTheme = 'paper' | 'white' | 'green' | 'night';
export type PageTurn = 'slide' | 'cover' | 'none';
export type BookFormat = 'sample' | 'epub' | 'pdf' | 'txt' | 'web' | 'webclip';
export type ReaderOrientation = 'auto' | 'portrait' | 'landscape';
export type TextAlignment = 'left' | 'justify';
export type WebReaderFlow = 'paged' | 'scroll';
export type ReaderFont = 'serif' | 'sans' | 'system';

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  progress: number;
  currentChapter: string;
  lastRead: string;
  coverColors: readonly [string, string, ...string[]];
  accent: string;
  darkCover?: boolean;
  pages: string[];
  pageTitles?: string[];
  format: BookFormat;
  fileUri?: string;
  contentUri?: string;
  importedAt?: number;
  sourceSize?: number;
  sourceId?: string;
  bookUrl?: string;
  tocUrl?: string;
  coverUrl?: string;
  sourceUrl?: string;
  webChapters?: WebChapterExtraction[];
  webNextUrl?: string;
  webCurrentChapterIndex?: number;
  onlineChapterIndex?: number;
  onlineChapterUrl?: string;
  onlineChapters?: OnlineChapter[];
  onlineChapterCount?: number;
  downloadedChapterCount?: number;
  fullyDownloaded?: boolean;
}

export interface WebChapterExtraction {
  title: string;
  content: string;
  url: string;
}

export interface WebPageExtraction {
  bookTitle?: string;
  title: string;
  author?: string;
  content: string;
  url: string;
  nextUrl?: string;
  tocUrl?: string;
  chapters?: WebChapterExtraction[];
}

export interface ReaderPreferences {
  theme: ReaderTheme;
  fontFamily: ReaderFont;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  horizontalPadding: number;
  textAlignment: TextAlignment;
  pageTurn: PageTurn;
  tapToTurn: boolean;
  keepScreenAwake: boolean;
  volumeKeys: boolean;
  autoSync: boolean;
  notifications: boolean;
  reminderHour: number;
  reminderMinute: number;
  orientation: ReaderOrientation;
  followSystemBrightness: boolean;
  brightness: number;
  showProgress: boolean;
  immersiveMode: boolean;
  webReaderFlow: WebReaderFlow;
}

export interface ReadingProgress {
  pageIndex: number;
  updatedAt: number;
}


export interface BookSourceConfig {
  bookSourceName: string;
  bookSourceUrl: string;
  bookSourceGroup?: string;
  enabled?: boolean;
  header?: string | Record<string, string>;
  searchUrl?: string;
  ruleSearch?: Record<string, string>;
  ruleBookInfo?: Record<string, string>;
  ruleToc?: Record<string, string>;
  ruleContent?: Record<string, string>;
  sourceFormat?: 'legado' | 'so-novel';
  soNovel?: SoNovelSourceRule;
  [key: string]: unknown;
}

export interface SoNovelRuleSection {
  disabled?: boolean;
  baseUri?: string;
  timeout?: number;
  url?: string;
  method?: string;
  data?: string | Record<string, unknown>;
  cookies?: string;
  result?: string;
  bookName?: string;
  author?: string;
  intro?: string;
  category?: string;
  coverUrl?: string;
  latestChapter?: string;
  latestChapterUrl?: string;
  lastUpdateTime?: string;
  status?: string;
  wordCount?: string;
  nextPage?: string;
  list?: string;
  item?: string;
  isDesc?: boolean;
  title?: string;
  content?: string;
  paragraphTagClosed?: boolean;
  paragraphTag?: string;
  filterTxt?: string;
  filterTag?: string;
  nextPageInJs?: boolean;
  nextChapterLink?: string;
  [key: string]: unknown;
}

export interface SoNovelSourceRule {
  url: string;
  name: string;
  comment?: string;
  language?: string;
  disabled?: boolean;
  search?: SoNovelRuleSection;
  book?: SoNovelRuleSection;
  toc?: SoNovelRuleSection;
  chapter?: SoNovelRuleSection;
  crawl?: {
    threads?: number;
    minInterval?: number;
    maxInterval?: number;
    maxRetry?: number;
    retryMinInterval?: number;
    retryMaxInterval?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ImportedBookSource {
  id: string;
  importUrl?: string;
  config: BookSourceConfig;
  importedAt: number;
  updatedAt: number;
  enabled: boolean;
}

export interface OnlineBookResult {
  sourceId: string;
  sourceName?: string;
  name: string;
  author: string;
  bookUrl: string;
  tocUrl?: string;
  coverUrl?: string;
  intro?: string;
  wordCount?: string;
  latestChapter?: string;
}

export interface OnlineChapter {
  name: string;
  url: string;
}
