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
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { I18nProvider, Text } from "./src/i18n";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Reanimated, {
  Easing as ReanimatedEasing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { AppDialogProvider, useAppAlert } from "./src/components/AppDialog";
import { OnboardingModal } from "./src/components/OnboardingModal";
import { sampleBooks } from "./src/data/books";
import { BookSourceBrowserBridge } from "./src/components/BookSourceBrowserBridge";
import { BookSourceModal } from "./src/screens/BookSourceModal";
import { HomeShelf } from "./src/screens/HomeShelf";
import { PdfReaderScreen } from "./src/screens/PdfReaderScreen";
import { ReaderScreen } from "./src/screens/ReaderScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
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
  loadHiddenSampleBooks,
  loadImportedBooks,
  loadOnboardingComplete,
  loadPreferences,
  loadProgress,
  saveHiddenSampleBooks,
  saveImportedBooks,
  saveOnboardingComplete,
  savePreferences,
  saveProgress,
} from "./src/services/runtime";
import { createWebCaptureBook, createWebCaptureExtraction } from "./src/services/webCapture";
import type {
  AppTab,
  Book,
  ImportedBookSource,
  OnlineBookResult,
  OnlineChapter,
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

export default function App() {
  return (
    <I18nProvider>
      <AppDialogProvider>
        <AppContent />
      </AppDialogProvider>
    </I18nProvider>
  );
}

function AppContent() {
  const Alert = useAppAlert();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<AppTab>("shelf");
  const [preferences, setPreferences] = useState<ReaderPreferences>(defaultPreferences);
  const [importedBooks, setImportedBooks] = useState<Book[]>([]);
  const [hiddenSampleIds, setHiddenSampleIds] = useState<string[]>([]);
  const [onlineBooks, setOnlineBooks] = useState<Book[]>([]);
  const onlineBooksRef = useRef<Book[]>([]);
  const [sources, setSources] = useState<ImportedBookSource[]>([]);
  const [sourceModalVisible, setSourceModalVisible] = useState(false);
  const [webReaderVisible, setWebReaderVisible] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [webReaderInitialExtraction, setWebReaderInitialExtraction] = useState<WebPageExtraction>();
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineSession, setOnlineSession] = useState<OnlineSession>();
  const [downloadState, setDownloadState] = useState<DownloadState>();
  const [progress, setProgress] = useState<Record<string, ReadingProgress>>({});
  const [currentBook, setCurrentBook] = useState<Book>();
  const [importing, setImporting] = useState(false);
  const readerProgress = useRef(new Animated.Value(0)).current;
  const preferencesRef = useRef<ReaderPreferences>(defaultPreferences);
  const preferencesSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingProgress = useRef<Record<string, ReadingProgress>>({});
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const progressDirty = useRef(false);
  const progressUiDirty = useRef(false);
  const { width: screenWidth } = useWindowDimensions();
  const navWidth = Math.min(screenWidth - 24, 560);
  const tabProgress = useSharedValue(0);

  const tabTrackStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: -screenWidth * tabProgress.value }] }),
    [screenWidth],
  );
  const navIndicatorStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: (navWidth / 2) * tabProgress.value }] }),
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

  const closeWebReader = () => {
    setWebReaderVisible(false);
    setWebReaderInitialExtraction(undefined);
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
      duration: 280,
      easing: Easing.inOut(Easing.cubic),
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
        if (progressUiDirty.current) {
          progressUiDirty.current = false;
          requestAnimationFrame(() => setProgress(next));
        }
      });
    });
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
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
  }, [currentBook, finishOnboarding, onboardingVisible, sourceModalVisible, tab, webReaderVisible]);

  useEffect(() => {
    Promise.all([
      loadPreferences(),
      loadImportedBooks(),
      loadOnlineBooks(),
      loadBookSources(),
      loadProgress(),
      loadHiddenSampleBooks(),
      loadOnboardingComplete(),
    ])
      .then(([savedPreferences, localBooks, savedOnlineBooks, savedSources, readingProgress, hiddenSamples, onboardingComplete]) => {
        preferencesRef.current = savedPreferences;
        setPreferences(savedPreferences);
        setImportedBooks(localBooks);
        onlineBooksRef.current = savedOnlineBooks;
        setOnlineBooks(savedOnlineBooks);
        setSources(savedSources);
        setProgress(readingProgress);
        setHiddenSampleIds(hiddenSamples);
        setOnboardingVisible(!onboardingComplete);
        pendingProgress.current = readingProgress;
        void applyOrientation(savedPreferences.orientation);
        void applyBrightness(savedPreferences);
      })
      .catch(() => {
        Alert.alert("初始化失败", "部分本地设置未能读取，已使用默认配置。");
      })
      .finally(() => setReady(true));
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
        return {
          ...book,
          progress:
            book.format === "web"
              ? book.progress
              : pageIndex === 0
                ? book.progress
                : ((pageIndex + 1) / pageCount) * 100,
        };
      }),
    [hiddenSampleIds, importedBooks, onlineBooks, progress],
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

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const book = await importDocument(importedBooks);
      if (book) {
        setImportedBooks((items) => [...items, book]);
        Alert.alert("导入成功", "《" + book.title + "》已加入书架。");
      }
    } catch (error) {
      Alert.alert("导入失败", error instanceof Error ? error.message : "无法读取这个文件。");
    } finally {
      setImporting(false);
    }
  };

  const presentBook = (book: Book) => {
    readerProgress.setValue(0);
    setCurrentBook(book);
    requestAnimationFrame(() => {
      Animated.spring(readerProgress, {
        toValue: 1,
        damping: 22,
        stiffness: 190,
        mass: 0.82,
        useNativeDriver: true,
      }).start();
    });
  };

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
        content = (await loadOnlineChapter(source, shelfBook.id, chapter)).content;
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
      setOnlineSession({
        sourceId: shelfBook.sourceId,
        chapters,
        index,
      });
      presentBook(opened);
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
        },
      },
    ]);
  };

  const handleOpenBook = (book: Book) => {
    if (book.format === "webclip") {
      const extraction = createWebCaptureExtraction(book);
      if (!extraction) {
        Alert.alert("内容不可用", "这本网页书缺少可恢复的正文。");
        return;
      }
      setWebReaderInitialExtraction(extraction);
      setWebReaderVisible(true);
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
        content = (await loadOnlineChapter(source, book.id, chapter)).content;
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
      setOnlineSession({ ...session, index: nextIndex });
      setCurrentBook(opened);
      await persistOnlineBook(opened);
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
    if (!currentBook || !preferences.autoSync) return;
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

  const handleDeleteBook = async (book: Book) => {
    try {
      const next = await deleteImportedBook(book, importedBooks);
      setImportedBooks(next);
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

  const stableHandleImport = useEvent(handleImport);
  const stableHandleOpenBook = useEvent(handleOpenBook);
  const stableHandleRemoveOnlineBook = useEvent(handleRemoveOnlineBook);
  const stableUpdatePreferences = useEvent(updatePreferences);
  const stableHandleClearAppCache = useEvent(handleClearAppCache);
  const stableHandleClearHistory = useEvent(handleClearHistory);
  const stableHandleDeleteBook = useEvent(handleDeleteBook);
  const stableHandleRemoveCapturedBook = useEvent(handleRemoveCapturedBook);
  const stableHandleRemoveShelfBook = useEvent(handleRemoveShelfBook);
  const stableHandleAddWebCapture = useEvent(handleAddWebCapture);
  const stableHandleReadWebCapture = useEvent(handleReadWebCapture);
  const stableHandleVolumeKeys = useEvent(handleVolumeKeys);
  const openSourceModal = useCallback(() => setSourceModalVisible(true), []);
  const openWebReader = useCallback(() => {
    setWebReaderInitialExtraction(undefined);
    setWebReaderVisible(true);
  }, []);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.loading}>
          <ActivityIndicator color="#496052" size="large" />
          <Text style={styles.loadingText}>正在整理书架…</Text>
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

        <View style={styles.baseLayer}>
          <SafeAreaView
            edges={["top", "right", "bottom", "left"]}
            pointerEvents={webReaderVisible ? "none" : "auto"}
            style={styles.app}
          >
            <View style={styles.content}>
              <Reanimated.View
                renderToHardwareTextureAndroid
                style={[styles.tabTrack, { width: screenWidth * 2 }, tabTrackStyle]}
              >
                <View
                  pointerEvents={tab === "shelf" ? "auto" : "none"}
                  style={[styles.tabPage, { width: screenWidth }]}
                >
                <MemoHomeShelf
                  books={books}
                  importedCount={importedBooks.length}
                  onBrowseWeb={openWebReader}
                  onImport={stableHandleImport}
                  onOnline={openSourceModal}
                  onOpen={stableHandleOpenBook}
                  onRemove={stableHandleRemoveShelfBook}
                />
                </View>

                <View
                  pointerEvents={tab === "settings" ? "auto" : "none"}
                  style={[styles.tabPage, { width: screenWidth }]}
                >
                <MemoSettingsScreen
                  importedBooks={importedBooks}
                  onChange={stableUpdatePreferences}
                  onClearCache={stableHandleClearAppCache}
                  onClearHistory={stableHandleClearHistory}
                  onDeleteBook={stableHandleDeleteBook}
                  onManageSources={openSourceModal}
                  onOpenGuide={() => setOnboardingVisible(true)}
                  onVolumeKeysChange={stableHandleVolumeKeys}
                  preferences={preferences}
                  sourceCount={sources.length}
                />
                </View>
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
                  { width: navWidth / 2 },
                  navIndicatorStyle,
                ]}
              >
                <View style={styles.navIconActive} />
              </Reanimated.View>
              <NavItem active={tab === "shelf"} icon="library-outline" label="书架" onPress={() => changeTab("shelf")} />
              <NavItem active={tab === "settings"} icon="options-outline" label="设置" onPress={() => changeTab("settings")} />
            </View>

            {importing ? (
              <View style={styles.importing}>
                <ActivityIndicator color="#F7F4ED" />
                <Text style={styles.importingText}>正在解析电子书…</Text>
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
                canNextChapter={Boolean(onlineSession && onlineSession.index < onlineSession.chapters.length - 1)}
                canPreviousChapter={Boolean(onlineSession && onlineSession.index > 0)}
                initialPage={
                  currentBook.format === "web" && onlineSession
                    ? (pendingProgress.current[currentBook.id]?.pageIndex ?? 0)
                    : (progress[currentBook.id]?.pageIndex ?? 0)
                }
                key={currentBook.id + "-" + String(currentBook.onlineChapterIndex ?? "local")}
                onBack={closeReader}
                downloadProgress={
                  downloadState?.bookId === currentBook.id ? downloadState : undefined
                }
                onChapterBoundary={handleChapterBoundary}
                onChapterSelect={currentBook.format === "web" ? handleChapterSelect : undefined}
                onDownloadAll={currentBook.format === "web" ? () => void handleDownloadAll() : undefined}
                onPageChange={handlePageChange}
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
          webReaderFlow={preferences.webReaderFlow}
          onWebReaderFlowChange={(webReaderFlow) => stableUpdatePreferences({ webReaderFlow })}
          onAdd={stableHandleAddWebCapture}
          onClose={closeWebReader}
          onRead={stableHandleReadWebCapture}
          visible={webReaderVisible}
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
  tabTrack: { backgroundColor: "#F4F1EA", bottom: 0, flexDirection: "row", left: 0, position: "absolute", top: 0 },
  tabPage: { backgroundColor: "#F4F1EA", height: "100%" },
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
  navSelectionSlot: { alignItems: "center", height: 34, justifyContent: "center", left: 0, position: "absolute", top: 7 },
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
  importing: {
    alignItems: "center",
    backgroundColor: "#26342D",
    borderRadius: 16,
    elevation: 18,
    flexDirection: "row",
    gap: 10,
    left: 38,
    paddingHorizontal: 18,
    paddingVertical: 15,
    position: "absolute",
    right: 38,
    top: "45%",
  },
  importingText: { color: "#F7F4ED", flex: 1, fontSize: 13, fontWeight: "600" },
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
