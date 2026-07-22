import {
  Ionicons } from "@expo/vector-icons";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  } from "expo-keep-awake";
import { useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from "react-native";
import { Text, TextInput, useI18n } from "../i18n";
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
  AnnotationColor,
  Book,
  ReaderAnnotation,
  ReaderBookmark,
  ReaderPreferences,
  ReaderTheme,
} from "../types";
import { getReaderFontFamily } from "../utils/readerFonts";
import { IOSPopupModal } from "../components/IOSPopupModal";
import {
  createMeasuredReaderPaginationLayout,
  type ReaderPaginationLayout,
} from "../services/readerPagination";
import {
  setVolumeKeyTurnsEnabled,
  subscribeToVolumeKeyTurns,
  supportsVolumeKeyTurns,
} from "../services/readerControls";

type ReaderScreenProps = {
  book: Book;
  annotations: ReaderAnnotation[];
  bookmarks: ReaderBookmark[];
  preferences: ReaderPreferences;
  initialPage: number;
  onBack: () => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSaveAnnotation: (annotation: ReaderAnnotation) => void;
  onToggleBookmark: (pageIndex: number, chapterTitle: string, excerpt: string) => void;
  onPageChange: (pageIndex: number) => void;
  onChapterBoundary?: (direction: -1 | 1) => void;
  onChapterSelect?: (chapterIndex: number, pageIndex?: number) => void;
  onSearchBook?: (query: string) => Promise<ReaderSearchResult[]>;
  canPreviousChapter?: boolean;
  canNextChapter?: boolean;
  onDownloadAll?: () => void;
  onOpenOriginal?: (url?: string) => void;
  downloadProgress?: { completed: number; total: number };
  onPaginationMeasured?: (layout: ReaderPaginationLayout) => void;
};

type ChapterEntry = {
  key: string;
  title: string;
  pageIndex: number;
  onlineIndex?: number;
  localIndex?: number;
  url?: string;
};

type ReaderSearchResult = {
  key: string;
  pageIndex: number;
  chapterIndex?: number;
  chapterTitle: string;
  excerpt: string;
  matchStart: number;
  matchLength: number;
};

type ReaderPageRuntimeState = {
  bookKey: string;
  phase: "ready" | "turning" | "settling";
  currentIndex: number;
  targetIndex?: number;
};

const annotationColors: Record<AnnotationColor, { fill: string; stroke: string }> = {
  amber: { fill: "rgba(222, 174, 77, 0.2)", stroke: "#B98936" },
  green: { fill: "rgba(102, 151, 116, 0.2)", stroke: "#5C8B69" },
  blue: { fill: "rgba(91, 132, 177, 0.18)", stroke: "#557DA7" },
  rose: { fill: "rgba(181, 105, 112, 0.18)", stroke: "#A66168" },
};

const READER_SEARCH_RESULT_LIMIT = 60;

function createReaderSearchResult(
  page: string,
  pageIndex: number,
  chapterTitle: string,
  query: string,
): ReaderSearchResult | undefined {
  const compactPage = page.replace(/\s+/g, " ").trim();
  const compactTitle = chapterTitle.replace(/\s+/g, " ").trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const titleMatch = compactTitle.toLocaleLowerCase().indexOf(normalizedQuery);
  const pageMatch = compactPage.toLocaleLowerCase().indexOf(normalizedQuery);
  if (titleMatch < 0 && pageMatch < 0) return undefined;

  if (pageMatch < 0) {
    return {
      key: `search-${pageIndex}`,
      pageIndex,
      chapterTitle,
      excerpt: compactPage.slice(0, 92),
      matchStart: -1,
      matchLength: 0,
    };
  }

  const excerptStart = Math.max(0, pageMatch - 34);
  const excerptEnd = Math.min(compactPage.length, pageMatch + query.length + 58);
  const prefix = excerptStart > 0 ? "…" : "";
  const suffix = excerptEnd < compactPage.length ? "…" : "";
  return {
    key: `search-${pageIndex}`,
    pageIndex,
    chapterTitle,
    excerpt: `${prefix}${compactPage.slice(excerptStart, excerptEnd)}${suffix}`,
    matchStart: prefix.length + pageMatch - excerptStart,
    matchLength: query.length,
  };
}

const READER_CALIBRATION_TEXT =
  "山川风月落在纸上，故事沿着灯火缓缓展开。天地玄黄宇宙洪荒，晨昏四季往来不息。".repeat(12);

const themes: Record<
  ReaderTheme,
  { background: string; text: string; muted: string; panel: string; accent: string }
> = {
  paper: {
    background: "#F5EBD8",
    text: "#3E342B",
    muted: "#88776A",
    panel: "#EFE0C6",
    accent: "#B46C45",
  },
  white: {
    background: "#FAFAF8",
    text: "#242422",
    muted: "#777772",
    panel: "#F0F0EC",
    accent: "#5B7553",
  },
  green: {
    background: "#DDE8D8",
    text: "#26372A",
    muted: "#657568",
    panel: "#CEDDC8",
    accent: "#4E7358",
  },
  night: {
    background: "#151816",
    text: "#D8DDD8",
    muted: "#7D897F",
    panel: "#222723",
    accent: "#87A68E",
  },
};

type ReaderParagraphPageProps = {
  annotations?: ReaderAnnotation[];
  fontFamily?: string;
  fontSize: number;
  lineHeight: number;
  onParagraphLayout?: (
    paragraphIndex: number,
    quote: string,
    y: number,
    height: number,
  ) => void;
  pageIndex: number;
  paragraphSpacing: number;
  paragraphs: string[];
  selectable?: boolean;
  textAlignment: ReaderPreferences["textAlignment"];
  textColor: string;
};

const ReaderParagraphPage = memo(function ReaderParagraphPage({
  annotations = [],
  fontFamily,
  fontSize,
  lineHeight,
  onParagraphLayout,
  pageIndex,
  paragraphSpacing,
  paragraphs,
  selectable = false,
  textAlignment,
  textColor,
}: ReaderParagraphPageProps) {
  const annotationByParagraph = useMemo(() => {
    const lookup = new Map<number, ReaderAnnotation>();
    annotations.forEach((annotation) => {
      if (annotation.pageIndex === pageIndex) {
        lookup.set(annotation.paragraphIndex, annotation);
      }
    });
    return lookup;
  }, [annotations, pageIndex]);

  return (
    <>
      {paragraphs.map((paragraph, paragraphIndex) => {
        const annotation = annotationByParagraph.get(paragraphIndex);
        const matchingAnnotation = annotation?.quote === paragraph ? annotation : undefined;
        return (
          <Text
            key={`${pageIndex}-${paragraphIndex}`}
            onLayout={onParagraphLayout ? (event) => {
              onParagraphLayout(
                paragraphIndex,
                paragraph,
                event.nativeEvent.layout.y,
                event.nativeEvent.layout.height,
              );
            } : undefined}
            selectable={selectable}
            suppressHighlighting
            style={[
              styles.paragraph,
              {
                color: textColor,
                fontFamily,
                fontSize,
                lineHeight,
                marginBottom: paragraphSpacing,
                textAlign: textAlignment,
              },
              matchingAnnotation ? {
                backgroundColor: annotationColors[matchingAnnotation.color].fill,
                textDecorationColor: annotationColors[matchingAnnotation.color].stroke,
                textDecorationLine: "underline" as const,
              } : undefined,
            ]}
          >
            {paragraph}
          </Text>
        );
      })}
    </>
  );
});

export function ReaderScreen({
  book,
  annotations,
  bookmarks,
  preferences,
  initialPage,
  onBack,
  onDeleteAnnotation,
  onSaveAnnotation,
  onToggleBookmark,
  onPageChange,
  onChapterBoundary,
  onChapterSelect,
  onSearchBook,
  canPreviousChapter = false,
  canNextChapter = false,
  onDownloadAll,
  onOpenOriginal,
  downloadProgress,
  onPaginationMeasured,
}: ReaderScreenProps) {
  const { resolvedLanguage } = useI18n();
  const [pageIndex, setPageIndex] = useState(() =>
    Math.max(0, Math.min(initialPage, book.pages.length - 1)),
  );
  const [pageGestureLocked, setPageGestureLocked] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(
    !preferences.immersiveMode,
  );
  const [chapterVisible, setChapterVisible] = useState(false);
  const [chapterSearchQuery, setChapterSearchQuery] = useState("");
  const [chapterSearchResults, setChapterSearchResults] = useState<ReaderSearchResult[]>([]);
  const [chapterSearching, setChapterSearching] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<{
    existing?: ReaderAnnotation;
    paragraphIndex: number;
    quote: string;
    note: string;
    color: AnnotationColor;
  }>();
  const [pageViewportHeight, setPageViewportHeight] = useState(0);
  const [completedCalibrationKey, setCompletedCalibrationKey] = useState("");
  const [settlementPageIndex, setSettlementPageIndex] = useState<number>();
  const chapterSheetProgress = useRef(new Animated.Value(0)).current;
  const bookmarkScale = useRef(new Animated.Value(1)).current;
  const dragTranslate = useRef(new Animated.Value(0)).current;
  const settlementOpacity = useRef(new Animated.Value(0)).current;
  const pageAnimatingRef = useRef(false);
  const pendingPageResetRef = useRef<number | undefined>(undefined);
  const settlementPageIndexRef = useRef<number | undefined>(undefined);
  const pendingSettlementFrameRef = useRef(0);
  const calibrationSentRef = useRef("");
  const paragraphLayoutsRef = useRef(new Map<number, { y: number; height: number; quote: string }>());
  const paragraphLayoutPageKeyRef = useRef("");
  const longPressConsumedRef = useRef(false);
  const gestureGuideRef = useRef<View>(null);
  const backGuideRef = useRef<View>(null);
  const bookmarkGuideRef = useRef<View>(null);
  const chapterGuideRef = useRef<View>(null);
  const pageCacheRef = useRef(new Map<number, string[]>());
  const pageBookKey = `${book.id}:${book.localChapterIndex ?? book.onlineChapterIndex ?? "all"}:${book.pages.length}:${book.paginationVersion ?? 0}`;
  const paragraphLayoutPageKey = `${pageBookKey}:${pageIndex}`;
  if (paragraphLayoutPageKeyRef.current !== paragraphLayoutPageKey) {
    paragraphLayoutPageKeyRef.current = paragraphLayoutPageKey;
    paragraphLayoutsRef.current.clear();
  }
  const pageRuntimeRef = useRef<ReaderPageRuntimeState>({
    bookKey: pageBookKey,
    currentIndex: pageIndex,
    phase: "ready",
  });
  if (pageRuntimeRef.current.bookKey !== pageBookKey) {
    pageCacheRef.current.clear();
    pageRuntimeRef.current = {
      bookKey: pageBookKey,
      currentIndex: pageIndex,
      phase: "ready",
    };
  }
  const controlsOpacity = useRef(
    new Animated.Value(preferences.immersiveMode ? 0 : 1),
  ).current;
  const palette = themes[preferences.theme];
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const readingColumnWidth = Math.min(screenWidth, screenWidth >= 600 ? 560 : 760);
  const chromeWidth = Math.min(screenWidth - 20, 860);
  const chromeLeft = (screenWidth - chromeWidth) / 2;
  const chapterSheetWidth = Math.min(screenWidth, 760);
  const chapterSheetLeft = (screenWidth - chapterSheetWidth) / 2;
  const calibrationKey = [
    readingColumnWidth,
    pageViewportHeight,
    preferences.fontFamily,
    preferences.fontSize,
    preferences.lineHeight,
    preferences.horizontalPadding,
    preferences.paragraphSpacing,
  ].join(":");
  const paginationReady = !onPaginationMeasured || completedCalibrationKey === calibrationKey;
  const handleCalibrationTextLayout = useCallback(
    (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (!onPaginationMeasured || pageViewportHeight <= 0) return;
      const lines = event.nativeEvent.lines;
      if (lines.length < 3 || calibrationSentRef.current === calibrationKey) return;
      const completeLines = lines.slice(0, -1);
      const measuredHeights = completeLines
        .map((line) => line.height)
        .filter((height) => Number.isFinite(height) && height > 0)
        .sort((left, right) => left - right);
      const measuredLineHeight = measuredHeights[
        Math.floor(measuredHeights.length / 2)
      ] ?? preferences.fontSize * preferences.lineHeight;
      calibrationSentRef.current = calibrationKey;
      setCompletedCalibrationKey(calibrationKey);
      onPaginationMeasured(
        createMeasuredReaderPaginationLayout(
          {
            lineLengths: completeLines.map((line) => line.text.length),
            lineHeight: measuredLineHeight,
            viewportHeight: pageViewportHeight,
          },
          preferences,
        ),
      );
    },
    [
      calibrationKey,
      onPaginationMeasured,
      pageViewportHeight,
      preferences,
    ],
  );

  const chapterEntries = useMemo<ChapterEntry[]>(() => {
    if (book.localChapterManifest?.length) {
      return book.localChapterManifest.map((chapter, index) => ({
        key: chapter.uri,
        title: chapter.title || `第 ${index + 1} 章`,
        pageIndex: 0,
        localIndex: index,
      }));
    }
    if (book.onlineChapters?.length) {
      return book.onlineChapters.map((chapter, index) => ({
        key: chapter.url + "-" + index,
        title: chapter.name || `第 ${index + 1} 章`,
        pageIndex: 0,
        onlineIndex: index,
      }));
    }
    if (book.format === "webclip" && book.webChapters?.length) {
      const titles = book.pageTitles ?? [];
      let searchFrom = 0;
      return book.webChapters.map((chapter, index) => {
        let chapterPage = titles.findIndex(
          (title, page) => page >= searchFrom && title?.trim() === chapter.title?.trim(),
        );
        if (chapterPage < 0) chapterPage = Math.min(searchFrom, Math.max(book.pages.length - 1, 0));
        searchFrom = chapterPage + 1;
        return {
          key: chapter.url + "-" + index,
          title: chapter.title || `第 ${index + 1} 章`,
          pageIndex: chapterPage,
          url: chapter.url,
        };
      });
    }
    const titles = book.pageTitles ?? [];
    if (!titles.length) {
      return [{ key: "body", title: "正文", pageIndex: 0 }];
    }
    const entries: ChapterEntry[] = [];
    let previousTitle = "";
    for (let index = 0; index < book.pages.length; index += 1) {
      const title = titles[index]?.trim() || "正文";
      if (index === 0 || title !== previousTitle) {
        entries.push({ key: title + "-" + index, title, pageIndex: index });
      }
      previousTitle = title;
    }
    return entries.length ? entries : [{ key: "body", title: "正文", pageIndex: 0 }];
  }, [
    book.format,
    book.localChapterManifest,
    book.onlineChapters,
    book.pageTitles,
    book.pages.length,
    book.webChapters,
  ]);

  const currentChapterListIndex = useMemo(() => {
    if (book.localChapterManifest?.length) {
      return Math.max(0, chapterEntries.findIndex(
        (entry) => entry.localIndex === (book.localChapterIndex ?? 0),
      ));
    }
    if (book.onlineChapters?.length) {
      return Math.max(0, chapterEntries.findIndex(
        (entry) => entry.onlineIndex === (book.onlineChapterIndex ?? 0),
      ));
    }
    let current = 0;
    chapterEntries.forEach((entry, index) => {
      if (entry.pageIndex <= pageIndex) current = index;
    });
    return current;
  }, [
    book.localChapterIndex,
    book.localChapterManifest,
    book.onlineChapterIndex,
    book.onlineChapters,
    chapterEntries,
    pageIndex,
  ]);

  const currentOriginalUrl = chapterEntries[currentChapterListIndex]?.url || book.sourceUrl;
  const currentBookmark = bookmarks.find((bookmark) => bookmark.pageIndex === pageIndex);
  const toggleCurrentBookmark = useCallback(() => {
    const chapterTitle = book.pageTitles?.[pageIndex] || `第 ${pageIndex + 1} 页`;
    const excerpt = (book.pages[pageIndex] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 72);
    bookmarkScale.stopAnimation();
    Animated.sequence([
      Animated.timing(bookmarkScale, {
        toValue: 0.82,
        duration: 80,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(bookmarkScale, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    onToggleBookmark(pageIndex, chapterTitle, excerpt);
  }, [
    book.pageTitles,
    book.pages,
    bookmarkScale,
    onToggleBookmark,
    pageIndex,
  ]);

  const openChapterList = useCallback(() => {
    chapterSheetProgress.setValue(0);
    setChapterVisible(true);
    requestAnimationFrame(() => {
      Animated.timing(chapterSheetProgress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [chapterSheetProgress]);

  const closeChapterList = useCallback(() => {
    Animated.timing(chapterSheetProgress, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setChapterVisible(false);
        setChapterSearchQuery("");
        setChapterSearchResults([]);
        setChapterSearching(false);
      }
    });
  }, [chapterSheetProgress]);

  const closeChapterListImmediately = useCallback(() => {
    Keyboard.dismiss();
    chapterSheetProgress.stopAnimation();
    chapterSheetProgress.setValue(0);
    setChapterVisible(false);
    setChapterSearchQuery("");
    setChapterSearchResults([]);
    setChapterSearching(false);
  }, [chapterSheetProgress]);

  useEffect(() => {
    const query = chapterSearchQuery.trim();
    if (!query) {
      setChapterSearchResults([]);
      setChapterSearching(false);
      return undefined;
    }

        if (onSearchBook) {
      let cancelled = false;
      setChapterSearching(true);
      const searchTimer = setTimeout(() => {
        void onSearchBook(query)
          .then((results) => {
            if (!cancelled) setChapterSearchResults(results);
          })
          .catch(() => {
            if (!cancelled) setChapterSearchResults([]);
          })
          .finally(() => {
            if (!cancelled) setChapterSearching(false);
          });
      }, 160);
      return () => {
        cancelled = true;
        clearTimeout(searchTimer);
      };
    }
let cancelled = false;
    let pageCursor = 0;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    const results: ReaderSearchResult[] = [];
    setChapterSearching(true);

    const scanNextBatch = () => {
      if (cancelled) return;
      const batchEnd = Math.min(pageCursor + 80, book.pages.length);
      while (pageCursor < batchEnd && results.length < READER_SEARCH_RESULT_LIMIT) {
        const chapterTitle = book.pageTitles?.[pageCursor]
          || book.onlineChapters?.[book.onlineChapterIndex ?? 0]?.name
          || (resolvedLanguage === "en" ? `Page ${pageCursor + 1}` : `第 ${pageCursor + 1} 页`);
        const result = createReaderSearchResult(
          book.pages[pageCursor] ?? "",
          pageCursor,
          chapterTitle,
          query,
        );
        if (result) results.push(result);
        pageCursor += 1;
      }

      if (pageCursor < book.pages.length && results.length < READER_SEARCH_RESULT_LIMIT) {
        scanTimer = setTimeout(scanNextBatch, 0);
        return;
      }
      if (!cancelled) {
        setChapterSearchResults(results);
        setChapterSearching(false);
      }
    };

    scanTimer = setTimeout(scanNextBatch, 140);
    return () => {
      cancelled = true;
      if (scanTimer) clearTimeout(scanTimer);
    };
  }, [
    book.onlineChapterIndex,
    book.onlineChapters,
    book.pageTitles,
    book.pages,
    chapterSearchQuery,
    onSearchBook,
    resolvedLanguage,
  ]);

  useEffect(() => {
    if (!chapterVisible) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeChapterList();
      return true;
    });
    return () => subscription.remove();
  }, [chapterVisible, closeChapterList]);

  useEffect(() => {
    if (preferences.keepScreenAwake) {
      void activateKeepAwakeAsync("modu-reader");
    } else {
      deactivateKeepAwake("modu-reader");
    }

    return () => {
      void deactivateKeepAwake("modu-reader");
    };
  }, [preferences.keepScreenAwake]);

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: controlsVisible ? 180 : 130,
      easing: controlsVisible
        ? Easing.out(Easing.cubic)
        : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity, controlsVisible]);

  useEffect(() => {
    if (preferences.immersiveMode) {
      setControlsVisible(false);
    }
  }, [preferences.immersiveMode]);
  const activePageBookKeyRef = useRef(pageBookKey);
  useLayoutEffect(() => {
    if (activePageBookKeyRef.current === pageBookKey) return;
    activePageBookKeyRef.current = pageBookKey;
    const nextPage = Math.max(0, Math.min(initialPage, book.pages.length - 1));
    pageCacheRef.current.clear();
    paragraphLayoutsRef.current.clear();
    pendingPageResetRef.current = undefined;
    cancelAnimationFrame(pendingSettlementFrameRef.current);
    settlementPageIndexRef.current = undefined;
    settlementOpacity.setValue(0);
    setSettlementPageIndex(undefined);
    pageAnimatingRef.current = false;
    setPageGestureLocked(false);
    dragTranslate.setValue(0);
    pageRuntimeRef.current = {
      bookKey: pageBookKey,
      currentIndex: nextPage,
      phase: "ready",
    };
    setPageIndex(nextPage);
  }, [book.pages.length, dragTranslate, initialPage, pageBookKey, settlementOpacity]);

  const getPageParagraphs = useCallback(
    (index: number) => {
      if (index < 0 || index >= book.pages.length) return [];
      const cached = pageCacheRef.current.get(index);
      if (cached) return cached;
      const prepared = splitReaderParagraphs(book.pages[index] ?? "");
      pageCacheRef.current.set(index, prepared);
      return prepared;
    },
    [book.pages],
  );

  const paragraphs = useMemo(
    () => getPageParagraphs(pageIndex),
    [getPageParagraphs, pageIndex],
  );
  const previousParagraphs = useMemo(
    () => getPageParagraphs(pageIndex - 1),
    [getPageParagraphs, pageIndex],
  );
  const nextParagraphs = useMemo(
    () => getPageParagraphs(pageIndex + 1),
    [getPageParagraphs, pageIndex],
  );
  const settlementParagraphs = useMemo(
    () => settlementPageIndex === undefined ? [] : getPageParagraphs(settlementPageIndex),
    [getPageParagraphs, settlementPageIndex],
  );
  const readerFontFamily = getReaderFontFamily(preferences.fontFamily);
  const readerLineHeight = preferences.fontSize * preferences.lineHeight;
  const handleParagraphLayout = useCallback((
    paragraphIndex: number,
    quote: string,
    y: number,
    height: number,
  ) => {
    paragraphLayoutsRef.current.set(paragraphIndex, { y, height, quote });
  }, []);

  useEffect(() => {
    for (const cachedIndex of pageCacheRef.current.keys()) {
      if (Math.abs(cachedIndex - pageIndex) > 2) {
        pageCacheRef.current.delete(cachedIndex);
      }
    }
  }, [pageIndex]);
  const preparePageSettlement = useCallback((next: number) => {
    cancelAnimationFrame(pendingSettlementFrameRef.current);
    settlementOpacity.setValue(0);
    settlementPageIndexRef.current = next;
    setSettlementPageIndex(next);
  }, [settlementOpacity]);

  const clearPageSettlement = useCallback(() => {
    cancelAnimationFrame(pendingSettlementFrameRef.current);
    settlementOpacity.setValue(0);
    settlementPageIndexRef.current = undefined;
    setSettlementPageIndex(undefined);
  }, [settlementOpacity]);

  const finishPageChange = useCallback(
    (next: number) => {
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: next,
        phase: "settling",
      };
      const hasPreparedSettlement = settlementPageIndexRef.current === next;
      if (hasPreparedSettlement) settlementOpacity.setValue(1);
      dragTranslate.setValue(0);
      pendingPageResetRef.current = hasPreparedSettlement ? next : undefined;
      setPageIndex(next);
      onPageChange(next);
      if (!hasPreparedSettlement) {
        pageAnimatingRef.current = false;
        setPageGestureLocked(false);
        pageRuntimeRef.current = {
          bookKey: pageBookKey,
          currentIndex: next,
          phase: "ready",
        };
      }
    },
    [dragTranslate, onPageChange, pageBookKey, settlementOpacity],
  );

  const jumpToPageImmediately = useCallback(
    (requestedPage: number) => {
      const nextPage = Math.max(0, Math.min(requestedPage, book.pages.length - 1));
      dragTranslate.stopAnimation();
      dragTranslate.setValue(0);
      pendingPageResetRef.current = undefined;
      clearPageSettlement();
      pageAnimatingRef.current = false;
      setPageGestureLocked(false);
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: nextPage,
        phase: "ready",
      };
      setPageIndex(nextPage);
      onPageChange(nextPage);
    },
    [book.pages.length, clearPageSettlement, dragTranslate, onPageChange, pageBookKey],
  );

  useLayoutEffect(() => {
    if (pendingPageResetRef.current !== pageIndex) return;
    dragTranslate.setValue(0);
    pendingPageResetRef.current = undefined;
    const firstFrame = requestAnimationFrame(() => {
      const secondFrame = requestAnimationFrame(() => {
        clearPageSettlement();
        pageAnimatingRef.current = false;
        setPageGestureLocked(false);
        pageRuntimeRef.current = {
          bookKey: pageBookKey,
          currentIndex: pageIndex,
          phase: "ready",
        };
      });
      pendingSettlementFrameRef.current = secondFrame;
    });
    pendingSettlementFrameRef.current = firstFrame;
    return () => cancelAnimationFrame(pendingSettlementFrameRef.current);
  }, [clearPageSettlement, dragTranslate, pageBookKey, pageIndex]);
  const selectChapter = useCallback(
    (entry: ChapterEntry) => {
      closeChapterListImmediately();
      if (
        entry.localIndex !== undefined &&
        entry.localIndex !== (book.localChapterIndex ?? 0)
      ) {
        requestAnimationFrame(() => onChapterSelect?.(entry.localIndex!, entry.pageIndex));
        return;
      }
      if (
        entry.onlineIndex !== undefined &&
        entry.onlineIndex !== (book.onlineChapterIndex ?? 0)
      ) {
        requestAnimationFrame(() => onChapterSelect?.(entry.onlineIndex!));
        return;
      }
      const targetPage = entry.onlineIndex !== undefined || entry.localIndex !== undefined
        ? 0
        : entry.pageIndex;
      if (targetPage === pageIndex) return;
      if (Math.abs(targetPage - pageIndex) > 1) {
        jumpToPageImmediately(targetPage);
        return;
      }
      const direction = targetPage > pageIndex ? 1 : -1;
      preparePageSettlement(targetPage);
      pageAnimatingRef.current = true;
      setPageGestureLocked(true);
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "turning",
        targetIndex: targetPage,
      };
      dragTranslate.setValue(0);
      requestAnimationFrame(() => Animated.timing(dragTranslate, {
        duration: 240,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: direction * -screenWidth,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) finishPageChange(targetPage);
        else {
          clearPageSettlement();
          pageAnimatingRef.current = false;
          setPageGestureLocked(false);
          pageRuntimeRef.current = {
            bookKey: pageBookKey,
            currentIndex: pageIndex,
            phase: "ready",
          };
        }
      }));
    },
    [
      book.localChapterIndex,
      book.onlineChapterIndex,
      clearPageSettlement,
      closeChapterListImmediately,
      dragTranslate,
      finishPageChange,
      jumpToPageImmediately,
      onChapterSelect,
      pageBookKey,
      pageIndex,
      preparePageSettlement,
      screenWidth,
    ],
  );

  const selectSearchResult = useCallback(
    (result: ReaderSearchResult) => {
      closeChapterListImmediately();
      if (
        result.chapterIndex !== undefined &&
        result.chapterIndex !== (book.localChapterIndex ?? 0)
      ) {
        const targetChapter = result.chapterIndex;
        requestAnimationFrame(() => {
          onChapterSelect?.(targetChapter, result.pageIndex);
        });
        return;
      }
      jumpToPageImmediately(result.pageIndex);
    },
    [
      book.localChapterIndex,
      closeChapterListImmediately,
      jumpToPageImmediately,
      onChapterSelect,
    ],
  );

  const resetPagePosition = useCallback((translationX = 0) => {
    clearPageSettlement();
    const settleReset = () => {
      pageAnimatingRef.current = false;
      setPageGestureLocked(false);
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "ready",
      };
    };
    const distanceRatio = Math.min(Math.abs(translationX) / screenWidth, 1);
    if (distanceRatio < 0.005) {
      dragTranslate.stopAnimation();
      dragTranslate.setValue(0);
      settleReset();
      return;
    }
    pageAnimatingRef.current = true;
    setPageGestureLocked(true);
    Animated.timing(dragTranslate, {
      toValue: 0,
      duration: Math.max(60, Math.min(200, Math.round(distanceRatio * 240))),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(settleReset);
  }, [clearPageSettlement, dragTranslate, pageBookKey, pageIndex, screenWidth]);
  const changePage = useCallback(
    (direction: -1 | 1) => {
      if (!paginationReady || pageAnimatingRef.current) return;
      const next = Math.max(0, Math.min(pageIndex + direction, book.pages.length - 1));
      if (next === pageIndex) {
        const canCrossChapter =
          (direction === -1 && canPreviousChapter) ||
          (direction === 1 && canNextChapter);
        resetPagePosition();
        if (canCrossChapter) onChapterBoundary?.(direction);
        return;
      }

      if (preferences.pageTurn === "none") {
        jumpToPageImmediately(next);
        return;
      }

      preparePageSettlement(next);
      pageAnimatingRef.current = true;
      setPageGestureLocked(true);
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "turning",
        targetIndex: next,
      };
      dragTranslate.stopAnimation();
      dragTranslate.setValue(0);
      requestAnimationFrame(() => Animated.timing(dragTranslate, {
        duration: preferences.pageTurn === "cover" ? 270 : 245,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: direction * -screenWidth,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) finishPageChange(next);
        else {
          clearPageSettlement();
          pageAnimatingRef.current = false;
          setPageGestureLocked(false);
          pageRuntimeRef.current = {
            bookKey: pageBookKey,
            currentIndex: pageIndex,
            phase: "ready",
          };
        }
      }));
    },
    [
      book.pages.length,
      canNextChapter,
      canPreviousChapter,
      dragTranslate,
      finishPageChange,
      jumpToPageImmediately,
      onChapterBoundary,
      pageIndex,
      paginationReady,
      preparePageSettlement,
      preferences.pageTurn,
      resetPagePosition,
      screenWidth,
    ],
  );
  const volumePageChangeRef = useRef(changePage);
  volumePageChangeRef.current = changePage;
  useEffect(() => {
    const enabled = preferences.volumeKeys && supportsVolumeKeyTurns;
    setVolumeKeyTurnsEnabled(enabled);
    if (!enabled) return () => setVolumeKeyTurnsEnabled(false);
    const subscription = subscribeToVolumeKeyTurns((direction) => {
      volumePageChangeRef.current(direction === "previous" ? -1 : 1);
    });
    return () => {
      subscription.remove();
      setVolumeKeyTurnsEnabled(false);
    };
  }, [preferences.volumeKeys]);
  const progress =
    book.pages.length > 0 ? ((pageIndex + 1) / book.pages.length) * 100 : 0;

  const dragVisual = useMemo(() => {
    const firstPage = pageIndex === 0;
    const lastPage = pageIndex === book.pages.length - 1;
    const negativeOutput = lastPage ? -screenWidth * 0.18 : -screenWidth;
    const positiveOutput = firstPage ? screenWidth * 0.18 : screenWidth;
    return dragTranslate.interpolate({
      inputRange: [-screenWidth, 0, screenWidth],
      outputRange: [negativeOutput, 0, positiveOutput],
      extrapolate: "clamp",
    });
  }, [book.pages.length, dragTranslate, pageIndex, screenWidth]);

  const previousPageOpacity = useMemo(
    () => dragTranslate.interpolate({
      inputRange: [-screenWidth, 0, 1, screenWidth],
      outputRange: [0, 0, 1, 1],
      extrapolate: "clamp",
    }),
    [dragTranslate, screenWidth],
  );
  const nextPageOpacity = useMemo(
    () => dragTranslate.interpolate({
      inputRange: [-screenWidth, -1, 0, screenWidth],
      outputRange: [1, 1, 0, 0],
      extrapolate: "clamp",
    }),
    [dragTranslate, screenWidth],
  );
  const previousPageTranslate = useMemo(
    () => dragTranslate.interpolate({
      inputRange: [-screenWidth, 0, screenWidth],
      outputRange: preferences.pageTurn === "slide"
        ? [-screenWidth, -screenWidth, 0]
        : [0, 0, 0],
      extrapolate: "clamp",
    }),
    [dragTranslate, preferences.pageTurn, screenWidth],
  );
  const nextPageTranslate = useMemo(
    () => dragTranslate.interpolate({
      inputRange: [-screenWidth, 0, screenWidth],
      outputRange: preferences.pageTurn === "slide"
        ? [0, screenWidth, screenWidth]
        : [0, 0, 0],
      extrapolate: "clamp",
    }),
    [dragTranslate, preferences.pageTurn, screenWidth],
  );

  const onGestureEvent = useMemo(
    () =>
      Animated.event<PanGestureHandlerGestureEvent>(
        [{ nativeEvent: { translationX: dragTranslate } }],
        { useNativeDriver: true },
      ),
    [dragTranslate],
  );

  const onGestureStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      if (
        !paginationReady ||
        event.nativeEvent.oldState !== State.ACTIVE ||
        pageAnimatingRef.current
      ) return;

      const { translationX, velocityX } = event.nativeEvent;
      const direction: -1 | 1 = translationX < 0 ? 1 : -1;
      const canTurn =
        (direction === 1 && pageIndex < book.pages.length - 1) ||
        (direction === -1 && pageIndex > 0);
      const canCrossChapter =
        (direction === 1 && pageIndex === book.pages.length - 1 && canNextChapter) ||
        (direction === -1 && pageIndex === 0 && canPreviousChapter);
      const committed =
        Math.abs(translationX) > screenWidth * 0.16 ||
        Math.abs(velocityX) > 480;

      if (canCrossChapter && committed) {
        resetPagePosition();
        onChapterBoundary?.(direction);
        return;
      }

      if (canTurn && committed) {
        const next = pageIndex + direction;
        preparePageSettlement(next);
        pageAnimatingRef.current = true;
        setPageGestureLocked(true);
        pageRuntimeRef.current = {
          bookKey: pageBookKey,
          currentIndex: pageIndex,
          phase: "settling",
          targetIndex: next,
        };
        const remaining = 1 - Math.min(Math.abs(translationX) / screenWidth, 1);
        const duration = Math.max(60, Math.min(240, Math.round(remaining * 240)));
        requestAnimationFrame(() => Animated.timing(dragTranslate, {
          duration,
          easing: Easing.linear,
          toValue: direction * -screenWidth,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) finishPageChange(next);
          else {
            clearPageSettlement();
            pageAnimatingRef.current = false;
            setPageGestureLocked(false);
            pageRuntimeRef.current = {
              bookKey: pageBookKey,
              currentIndex: pageIndex,
              phase: "ready",
            };
          }
        }));
        return;
      }

      resetPagePosition(translationX);
    },
    [
      book.pages.length,
      canNextChapter,
      canPreviousChapter,
      clearPageSettlement,
      dragTranslate,
      finishPageChange,
      pageIndex,
      paginationReady,
      preparePageSettlement,
      onChapterBoundary,
      resetPagePosition,
      screenWidth,
    ],
  );

  const pageTranslate = dragVisual;
  const openAnnotationEditor = useCallback((
    paragraphIndex: number,
    quote: string,
    existing?: ReaderAnnotation,
  ) => {
    setAnnotationDraft({
      existing,
      paragraphIndex,
      quote,
      note: existing?.note ?? "",
      color: existing?.color ?? "amber",
    });
  }, []);

  const handleParagraphLongPress = useCallback((event: GestureResponderEvent) => {
    const touchY = event.nativeEvent.locationY;
    const match = [...paragraphLayoutsRef.current.entries()].find(([, layout]) =>
      touchY >= layout.y && touchY <= layout.y + layout.height
    );
    if (!match) return;
    const [paragraphIndex, layout] = match;
    const existing = annotations.find((annotation) =>
      annotation.pageIndex === pageIndex &&
      annotation.paragraphIndex === paragraphIndex &&
      annotation.quote === layout.quote
    );
    longPressConsumedRef.current = true;
    setTimeout(() => { longPressConsumedRef.current = false; }, 700);
    openAnnotationEditor(paragraphIndex, layout.quote, existing);
  }, [annotations, openAnnotationEditor, pageIndex]);

  const runAfterPossibleLongPress = useCallback((action: () => void) => {
    if (longPressConsumedRef.current) {
      longPressConsumedRef.current = false;
      return;
    }
    action();
  }, []);

  const saveAnnotationDraft = useCallback(() => {
    if (!annotationDraft) return;
    const now = Date.now();
    const chapterTitle = book.pageTitles?.[pageIndex] || `第 ${pageIndex + 1} 页`;
    onSaveAnnotation({
      id: annotationDraft.existing?.id ??
        `${book.id}:note:${now}:${Math.random().toString(36).slice(2, 7)}`,
      bookId: book.id,
      pageIndex,
      chapterIndex: book.localChapterIndex ?? book.onlineChapterIndex,
      paragraphIndex: annotationDraft.paragraphIndex,
      chapterTitle,
      quote: annotationDraft.quote,
      note: annotationDraft.note.trim(),
      color: annotationDraft.color,
      createdAt: annotationDraft.existing?.createdAt ?? now,
      updatedAt: now,
    });
    setAnnotationDraft(undefined);
  }, [annotationDraft, book, onSaveAnnotation, pageIndex]);



  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.container}>
        <View collapsable={false} pointerEvents="none" ref={gestureGuideRef} style={styles.guideGestureTarget} />
        <Animated.View
          pointerEvents={controlsVisible ? "auto" : "none"}
          renderToHardwareTextureAndroid
          style={[
            styles.header,
            {
              left: chromeLeft,
              opacity: controlsOpacity,
              right: undefined,
              width: chromeWidth,
              borderColor: `${palette.muted}28`,
              transform: [
                {
                  translateY: controlsOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-12, 0],
                  }),
                },

              ],
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `${palette.background}F4` },
            ]}
          />
          <View pointerEvents="none" style={styles.glassShine} />
          <Pressable collapsable={false} onPress={onBack} ref={backGuideRef} style={styles.iconButton}>
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text numberOfLines={1} style={[styles.bookTitle, { color: palette.text }]}>
              {book.title}
            </Text>
            <Text numberOfLines={1} style={[styles.chapterTitle, { color: palette.muted }]}>
              {book.pageTitles?.[pageIndex] ?? `第 ${pageIndex + 1} 页`}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {onOpenOriginal ? (
              <Pressable
                accessibilityLabel="回到原网页"
                onPress={() => onOpenOriginal(currentOriginalUrl)}
                style={styles.iconButton}
              >
                <Ionicons name="globe-outline" size={22} color={palette.text} />
              </Pressable>
            ) : null}
<Pressable
              accessibilityLabel={currentBookmark ? "移除本页书签" : "添加本页书签"}
              collapsable={false}
              onPress={toggleCurrentBookmark}
              ref={bookmarkGuideRef}
              style={styles.iconButton}
            >
              <Animated.View style={{ transform: [{ scale: bookmarkScale }] }}>
                <Ionicons
                  name={currentBookmark ? "bookmark" : "bookmark-outline"}
                  size={22}
                  color={currentBookmark ? palette.accent : palette.text}
                />
              </Animated.View>
            </Pressable>
            <Pressable accessibilityLabel="章节目录" collapsable={false} onPress={openChapterList} ref={chapterGuideRef} style={styles.iconButton}>
              <Ionicons name="list-outline" size={23} color={palette.text} />
            </Pressable>
            {onDownloadAll ? (
              <Pressable
                accessibilityLabel={
                  downloadProgress
                    ? "正在下载 " + downloadProgress.completed + " / " + downloadProgress.total + " 章"
                    : book.fullyDownloaded ? "已下载全部章节" : "下载全部章节"
                }
                disabled={Boolean(downloadProgress) || book.fullyDownloaded}
                onPress={onDownloadAll}
                style={styles.iconButton}
              >
                {downloadProgress ? (
                  <View style={styles.downloadIndicator}>
                    <ActivityIndicator color={palette.accent} size="small" />
                    <Text style={[styles.downloadCount, { color: palette.muted }]}>
                      {Math.round((downloadProgress.completed / Math.max(downloadProgress.total, 1)) * 100)}
                    </Text>
                  </View>
                ) : (
                  <Ionicons
                    color={book.fullyDownloaded ? palette.accent : palette.text}
                    name={book.fullyDownloaded ? "checkmark-circle" : "cloud-download-outline"}
                    size={22}
                  />
                )}
              </Pressable>
            ) : null}
          </View>
        </Animated.View>

        <PanGestureHandler
          activeOffsetX={[-10, 10]}
          enabled={paginationReady && !pageGestureLocked}
          failOffsetY={[-12, 12]}
          hitSlop={{ left: -28 }}
          onGestureEvent={onGestureEvent}
          onHandlerStateChange={onGestureStateChange}
        >
          <Animated.View
            onLayout={(event) => {
              const nextHeight = Math.round(event.nativeEvent.layout.height);
              setPageViewportHeight((current) => current === nextHeight ? current : nextHeight);
            }}
            style={styles.page}
          >
            {onPaginationMeasured && completedCalibrationKey !== calibrationKey ? (
              <NativeText
                key={calibrationKey}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onTextLayout={handleCalibrationTextLayout}
                pointerEvents="none"
                style={[
                  styles.calibrationText,
                  {
                    fontFamily: getReaderFontFamily(preferences.fontFamily),
                    fontSize: preferences.fontSize,
                    letterSpacing: 0.25,
                    lineHeight: preferences.fontSize * preferences.lineHeight,
                    width: Math.max(
                      180,
                      readingColumnWidth - preferences.horizontalPadding * 2,
                    ),
                  },
                ]}
              >
                {READER_CALIBRATION_TEXT}
              </NativeText>
            ) : null}
          {pageIndex > 0 && preferences.pageTurn !== "none" ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.adjacentPage,
                styles.pageContent,
                {
                  left: (screenWidth - readingColumnWidth) / 2,
                  paddingHorizontal: preferences.horizontalPadding,
                  width: readingColumnWidth,
                  backgroundColor: palette.background,
                  transform: [{ translateX: previousPageTranslate }],
                },
                preferences.pageTurn === "cover" ? { opacity: previousPageOpacity } : undefined,
              ]}
            >
              <ReaderParagraphPage
                fontFamily={readerFontFamily}
                fontSize={preferences.fontSize}
                lineHeight={readerLineHeight}
                pageIndex={pageIndex - 1}
                paragraphSpacing={preferences.paragraphSpacing}
                paragraphs={previousParagraphs}
                textAlignment={preferences.textAlignment}
                textColor={palette.text}
              />
            </Animated.View>
          ) : null}

          {pageIndex < book.pages.length - 1 && preferences.pageTurn !== "none" ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.adjacentPage,
                styles.pageContent,
                {
                  left: (screenWidth - readingColumnWidth) / 2,
                  paddingHorizontal: preferences.horizontalPadding,
                  width: readingColumnWidth,
                  backgroundColor: palette.background,
                  transform: [{ translateX: nextPageTranslate }],
                },
                preferences.pageTurn === "cover" ? { opacity: nextPageOpacity } : undefined,
              ]}
            >
              <ReaderParagraphPage
                fontFamily={readerFontFamily}
                fontSize={preferences.fontSize}
                lineHeight={readerLineHeight}
                pageIndex={pageIndex + 1}
                paragraphSpacing={preferences.paragraphSpacing}
                paragraphs={nextParagraphs}
                textAlignment={preferences.textAlignment}
                textColor={palette.text}
              />
            </Animated.View>
          ) : null}

          <Animated.View
            renderToHardwareTextureAndroid={preferences.pageTurn !== "none"}
            style={[
              styles.readingColumn,
              styles.pageContent,
              {
                backgroundColor: palette.background,
                paddingHorizontal: preferences.horizontalPadding,
                width: readingColumnWidth,
                transform: [{ translateX: pageTranslate }],
              },
            ]}
          >
            <ReaderParagraphPage
              annotations={annotations}
              fontFamily={readerFontFamily}
              fontSize={preferences.fontSize}
              lineHeight={readerLineHeight}
              onParagraphLayout={handleParagraphLayout}
              pageIndex={pageIndex}
              paragraphSpacing={preferences.paragraphSpacing}
              paragraphs={paragraphs}
              selectable
              textAlignment={preferences.textAlignment}
              textColor={palette.text}
            />
          </Animated.View>

          {settlementPageIndex !== undefined ? (
            <Animated.View
              pointerEvents="none"
              renderToHardwareTextureAndroid
              style={[
                styles.settlementPage,
                styles.pageContent,
                {
                  backgroundColor: palette.background,
                  left: (screenWidth - readingColumnWidth) / 2,
                  opacity: settlementOpacity,
                  paddingHorizontal: preferences.horizontalPadding,
                  width: readingColumnWidth,
                },
              ]}
            >
              <ReaderParagraphPage
                fontFamily={readerFontFamily}
                fontSize={preferences.fontSize}
                lineHeight={readerLineHeight}
                pageIndex={settlementPageIndex}
                paragraphSpacing={preferences.paragraphSpacing}
                paragraphs={settlementParagraphs}
                textAlignment={preferences.textAlignment}
                textColor={palette.text}
              />
            </Animated.View>
          ) : null}

          {preferences.tapToTurn ? (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <Pressable
                accessibilityLabel="上一页"
                delayLongPress={360}
                onLongPress={handleParagraphLongPress}
                onPress={() => runAfterPossibleLongPress(() => changePage(-1))}
                style={styles.leftTapArea}
              />
              <Pressable
                accessibilityLabel="显示或隐藏阅读工具栏"
                delayLongPress={360}
                onLongPress={handleParagraphLongPress}
                onPress={() => runAfterPossibleLongPress(() => setControlsVisible((visible) => !visible))}
                style={styles.centerTapArea}
              />
              <Pressable
                accessibilityLabel="下一页"
                delayLongPress={360}
                onLongPress={handleParagraphLongPress}
                onPress={() => runAfterPossibleLongPress(() => changePage(1))}
                style={styles.rightTapArea}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => setControlsVisible((visible) => !visible)}
              style={StyleSheet.absoluteFill}
            />
          )}
          </Animated.View>
        </PanGestureHandler>

        <Animated.View
          pointerEvents={controlsVisible ? "auto" : "none"}
          renderToHardwareTextureAndroid
          style={[
            styles.footer,
            {
              left: chromeLeft,
              opacity: controlsOpacity,
              right: undefined,
              width: chromeWidth,
              borderColor: `${palette.muted}28`,
              transform: [
                {
                  translateY: controlsOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [14, 0],
                  }),
                },

              ],
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `${palette.background}F0` },
            ]}
          />
          <View pointerEvents="none" style={styles.glassShine} />
          <Pressable
            accessibilityLabel={
              resolvedLanguage === "en"
                ? pageIndex === 0 && canPreviousChapter ? "Previous chapter" : "Previous page"
                : pageIndex === 0 && canPreviousChapter ? "上一章" : "上一页"
            }
            disabled={pageIndex === 0 && !canPreviousChapter}
            hitSlop={4}
            onPress={() => changePage(-1)}
            style={[styles.pageButton, pageIndex === 0 && !canPreviousChapter && styles.disabled]}
          >
            <Ionicons name="chevron-back" size={23} color={palette.text} />
          </Pressable>

          {preferences.showProgress ? (
            <Pressable
              accessibilityLabel="章节目录"
              onPress={openChapterList}
              style={styles.progressBlock}
            >
              <Text style={[styles.progressText, { color: palette.muted }]}>
                {resolvedLanguage === "en"
                  ? `Page ${pageIndex + 1} / ${book.pages.length} · ${Math.round(progress)}%`
                  : `章节 · ${pageIndex + 1} / ${book.pages.length} · ${Math.round(progress)}%`}
              </Text>
              <View style={[styles.progressTrack, { backgroundColor: palette.panel }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress}%`, backgroundColor: palette.accent },
                  ]}
                />
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="章节目录"
              onPress={openChapterList}
              style={styles.progressBlock}
            >
              <Ionicons name="list-outline" size={22} color={palette.text} />
            </Pressable>
          )}

          <Pressable
            accessibilityLabel={
              resolvedLanguage === "en"
                ? pageIndex === book.pages.length - 1 && canNextChapter ? "Next chapter" : "Next page"
                : pageIndex === book.pages.length - 1 && canNextChapter ? "下一章" : "下一页"
            }
            disabled={pageIndex === book.pages.length - 1 && !canNextChapter}
            hitSlop={4}
            onPress={() => changePage(1)}
            style={[
              styles.pageButton,
              pageIndex === book.pages.length - 1 && !canNextChapter && styles.disabled,
            ]}
          >
            <Ionicons name="chevron-forward" size={23} color={palette.text} />
          </Pressable>
        </Animated.View>

        {chapterVisible ? (
          <View style={styles.chapterOverlay}>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.chapterBackdrop, {
                opacity: chapterSheetProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.34],
                }),
              }]}
            />
            <Pressable accessibilityLabel="关闭章节目录" onPress={closeChapterList} style={StyleSheet.absoluteFill} />
            <Animated.View
              style={[styles.chapterSheet, {
                backgroundColor: palette.background,
                borderColor: `${palette.muted}35`,
                left: chapterSheetLeft,
                maxHeight: screenHeight * 0.68,
                transform: [{
                  translateY: chapterSheetProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [screenHeight * 0.7, 0],
                  }),
                }],
                width: chapterSheetWidth,
              }]}
            >
              <View style={[styles.chapterHandle, { backgroundColor: `${palette.muted}66` }]} />
              <View style={styles.chapterSheetHeader}>
                <View>
                  <Text style={[styles.chapterSheetTitle, { color: palette.text }]}>章节</Text>
                  <Text style={[styles.chapterSheetMeta, { color: palette.muted }]}>
                    {resolvedLanguage === "en"
                      ? `${chapterEntries.length} chapters · Chapter ${currentChapterListIndex + 1}`
                      : `共 ${chapterEntries.length} 章 · 当前第 ${currentChapterListIndex + 1} 章`}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="关闭章节目录"
                  onPress={closeChapterList}
                  style={[styles.chapterCloseButton, { backgroundColor: palette.panel }]}
                >
                  <Ionicons name="close" size={20} color={palette.text} />
                </Pressable>
              </View>
              <View
                style={[
                  styles.chapterSearchBox,
                  {
                    backgroundColor: palette.panel,
                    borderColor: chapterSearchQuery ? `${palette.accent}88` : `${palette.muted}28`,
                  },
                ]}
              >
                <Ionicons
                  name="search-outline"
                  size={18}
                  color={chapterSearchQuery ? palette.accent : palette.muted}
                />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setChapterSearchQuery}
                  placeholder={resolvedLanguage === "en" ? "Search in this book" : "在本书中寻找一句话"}
                  {...({ placeholder: resolvedLanguage === "en" ? "Search in this book" : "\u5728\u672c\u4e66\u4e2d\u5bfb\u627e\u4e00\u53e5\u8bdd" } as Record<string, unknown>)}
                  placeholderTextColor={`${palette.muted}99`}
                  returnKeyType="search"
                  selectionColor={palette.accent}
                  style={[styles.chapterSearchInput, { color: palette.text }]}
                  value={chapterSearchQuery}
                />
                {chapterSearching ? (
                  <ActivityIndicator color={palette.accent} size="small" />
                ) : chapterSearchQuery ? (
                  <Pressable
                    accessibilityLabel={resolvedLanguage === "en" ? "Clear search" : "清除搜索"}
                    {...({ accessibilityLabel: resolvedLanguage === "en" ? "Clear search" : "\u6e05\u9664\u641c\u7d22" } as Record<string, unknown>)}
                    hitSlop={10}
                    onPress={() => setChapterSearchQuery("")}
                  >
                    <Ionicons name="close-circle" size={19} color={palette.muted} />
                  </Pressable>
                ) : null}
              </View>
              {chapterSearchQuery.trim() ? (
                <View style={styles.readerSearchArea}>
                  <View style={styles.readerSearchHeader}>
                    <Text style={[styles.bookmarkSectionTitle, { color: palette.text }]}>{resolvedLanguage === "en" ? "Found in the pages" : "\u5728\u4e66\u9875\u4e2d\u5bfb\u5230"}</Text>
                    <Text style={[styles.bookmarkSectionCount, { color: palette.muted }]}>
                      {chapterSearching
                        ? (resolvedLanguage === "en" ? "Searching\u2026" : "\u6b63\u5728\u5bfb\u627e\u2026")
                        : (resolvedLanguage === "en"
                          ? `${chapterSearchResults.length}${chapterSearchResults.length >= READER_SEARCH_RESULT_LIMIT ? "+" : ""} results`
                          : `${chapterSearchResults.length}${chapterSearchResults.length >= READER_SEARCH_RESULT_LIMIT ? "+" : ""} \u6761`)}
                    </Text>
                  </View>
                  {!chapterSearching && chapterSearchResults.length === 0 ? (
                    <View style={styles.readerSearchEmpty}>
                      <Ionicons name="leaf-outline" size={25} color={`${palette.muted}88`} />
                      <Text style={[styles.readerSearchEmptyTitle, { color: palette.text }]}>{resolvedLanguage === "en" ? "No matching words" : "\u6ca1\u6709\u5bfb\u5230\u8fd9\u53e5\u8bdd"}</Text>
                      <Text style={[styles.readerSearchEmptyText, { color: palette.muted }]}>{resolvedLanguage === "en" ? "Try a name, a place, or a shorter phrase." : "\u8bd5\u8bd5\u4eba\u540d\u3001\u5730\u70b9\uff0c\u6216\u66f4\u77ed\u7684\u8bcd\u53e5\u3002"}</Text>
                    </View>
                  ) : (
                    <FlatList
                      data={chapterSearchResults}
                      ItemSeparatorComponent={() => (
                        <View style={[styles.chapterSeparator, { backgroundColor: `${palette.muted}20` }]} />
                      )}
                      keyboardShouldPersistTaps="handled"
                      keyExtractor={(item) => item.key}
                      renderItem={({ item }) => {
                        const before = item.matchStart >= 0 ? item.excerpt.slice(0, item.matchStart) : item.excerpt;
                        const matched = item.matchStart >= 0
                          ? item.excerpt.slice(item.matchStart, item.matchStart + item.matchLength)
                          : "";
                        const after = item.matchStart >= 0
                          ? item.excerpt.slice(item.matchStart + item.matchLength)
                          : "";
                        return (
                          <Pressable
                            onPress={() => selectSearchResult(item)}
                            style={({ pressed }) => [
                              styles.readerSearchResult,
                              pressed && { backgroundColor: `${palette.accent}12` },
                            ]}
                          >
                            <View style={[styles.readerSearchPageBadge, { backgroundColor: `${palette.accent}16` }]}>
                              <Text style={[styles.readerSearchPageText, { color: palette.accent }]}>
                                {item.pageIndex + 1}
                              </Text>
                            </View>
                            <View style={styles.readerSearchResultCopy}>
                              <Text numberOfLines={1} style={[styles.readerSearchChapter, { color: palette.text }]}>
                                {item.chapterTitle}
                              </Text>
                              <Text numberOfLines={2} style={[styles.readerSearchExcerpt, { color: palette.muted }]}>
                                {before}
                                {matched ? (
                                  <Text style={{ color: palette.accent, fontWeight: "800" }}>{matched}</Text>
                                ) : null}
                                {after}
                              </Text>
                            </View>
                            <Ionicons name="arrow-forward" size={16} color={`${palette.muted}88`} />
                          </Pressable>
                        );
                      }}
                      showsVerticalScrollIndicator={false}
                      style={styles.readerSearchList}
                    />
                  )}
                </View>
              ) : null}
              <View style={[styles.chapterDefaultContent, chapterSearchQuery.trim() && styles.hidden]}>
              {onOpenOriginal ? (
                <Pressable
                  accessibilityLabel="在原网页查找更多章节"
                  onPress={() => {
                    closeChapterList();
                    onOpenOriginal(book.tocUrl || currentOriginalUrl);
                  }}
                  style={[styles.webChapterAction, { backgroundColor: palette.panel }]}
                >
                  <View style={[styles.webChapterActionIcon, { backgroundColor: `${palette.accent}18` }]}>
                    <Ionicons name="search-outline" size={19} color={palette.accent} />
                  </View>
                  <View style={styles.webChapterActionCopy}>
                    <Text style={[styles.webChapterActionTitle, { color: palette.text }]}>在原网页查找更多章节</Text>
                    <Text style={[styles.webChapterActionText, { color: palette.muted }]}>回到网页目录，继续发现并保存后续章节</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={palette.muted} />
                </Pressable>
              ) : null}
{bookmarks.length ? (
                <View style={styles.bookmarkSection}>
                  <View style={styles.bookmarkSectionHeader}>
                    <Text style={[styles.bookmarkSectionTitle, { color: palette.text }]}>书签</Text>
                    <Text style={[styles.bookmarkSectionCount, { color: palette.muted }]}>
                      {resolvedLanguage === "en"
                        ? `${bookmarks.length} saved ${bookmarks.length === 1 ? "place" : "places"}`
                        : `${bookmarks.length} 处留痕`}
                    </Text>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.bookmarkRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {[...bookmarks]
                      .sort((left, right) => left.pageIndex - right.pageIndex)
                      .map((bookmark) => (
                        <Pressable
                          key={bookmark.id}
                          onPress={() => selectChapter({
                            key: bookmark.id,
                            title: bookmark.chapterTitle,
                            pageIndex: Math.min(
                              Math.max(bookmark.pageIndex, 0),
                              Math.max(book.pages.length - 1, 0),
                            ),
                          })}
                          style={[
                            styles.bookmarkCard,
                            {
                              backgroundColor: palette.panel,
                              borderColor: bookmark.pageIndex === pageIndex
                                ? palette.accent
                                : `${palette.muted}25`,
                            },
                          ]}
                        >
                          <View style={styles.bookmarkCardTop}>
                            <Ionicons name="bookmark" size={14} color={palette.accent} />
                            <Text style={[styles.bookmarkPage, { color: palette.accent }]}>
                              {bookmark.pageIndex + 1}
                            </Text>
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[styles.bookmarkChapter, { color: palette.text }]}
                          >
                            {bookmark.chapterTitle}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={[styles.bookmarkExcerpt, { color: palette.muted }]}
                          >
                            {bookmark.excerpt || "这一页，曾被你轻轻折起。"}
                          </Text>
                        </Pressable>
                      ))}
                  </ScrollView>
                </View>
              ) : null}
{annotations.length ? (
                <View style={styles.annotationSection}>
                  <View style={styles.bookmarkSectionHeader}>
                    <Text style={[styles.bookmarkSectionTitle, { color: palette.text }]}>批注</Text>
                    <Text style={[styles.bookmarkSectionCount, { color: palette.muted }]}>
                      {resolvedLanguage === "en"
                        ? `${annotations.length} ${annotations.length === 1 ? "note" : "notes"}`
                        : `${annotations.length} 条笔记`}
                    </Text>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.bookmarkRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {[...annotations]
                      .sort((left, right) => left.pageIndex - right.pageIndex)
                      .map((annotation) => (
                        <Pressable
                          key={annotation.id}
                          onLongPress={() => {
                            closeChapterList();
                            setTimeout(() => openAnnotationEditor(
                              annotation.paragraphIndex,
                              annotation.quote,
                              annotation,
                            ), 190);
                          }}
                          onPress={() => selectChapter({
                            key: annotation.id,
                            title: annotation.chapterTitle,
                            pageIndex: Math.min(
                              Math.max(annotation.pageIndex, 0),
                              Math.max(book.pages.length - 1, 0),
                            ),
                          })}
                          style={[
                            styles.annotationCard,
                            {
                              backgroundColor: palette.panel,
                              borderColor: annotationColors[annotation.color].stroke,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.annotationStripe,
                              { backgroundColor: annotationColors[annotation.color].stroke },
                            ]}
                          />
                          <Text
                            numberOfLines={2}
                            style={[styles.annotationQuote, { color: palette.text }]}
                          >
                            {annotation.quote}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[styles.annotationNote, { color: palette.muted }]}
                          >
                            {annotation.note || (resolvedLanguage === "en" ? "Highlight only" : "只留下一道划线")}
                          </Text>
                          <Text style={[styles.annotationHint, { color: palette.muted }]}>
                            {resolvedLanguage === "en" ? "Hold to edit" : "长按编辑"}
                          </Text>
                        </Pressable>
                      ))}
                  </ScrollView>
                </View>
              ) : null}
              <FlatList
                data={chapterEntries}
                getItemLayout={(_, index) => ({ index, length: 59, offset: 59 * index })}
                initialScrollIndex={Math.max(0, currentChapterListIndex - 3)}
                ItemSeparatorComponent={() => (
                  <View style={[styles.chapterSeparator, { backgroundColor: `${palette.muted}20` }]} />
                )}
                keyExtractor={(item) => item.key}
                renderItem={({ item, index }) => {
                  const selected = index === currentChapterListIndex;
                  return (
                    <Pressable
                      accessibilityLabel={item.title + (selected ? "，当前章节" : "")}
                      onPress={() => selectChapter(item)}
                      style={[styles.chapterItem, selected && { backgroundColor: `${palette.accent}18` }]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.chapterItemIndex, { color: selected ? palette.accent : palette.muted }]}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.chapterItemTitle, {
                          color: selected ? palette.accent : palette.text,
                          fontWeight: selected ? "700" : "500",
                        }]}
                      >
                        {item.title}
                      </Text>
                      <Ionicons
                        name={selected ? "radio-button-on" : "chevron-forward"}
                        size={selected ? 17 : 16}
                        color={selected ? palette.accent : `${palette.muted}88`}
                      />
                    </Pressable>
                  );
                }}
                showsVerticalScrollIndicator={false}
                style={styles.chapterList}
              />
              </View>
            </Animated.View>
          </View>
        ) : null}

        <IOSPopupModal
          onRequestClose={() => setAnnotationDraft(undefined)}
          visible={Boolean(annotationDraft)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.annotationModalKeyboard}
          >
            <View style={[styles.annotationModal, { backgroundColor: palette.background }]}>
              <View style={styles.annotationModalHeader}>
                <View style={styles.annotationModalHeading}>
                  <Text style={[styles.annotationModalTitle, { color: palette.text }]}>留一句批注</Text>
                  <Text style={[styles.annotationModalSubtitle, { color: palette.muted }]}>长按段落留下划线，也可以写下此刻所想</Text>
                </View>
                <Pressable
                  accessibilityLabel="关闭批注"
                  onPress={() => setAnnotationDraft(undefined)}
                  style={[styles.chapterCloseButton, { backgroundColor: palette.panel }]}
                >
                  <Ionicons name="close" size={20} color={palette.text} />
                </Pressable>
              </View>
              <Text
                numberOfLines={4}
                style={[
                  styles.annotationModalQuote,
                  {
                    backgroundColor: annotationDraft
                      ? annotationColors[annotationDraft.color].fill
                      : palette.panel,
                    color: palette.text,
                  },
                ]}
              >
                {annotationDraft?.quote}
              </Text>
              <View style={styles.annotationColorRow}>
                {(Object.keys(annotationColors) as AnnotationColor[]).map((color) => (
                  <Pressable
                    accessibilityLabel={`批注颜色 ${color}`}
                    key={color}
                    onPress={() => setAnnotationDraft((draft) => draft ? { ...draft, color } : draft)}
                    style={[
                      styles.annotationColorButton,
                      { backgroundColor: annotationColors[color].fill },
                      annotationDraft?.color === color && {
                        borderColor: annotationColors[color].stroke,
                        borderWidth: 2,
                      },
                    ]}
                  >
                    {annotationDraft?.color === color ? (
                      <Ionicons name="checkmark" size={17} color={annotationColors[color].stroke} />
                    ) : null}
                  </Pressable>
                ))}
              </View>
              <TextInput
                multiline
                onChangeText={(note) => setAnnotationDraft((draft) =>
                  draft ? { ...draft, note } : draft
                )}
                placeholder="写下这一页带来的念头…"
                placeholderTextColor={palette.muted}
                selectionColor={palette.accent}
                style={[
                  styles.annotationInput,
                  { backgroundColor: palette.panel, color: palette.text },
                ]}
                value={annotationDraft?.note ?? ""}
              />
              <View style={styles.annotationModalActions}>
                {annotationDraft?.existing ? (
                  <Pressable
                    onPress={() => {
                      onDeleteAnnotation(annotationDraft.existing!.id);
                      setAnnotationDraft(undefined);
                    }}
                    style={styles.annotationDeleteButton}
                  >
                    <Ionicons name="trash-outline" size={18} color="#A85F5F" />
                    <Text style={styles.annotationDeleteText}>删除</Text>
                  </Pressable>
                ) : <View />}
                <Pressable
                  onPress={saveAnnotationDraft}
                  style={[styles.annotationSaveButton, { backgroundColor: palette.accent }]}
                >
                  <Text style={styles.annotationSaveText}>收好这句</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </IOSPopupModal>
      </View>
    </SafeAreaView>
  );
}

function splitReaderParagraphs(page: string) {
  return page
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  guideGestureTarget: { height: 150, left: "32%", position: "absolute", right: "32%", top: "38%" },
  header: {
    alignItems: "center",
    borderRadius: 20,
    flexDirection: "row",
    height: 64,
    left: 10,
    overflow: "hidden",
    paddingHorizontal: 8,
    position: "absolute",
    right: 10,
    top: 8,
    zIndex: 4,
  },
  downloadIndicator: { alignItems: "center", justifyContent: "center" },
  downloadCount: { fontSize: 7, fontWeight: "800", marginTop: -2 },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerText: { alignItems: "center", flex: 1 },
  headerActions: { alignItems: "center", flexDirection: "row" },
  bookTitle: { fontSize: 15, fontWeight: "700" },
  chapterTitle: { fontSize: 11, marginTop: 3 },
  page: { flex: 1, overflow: "hidden" },
  readingColumn: { alignSelf: "center", flex: 1 },
  adjacentPage: { bottom: 0, position: "absolute", top: 0 },
  settlementPage: { bottom: 0, position: "absolute", top: 0, zIndex: 2 },
  pageContent: { minHeight: "100%", paddingBottom: 64, paddingTop: 36 },
  paragraph: { fontFamily: "serif", letterSpacing: 0.25 },
  calibrationText: { left: 0, opacity: 0, position: "absolute", top: 0 },
  leftTapArea: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: "27%",
  },
  centerTapArea: {
    bottom: 0,
    left: "27%",
    position: "absolute",
    top: 0,
    width: "46%",
  },
  rightTapArea: {
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "27%",
  },
  footer: {
    alignItems: "center",
    borderRadius: 22,
    bottom: 10,
    flexDirection: "row",
    left: 10,
    minHeight: 72,
    overflow: "hidden",
    paddingHorizontal: 14,
    position: "absolute",
    right: 10,
    zIndex: 4,
  },
  glassShine: {
    backgroundColor: "#FFFFFF52",
    height: 1,
    left: 18,
    position: "absolute",
    right: 18,
    top: 1,
  },
  pageButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  disabled: { opacity: 0.28 },
  progressBlock: { alignItems: "center", flex: 1, paddingHorizontal: 10 },
  progressText: { fontSize: 11, marginBottom: 8 },
  progressTrack: { borderRadius: 3, height: 5, overflow: "hidden", width: "100%" },
  progressFill: { borderRadius: 2, height: "100%" },
  chapterOverlay: {
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  chapterBackdrop: { backgroundColor: "#000000" },
  chapterSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    bottom: 0,
    overflow: "hidden",
    paddingBottom: 8,
    position: "absolute",
  },
  chapterHandle: {
    alignSelf: "center",
    borderRadius: 2,
    height: 4,
    marginTop: 9,
    width: 38,
  },
  chapterSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 13,
  },
  chapterSheetTitle: { fontSize: 22, fontWeight: "800" },
  chapterSheetMeta: { fontSize: 12, marginTop: 4 },
  chapterCloseButton: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  chapterSearchBox: {
    alignItems: "center",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginBottom: 12,
    marginHorizontal: 18,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  chapterSearchInput: {
    flex: 1,
    fontSize: 14,
    minHeight: 46,
    paddingVertical: 0,
  },
  chapterDefaultContent: { flexShrink: 1 },
  hidden: { display: "none" },
  readerSearchArea: { flexShrink: 1, minHeight: 180 },
  readerSearchHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  readerSearchList: { flexGrow: 0, flexShrink: 1 },
  readerSearchResult: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    minHeight: 76,
    paddingHorizontal: 19,
    paddingVertical: 10,
  },
  readerSearchPageBadge: {
    alignItems: "center",
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  readerSearchPageText: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  readerSearchResultCopy: { flex: 1 },
  readerSearchChapter: { fontSize: 13, fontWeight: "700" },
  readerSearchExcerpt: { fontSize: 11, lineHeight: 17, marginTop: 4 },
  readerSearchEmpty: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 190,
    paddingHorizontal: 28,
  },
  readerSearchEmptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginTop: 10,
  },
  readerSearchEmptyText: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
    textAlign: "center",
  },
  webChapterAction: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 11,
    marginBottom: 8,
    marginHorizontal: 18,
    minHeight: 68,
    paddingHorizontal: 13,
  },
  webChapterActionIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  webChapterActionCopy: { flex: 1 },
  webChapterActionTitle: { fontSize: 13, fontWeight: "700" },
  webChapterActionText: { fontSize: 10.5, marginTop: 4 },
  bookmarkSection: { marginBottom: 10 },
  bookmarkSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  bookmarkSectionTitle: { fontSize: 13, fontWeight: "800" },
  bookmarkSectionCount: { fontSize: 10.5 },
  bookmarkRail: { gap: 10, paddingHorizontal: 18, paddingTop: 9 },
  bookmarkCard: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 92,
    paddingHorizontal: 13,
    paddingVertical: 11,
    width: 188,
  },
  bookmarkCardTop: { alignItems: "center", flexDirection: "row", gap: 5 },
  bookmarkPage: { fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "800" },
  bookmarkChapter: { fontSize: 12.5, fontWeight: "700", marginTop: 7 },
  bookmarkExcerpt: { fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  annotationSection: { marginBottom: 10 },
  annotationCard: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 108,
    overflow: "hidden",
    paddingBottom: 10,
    paddingHorizontal: 13,
    paddingTop: 13,
    width: 208,
  },
  annotationStripe: { borderRadius: 2, height: 3, marginBottom: 9, width: 34 },
  annotationQuote: { fontSize: 11.5, fontWeight: "600", lineHeight: 17 },
  annotationNote: { fontSize: 10.5, marginTop: 7 },
  annotationHint: { fontSize: 9, marginTop: 7 },
  annotationModalKeyboard: { alignItems: "center", width: "100%" },
  annotationModal: {
    borderRadius: 28,
    elevation: 24,
    maxWidth: 520,
    padding: 20,
    shadowColor: "#142018",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.26,
    shadowRadius: 24,
    width: "100%",
  },
  annotationModalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  annotationModalHeading: { flex: 1, marginRight: 12 },
  annotationModalTitle: { fontSize: 20, fontWeight: "800" },
  annotationModalSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  annotationModalQuote: {
    borderRadius: 16,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 16,
    overflow: "hidden",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  annotationColorRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  annotationColorButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 16,
    height: 36,
    justifyContent: "center",
    width: 48,
  },
  annotationInput: {
    borderRadius: 17,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
    minHeight: 112,
    paddingHorizontal: 14,
    paddingTop: 13,
    textAlignVertical: "top",
  },
  annotationModalActions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  annotationDeleteButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  annotationDeleteText: { color: "#A85F5F", fontSize: 13, fontWeight: "700" },
  annotationSaveButton: {
    alignItems: "center",
    borderRadius: 16,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  annotationSaveText: { color: "#F8F4EA", fontSize: 13, fontWeight: "800" },
  chapterList: { flexGrow: 0, flexShrink: 1 },
  chapterItem: {
    alignItems: "center",
    flexDirection: "row",
    height: 58,
    paddingHorizontal: 20,
  },
  chapterItemIndex: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    marginRight: 14,
    width: 30,
  },
  chapterItemTitle: { flex: 1, fontSize: 15, marginRight: 10 },
  chapterSeparator: { height: 1, marginLeft: 64 },
});
