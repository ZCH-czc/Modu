import {
  Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { I18nProvider, Text, useI18n } from "./src/i18n";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Reanimated, {
  Easing as ReanimatedEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { AppDialogProvider, useAppAlert } from "./src/components/AppDialog";
import { BrandLaunchScreen } from "./src/components/BrandLaunchScreen";
import { OnboardingModal } from "./src/components/OnboardingModal";
import { getSampleBooks } from "./src/data/books";
import { BookSourceBrowserBridge } from "./src/components/BookSourceBrowserBridge";
import { BookSourceModal } from "./src/screens/BookSourceModal";
import { HomeShelf } from "./src/screens/HomeShelf";
import { PdfReaderScreen } from "./src/screens/PdfReaderScreen";
import { ReaderScreen } from "./src/screens/ReaderScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { LanTransferModal, type LanTransferRequest } from "./src/screens/LanTransferModal";
import { WebReaderModal } from "./src/screens/WebReaderModal";
import {
  clearOnlineChapterCache,
  countCachedOnlineChapters,
  createOnlineBook,
  deleteOnlineBookCache,
  downloadOnlineBook,
  loadBookInfo,
  loadBookSources,
  loadChapterList,
  loadOnlineBooks,
  loadOnlineChapter,
  paginateOnlineText,
  readCachedOnlineChapter,
  saveOnlineBooks,
} from "./src/services/bookSources";
import {
  applyBrightness,
  applyOrientation,
  clearCache,
  clearProgress,
  configureReminder,
  defaultPreferences,
  deleteImportedBook,
  importDocument,
  type ImportProgress,
  importBookFromUri,
  loadBookmarks,
  loadHiddenSampleBooks,
  loadImportedBooks,
  loadOnboardingComplete,
  loadPreferences,
  loadProgress,
  persistEpubPagination,
  repaginateImportedTextBook,
  saveBookmarks,
  saveHiddenSampleBooks,
  saveImportedBooks,
  saveOnboardingComplete,
  savePreferences,
  saveProgress,
} from "./src/services/runtime";
import { exportAppBackup, restoreAppBackup } from "./src/services/appBackup";
import {
  exportAnnotationsMarkdown,
  loadAnnotations,
  migrateAnnotationsForPagination,
  saveAnnotations,
} from "./src/services/readerAnnotations";
import {
  addReadingSession,
  emptyReadingStats,
  loadReadingStats,
  saveReadingStats,
  type ReadingStats,
} from "./src/services/readingStats";
import { loadReadingGoal, saveReadingGoal } from "./src/services/readingGoal";
import {
  createWebCaptureBook,
  repaginateWebCaptureBook,
} from "./src/services/webCapture";
import {
  createReaderPaginationLayout,
  type ReaderPaginationLayout,
} from "./src/services/readerPagination";
import {
  deleteBookCoverImage,
  loadBookAppearances,
  pickBookCoverImage,
  saveBookAppearances,
} from "./src/services/bookAppearance";
import type {
  AppTab,
  Book,
  BookCoverAppearance,
  ImportedBookSource,
  OnlineBookResult,
  OnlineChapter,
  ReaderAnnotation,
  ReaderBookmark,
  ReaderPreferences,
  ReadingProgress,
  WebPageExtraction,
} from "./src/types";

type DownloadState = {
  bookId: string;
  completed: number;
  total: number;
};

type OnlineSession = {  sourceId: string;
  chapters: OnlineChapter[];
  index: number;
};

const MemoHomeShelf = memo(HomeShelf);
const MemoSettingsScreen = memo(SettingsScreen);

function useEvent<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}

function prepareBookForPagination(
  book: Book,
  layout: ReaderPaginationLayout,
): Book {
  if (book.format === "webclip" && book.webChapters?.length) {
    return repaginateWebCaptureBook(book, layout);
  }
  if (book.format === "epub" || book.format === "txt") {
    return repaginateImportedTextBook(book, layout);
  }
  return book;
}

function migrateBookmarks(
  bookmarks: ReaderBookmark[],
  bookId: string,
  oldPageCount: number,
  newPageCount: number,
) {
  const oldLastPage = Math.max(oldPageCount - 1, 1);
  const newLastPage = Math.max(newPageCount - 1, 0);
  const migrated = bookmarks.map((bookmark) =>
    bookmark.bookId === bookId
      ? {
          ...bookmark,
          pageIndex: Math.min(
            newLastPage,
            Math.round((bookmark.pageIndex / oldLastPage) * newLastPage),
          ),
        }
      : bookmark,
  );
  return migrated.filter((bookmark, index, items) =>
    items.findIndex((candidate) =>
      candidate.bookId === bookmark.bookId &&
      candidate.chapterIndex === bookmark.chapterIndex &&
      candidate.pageIndex === bookmark.pageIndex
    ) === index,
  );
}

export default function App() {
  const [launchVisible, setLaunchVisible] = useState(true);
  const finishLaunch = useCallback(() => setLaunchVisible(false), []);

  return (
    <>
      <I18nProvider>
        <AppDialogProvider>
          <AppContent />
        </AppDialogProvider>
      </I18nProvider>
      {launchVisible ? <BrandLaunchScreen onFinished={finishLaunch} /> : null}
    </>
  );
}

function AppContent() {
  const Alert = useAppAlert();
  const { resolvedLanguage } = useI18n();
  const sampleBooks = useMemo(() => getSampleBooks(resolvedLanguage), [resolvedLanguage]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<AppTab>("shelf");
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultPreferences);
  const [importedBooks, setImportedBooks] = useState<Book[]>([]);
  const [bookAppearances, setBookAppearances] = useState<Record<string, BookCoverAppearance>>({});
  const [hiddenSampleIds, setHiddenSampleIds] = useState<string[]>([]);
  const [onlineBooks, setOnlineBooks] = useState<Book[]>([]);
  const onlineBooksRef = useRef<Book[]>([]);
  const [sources, setSources] = useState<ImportedBookSource[]>([]);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [webReaderVisible, setWebReaderVisible] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [lanTransferVisible, setLanTransferVisible] = useState(false);
  const [webReaderInitialExtraction, setWebReaderInitialExtraction] = useState<WebPageExtraction>();
  const [webReaderInitialUrl, setWebReaderInitialUrl] = useState<string>();
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineSession, setOnlineSession] = useState<OnlineSession>();
  const [downloadState, setDownloadState] = useState<DownloadState>();
  const [progress, setProgress] = useState<Record<string, ReadingProgress>>({});
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [readingStats, setReadingStats] = useState<ReadingStats>(emptyReadingStats);
  const [readingGoalMinutes, setReadingGoalMinutes] = useState(30);
  const [currentBook, setCurrentBook] = useState<Book>();
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>();
  const importProgressValue = useRef(new Animated.Value(0)).current;
  const readerProgress = useRef(new Animated.Value(0)).current;
  const preferencesRef = useRef<ReaderPreferences>(defaultPreferences);
  const preferencesSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingProgress = useRef<Record<string, ReadingProgress>>({});
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const progressDirty = useRef(false);
  const progressUiDirty = useRef(false);
  const readingStatsRef = useRef<ReadingStats>(emptyReadingStats);
  const readingSessionRef = useRef<{
    bookId: string;
    startedAt: number;
    pageTurns: number;
    lastPageIndex?: number;
  } | undefined>(undefined);
  const currentBookRef = useRef<Book | undefined>(undefined);
  const appStateRef = useRef(AppState.currentState);
  const chapterLoadTasksRef = useRef(new Map<string, Promise<string>>());
  const onlinePreloadRef = useRef<{
    bookId?: string;
    generation: number;
    phase: "idle" | "loading" | "ready" | "partial";
  }>({ generation: 0, phase: "idle" });
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const navWidth = Math.min(screenWidth - 24, 560);
  const tabProgress = useSharedValue(0);
  currentBookRef.current = currentBook;

  const shelfPageStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: -screenWidth * tabProgress.value }] }),
    [screenWidth],
  );
  const settingsPageStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: screenWidth * (1 - tabProgress.value) }] }),
    [screenWidth],
  );
  const navIndicatorStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: ((navWidth - 16) / 2) * tabProgress.value }] }),
    [navWidth],
  );

  const changeTab = (nextTab: AppTab) => {
    if (nextTab === tab) return;
    setTab(nextTab);
    tabProgress.value = withTiming(nextTab === "settings" ? 1 : 0, {
      duration: 280,
      easing: ReanimatedEasing.bezier(0.22, 1, 0.36, 1),
    });
  };

  const commitReadingSession = useEvent((restart = false) => {
    const session = readingSessionRef.current;
    if (!session) return;
    const now = Date.now();
    const next = addReadingSession(
      readingStatsRef.current,
      session.bookId,
      session.startedAt,
      now,
      session.pageTurns,
    );
    if (next !== readingStatsRef.current) {
      readingStatsRef.current = next;
      setReadingStats(next);
      void saveReadingStats(next);
    }
    readingSessionRef.current =
      restart && appStateRef.current === "active" && currentBookRef.current
        ? {
            bookId: currentBookRef.current.id,
            startedAt: now,
            pageTurns: 0,
            lastPageIndex: session.lastPageIndex,
          }
        : undefined;
  });

  const startReadingSession = useEvent((bookId: string) => {
    if (appStateRef.current !== "active") return;
    if (readingSessionRef.current?.bookId === bookId) return;
    commitReadingSession(false);
    readingSessionRef.current = {
      bookId,
      startedAt: Date.now(),
      pageTurns: 0,
    };
  });

  useEffect(() => {
    if (currentBook) startReadingSession(currentBook.id);
    else commitReadingSession(false);
    return () => commitReadingSession(false);
  }, [commitReadingSession, currentBook?.id, startReadingSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "active" && currentBookRef.current) {
        startReadingSession(currentBookRef.current.id);
      } else {
        commitReadingSession(false);
      }
    });
    const interval = setInterval(() => commitReadingSession(true), 30_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
      commitReadingSession(false);
    };
  }, [commitReadingSession, startReadingSession]);

  const closeWebReader = () => {
    setWebReaderVisible(false);
    setWebReaderInitialExtraction(undefined);
    setWebReaderInitialUrl(undefined);
  };

  const finishOnboarding = useCallback(() => {
    setOnboardingVisible(false);
    void saveOnboardingComplete();
  }, []);

  const closeReader = () => {
    if (!currentBook) return;
    readerProgress.stopAnimation();
    Animated.timing(readerProgress, {
      toValue: 0,
      duration: 260,
      easing: Easing.bezier(0.4, 0, 0.6, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      if (progressSaveTimer.current) {
        clearTimeout(progressSaveTimer.current);
        progressSaveTimer.current = undefined;
      }
      const next = pendingProgress.current;
      if (progressDirty.current) {
        progressDirty.current = false;
        void saveProgress(next);
      }
      requestAnimationFrame(() => {
        setCurrentBook(undefined);
        setOnlineSession(undefined);
        onlinePreloadRef.current = {
          generation: onlinePreloadRef.current.generation + 1,
          phase: "idle",
        };
        if (progressUiDirty.current) {
          progressUiDirty.current = false;
          requestAnimationFrame(() => setProgress(next));
        }
      });
    });
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (lanTransferVisible) {
        setLanTransferVisible(false);
        return true;
      }
      if (onboardingVisible) {
        finishOnboarding();
        return true;
      }
      if (webReaderVisible) {
        closeWebReader();
        return true;
      }
      if (sourceModalVisible) {
        setSourceModalVisible(false);
        return true;
      }
      if (currentBook) {
        closeReader();
        return true;
      }
      if (tab === "settings") {
        changeTab("shelf");
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [currentBook, finishOnboarding, lanTransferVisible, onboardingVisible, sourceModalVisible, tab, webReaderVisible]);

  useEffect(() => {
    Promise.all([
      loadPreferences(),
      loadImportedBooks(),
      loadOnlineBooks(),
      loadBookSources(),
      loadProgress(),
      loadHiddenSampleBooks(),
      loadOnboardingComplete(),
      loadBookAppearances(),
      loadBookmarks(),
      loadAnnotations(),
      loadReadingStats(),
    ])
      .then(([savedPreferences, localBooks, savedOnlineBooks, savedSources, readingProgress, hiddenSamples, onboardingComplete, savedBookAppearances, savedBookmarks, savedAnnotations, savedReadingStats]) => {
        preferencesRef.current = savedPreferences;
        setPreferences(savedPreferences);
        setImportedBooks(localBooks);
        onlineBooksRef.current = savedOnlineBooks;
        setOnlineBooks(savedOnlineBooks);
        setSources(savedSources);
        setProgress(readingProgress);
        setHiddenSampleIds(hiddenSamples);
        setOnboardingVisible(!onboardingComplete);
        setBookAppearances(savedBookAppearances);
        setBookmarks(savedBookmarks);
        setAnnotations(savedAnnotations);
        readingStatsRef.current = savedReadingStats;
        setReadingStats(savedReadingStats);
        pendingProgress.current = readingProgress;
        void applyOrientation(savedPreferences.orientation);
        void applyBrightness(savedPreferences);
      })
      .catch(() => {
        Alert.alert("初始化失败", "部分本地设置未能读取，已使用默认配置。");
      })
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    void loadReadingGoal().then(setReadingGoalMinutes);
  }, []);


  useEffect(
    () => () => {
      if (preferencesSaveTimer.current) {
        clearTimeout(preferencesSaveTimer.current);
        void savePreferences(preferencesRef.current);
      }
      if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
      if (progressDirty.current) void saveProgress(pendingProgress.current);
    },
    [],
  );

  const books = useMemo(
    () =>
      [...sampleBooks.filter((book) => !hiddenSampleIds.includes(book.id)), ...importedBooks, ...onlineBooks].map((book) => {
        const pageIndex = progress[book.id]?.pageIndex ?? 0;
        const pageCount = Math.max(book.pages.length, 1);
        const appearance = bookAppearances[book.id];
        return {
          ...book,
          coverColors: appearance?.colors ?? book.coverColors,
          coverMode: appearance?.mode,
          coverImageUri: appearance?.mode === "image" ? appearance.imageUri : undefined,
          lastOpenedAt: progress[book.id]?.updatedAt ?? book.importedAt ?? 0,
          progress:
            book.format === "web"
              ? book.progress
              : pageIndex === 0
                ? book.progress
                : ((pageIndex + 1) / pageCount) * 100,
        };
      }),
    [bookAppearances, hiddenSampleIds, importedBooks, onlineBooks, progress, sampleBooks],
  );

  const updatePreferences = (patch: Partial<ReaderPreferences>) => {
    const next = { ...preferencesRef.current, ...patch };
    preferencesRef.current = next;
    setPreferences(next);

    if (preferencesSaveTimer.current) clearTimeout(preferencesSaveTimer.current);
    preferencesSaveTimer.current = setTimeout(() => {
      preferencesSaveTimer.current = undefined;
      void savePreferences(next);
    }, 180);

    void (async () => {
      if ("orientation" in patch) await applyOrientation(next.orientation);
      if ("followSystemBrightness" in patch || "brightness" in patch) {
        await applyBrightness(next);
      }
      if (
        "notifications" in patch ||
        "reminderHour" in patch ||
        "reminderMinute" in patch
      ) {
        const reminderResult = await configureReminder(next);
        if (reminderResult !== "configured") {
          const corrected = { ...preferencesRef.current, notifications: false };
          preferencesRef.current = corrected;
          setPreferences(corrected);
          if (preferencesSaveTimer.current) {
            clearTimeout(preferencesSaveTimer.current);
            preferencesSaveTimer.current = undefined;
          }
          await savePreferences(corrected);
          Alert.alert(
            reminderResult === "unsupported" ? "提醒服务不可用" : "通知权限未开启",
            reminderResult === "unsupported"
              ? "当前设备暂时无法创建每日提醒，请稍后重试。"
              : "请在系统设置中允许通知后，再开启每日阅读提醒。",
          );
        }
      }
    })();
  };

  const updateImportProgress = useCallback((next: ImportProgress) => {
    setImportProgress(next);
    Animated.timing(importProgressValue, {
      toValue: next.progress,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [importProgressValue]);
  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    importProgressValue.setValue(0.02);
    setImportProgress({ progress: 0.02, message: "等待选择书籍" });
    try {
      const book = await importDocument(importedBooks, updateImportProgress);
      if (book) {
        setImportedBooks((items) => [...items, book]);
        await new Promise((resolve) => setTimeout(resolve, 220));
        Alert.alert("导入成功", "《" + book.title + "》已加入书架。");
      }
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : "无法读取这个文件。");
    } finally {
      setImporting(false);
      setImportProgress(undefined);
      importProgressValue.setValue(0);
    }
  };

  const presentBook = (book: Book) => {
    const layout = createReaderPaginationLayout(
      screenWidth,
      screenHeight,
      preferencesRef.current,
    );
    const preparedBook = prepareBookForPagination(book, layout);

    const paginationChanged =
      preparedBook.pages.length !== book.pages.length ||
      preparedBook.pages.some((page, index) => page !== book.pages[index]);
    if (paginationChanged) {
      const oldPage = pendingProgress.current[book.id]?.pageIndex ?? 0;
      const oldLastPage = Math.max(book.pages.length - 1, 1);
      const newLastPage = Math.max(preparedBook.pages.length - 1, 0);
      const migratedPage = Math.min(
        newLastPage,
        Math.round((oldPage / oldLastPage) * newLastPage),
      );
      const nextProgress = {
        ...pendingProgress.current,
        [book.id]: { pageIndex: migratedPage, updatedAt: Date.now() },
      };
      pendingProgress.current = nextProgress;
      setProgress(nextProgress);
      void saveProgress(nextProgress);
      setBookmarks((items) => {
        const next = migrateBookmarks(
          items,
          book.id,
          book.pages.length,
          preparedBook.pages.length,
        );
        void saveBookmarks(next);
        return next;
      });      setAnnotations((items) => {
        const next = migrateAnnotationsForPagination(items, book.id, preparedBook.pages);
        void saveAnnotations(next);
        return next;
      });

      if (importedBooks.some((item) => item.id === book.id)) {
        const nextBooks = importedBooks.map((item) =>
          item.id === book.id ? preparedBook : item,
        );
        setImportedBooks(nextBooks);
        void saveImportedBooks(nextBooks);
        void persistEpubPagination(preparedBook);
      }
    }
    readerProgress.setValue(0);
    setCurrentBook(preparedBook);
    requestAnimationFrame(() => {
      Animated.timing(readerProgress, {
        toValue: 1,
        duration: 300,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
    });
  };

  const handlePaginationMeasured = useEvent((layout: ReaderPaginationLayout) => {
    const book = currentBook;
    if (!book) return;
    const prepared = prepareBookForPagination(book, layout);
    const paginationChanged =
      prepared.pages.length !== book.pages.length ||
      prepared.pages.some((page, index) => page !== book.pages[index]);
    if (!paginationChanged) return;

    const oldPage = pendingProgress.current[book.id]?.pageIndex ?? 0;
    const oldLastPage = Math.max(book.pages.length - 1, 1);
    const newLastPage = Math.max(prepared.pages.length - 1, 0);
    const migratedPage = Math.min(
      newLastPage,
      Math.round((oldPage / oldLastPage) * newLastPage),
    );
    const nextProgress = {
      ...pendingProgress.current,
      [book.id]: { pageIndex: migratedPage, updatedAt: Date.now() },
    };
    const nextBook: Book = {
      ...prepared,
      paginationVersion: (book.paginationVersion ?? 0) + 1,
    };

    pendingProgress.current = nextProgress;
    setProgress(nextProgress);
    setCurrentBook(nextBook);
    void saveProgress(nextProgress);
    setBookmarks((items) => {
      const next = migrateBookmarks(
        items,
        book.id,
        book.pages.length,
        nextBook.pages.length,
      );
      void saveBookmarks(next);
      return next;
    });    setAnnotations((items) => {
      const next = migrateAnnotationsForPagination(items, book.id, nextBook.pages);
      void saveAnnotations(next);
      return next;
    });

    if (importedBooks.some((item) => item.id === book.id)) {
      const nextBooks = importedBooks.map((item) =>
        item.id === book.id ? nextBook : item,
      );
      setImportedBooks(nextBooks);
      void saveImportedBooks(nextBooks);
      void persistEpubPagination(nextBook);
    }
  });

  const handleToggleBookmark = useEvent((
    pageIndex: number,
    chapterTitle: string,
    excerpt: string,
  ) => {
    const book = currentBook;
    if (!book) return;
    setBookmarks((items) => {
      const existing = items.find(
        (bookmark) =>
          bookmark.bookId === book.id &&
          bookmark.chapterIndex === book.onlineChapterIndex &&
          bookmark.pageIndex === pageIndex,
      );
      const next = existing
        ? items.filter((bookmark) => bookmark.id !== existing.id)
        : [
            ...items,
            {
              id: `${book.id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
              bookId: book.id,
              pageIndex,
              chapterIndex: book.onlineChapterIndex,
              chapterTitle,
              excerpt,
              createdAt: Date.now(),
            },
          ];
      void saveBookmarks(next);
      return next;
    });
  });

  const removeBookmarksForBook = useEvent((bookId: string) => {
    setBookmarks((items) => {
      const next = items.filter((bookmark) => bookmark.bookId !== bookId);
      if (next.length !== items.length) void saveBookmarks(next);
      return next;
    });
  });

  const handleSaveAnnotation = useEvent((annotation: ReaderAnnotation) => {
    setAnnotations((items) => {
      const index = items.findIndex((item) => item.id === annotation.id);
      const next = index >= 0
        ? items.map((item) => item.id === annotation.id ? annotation : item)
        : [...items, annotation];
      void saveAnnotations(next);
      return next;
    });
  });

  const handleDeleteAnnotation = useEvent((annotationId: string) => {
    setAnnotations((items) => {
      const next = items.filter((annotation) => annotation.id !== annotationId);
      if (next.length !== items.length) void saveAnnotations(next);
      return next;
    });
  });

  const removeAnnotationsForBook = useEvent((bookId: string) => {
    setAnnotations((items) => {
      const next = items.filter((annotation) => annotation.bookId !== bookId);
      if (next.length !== items.length) void saveAnnotations(next);
      return next;
    });
  });

  const persistOnlineBook = async (book: Book) => {
    const current = onlineBooksRef.current;
    const stored = { ...book, pages: [], pageTitles: [] };
    const next = current.some((item) => item.id === book.id)
      ? current.map((item) => (item.id === book.id ? { ...item, ...stored } : item))
      : [...current, stored];
    onlineBooksRef.current = next;
    setOnlineBooks(next);
    await saveOnlineBooks(next);
  };

  const handleAddOnlineResult = async (result: OnlineBookResult) => {
    const created = createOnlineBook(result);
    const existing = onlineBooksRef.current.find((book) => book.id === created.id);
    if (!existing) await persistOnlineBook(created);
  };

  const loadManagedOnlineChapter = useCallback(
    async (
      source: ImportedBookSource,
      bookId: string,
      chapter: OnlineChapter,
    ) => {
      const cached = await readCachedOnlineChapter(bookId, chapter);
      if (cached) return cached;

      const key = `${bookId}:${chapter.url}`;
      const existing = chapterLoadTasksRef.current.get(key);
      if (existing) return existing;

      const task = loadOnlineChapter(source, bookId, chapter)
        .then((result) => result.content)
        .finally(() => chapterLoadTasksRef.current.delete(key));
      chapterLoadTasksRef.current.set(key, task);
      return task;
    },
    [],
  );

  const preloadOnlineNeighbors = useCallback(
    (bookId: string, session: OnlineSession) => {
      const source = sources.find(
        (item) => item.id === session.sourceId && item.enabled,
      );
      const generation = onlinePreloadRef.current.generation + 1;
      onlinePreloadRef.current = {
        bookId,
        generation,
        phase: source ? "loading" : "idle",
      };
      if (!source) return;

      const neighborIndexes = [session.index + 1, session.index - 1].filter(
        (index) => index >= 0 && index < session.chapters.length,
      );
      if (!neighborIndexes.length) {
        onlinePreloadRef.current.phase = "ready";
        return;
      }

      void Promise.allSettled(
        neighborIndexes.map((index) =>
          loadManagedOnlineChapter(source, bookId, session.chapters[index]),
        ),
      ).then((results) => {
        const state = onlinePreloadRef.current;
        if (state.bookId !== bookId || state.generation !== generation) return;
        state.phase = results.every((result) => result.status === "fulfilled")
          ? "ready"
          : "partial";
      });
    },
    [loadManagedOnlineChapter, sources],
  );

  const openOnlineBook = async (shelfBook: Book, rawResult?: OnlineBookResult) => {
    if (!shelfBook.sourceId || !shelfBook.bookUrl) {
      throw new Error("这本书缺少书源信息。");
    }
    const source = sources.find(
      (item) => item.id === shelfBook.sourceId && item.enabled,
    );

    setOnlineLoading(true);
    try {
      const seed: OnlineBookResult = rawResult ?? {
        sourceId: shelfBook.sourceId,
        name: shelfBook.title,
        author: shelfBook.author,
        bookUrl: shelfBook.bookUrl,
        tocUrl: shelfBook.tocUrl,
        coverUrl: shelfBook.coverUrl,
      };
      const info = source && (rawResult || !(shelfBook.onlineChapters?.length))
        ? await loadBookInfo(source, seed)
        : seed;
      let chapters = shelfBook.onlineChapters ?? [];
      if (!chapters.length) {
        if (!source) {
          throw new Error("尚未保存章节目录，请先恢复对应书源。");
        }
        chapters = await loadChapterList(source, info.tocUrl || info.bookUrl);
      }
      if (!chapters.length) throw new Error("没有找到可阅读的章节。");

      let index = Math.max(
        0,
        Math.min(shelfBook.onlineChapterIndex ?? 0, chapters.length - 1),
      );
      if (shelfBook.onlineChapterUrl) {
        const savedIndex = chapters.findIndex(
          (chapter) => chapter.url === shelfBook.onlineChapterUrl,
        );
        if (savedIndex >= 0) index = savedIndex;
      }

      const chapter = chapters[index];
      let content = await readCachedOnlineChapter(shelfBook.id, chapter);
      if (!content) {
        if (!source) {
          throw new Error("当前章节尚未下载，请恢复书源后再试。");
        }
        content = await loadManagedOnlineChapter(source, shelfBook.id, chapter);
      }
      const downloadedChapterCount = await countCachedOnlineChapters(shelfBook.id);
      const pages = paginateOnlineText(content);
      const opened: Book = {
        ...shelfBook,
        title: info.name || shelfBook.title,
        author: info.author || shelfBook.author,
        bookUrl: info.bookUrl,
        tocUrl: info.tocUrl,
        coverUrl: info.coverUrl,
        currentChapter: chapter.name,
        lastRead: "刚刚阅读",
        pages,
        pageTitles: pages.map(() => chapter.name),
        onlineChapterIndex: index,
        onlineChapterUrl: chapter.url,
        onlineChapters: chapters,
        onlineChapterCount: chapters.length,
        downloadedChapterCount,
        fullyDownloaded: downloadedChapterCount >= chapters.length,
      };
      await persistOnlineBook(opened);
      const nextSession: OnlineSession = {
        sourceId: shelfBook.sourceId,
        chapters,
        index,
      };
      setOnlineSession(nextSession);
      presentBook(opened);
      requestAnimationFrame(() =>
        preloadOnlineNeighbors(opened.id, nextSession),
      );
    } finally {
      setOnlineLoading(false);
    }
  };

  const handleOnlineResult = async (result: OnlineBookResult) => {
    const created = createOnlineBook(result);
    const existing = onlineBooksRef.current.find((book) => book.id === created.id);
    if (!existing) await persistOnlineBook(created);
    await openOnlineBook(existing ?? created, result);
  };

  const handleRemoveOnlineBook = (book: Book) => {
    Alert.alert("移出书架", "确定将《" + book.title + "》从书架移除吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => {
          const next = onlineBooksRef.current.filter((item) => item.id !== book.id);
          onlineBooksRef.current = next;
          setOnlineBooks(next);
          void saveOnlineBooks(next);
          void deleteOnlineBookCache(book.id);
          removeBookmarksForBook(book.id);
          removeAnnotationsForBook(book.id);
        },
      },
    ]);
  };

  const handleOpenBook = (book: Book) => {
    if (book.format === "webclip") {
      if (!book.pages.length) {
        Alert.alert("内容不可用", "这本网页书缺少可恢复的正文。");
        return;
      }
      presentBook(book);
      return;
    }
    if (book.format === "web") {
      void openOnlineBook(book).catch((error) => {
        Alert.alert(
          "无法打开",
          error instanceof Error ? error.message : "请检查网络后重试。",
        );
      });
      return;
    }
    if (book.format === "epub" && book.pages.length === 0) {
      Alert.alert("内容不可用", "请删除该书后重新导入。");
      return;
    }
    presentBook(book);
  };

  const openOnlineChapterAt = async (
    nextIndex: number,
    initialPosition: "start" | "end" = "start",
  ) => {
    const book = currentBook;
    const session = onlineSession;
    if (!book || !session || onlineLoading) return;
    if (nextIndex < 0 || nextIndex >= session.chapters.length) return;

    const source = sources.find(
      (item) => item.id === session.sourceId && item.enabled,
    );

    setOnlineLoading(true);
    try {
      const chapter = session.chapters[nextIndex];
      let content = await readCachedOnlineChapter(book.id, chapter);
      if (!content) {
        if (!source) {
          throw new Error("这一章尚未下载，请恢复书源后再试。");
        }
        content = await loadManagedOnlineChapter(source, book.id, chapter);
      }
      const downloadedChapterCount = await countCachedOnlineChapters(book.id);
      const pages = paginateOnlineText(content);
      const opened: Book = {
        ...book,
        currentChapter: chapter.name,
        lastRead: "刚刚阅读",
        pages,
        pageTitles: pages.map(() => chapter.name),
        onlineChapterIndex: nextIndex,
        onlineChapterUrl: chapter.url,
        downloadedChapterCount,
        fullyDownloaded:
          downloadedChapterCount >= session.chapters.length,
      };
      const targetPage =
        initialPosition === "end" ? Math.max(0, pages.length - 1) : 0;
      pendingProgress.current = {
        ...pendingProgress.current,
        [book.id]: {
          pageIndex: targetPage,
          updatedAt: Date.now(),
        },
      };
      progressDirty.current = true;
      const nextSession = { ...session, index: nextIndex };
      setOnlineSession(nextSession);
      setCurrentBook(opened);
      await persistOnlineBook(opened);
      requestAnimationFrame(() =>
        preloadOnlineNeighbors(opened.id, nextSession),
      );
    } catch (error) {
      Alert.alert(
        "章节加载失败",
        error instanceof Error ? error.message : "请稍后重试。",
      );
    } finally {
      setOnlineLoading(false);
    }
  };

  const handleChapterBoundary = (direction: -1 | 1) => {
    if (!onlineSession) return;
    void openOnlineChapterAt(
      onlineSession.index + direction,
      direction < 0 ? "end" : "start",
    );
  };

  const handleChapterSelect = (chapterIndex: number) => {
    void openOnlineChapterAt(chapterIndex, "start");
  };

  const handleDownloadAll = async () => {
    const book = currentBook;
    const chapters = onlineSession?.chapters ?? book?.onlineChapters ?? [];
    if (!book || book.format !== "web" || !chapters.length || downloadState) return;
    if (book.fullyDownloaded) {
      Alert.alert("已下载", "这本书的全部章节已经保存在本机。");
      return;
    }

    const cachedCount = await countCachedOnlineChapters(book.id);
    if (cachedCount >= chapters.length) {
      const completed = {
        ...book,
        downloadedChapterCount: chapters.length,
        fullyDownloaded: true,
      };
      setCurrentBook(completed);
      await persistOnlineBook(completed);
      return;
    }

    const source = sources.find(
      (item) => item.id === book.sourceId && item.enabled,
    );
    if (!source) {
      Alert.alert("无法下载", "请先启用这本书对应的书源。");
      return;
    }

    setDownloadState({
      bookId: book.id,
      completed: cachedCount,
      total: chapters.length,
    });
    try {
      await downloadOnlineBook(source, book, chapters, (completed, total) => {
        setDownloadState({ bookId: book.id, completed, total });
      });
      const completed: Book = {
        ...book,
        onlineChapters: chapters,
        onlineChapterCount: chapters.length,
        downloadedChapterCount: chapters.length,
        fullyDownloaded: true,
      };
      setCurrentBook((current) =>
        current?.id === book.id ? { ...current, ...completed } : current,
      );
      await persistOnlineBook(completed);
      Alert.alert("下载完成", "《" + book.title + "》已可离线阅读。");
    } catch (error) {
      const downloadedChapterCount = await countCachedOnlineChapters(book.id);
      const partial: Book = {
        ...book,
        onlineChapters: chapters,
        onlineChapterCount: chapters.length,
        downloadedChapterCount,
        fullyDownloaded: downloadedChapterCount >= chapters.length,
      };
      setCurrentBook((current) =>
        current?.id === book.id ? { ...current, ...partial } : current,
      );
      await persistOnlineBook(partial);
      Alert.alert(
        "下载未完成",
        error instanceof Error ? error.message : "请稍后继续下载。",
      );
    } finally {
      setDownloadState(undefined);
    }
  };

  const handlePageChange = (pageIndex: number) => {
    if (!currentBook) return;
    const session = readingSessionRef.current;
    if (session?.bookId === currentBook.id) {
      if (session.lastPageIndex !== undefined && session.lastPageIndex !== pageIndex) {
        session.pageTurns += 1;
      }
      session.lastPageIndex = pageIndex;
    }
    if (!preferences.autoSync) return;
    const next = {
      ...pendingProgress.current,
      [currentBook.id]: { pageIndex, updatedAt: Date.now() },
    };
    pendingProgress.current = next;
    progressDirty.current = true;
    progressUiDirty.current = true;
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(() => {
      progressSaveTimer.current = undefined;
      progressDirty.current = false;
      void saveProgress(pendingProgress.current);
    }, 500);
  };

  const handleRenameShelfBook = async (book: Book, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === book.title || book.format === "sample") return;
    if (book.format === "web") {
      const next = onlineBooksRef.current.map((item) =>
        item.id === book.id ? { ...item, title: trimmed } : item,
      );
      onlineBooksRef.current = next;
      setOnlineBooks(next);
      await saveOnlineBooks(next);
    } else {
      const next = importedBooks.map((item) =>
        item.id === book.id ? { ...item, title: trimmed } : item,
      );
      setImportedBooks(next);
      await saveImportedBooks(next);
    }
    setCurrentBook((current) =>
      current?.id === book.id ? { ...current, title: trimmed } : current,
    );
  };

  const handleSetBookCoverColors = async (
    book: Book,
    colors: readonly [string, string],
  ) => {
    const next = {
      ...bookAppearances,
      [book.id]: { mode: "colors" as const, colors },
    };
    const previousImage = bookAppearances[book.id]?.imageUri;
    setBookAppearances(next);
    await saveBookAppearances(next);
    await deleteBookCoverImage(previousImage);
  };

  const handlePickBookCoverImage = async (book: Book) => {
    try {
      const previousImage = bookAppearances[book.id]?.imageUri;
      const imageUri = await pickBookCoverImage(book.id);

      if (!imageUri) return false;
      const next = {
        ...bookAppearances,
        [book.id]: { mode: "image" as const, imageUri },
      };
      setBookAppearances(next);
      await saveBookAppearances(next);
      await deleteBookCoverImage(previousImage);
      return true;
    } catch (error) {
      Alert.alert(
        "无法更换封面",
        error instanceof Error ? error.message : "无法读取这张图片。",
      );
      return false;
    }
  };
  const handleDeleteBook = async (book: Book) => {
    try {
      const next = await deleteImportedBook(book, importedBooks);
      setImportedBooks(next);
      removeBookmarksForBook(book.id);
      removeAnnotationsForBook(book.id);
    } catch {
      Alert.alert("删除失败", "无法移除这本本地书籍。");
    }
  };

  const handleRemoveCapturedBook = (book: Book) => {
    Alert.alert("移出书架", "确定将《" + book.title + "》从书架移除吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => void handleDeleteBook(book),
      },
    ]);
  };

  const handleRemoveShelfBook = (book: Book) => {
    if (book.format === "web") {
      handleRemoveOnlineBook(book);
      return;
    }
    if (sampleBooks.some((sample) => sample.id === book.id)) {
      Alert.alert("移出书架", "确定将《" + book.title + "》从书架移除吗？", [
        { text: "取消", style: "cancel" },
        {
          text: "移除",
          style: "destructive",
          onPress: () => {
            const next = [...new Set([...hiddenSampleIds, book.id])];
            setHiddenSampleIds(next);
            void saveHiddenSampleBooks(next);
            removeBookmarksForBook(book.id);
            removeAnnotationsForBook(book.id);
          },
        },
      ]);
      return;
    }
    handleRemoveCapturedBook(book);
  };

  const handleAddWebCapture = async (extraction: WebPageExtraction, silent = false) => {
    const created = createWebCaptureBook(extraction);
    const next = importedBooks.some((book) => book.id === created.id)
      ? importedBooks.map((book) =>
          book.id === created.id ? { ...created, progress: book.progress } : book,
        )
      : [...importedBooks, created];
    setImportedBooks(next);
    await saveImportedBooks(next);
    if (!silent) Alert.alert("已加入书架", "《" + created.title + "》已保存在本机。");
  };

  const handleReadWebCapture = (extraction: WebPageExtraction) => {
    const created = createWebCaptureBook(extraction);
    closeWebReader();
    requestAnimationFrame(() => presentBook(created));
  };

  const handleExportBackup = async () => exportAppBackup();

  const handleExportAnnotations = async () =>
    exportAnnotationsMarkdown(annotations, [...sampleBooks, ...importedBooks, ...onlineBooks]);

  const handleRestoreBackup = async () => {
    const result = await restoreAppBackup();
    if (result.canceled) return result;
    const savedReadingGoal = await loadReadingGoal();
    const [
      savedPreferences,
      localBooks,
      savedOnlineBooks,
      savedSources,
      readingProgress,
      hiddenSamples,
      savedBookAppearances,
      savedBookmarks,
      savedAnnotations,
      savedReadingStats,
    ] = await Promise.all([
      loadPreferences(),
      loadImportedBooks(),
      loadOnlineBooks(),
      loadBookSources(),
      loadProgress(),
      loadHiddenSampleBooks(),
      loadBookAppearances(),
      loadBookmarks(),
      loadAnnotations(),
      loadReadingStats(),
    ]);
    preferencesRef.current = savedPreferences;
    setPreferences(savedPreferences);
    setImportedBooks(localBooks);
    onlineBooksRef.current = savedOnlineBooks;
    setOnlineBooks(savedOnlineBooks);
    setSources(savedSources);
    setProgress(readingProgress);
    pendingProgress.current = readingProgress;
    setHiddenSampleIds(hiddenSamples);
    setBookAppearances(savedBookAppearances);
    setBookmarks(savedBookmarks);
    setAnnotations(savedAnnotations);
    readingStatsRef.current = savedReadingStats;
    setReadingStats(savedReadingStats);
    setReadingGoalMinutes(savedReadingGoal);
    void applyOrientation(savedPreferences.orientation);
    void applyBrightness(savedPreferences);
    return result;
  };

  const handleClearAppCache = async () => {
    const clearedSize = await clearCache();
    await clearOnlineChapterCache();
    const next = onlineBooksRef.current.map((book) => ({
      ...book,
      downloadedChapterCount: 0,
      fullyDownloaded: false,
    }));
    onlineBooksRef.current = next;
    setOnlineBooks(next);
    await saveOnlineBooks(next);
    setCurrentBook((book) =>
      book?.format === "web"
        ? { ...book, downloadedChapterCount: 0, fullyDownloaded: false }
        : book,
    );
    return clearedSize;
  };
  const handleClearHistory = async () => {
    await clearProgress();
    pendingProgress.current = {};
    progressDirty.current = false;
    progressUiDirty.current = false;
    setProgress({});
  };

  const handleVolumeKeys = () => {
    Alert.alert("当前设备暂不支持", "音量键翻页将在支持的设备上自动启用。");
  };
  const handleReadingGoalChange = (minutes: number) => {
    const normalized = Math.max(5, Math.min(180, Math.round(minutes / 5) * 5));
    setReadingGoalMinutes(normalized);
    void saveReadingGoal(normalized);
  };


  const handleLanTransferAccept = async (request: LanTransferRequest) => {
    const book = await importBookFromUri(
      `file://${request.path}`,
      request.name,
      request.size,
      importedBooks,
    );
    setImportedBooks((items) => [...items, book]);
  };

  const stableHandleLanTransferAccept = useEvent(handleLanTransferAccept);
  const stableHandleImport = useEvent(handleImport);
  const stableHandleOpenBook = useEvent(handleOpenBook);
  const stableHandleRemoveOnlineBook = useEvent(handleRemoveOnlineBook);
  const stableUpdatePreferences = useEvent(updatePreferences);
  const stableHandleClearAppCache = useEvent(handleClearAppCache);
  const stableHandleClearHistory = useEvent(handleClearHistory);
  const stableHandleDeleteBook = useEvent(handleDeleteBook);
  const stableHandleRemoveCapturedBook = useEvent(handleRemoveCapturedBook);
  const stableHandleRemoveShelfBook = useEvent(handleRemoveShelfBook);
  const stableHandleRenameShelfBook = useEvent(handleRenameShelfBook);
  const stableHandleSetBookCoverColors = useEvent(handleSetBookCoverColors);
  const stableHandlePickBookCoverImage = useEvent(handlePickBookCoverImage);
  const stableHandleAddWebCapture = useEvent(handleAddWebCapture);
  const stableHandleReadWebCapture = useEvent(handleReadWebCapture);
  const stableHandleVolumeKeys = useEvent(handleVolumeKeys);
  const stableHandleReadingGoalChange = useEvent(handleReadingGoalChange);
  const openSourceModal = useCallback(() => setSourceModalVisible(true), []);
  const openWebReader = useCallback(() => {
    setWebReaderInitialExtraction(undefined);
    setWebReaderInitialUrl(undefined);
    setWebReaderVisible(true);
  }, []);

  const openCapturedWebPage = useEvent((url?: string) => {
    const target = url || currentBook?.sourceUrl;
    if (!target) {
      Alert.alert("原网页不可用", "这本网页书没有保存原始网址。");
      return;
    }
    setWebReaderInitialExtraction(undefined);
    setWebReaderInitialUrl(target);
    setWebReaderVisible(true);
  });

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <ActivityIndicator color="#496052" size="large" />
          <Text style={styles.loadingText}>正在把故事放回原处…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar
          hidden={Boolean(currentBook && preferences.immersiveMode)}
          style={
            currentBook?.format === "pdf" ||
            (currentBook && preferences.theme === "night")
              ? "light"
              : "dark"
          }
        />

        <View
          accessibilityElementsHidden={Boolean(currentBook) || webReaderVisible}
          importantForAccessibility={currentBook || webReaderVisible ? "no-hide-descendants" : "auto"}
          pointerEvents={currentBook || webReaderVisible ? "none" : "auto"}
          style={styles.baseLayer}
        >
          <SafeAreaView
            accessibilityElementsHidden={Boolean(currentBook) || webReaderVisible}
            importantForAccessibility={currentBook || webReaderVisible ? "no-hide-descendants" : "auto"}
            edges={["top", "right", "bottom", "left"]}
            pointerEvents={currentBook || webReaderVisible ? "none" : "auto"}
            style={styles.app}
          >
            <View style={styles.content}>
              <Reanimated.View
                accessibilityElementsHidden={tab !== "shelf"}
                importantForAccessibility={tab === "shelf" ? "auto" : "no-hide-descendants"}
                renderToHardwareTextureAndroid
                pointerEvents={tab === "shelf" ? "auto" : "none"}
                style={[styles.tabPage, shelfPageStyle]}
              >
                <MemoHomeShelf
                  books={books}
                  importedCount={importedBooks.length}
                  onBrowseWeb={openWebReader}
                  onImport={stableHandleImport}
                  onOnline={openSourceModal}
                  onOpen={stableHandleOpenBook}
                  onRemove={stableHandleRemoveShelfBook}
                  onPickCoverImage={stableHandlePickBookCoverImage}
                  onRename={stableHandleRenameShelfBook}
                  onSetCoverColors={stableHandleSetBookCoverColors}
                />
              </Reanimated.View>

              <Reanimated.View
                accessibilityElementsHidden={tab !== "settings"}
                importantForAccessibility={tab === "settings" ? "auto" : "no-hide-descendants"}
                renderToHardwareTextureAndroid
                pointerEvents={tab === "settings" ? "auto" : "none"}
                style={[styles.tabPage, settingsPageStyle]}
              >
                <MemoSettingsScreen
                  books={books}
                  importedBooks={importedBooks}
                  onChange={stableUpdatePreferences}
                  onClearCache={stableHandleClearAppCache}
                  onExportAnnotations={handleExportAnnotations}
                  onExportBackup={handleExportBackup}
                  onRestoreBackup={handleRestoreBackup}
                  onClearHistory={stableHandleClearHistory}
                  onDeleteBook={stableHandleDeleteBook}
                  onManageSources={openSourceModal}
                  onOpenGuide={() => setOnboardingVisible(true)}
                  onOpenLanTransfer={() => setLanTransferVisible(true)}
                  onReadingGoalChange={stableHandleReadingGoalChange}
                  onVolumeKeysChange={stableHandleVolumeKeys}
                  preferences={preferences}
                  readingGoalMinutes={readingGoalMinutes}
                  readingStats={readingStats}
                  sourceCount={sources.length}
                />
              </Reanimated.View>
            </View>

            <View
              style={[
                styles.nav,
                {
                  left: (screenWidth - navWidth) / 2,
                  right: undefined,
                  width: navWidth,
                },
              ]}
            >
              <View pointerEvents="none" style={styles.navTint} />
              <View pointerEvents="none" style={styles.navShine} />
              <Reanimated.View
                pointerEvents="none"
                style={[
                  styles.navSelectionSlot,
                  { width: (navWidth - 16) / 2 },
                  navIndicatorStyle,
                ]}
              >
                <View style={styles.navIconActive} />
              </Reanimated.View>
              <NavItem active={tab === "shelf"} icon="library-outline" label="书架" onPress={() => changeTab("shelf")} />
              <NavItem active={tab === "settings"} icon="options-outline" label="设置" onPress={() => changeTab("settings")} />
            </View>

            {importing ? (
              <View style={styles.importingOverlay}>
                <View style={styles.importing}>
                  <View style={styles.importingHeader}>
                    <View style={styles.importingIcon}>
                      <Ionicons name="book-outline" color="#EDF3EE" size={21} />
                    </View>
                    <View style={styles.importingCopy}>
                      <Text style={styles.importingTitle}>正在导入书籍</Text>
                      <Text numberOfLines={1} style={styles.importingText}>
                        {importProgress?.message ?? "正在轻轻拆开这本书…"}
                      </Text>
                    </View>
                    <Text style={styles.importingPercent}>
                      {Math.round((importProgress?.progress ?? 0) * 100)}%
                    </Text>
                  </View>
                  <View style={styles.importingTrack}>
                    <Animated.View
                      style={[
                        styles.importingFill,
                        {
                          width: importProgressValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["0%", "100%"],
                          }),
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            ) : null}
          </SafeAreaView>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.baseDim,
              {
                opacity: readerProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 0.07],
                }),
              },
            ]}
          />
        </View>

        {currentBook ? (
          <Animated.View
            renderToHardwareTextureAndroid
            style={[
              styles.readerLayer,
              {
                transform: [{
                  translateX: readerProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [screenWidth, 0],
                  }),
                }],
              },
            ]}
          >
            {currentBook.format === "pdf" ? (
              <PdfReaderScreen book={currentBook} onBack={closeReader} preferences={preferences} />
            ) : (
              <ReaderScreen
                book={currentBook}
                annotations={annotations.filter((annotation) =>
                  annotation.bookId === currentBook.id &&
                  annotation.chapterIndex === currentBook.onlineChapterIndex
                )}
                bookmarks={bookmarks.filter((bookmark) =>
                  bookmark.bookId === currentBook.id &&
                  bookmark.chapterIndex === currentBook.onlineChapterIndex
                )}
                canNextChapter={Boolean(onlineSession && onlineSession.index < onlineSession.chapters.length - 1)}
                canPreviousChapter={Boolean(onlineSession && onlineSession.index > 0)}
                initialPage={
                  currentBook.format === "web" && onlineSession
                    ? (pendingProgress.current[currentBook.id]?.pageIndex ?? 0)
                    : (progress[currentBook.id]?.pageIndex ?? 0)
                }
                key={`${currentBook.id}-${currentBook.paginationVersion ?? 0}`}
                onBack={closeReader}
                onDeleteAnnotation={handleDeleteAnnotation}
                onSaveAnnotation={handleSaveAnnotation}
                onToggleBookmark={handleToggleBookmark}
                downloadProgress={
                  downloadState?.bookId === currentBook.id ? downloadState : undefined
                }
                onChapterBoundary={handleChapterBoundary}
                onChapterSelect={currentBook.format === "web" ? handleChapterSelect : undefined}
                onDownloadAll={currentBook.format === "web" ? () => void handleDownloadAll() : undefined}
                onOpenOriginal={currentBook.format === "webclip" ? openCapturedWebPage : undefined}
                onPageChange={handlePageChange}
                onPaginationMeasured={handlePaginationMeasured}
                preferences={preferences}
              />
            )}
          </Animated.View>
        ) : null}

        <BookSourceModal
          addedBookUrls={onlineBooks.map((book) => book.bookUrl).filter((url): url is string => Boolean(url))}
          onAdd={handleAddOnlineResult}
          onClose={() => setSourceModalVisible(false)}
          onRead={handleOnlineResult}
          onSourcesChange={setSources}
          sources={sources}
          visible={sourceModalVisible}
        />

        <BookSourceBrowserBridge />

        <WebReaderModal
          initialExtraction={webReaderInitialExtraction}
          initialUrl={webReaderInitialUrl}
          readerFont={preferences.fontFamily}
          webReaderFlow={preferences.webReaderFlow}
          onWebReaderFlowChange={(webReaderFlow) => stableUpdatePreferences({ webReaderFlow })}
          onAdd={stableHandleAddWebCapture}
          onClose={closeWebReader}
          onRead={stableHandleReadWebCapture}
          onReaderFontChange={(fontFamily) => stableUpdatePreferences({ fontFamily })}
          visible={webReaderVisible}
        />

        <LanTransferModal
          onAccept={stableHandleLanTransferAccept}
          onClose={() => setLanTransferVisible(false)}
          visible={lanTransferVisible}
        />
        <OnboardingModal onComplete={finishOnboarding} visible={onboardingVisible} />

        {onlineLoading && !sourceModalVisible ? (
          <View style={styles.onlineLoading}>
            <View style={styles.onlineLoadingCard}>
              <ActivityIndicator color="#4F6D5D" size="large" />
              <Text style={styles.onlineLoadingTitle}>正在载入当前章节</Text>
              <Text style={styles.onlineLoadingText}>读过的章节会自动保存</Text>
            </View>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function NavItem({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.navItem}>
      <View style={styles.navIcon}>
        <Ionicons color={active ? "#F3EEE3" : "#878D86"} name={icon} size={21} />
      </View>
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#1D211F", flex: 1, overflow: "hidden" },
  baseLayer: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  baseDim: { backgroundColor: "#111713", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  readerLayer: { backgroundColor: "#F4F1EA", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  app: { backgroundColor: "#F4F1EA", flex: 1 },
  appHidden: { display: "none" },
  content: { flex: 1, overflow: "hidden" },
  tabPage: { backgroundColor: "#F4F1EA", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  loading: { alignItems: "center", backgroundColor: "#F4F1EA", flex: 1, gap: 13, justifyContent: "center" },
  loadingText: { color: "#778078", fontSize: 13 },
  nav: {
    alignItems: "center",
    backgroundColor: "#F7F4EDF4",
    borderColor: "#DCD9D0",
    borderRadius: 24,
    borderWidth: 1,
    bottom: 18,
    elevation: 3,
    flexDirection: "row",
    height: 64,
    justifyContent: "space-around",
    left: 12,
    overflow: "hidden",
    paddingHorizontal: 8,
    position: "absolute",
    right: 12,
    shadowColor: "#243029",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 9,
  },
  navTint: { backgroundColor: "#FFFFFF24", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  navShine: { backgroundColor: "#FFFFFFA8", height: StyleSheet.hairlineWidth, left: 20, position: "absolute", right: 20, top: 1 },
  navItem: { alignItems: "center", flex: 1, gap: 3, height: "100%", justifyContent: "center", zIndex: 1 },
  navSelectionSlot: { alignItems: "center", height: 34, justifyContent: "center", left: 8, position: "absolute", top: 7 },
  navIcon: { alignItems: "center", borderRadius: 17, height: 34, justifyContent: "center", width: 48 },
  navIconActive: {
    backgroundColor: "#496052E8",
    borderColor: "#FFFFFF3D",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    width: 48,
  },
  navLabel: { color: "#92958F", fontSize: 10, fontWeight: "700" },
  navLabelActive: { color: "#496052" },
  importingOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(26, 34, 29, 0.2)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 30,
  },
  importing: {
    backgroundColor: "#26342D",
    borderColor: "#FFFFFF24",
    borderRadius: 22,
    borderWidth: 1,
    elevation: 18,
    maxWidth: 430,
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: "#18221C",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    width: "84%",
  },
  importingHeader: { alignItems: "center", flexDirection: "row" },
  importingIcon: { alignItems: "center", backgroundColor: "#496655", borderRadius: 15, height: 42, justifyContent: "center", width: 42 },
  importingCopy: { flex: 1, marginLeft: 12, minWidth: 0 },
  importingTitle: { color: "#F8F4EA", fontSize: 14, fontWeight: "800" },
  importingText: { color: "#AEBBB3", fontSize: 11, marginTop: 4 },
  importingPercent: { color: "#F2E6C9", fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "900", marginLeft: 12 },
  importingTrack: { backgroundColor: "#FFFFFF24", borderRadius: 4, height: 7, marginTop: 16, overflow: "hidden" },
  importingFill: { backgroundColor: "#A9C4B3", borderRadius: 4, height: "100%" },
  onlineLoading: {
    alignItems: "center",
    backgroundColor: "#17201977",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  onlineLoadingCard: {
    alignItems: "center",
    backgroundColor: "#FAF7F0",
    borderRadius: 22,
    elevation: 10,
    minWidth: 230,
    padding: 24,
  },
  onlineLoadingTitle: { color: "#3E4943", fontSize: 13, fontWeight: "900", marginTop: 13 },
  onlineLoadingText: { color: "#99928A", fontSize: 9.5, marginTop: 5 },
});
