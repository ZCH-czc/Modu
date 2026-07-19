import {
  Ionicons } from "@expo/vector-icons";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  } from "expo-keep-awake";
import { useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text } from "../i18n";
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Book, ReaderPreferences, ReaderTheme } from "../types";
import { getReaderFontFamily } from "../utils/readerFonts";

type ReaderScreenProps = {
  book: Book;
  preferences: ReaderPreferences;
  initialPage: number;
  onBack: () => void;
  onPageChange: (pageIndex: number) => void;
  onChapterBoundary?: (direction: -1 | 1) => void;
  onChapterSelect?: (chapterIndex: number) => void;
  canPreviousChapter?: boolean;
  canNextChapter?: boolean;
  onDownloadAll?: () => void;
  onOpenOriginal?: (url?: string) => void;
  downloadProgress?: { completed: number; total: number };
};

type ChapterEntry = {
  key: string;
  title: string;
  pageIndex: number;
  onlineIndex?: number;
  url?: string;
};

type ReaderPageRuntimeState = {
  bookKey: string;
  phase: "ready" | "turning" | "settling";
  currentIndex: number;
  targetIndex?: number;
};

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

export function ReaderScreen({
  book,
  preferences,
  initialPage,
  onBack,
  onPageChange,
  onChapterBoundary,
  onChapterSelect,
  canPreviousChapter = false,
  canNextChapter = false,
  onDownloadAll,
  onOpenOriginal,
  downloadProgress,
}: ReaderScreenProps) {
  const [pageIndex, setPageIndex] = useState(() =>
    Math.max(0, Math.min(initialPage, book.pages.length - 1)),
  );
  const [controlsVisible, setControlsVisible] = useState(
    !preferences.immersiveMode,
  );
  const [chapterVisible, setChapterVisible] = useState(false);
  const chapterSheetProgress = useRef(new Animated.Value(0)).current;
  const pageOpacity = useRef(new Animated.Value(1)).current;
  const pageTransition = useRef(new Animated.Value(0)).current;
  const dragTranslate = useRef(new Animated.Value(0)).current;
  const pageAnimatingRef = useRef(false);
  const pendingPageResetRef = useRef<number | undefined>(undefined);
  const pageCacheRef = useRef(new Map<number, string[]>());
  const pageBookKey = `${book.id}:${book.onlineChapterIndex ?? "local"}:${book.pages.length}`;
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
  const readingColumnWidth = Math.min(screenWidth, 760);
  const chromeWidth = Math.min(screenWidth - 20, 860);
  const chromeLeft = (screenWidth - chromeWidth) / 2;
  const chapterSheetWidth = Math.min(screenWidth, 760);
  const chapterSheetLeft = (screenWidth - chapterSheetWidth) / 2;

  const chapterEntries = useMemo<ChapterEntry[]>(() => {
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
  }, [book.format, book.onlineChapters, book.pageTitles, book.pages.length, book.webChapters]);

  const currentChapterListIndex = useMemo(() => {
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
  }, [book.onlineChapterIndex, book.onlineChapters, chapterEntries, pageIndex]);

  const currentOriginalUrl = chapterEntries[currentChapterListIndex]?.url || book.sourceUrl;

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
      if (finished) setChapterVisible(false);
    });
  }, [chapterSheetProgress]);

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

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      getPageParagraphs(pageIndex - 2);
      getPageParagraphs(pageIndex + 2);
    });
    return () => task.cancel();
  }, [getPageParagraphs, pageIndex]);
  const finishPageChange = useCallback(
    (next: number) => {
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: next,
        phase: "settling",
      };
      pendingPageResetRef.current = next;
      setPageIndex(next);
      onPageChange(next);
    },
    [onPageChange, pageBookKey],
  );

  useLayoutEffect(() => {
    if (pendingPageResetRef.current !== pageIndex) return;
    dragTranslate.setValue(0);
    pageTransition.setValue(0);
    pageOpacity.setValue(1);
    pendingPageResetRef.current = undefined;
    pageAnimatingRef.current = false;
    pageRuntimeRef.current = {
      bookKey: pageBookKey,
      currentIndex: pageIndex,
      phase: "ready",
    };
  }, [dragTranslate, pageBookKey, pageIndex, pageOpacity, pageTransition]);
  const selectChapter = useCallback(
    (entry: ChapterEntry) => {
      closeChapterList();
      if (
        entry.onlineIndex !== undefined &&
        entry.onlineIndex !== (book.onlineChapterIndex ?? 0)
      ) {
        onChapterSelect?.(entry.onlineIndex);
        return;
      }
      const targetPage = entry.onlineIndex !== undefined ? 0 : entry.pageIndex;
      if (targetPage === pageIndex) return;
      const direction = targetPage > pageIndex ? 1 : -1;
      pageAnimatingRef.current = true;
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "turning",
        targetIndex: targetPage,
      };
      dragTranslate.setValue(0);
      Animated.timing(dragTranslate, {
        duration: 240,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: direction * -screenWidth,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) finishPageChange(targetPage);
        else {
          pageAnimatingRef.current = false;
          pageRuntimeRef.current = {
            bookKey: pageBookKey,
            currentIndex: pageIndex,
            phase: "ready",
          };
        }
      });
    },
    [book.onlineChapterIndex, closeChapterList, dragTranslate, finishPageChange, onChapterSelect, pageBookKey, pageIndex, screenWidth],
  );

  const resetPagePosition = useCallback(() => {
    Animated.parallel([
      Animated.timing(dragTranslate, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageTransition, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pageOpacity, {
        toValue: 1,
        duration: 130,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      pageAnimatingRef.current = false;
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "ready",
      };
    });
  }, [dragTranslate, pageBookKey, pageIndex, pageOpacity, pageTransition]);

  const changePage = useCallback(
    (direction: -1 | 1) => {
      if (pageAnimatingRef.current) return;
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
        finishPageChange(next);
        return;
      }

      pageAnimatingRef.current = true;
      pageRuntimeRef.current = {
        bookKey: pageBookKey,
        currentIndex: pageIndex,
        phase: "turning",
        targetIndex: next,
      };
      dragTranslate.stopAnimation();
      pageTransition.stopAnimation();
      pageOpacity.stopAnimation();
      pageTransition.setValue(0);
      pageOpacity.setValue(1);
      dragTranslate.setValue(0);
      Animated.timing(dragTranslate, {
        duration: preferences.pageTurn === "cover" ? 270 : 245,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: direction * -screenWidth,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) finishPageChange(next);
        else {
          pageAnimatingRef.current = false;
          pageRuntimeRef.current = {
            bookKey: pageBookKey,
            currentIndex: pageIndex,
            phase: "ready",
          };
        }
      });
    },
    [
      book.pages.length,
      canNextChapter,
      canPreviousChapter,
      dragTranslate,
      finishPageChange,
      onChapterBoundary,
      pageIndex,
      pageOpacity,
      pageTransition,
      preferences.pageTurn,
      resetPagePosition,
      screenWidth,
    ],
  );
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

  const dragOpacity = useMemo(
    () =>
      dragVisual.interpolate({
        inputRange: [-screenWidth, 0, screenWidth],
        outputRange: [1, 1, 1],
        extrapolate: "clamp",
      }),
    [dragVisual, screenWidth],
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
      if (event.nativeEvent.oldState !== State.ACTIVE || pageAnimatingRef.current) return;

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
        pageAnimatingRef.current = true;
        const next = pageIndex + direction;
        pageRuntimeRef.current = {
          bookKey: pageBookKey,
          currentIndex: pageIndex,
          phase: "settling",
          targetIndex: next,
        };
        const remaining = 1 - Math.min(Math.abs(translationX) / screenWidth, 1);
        const duration = Math.max(110, Math.min(230, Math.round(remaining * 220)));
        pageOpacity.setValue(1);
        Animated.timing(dragTranslate, {
          duration,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          toValue: direction * -screenWidth,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) finishPageChange(next);
          else {
          pageAnimatingRef.current = false;
          pageRuntimeRef.current = {
            bookKey: pageBookKey,
            currentIndex: pageIndex,
            phase: "ready",
          };
        }
        });
        return;
      }

      resetPagePosition();
    },
    [
      book.pages.length,
      canNextChapter,
      canPreviousChapter,
      dragTranslate,
      finishPageChange,
      pageIndex,
      pageOpacity,
      onChapterBoundary,
      resetPagePosition,
      screenWidth,
    ],
  );

  const pageTranslate = useMemo(
    () => Animated.add(pageTransition, dragVisual),
    [dragVisual, pageTransition],
  );
  const combinedPageOpacity = useMemo(
    () => Animated.multiply(pageOpacity, dragOpacity),
    [dragOpacity, pageOpacity],
  );
  const renderParagraphNodes = (items: string[], index: number, selectable = false) =>
    items.map((paragraph, paragraphIndex) => (
      <Text
        key={`${index}-${paragraphIndex}`}
        selectable={selectable}
        style={[
          styles.paragraph,
          {
            color: palette.text,
            fontFamily: getReaderFontFamily(preferences.fontFamily),
            fontSize: preferences.fontSize,
            lineHeight: preferences.fontSize * preferences.lineHeight,
            marginBottom: preferences.paragraphSpacing,
            textAlign: preferences.textAlignment,
          },
        ]}
      >
        {paragraph}
      </Text>
    ));

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={styles.container}>
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
          <Pressable onPress={onBack} style={styles.iconButton}>
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
            <Pressable accessibilityLabel="章节目录" onPress={openChapterList} style={styles.iconButton}>
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
          failOffsetY={[-12, 12]}
          hitSlop={{ left: -28 }}
          onGestureEvent={onGestureEvent}
          onHandlerStateChange={onGestureStateChange}
        >
          <Animated.View style={styles.page}>
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
                  opacity: previousPageOpacity,
                  backgroundColor: palette.background,
                },
              ]}
            >
              {renderParagraphNodes(previousParagraphs, pageIndex - 1)}
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
                  opacity: nextPageOpacity,
                  backgroundColor: palette.background,
                },
              ]}
            >
              {renderParagraphNodes(nextParagraphs, pageIndex + 1)}
            </Animated.View>
          ) : null}

          <Animated.ScrollView
            contentContainerStyle={[
              styles.pageContent,
              { paddingHorizontal: preferences.horizontalPadding },
            ]}
            showsVerticalScrollIndicator={false}
            style={[
              styles.readingColumn,
              {
                opacity: combinedPageOpacity,
                backgroundColor: palette.background,
                width: readingColumnWidth,
                transform: [{ translateX: pageTranslate }],
              },
            ]}
          >
            {renderParagraphNodes(paragraphs, pageIndex, true)}

          </Animated.ScrollView>

          {preferences.tapToTurn ? (
            <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              <Pressable
                accessibilityLabel="上一页"
                onPress={() => changePage(-1)}
                style={styles.leftTapArea}
              />
              <Pressable
                accessibilityLabel="显示或隐藏阅读工具栏"
                onPress={() => setControlsVisible((visible) => !visible)}
                style={styles.centerTapArea}
              />
              <Pressable
                accessibilityLabel="下一页"
                onPress={() => changePage(1)}
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
            disabled={pageIndex === 0 && !canPreviousChapter}
            onPress={() => changePage(-1)}
            style={[styles.pageButton, pageIndex === 0 && !canPreviousChapter && styles.disabled]}
          >
            <Ionicons name="arrow-back" size={19} color={palette.text} />
            <Text style={[styles.pageButtonText, { color: palette.text }]}>
              {pageIndex === 0 && canPreviousChapter ? "上一章" : "上一页"}
            </Text>
          </Pressable>

          {preferences.showProgress ? (
            <Pressable
              accessibilityLabel="章节目录"
              onPress={openChapterList}
              style={styles.progressBlock}
            >
              <Text style={[styles.progressText, { color: palette.muted }]}>
                章节 · {pageIndex + 1} / {book.pages.length} · {Math.round(progress)}%
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
            disabled={pageIndex === book.pages.length - 1 && !canNextChapter}
            onPress={() => changePage(1)}
            style={[
              styles.pageButton,
              pageIndex === book.pages.length - 1 && !canNextChapter && styles.disabled,
            ]}
          >
            <Text style={[styles.pageButtonText, { color: palette.text }]}>
              {pageIndex === book.pages.length - 1 && canNextChapter ? "下一章" : "下一页"}
            </Text>
            <Ionicons name="arrow-forward" size={19} color={palette.text} />
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
                    共 {chapterEntries.length} 章 · 当前第 {currentChapterListIndex + 1} 章
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
            </Animated.View>
          </View>
        ) : null}
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
  header: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
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
  pageContent: { minHeight: "100%", paddingBottom: 104, paddingTop: 12 },
  paragraph: { fontFamily: "serif", letterSpacing: 0.25 },
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
    borderWidth: 1,
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
    flexDirection: "row",
    gap: 5,
    minWidth: 76,
    paddingVertical: 12,
  },
  pageButtonText: { fontSize: 13, fontWeight: "600" },
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
    borderWidth: 1,
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
