import { useRef } from "react";
import { Animated, Easing } from "react-native";
import {
  Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { memo,
  useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import { FlatList,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text, TextInput, useI18n } from "../i18n";
import type { DimensionValue } from "react-native";

import { IOSPopupModal } from "../components/IOSPopupModal";
import type { Book } from "../types";
import {
  defaultLibraryViewPreferences,
  loadLibraryViewPreferences,
  saveLibraryViewPreferences,
  type ShelfFilter,
  type ShelfSort,
} from "../services/libraryView";

type HomeShelfProps = {
  books: Book[];
  importedCount: number;
  onBrowseWeb: () => void;
  onImport: () => void;
  onOnline: () => void;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
  onRename: (book: Book, title: string) => Promise<void>;
  onPickCoverImage: (book: Book) => Promise<boolean>;
  onSetCoverColors: (book: Book, colors: readonly [string, string]) => Promise<void>;
};

type ShelfListItem =
  | { kind: "book"; book: Book; colorIndex: number }
  | { kind: "import" };

const coverColors = [
  ["#365447", "#182A22"],
  ["#926A4F", "#442D24"],
  ["#667789", "#29343E"],
  ["#7A7353", "#373421"],
] as const;

const colorChoices = [
  "#24382F", "#3F6653", "#789181", "#B4C7B8", "#E7EEE7",
  "#352B27", "#6A4438", "#A66E53", "#D8A978", "#F0D5AA",
  "#273746", "#506B82", "#819CB4", "#B9CDDC", "#E5EDF2",
  "#302E25", "#686143", "#999068", "#C8BE92", "#EEE5C7",
] as const;


const FILTER_OPTION_WIDTH = 62;

export function HomeShelf({
  books,
  importedCount,
  onBrowseWeb,
  onImport,
  onOnline,
  onOpen,
  onRemove,
  onRename,
  onPickCoverImage,
  onSetCoverColors,
}: HomeShelfProps) {
  const { resolvedLanguage } = useI18n();
  const { width } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState("");
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>(defaultLibraryViewPreferences.filter);
  const [shelfSort, setShelfSort] = useState<ShelfSort>(defaultLibraryViewPreferences.sort);
  const [sortVisible, setSortVisible] = useState(false);
  const [renameBook, setRenameBook] = useState<Book>();
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const filterProgress = useRef(new Animated.Value(0)).current;
  const [coverBook, setCoverBook] = useState<Book>();
  const [coverVisible, setCoverVisible] = useState(false);
  const [coverColorsValue, setCoverColorsValue] = useState<[string, string]>(["#365447", "#182A22"]);
  const [activeColor, setActiveColor] = useState<0 | 1>(0);
  const [savingCover, setSavingCover] = useState(false);


  useEffect(() => {
    let active = true;
    void loadLibraryViewPreferences().then((saved) => {
      if (!active) return;
      setShelfFilter(saved.filter);
      setShelfSort(saved.sort);
    });
    return () => {
      active = false;
    };
  }, []);


  useEffect(() => {
    const filterIndex = shelfFilter === "local" ? 1 : shelfFilter === "web" ? 2 : 0;
    Animated.timing(filterProgress, {
      toValue: filterIndex,
      duration: 210,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [filterProgress, shelfFilter]);

  const updateShelfFilter = useCallback((filter: ShelfFilter) => {

    setShelfFilter(filter);
    void saveLibraryViewPreferences({ filter, sort: shelfSort });
  }, [shelfSort]);

  const updateShelfSort = useCallback((sort: ShelfSort) => {
    setShelfSort(sort);
    setSortVisible(false);
    void saveLibraryViewPreferences({ filter: shelfFilter, sort });
  }, [shelfFilter]);

  const shelfFilterOptions = useMemo<Array<{ key: ShelfFilter; label: string }>>(
    () => [
      { key: "all", label: resolvedLanguage === "en" ? "All" : "全部" },
      { key: "local", label: resolvedLanguage === "en" ? "Local" : "本地" },
      { key: "web", label: resolvedLanguage === "en" ? "Web" : "网页" },
    ],
    [resolvedLanguage],
  );
  const shelfSortLabels = useMemo<Record<ShelfSort, string>>(
    () => ({
      recent: resolvedLanguage === "en" ? "Recently read" : "最近阅读",
      title: resolvedLanguage === "en" ? "Book title" : "书名排序",
      progress: resolvedLanguage === "en" ? "Reading progress" : "阅读进度",
    }),
    [resolvedLanguage],
  );

  const beginRename = useCallback((book: Book) => {
    setRenameBook(book);
    setRenameValue(book.title);
    setRenameVisible(true);
  }, []);
  const finishRename = useCallback(async () => {
    if (!renameBook || !renameValue.trim() || renaming) return;
    setRenaming(true);
    try {
      await onRename(renameBook, renameValue);
      setRenameVisible(false);
    } finally {
      setRenaming(false);
    }
  }, [onRename, renameBook, renameValue, renaming]);
  const beginCoverEdit = useCallback((book: Book) => {
    setCoverBook(book);
    setCoverColorsValue([
      normalizeHexColor(book.coverColors[0]) ?? "#365447",
      normalizeHexColor(book.coverColors[1]) ?? "#182A22",
    ]);
    setActiveColor(0);
    setCoverVisible(true);
  }, []);
  const chooseColor = useCallback((color: string) => {
    setCoverColorsValue((current) => {
      const next: [string, string] = [...current];
      next[activeColor] = color;
      return next;
    });
  }, [activeColor]);
  const finishCoverColors = useCallback(async () => {
    const first = normalizeHexColor(coverColorsValue[0]);
    const second = normalizeHexColor(coverColorsValue[1]);
    if (!coverBook || !first || !second || savingCover) return;
    setSavingCover(true);
    try {
      await onSetCoverColors(coverBook, [first, second]);
      setCoverVisible(false);
    } finally {
      setSavingCover(false);
    }
  }, [coverBook, coverColorsValue, onSetCoverColors, savingCover]);
  const chooseCoverImage = useCallback(async () => {
    if (!coverBook || savingCover) return;
    setSavingCover(true);
    try {
      if (await onPickCoverImage(coverBook)) setCoverVisible(false);
    } finally {
      setSavingCover(false);
    }
  }, [coverBook, onPickCoverImage, savingCover]);  const isTablet = width >= 700;
  const columns = width >= 1120 ? 3 : isTablet ? 2 : 1;
  const contentWidth = Math.min(width, 1180);
  const contentPadding = isTablet ? 28 : 18;
  const columnGap = 14;
  const cardWidth =
    (contentWidth - contentPadding * 2 - columnGap * (columns - 1)) / columns;

  const visibleBooks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const originalOrder = new Map(books.map((book, index) => [book.id, index]));
    return books
      .filter((book) => {
        if (shelfFilter === "local" && (book.format === "web" || book.format === "webclip")) {
          return false;
        }
        if (shelfFilter === "web" && book.format !== "web" && book.format !== "webclip") {
          return false;
        }
        if (!normalizedQuery) return true;
        return [book.title, book.author, book.currentChapter]
          .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        if (shelfSort === "title") {
          return left.title.localeCompare(right.title, resolvedLanguage === "en" ? "en" : "zh-CN");
        }
        if (shelfSort === "progress") {
          return right.progress - left.progress || left.title.localeCompare(right.title);
        }
        return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0)
          || (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
      });
  }, [books, resolvedLanguage, searchQuery, shelfFilter, shelfSort]);

  const items = useMemo<ShelfListItem[]>(
    () => [
      ...visibleBooks.map((book, colorIndex) => ({
        kind: "book" as const,
        book,
        colorIndex,
      })),
      ...(!searchQuery.trim() && shelfFilter === "all"
        ? [{ kind: "import" as const }]
        : []),
    ],
    [searchQuery, shelfFilter, visibleBooks],
  );

  const renderItem = useCallback(
    ({ item }: { item: ShelfListItem }) =>
      item.kind === "book" ? (
        <ShelfBookCard
          book={item.book}
          cardWidth={cardWidth}
          colorIndex={item.colorIndex}
          isTablet={isTablet}
          onOpen={onOpen}
          onRemove={onRemove}
          onRename={beginRename}
          onEditCover={beginCoverEdit}
        />
      ) : (
        <ImportCard cardWidth={cardWidth} onImport={onImport} />
      ),
    [beginCoverEdit, beginRename, cardWidth, isTablet, onImport, onOpen, onRemove],
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.contentFrame, { width: contentWidth }]}>
        <View style={[styles.header, isTablet && styles.headerTablet]}>
          <View>
            <Text style={styles.eyebrow}>A ROOM FOR STORIES</Text>
            <Text style={[styles.title, isTablet && styles.titleTablet]}>书架</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="网页寻书"
              onPress={onBrowseWeb}
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
            >
              <Ionicons name="compass-outline" color="#405E4F" size={20} />
            </Pressable>
            <Pressable
              accessibilityLabel="搜索在线书源"
              onPress={onOnline}
              style={({ pressed }) => [styles.roundButton, pressed && styles.buttonPressed]}
            >
              <Ionicons name="globe-outline" color="#405E4F" size={19} />
            </Pressable>
            <Pressable
              accessibilityLabel="导入电子书"
              onPress={onImport}
              style={({ pressed }) => [styles.importButton, pressed && styles.buttonPressed]}
            >
              <Ionicons name="add" color="#F7F1E6" size={20} />
              <Text style={styles.importText}>导入</Text>
            </Pressable>
          </View>
        </View>

        <LinearGradient
          colors={["#ECE8DE", "#E3E8E1"]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.summary, isTablet && styles.summaryTablet]}
        >
          <View pointerEvents="none" style={styles.summaryShine} />
          <View style={styles.statBlock}>
            <Text style={styles.summaryNumber}>{books.length}</Text>
            <Text style={styles.summaryLabel}>全部藏书</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.statBlock}>
            <Text style={styles.summaryNumber}>{importedCount}</Text>
            <Text style={styles.summaryLabel}>本地收藏</Text>
          </View>
          <View style={styles.summaryQuote}>
            <View style={styles.quoteIcon}>
              <Ionicons name="leaf-outline" color="#587062" size={17} />
            </View>
            <View style={styles.quoteCopy}>
              <Text style={styles.quoteText}>
                {isTablet ? "翻一页人间，藏一寸光阴" : "一页人间，一寸光阴"}
              </Text>
              {isTablet ? <Text style={styles.quoteSubtext}>让故事落座，让心绪归静</Text> : null}
            </View>
          </View>
        </LinearGradient>


        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>我的藏书</Text>
          <View style={styles.layoutBadge}>
            <Ionicons name="library-outline" color="#6D7E74" size={14} />
            <Text style={styles.layoutText}>{visibleBooks.length} {resolvedLanguage === "en" ? "books" : "本"}</Text>
          </View>
        </View>
        <View style={styles.shelfTools}>
          <View style={styles.shelfSearchBox}>
            <Ionicons name="search-outline" color="#617269" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchQuery}
              placeholder={resolvedLanguage === "en" ? "Search title, author, or chapter" : "搜索书名、作者或章节"}
              placeholderTextColor="#9A9D96"
              {...({ placeholder: resolvedLanguage === "en" ? "Search title, author, or chapter" : "\u641c\u7d22\u4e66\u540d\u3001\u4f5c\u8005\u6216\u7ae0\u8282" } as Record<string, unknown>)}
              returnKeyType="search"
              selectionColor="#466554"
              style={styles.shelfSearchInput}
              value={searchQuery}
            />
            {searchQuery ? (
              <Pressable
                accessibilityLabel={resolvedLanguage === "en" ? "Clear library search" : "清除书架搜索"}
                hitSlop={10}
                {...({ accessibilityLabel: resolvedLanguage === "en" ? "Clear library search" : "\u6e05\u9664\u4e66\u67b6\u641c\u7d22" } as Record<string, unknown>)}
                onPress={() => setSearchQuery("")}
              >
                <Ionicons name="close-circle" color="#8B938D" size={19} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.shelfToolRow}>
            <View style={styles.shelfFilterControl}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.shelfFilterIndicator,
                  {
                    transform: [{
                      translateX: filterProgress.interpolate({
                        inputRange: [0, 1, 2],
                        outputRange: [0, FILTER_OPTION_WIDTH, FILTER_OPTION_WIDTH * 2],
                      }),
                    }],
                  },
                ]}
              />
              {shelfFilterOptions.map((option) => {
                const active = option.key === shelfFilter;
                return (
                  <Pressable
                    accessibilityState={{ selected: active }}
                    key={option.key}
                    onPress={() => updateShelfFilter(option.key)}
                    style={({ pressed }) => [styles.shelfFilterOption, pressed && styles.toolPressed]}
                  >
                    <Text style={[styles.shelfFilterLabel, active && styles.shelfFilterLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              accessibilityLabel={resolvedLanguage === "en" ? "Choose library sort order" : "筛选与排列藏书"}
              onPress={() => setSortVisible(true)}
              {...({ accessibilityLabel: resolvedLanguage === "en" ? "Filter and arrange the shelf" : "\u7b5b\u9009\u4e0e\u6392\u5217\u85cf\u4e66" } as Record<string, unknown>)}
              style={({ pressed }) => [styles.shelfSortButton, pressed && styles.toolPressed]}
            >
              <Ionicons name="swap-vertical-outline" color="#4E685A" size={17} />
              <Text numberOfLines={1} style={styles.shelfSortText}>
                {shelfSortLabels[shelfSort]}
              </Text>
              <Ionicons name="chevron-down" color="#7C8981" size={14} />
            </Pressable>
          </View>
          <Pressable
            accessibilityLabel={resolvedLanguage === "en" ? "Filter and arrange the shelf" : "\u7b5b\u9009\u4e0e\u6392\u5217\u85cf\u4e66"}
            onPress={() => setSortVisible(true)}
            style={({ pressed }) => [styles.compactToolButton, pressed && styles.toolPressed]}
          >
            <Ionicons name="options-outline" color="#4E685A" size={19} />
            {shelfFilter !== "all" ? <View style={styles.activeFilterDot} /> : null}
          </Pressable>
        </View>
      </View>

      <FlatList
        columnWrapperStyle={columns > 1 ? styles.column : undefined}
        contentContainerStyle={[
          styles.list,
          {
            paddingHorizontal: contentPadding,
            width: contentWidth,
          },
        ]}
        data={items}
        initialNumToRender={columns * 4}
        key={"shelf-" + columns}
        ListEmptyComponent={(
          <View style={styles.shelfEmpty}>
            <View style={styles.shelfEmptyIcon}>
              <Ionicons name="library-outline" color="#6C8175" size={25} />
            </View>
            <Text style={styles.shelfEmptyTitle}>{resolvedLanguage === "en" ? "No story found here" : "\u8fd9\u91cc\u8fd8\u6ca1\u6709\u5bfb\u5230\u6545\u4e8b"}</Text>
            <Text style={styles.shelfEmptyText}>{resolvedLanguage === "en" ? "Try another title, or return to the whole library." : "\u6362\u4e00\u4e2a\u540d\u5b57\u8bd5\u8bd5\uff0c\u6216\u56de\u5230\u5168\u90e8\u85cf\u4e66\u3002"}</Text>
            <Pressable
              onPress={() => {
                setSearchQuery("");
                updateShelfFilter("all");
              }}
              style={styles.shelfEmptyAction}
            >
              <Text style={styles.shelfEmptyActionText}>{resolvedLanguage === "en" ? "Show all books" : "\u770b\u770b\u5168\u90e8\u85cf\u4e66"}</Text>
            </Pressable>
          </View>
        )}
        keyExtractor={(item) => item.kind === "book" ? item.book.id : "import-book"}
        maxToRenderPerBatch={columns * 4}
        numColumns={columns}
        removeClippedSubviews
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        style={[styles.listViewport, { width: contentWidth }]}
        updateCellsBatchingPeriod={32}
        windowSize={6}
      />

      <IOSPopupModal
        onRequestClose={() => setSortVisible(false)}
        visible={sortVisible}
      >
        <View style={styles.sortCard}>
          <View style={styles.sortHeader}>
            <View style={styles.sortIcon}>
              <Ionicons name="swap-vertical-outline" color="#486555" size={20} />
            </View>
            <View>
              <Text style={styles.sortTitle}>{resolvedLanguage === "en" ? "Arrange the shelf" : "\u4e3a\u85cf\u4e66\u6392\u4e00\u6392"}</Text>
              <Text style={styles.sortSubtitle}>{resolvedLanguage === "en" ? "Choose how stories meet you." : "\u9009\u62e9\u6545\u4e8b\u4e0e\u4f60\u76f8\u9047\u7684\u6b21\u5e8f\u3002"}</Text>
            </View>
          </View>
          <Text style={styles.sortGroupLabel}>
            {resolvedLanguage === "en" ? "Show books from" : "筛选藏书"}
          </Text>
          <View style={styles.sortFilterRow}>
            {shelfFilterOptions.map((option) => {
              const active = option.key === shelfFilter;
              return (
                <Pressable
                  accessibilityState={{ selected: active }}
                  key={option.key}
                  onPress={() => updateShelfFilter(option.key)}
                  style={[styles.sortFilterOption, active && styles.sortFilterOptionActive]}
                >
                  <Text style={[styles.sortFilterText, active && styles.sortFilterTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.sortGroupLabel}>
            {resolvedLanguage === "en" ? "Arrange by" : "排列次序"}
          </Text>
          {(["recent", "title", "progress"] as ShelfSort[]).map((sort) => {
            const active = sort === shelfSort;
            return (
              <Pressable
                key={sort}
                onPress={() => updateShelfSort(sort)}
                style={[styles.sortOption, active && styles.sortOptionActive]}
              >
                <Ionicons
                  name={sort === "recent" ? "time-outline" : sort === "title" ? "text-outline" : "analytics-outline"}
                  color={active ? "#3F6552" : "#748078"}
                  size={19}
                />
                <Text style={[styles.sortOptionText, active && styles.sortOptionTextActive]}>
                  {shelfSortLabels[sort]}
                </Text>
                <Ionicons name={active ? "checkmark-circle" : "ellipse-outline"} color={active ? "#4A705D" : "#B4B9B4"} size={19} />
              </Pressable>
            );
          })}
        </View>
      </IOSPopupModal>

      <IOSPopupModal
        onDismiss={() => setRenameBook(undefined)}
        onRequestClose={() => setRenameVisible(false)}
        visible={renameVisible}
      >
          <View style={styles.renameCard}>
            <View style={styles.renameIcon}><Ionicons name="create-outline" color="#486555" size={21} /></View>
            <Text style={styles.renameTitle}>修改藏书名称</Text>
            <Text style={styles.renameHint}>为这本书取一个更容易辨认的名字</Text>
            <TextInput
              autoFocus
              maxLength={120}
              onChangeText={setRenameValue}
              onSubmitEditing={() => void finishRename()}
              placeholder="输入新的名称"
              returnKeyType="done"
              selectTextOnFocus
              style={styles.renameInput}
              value={renameValue}
            />
            <View style={styles.renameActions}>
              <Pressable onPress={() => setRenameVisible(false)} style={styles.renameCancel}><Text style={styles.renameCancelText}>取消</Text></Pressable>
              <Pressable disabled={!renameValue.trim() || renaming} onPress={() => void finishRename()} style={[styles.renameSave, (!renameValue.trim() || renaming) && styles.renameDisabled]}>
                <Text style={styles.renameSaveText}>{renaming ? "正在保存…" : "保存"}</Text>
              </Pressable>
            </View>
          </View>
      </IOSPopupModal>

      <IOSPopupModal
        onDismiss={() => setCoverBook(undefined)}
        onRequestClose={() => setCoverVisible(false)}
        visible={coverVisible}
      >
        <ScrollView contentContainerStyle={styles.coverEditorContent} showsVerticalScrollIndicator={false} style={styles.coverEditorCard}>
          <View style={styles.coverEditorHeader}>
            <View style={styles.renameIcon}><Ionicons name="color-palette-outline" color="#486555" size={21} /></View>
            <View style={styles.coverEditorHeading}>
              <Text style={styles.renameTitle}>装点书封</Text>
              <Text style={styles.renameHint}>为故事挑两种颜色，或留下一幅画</Text>
            </View>
          </View>

          {coverBook ? (
            <View style={styles.coverEditorPreviewRow}>
              <View style={styles.coverEditorPreview}>
                <LinearGradient colors={coverColorsValue} style={styles.coverEditorPreviewFace}>
                  <View style={styles.coverSpine} />
                  <Text numberOfLines={3} style={styles.coverEditorPreviewTitle}>{coverBook.title}</Text>
                  <Text numberOfLines={1} style={styles.coverEditorPreviewAuthor}>{coverBook.author}</Text>
                </LinearGradient>
              </View>
              <View style={styles.coverEditorIntro}>
                <Text style={styles.coverEditorLabel}>渐变颜色</Text>
                <Text style={styles.coverEditorCopy}>点击“起色”或“落色”，再从色板中选取。也可以直接输入 HEX 色值。</Text>
                <Pressable onPress={() => void chooseCoverImage()} style={styles.imageCoverButton}>
                  <Ionicons name="image-outline" color="#F8F4EA" size={18} />
                  <Text style={styles.imageCoverButtonText}>{savingCover ? "正在打开…" : "选择图片"}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.colorSlotRow}>
            {coverColorsValue.map((color, index) => (
              <Pressable
                key={index}
                onPress={() => setActiveColor(index as 0 | 1)}
                style={[styles.colorSlot, activeColor === index && styles.colorSlotActive]}
              >
                <View style={[styles.colorSlotDot, { backgroundColor: normalizeHexColor(color) ?? "#FFFFFF" }]} />
                <Text style={styles.colorSlotLabel}>{index === 0 ? "起色" : "落色"}</Text>
                <TextInput
                  autoCapitalize="characters"
                  maxLength={7}
                  onChangeText={(value) => setCoverColorsValue((current) => {
                    const next: [string, string] = [...current];
                    next[index] = value;
                    return next;
                  })}
                  onFocus={() => setActiveColor(index as 0 | 1)}
                  style={styles.colorHexInput}
                  value={color}
                />
              </Pressable>
            ))}
          </View>

          <View style={styles.colorGrid}>
            {colorChoices.map((color) => (
              <Pressable
                accessibilityLabel={`选择颜色 ${color}`}
                key={color}
                onPress={() => chooseColor(color)}
                style={[styles.colorChoice, { backgroundColor: color }]}
              />
            ))}
          </View>

          <View style={styles.renameActions}>
            <Pressable onPress={() => setCoverVisible(false)} style={styles.renameCancel}><Text style={styles.renameCancelText}>取消</Text></Pressable>
            <Pressable
              disabled={!normalizeHexColor(coverColorsValue[0]) || !normalizeHexColor(coverColorsValue[1]) || savingCover}
              onPress={() => void finishCoverColors()}
              style={[styles.renameSave, (!normalizeHexColor(coverColorsValue[0]) || !normalizeHexColor(coverColorsValue[1]) || savingCover) && styles.renameDisabled]}
            >

              <Text style={styles.renameSaveText}>{savingCover ? "正在保存…" : "使用这组颜色"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </IOSPopupModal>
    </View>
  );
}

const ShelfBookCard = memo(function ShelfBookCard({
  book,
  cardWidth,
  colorIndex,
  isTablet,
  onOpen,
  onRemove,
  onRename,
  onEditCover,
}: {
  book: Book;
  cardWidth: number;
  colorIndex: number;
  isTablet: boolean;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
  onRename: (book: Book) => void;
  onEditCover: (book: Book) => void;
}) {
  const openBook = useCallback(() => onOpen(book), [book, onOpen]);
  const progress = Math.max(0, Math.min(book.progress, 100));
  const formatLabel = getFormatLabel(book);

  return (
    <View style={[styles.cardWrap, { width: cardWidth }]}>
      <Pressable
        accessibilityLabel={
          book.title + "，" + book.author + "，阅读进度 " + Math.round(progress) + "%"
        }
        onLongPress={() => book.format === "sample" ? onEditCover(book) : onRename(book)}
        onPress={openBook}
        style={({ pressed }) => [
          styles.card,
          isTablet && styles.cardTablet,
          pressed && styles.cardPressed,
        ]}
      >
        <View pointerEvents="none" style={styles.cardTopLine} />
        <View style={[styles.coverFrame, isTablet && styles.coverFrameTablet]}>
          <ShelfCoverFace
            book={book}
            colors={book.coverColors ?? coverColors[colorIndex % coverColors.length]}
            formatLabel={formatLabel}
          />
        </View>

        <View style={styles.bookInfo}>
          <View>
            <Text numberOfLines={1} style={styles.bookTitle}>{book.title}</Text>
            <Text numberOfLines={1} style={styles.author}>{book.author}</Text>
          </View>

          <View style={styles.chapterRow}>
            <Ionicons name="bookmark-outline" color="#718178" size={14} />
            <Text numberOfLines={1} style={styles.chapterText}>
              {book.currentChapter || "尚未开始"}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <Text numberOfLines={1} style={styles.lastRead}>{book.lastRead || "等待翻开"}</Text>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: (progress + "%") as DimensionValue },
              ]}
            />
          </View>
        </View>

        <View style={styles.cardActions}>
          <Pressable
            accessibilityLabel={"修改封面 " + book.title}
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              onEditCover(book);
            }}
            style={styles.cardActionButton}
          >
            <Ionicons name="color-palette-outline" color="#65786D" size={15} />
          </Pressable>
          {book.format !== "sample" ? (
            <Pressable
              accessibilityLabel={"重命名" + book.title}
              hitSlop={6}
              onPress={(event) => {
                event.stopPropagation();
                onRename(book);
              }}
              style={styles.cardActionButton}
            >
              <Ionicons name="create-outline" color="#65786D" size={15} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={"移除" + book.title}
            hitSlop={6}
            onPress={(event) => {
              event.stopPropagation();
              onRemove(book);
            }}
            style={styles.cardActionButton}
          >
            <Ionicons name="trash-outline" color="#65786D" size={15} />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
});

const ShelfCoverFace = memo(function ShelfCoverFace({
  book,
  colors,
  formatLabel,
}: {
  book: Book;
  colors: readonly [string, string, ...string[]];
  formatLabel: string;
}) {
  const imageUri = book.coverMode === "image"
    ? book.coverImageUri
    : book.coverMode === "colors"
      ? undefined
      : book.coverUrl;
  const content = (
    <>
      <View style={styles.coverSpine} />
      <View style={styles.coverInnerLine} />
      <Text style={styles.coverMonogram}>墨</Text>
      <View style={styles.coverRule} />
      <Text numberOfLines={3} style={styles.coverTitle}>{book.title}</Text>
      <Text numberOfLines={1} style={styles.coverAuthor}>{book.author}</Text>
      <View style={styles.formatPill}>
        <Text style={styles.formatText}>{formatLabel}</Text>
      </View>
    </>
  );

  if (imageUri) {
    return (
      <ImageBackground
        imageStyle={styles.coverImage}
        resizeMode="cover"
        source={{ uri: imageUri }}
        style={styles.cover}
      >
        <View style={styles.coverImageShade} />
        {content}
      </ImageBackground>
    );
  }

  return (
    <LinearGradient
      colors={colors}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.cover}
    >
      {content}
    </LinearGradient>
  );
});
const ImportCard = memo(function ImportCard({
  cardWidth,
  onImport,
}: {
  cardWidth: number;
  onImport: () => void;
}) {
  return (
    <View style={[styles.cardWrap, { width: cardWidth }]}>
      <Pressable
        accessibilityLabel="导入 EPUB 或 PDF"
        onPress={onImport}
        style={({ pressed }) => [styles.importCard, pressed && styles.cardPressed]}
      >
        <View style={styles.importIllustration}>
          <View style={styles.importBookBack} />
          <View style={styles.importBookFront}>
            <Ionicons name="add" color="#4C6959" size={22} />
          </View>
        </View>
        <View style={styles.importCopy}>
          <Text style={styles.emptyTitle}>为书架添一册新故事</Text>
          <Text style={styles.emptyText}>从 EPUB 或 PDF，拾一段安静时光</Text>
        </View>
        <View style={styles.importArrow}>
          <Ionicons name="cloud-upload-outline" color="#F6F0E5" size={20} />
        </View>
      </Pressable>
    </View>
  );
});

function normalizeHexColor(value: string) {
  const normalized = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9A-F]{3}$/.test(normalized)) {
    return "#" + normalized.slice(1).split("").map((item) => item + item).join("");
  }
  return undefined;
}
function getFormatLabel(book: Book) {
  if (book.format === "sample") return "精选";
  if (book.format === "web") return book.fullyDownloaded ? "离线" : "在线";
  if (book.format === "webclip") return "网页";
  return book.format.toUpperCase();
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F2EFE8", flex: 1 },
  contentFrame: { alignSelf: "center" },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerTablet: { paddingHorizontal: 28, paddingTop: 14 },
  eyebrow: { color: "#85887F", fontSize: 8, fontWeight: "900", letterSpacing: 2.1 },
  title: { color: "#242A25", fontFamily: "serif", fontSize: 29, fontWeight: "800", lineHeight: 37 },
  titleTablet: { fontSize: 38, lineHeight: 48 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  roundButton: {
    alignItems: "center",
    backgroundColor: "#E7EBE6",
    borderColor: "#C9D2CB",
    borderRadius: 17,
    borderWidth: 1,
    elevation: 1,
    height: 40,
    justifyContent: "center",
    shadowColor: "#26372E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    width: 40,
  },
  importButton: {
    alignItems: "center",
    backgroundColor: "#365445",
    borderColor: "#2A4437",
    borderRadius: 18,
    borderWidth: 1,
    elevation: 2,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#1D3026",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
  },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  importText: { color: "#F7F1E6", fontSize: 13, fontWeight: "800" },
  summary: {
    alignItems: "center",
    borderColor: "#D2D2C8",
    borderRadius: 22,
    borderWidth: 1,
    elevation: 2,
    flexDirection: "row",
    marginHorizontal: 18,
    minHeight: 72,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#314239",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  summaryTablet: { marginHorizontal: 28, minHeight: 104, paddingHorizontal: 22 },
  summaryShine: {
    backgroundColor: "#FFFFFF8F",
    height: 1,
    left: 20,
    position: "absolute",
    right: 20,
    top: 1,
  },
  statBlock: { minWidth: 62 },
  todayCard: {
    alignItems: "center", backgroundColor: "#FAF8F2", borderColor: "#DDD9D0",
    borderRadius: 17, borderWidth: 1, elevation: 1, flexDirection: "row",
    marginHorizontal: 20, marginTop: 10, minHeight: 58, paddingHorizontal: 13,
    shadowColor: "#27382F", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 6,
  },
  todayCardTablet: { marginHorizontal: 28, minHeight: 62, paddingHorizontal: 16 },
  todayCardPressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  todayIcon: { alignItems: "center", backgroundColor: "#E8EFEB", borderRadius: 12, height: 36, justifyContent: "center", width: 36 },
  todayCopy: { flex: 1, marginHorizontal: 11 },
  todayHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  todayTitle: { color: "#3C443F", fontSize: 11.5, fontWeight: "800" },
  todayValue: { color: "#6F7D75", fontSize: 9.5, fontWeight: "700" },
  todayTrack: { backgroundColor: "#E2E6E1", borderRadius: 4, height: 5, marginTop: 7, overflow: "hidden" },
  todayFill: { backgroundColor: "#799487", borderRadius: 4, height: 5 },
  todayFillComplete: { backgroundColor: "#416451" },
  summaryNumber: { color: "#2F4037", fontSize: 23, fontWeight: "900" },
  summaryLabel: { color: "#81877F", fontSize: 10, fontWeight: "600", marginTop: 1 },
  summaryDivider: { backgroundColor: "#C4C9C1", height: 32, marginHorizontal: 13, width: 1.5 },
  summaryQuote: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10, minWidth: 0 },
  quoteIcon: {
    alignItems: "center",
    backgroundColor: "#F7F5EF99",
    borderColor: "#D4DAD3",
    borderRadius: 14,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  quoteCopy: { flex: 1 },
  quoteText: { color: "#57675E", fontFamily: "serif", fontSize: 12, fontWeight: "700", lineHeight: 18 },
  quoteSubtext: { color: "#8A928B", fontSize: 9.5, marginTop: 3 },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 13,
  },
  sectionTitle: { color: "#303832", fontSize: 17, fontWeight: "900" },
  sectionSubtitle: { color: "#96968F", fontSize: 9.5, marginTop: 3 },
  layoutBadge: {
    alignItems: "center",
    backgroundColor: "#E8EAE5",
    borderColor: "#D3D6CF",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  layoutText: { color: "#727B75", fontSize: 9.5, fontWeight: "700" },
  shelfTools: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
    paddingBottom: 10,
    paddingHorizontal: 18,
  },
  shelfToolsTablet: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 28,
  },
  shelfSearchBox: {
    alignItems: "center",
    backgroundColor: "#FBF9F4",
    borderColor: "#D4D5CE",
    borderRadius: 15,
    borderWidth: 1,
    elevation: 1,
    flex: 1,
    flexDirection: "row",
    gap: 9,
    minHeight: 40,
    paddingHorizontal: 13,
    shadowColor: "#26372E",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  shelfSearchInput: {
    color: "#303A34",
    flex: 1,
    fontSize: 13,
    minHeight: 38,
    paddingVertical: 0,
  },
  shelfToolRow: {
    display: "none",
  },
  shelfFilterControl: {
    backgroundColor: "#E2E5DF",
    borderColor: "#D1D5CE",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    height: 42,
    overflow: "hidden",
    padding: 3,
    width: FILTER_OPTION_WIDTH * 3 + 6,
  },
  shelfFilterIndicator: {
    backgroundColor: "#FDFBF6",
    borderColor: "#C8D0C9",
    borderRadius: 13,
    borderWidth: 1,
    elevation: 2,
    height: 34,
    left: 3,
    position: "absolute",
    shadowColor: "#25362D",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    top: 3,
    width: FILTER_OPTION_WIDTH,
  },
  shelfFilterOption: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: FILTER_OPTION_WIDTH,
  },
  shelfFilterLabel: {
    color: "#7B847E",
    fontSize: 10.5,
    fontWeight: "700",
  },
  shelfFilterLabelActive: { color: "#3F6250", fontWeight: "900" },
  shelfSortButton: {
    alignItems: "center",
    backgroundColor: "#E8EBE6",
    borderColor: "#D0D5CF",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    height: 42,
    justifyContent: "center",
    minWidth: 142,
    paddingHorizontal: 10,
  },
  shelfSortText: {
    color: "#52665B",
    flexShrink: 1,
    fontSize: 10.5,
    fontWeight: "800",
  },
  toolPressed: { opacity: 0.78, transform: [{ scale: 0.97 }] },
  compactToolButton: {
    alignItems: "center",
    backgroundColor: "#E8EBE6",
    borderColor: "#D0D5CF",
    borderRadius: 15,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    position: "relative",
    width: 44,
  },
  activeFilterDot: {
    backgroundColor: "#4D715E",
    borderRadius: 3,
    height: 6,
    position: "absolute",
    right: 7,
    top: 6,
    width: 6,
  },
  shelfEmpty: {
    alignItems: "center",
    minHeight: 250,
    paddingHorizontal: 24,
    paddingTop: 42,
  },
  shelfEmptyIcon: {
    alignItems: "center",
    backgroundColor: "#E4E9E3",
    borderRadius: 22,
    height: 50,
    justifyContent: "center",
    width: 50,
  },
  shelfEmptyTitle: {
    color: "#39483F",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 14,
  },
  shelfEmptyText: {
    color: "#8A918C",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
    textAlign: "center",
  },
  shelfEmptyAction: {
    backgroundColor: "#416451",
    borderRadius: 15,
    marginTop: 17,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  shelfEmptyActionText: { color: "#F8F4EA", fontSize: 11, fontWeight: "800" },
  sortCard: {
    backgroundColor: "#FBF9F4",
    borderRadius: 28,
    elevation: 24,
    maxWidth: 480,
    padding: 20,
    shadowColor: "#142018",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    width: "100%",
  },
  sortHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  sortIcon: {
    alignItems: "center",
    backgroundColor: "#E5ECE6",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sortTitle: { color: "#303A34", fontSize: 19, fontWeight: "900" },
  sortSubtitle: { color: "#92958F", fontSize: 10.5, marginTop: 3 },
  sortGroupLabel: {
    color: "#777F79",
    fontSize: 10.5,
    fontWeight: "800",
    marginBottom: 7,
    marginTop: 5,
  },
  sortFilterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  sortFilterOption: {
    alignItems: "center",
    backgroundColor: "#ECEDE8",
    borderColor: "#DCDED8",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  sortFilterOptionActive: {
    backgroundColor: "#E0EAE3",
    borderColor: "#88A090",
  },
  sortFilterText: { color: "#777F79", fontSize: 11, fontWeight: "700" },
  sortFilterTextActive: { color: "#3F6250", fontWeight: "900" },
  sortOption: {
    alignItems: "center",
    borderColor: "#E2E2DB",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    marginTop: 8,
    minHeight: 54,
    paddingHorizontal: 15,
  },
  sortOptionActive: { backgroundColor: "#E9EFEA", borderColor: "#AFC0B5" },
  sortOptionText: { color: "#66726B", flex: 1, fontSize: 13, fontWeight: "700" },
  sortOptionTextActive: { color: "#365746", fontWeight: "900" },
  listViewport: { alignSelf: "center", flex: 1 },
  list: { alignSelf: "center", paddingBottom: 126 },
  column: { gap: 14 },
  cardWrap: { marginBottom: 13 },
  card: {
    alignItems: "stretch",
    backgroundColor: "#FBF9F4",
    borderColor: "#D5D2C9",
    borderRadius: 20,
    borderWidth: 1,
    elevation: 3,
    flexDirection: "row",
    minHeight: 146,
    overflow: "hidden",
    padding: 12,
    shadowColor: "#28362F",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  cardTablet: { minHeight: 154, padding: 13 },
  cardTopLine: {
    backgroundColor: "#FFFFFFD1",
    height: 1,
    left: 22,
    position: "absolute",
    right: 22,
    top: 1,
  },
  cardPressed: { opacity: 0.88, transform: [{ scale: 0.988 }] },
  coverFrame: {
    backgroundColor: "#26352D",
    borderColor: "#C9C5BA",
    borderRadius: 10,
    borderWidth: 1,
    elevation: 3,
    height: 120,
    shadowColor: "#17231D",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.17,
    shadowRadius: 5,
    width: 84,
  },
  coverFrameTablet: { height: 128, width: 90 },
  cover: {
    borderRadius: 9,
    flex: 1,
    overflow: "hidden",
    paddingBottom: 11,
    paddingHorizontal: 11,
    paddingTop: 12,
  },
  coverSpine: { backgroundColor: "#0D171247", bottom: 0, left: 0, position: "absolute", top: 0, width: 7 },
  coverInnerLine: {
    borderColor: "#FFFFFF22",
    borderRadius: 7,
    borderWidth: 1,
    bottom: 5,
    left: 8,
    position: "absolute",
    right: 5,
    top: 5,
  },
  coverMonogram: { color: "#F2EAD38A", fontFamily: "serif", fontSize: 11, fontWeight: "900", textAlign: "right" },
  coverRule: { backgroundColor: "#F5EDD16B", height: 2, marginTop: 8, width: 22 },
  coverTitle: {
    color: "#F8F0E2",
    flex: 1,
    fontFamily: "serif",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: 8,
    textAlignVertical: "center",
  },
  coverAuthor: { color: "#FFFFFFA6", fontSize: 8.5, marginBottom: 1 },
  formatPill: {
    backgroundColor: "#0E18124D",
    borderColor: "#FFFFFF24",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 3,
    position: "absolute",
    right: 7,
    top: 8,
  },
  formatText: { color: "#F7F0E1C7", fontSize: 6.5, fontWeight: "900", letterSpacing: 0.6 },
  bookInfo: { flex: 1, justifyContent: "space-between", minWidth: 0, paddingLeft: 14, paddingRight: 48, paddingVertical: 3 },
  bookTitle: { color: "#29312C", fontSize: 16, fontWeight: "900" },
  author: { color: "#838881", fontSize: 11, marginTop: 4 },
  chapterRow: {
    alignItems: "center",
    backgroundColor: "#F0F1EC",
    borderColor: "#E0E1DA",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  chapterText: { color: "#657069", flex: 1, fontSize: 10.5, fontWeight: "600" },
  metaRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  lastRead: { color: "#979890", flex: 1, fontSize: 9.5 },
  progressText: { color: "#526A5D", fontSize: 10, fontWeight: "900", marginLeft: 8 },
  progressTrack: {
    backgroundColor: "#D9DDD6",
    borderColor: "#CED3CC",
    borderRadius: 3,
    borderWidth: 1,
    height: 6,
    marginTop: 5,
    overflow: "hidden",
  },
  progressFill: { backgroundColor: "#607D6D", borderRadius: 2, height: "100%" },
  cardActions: { gap: 6, position: "absolute", right: 10, top: 10 },
  cardActionButton: {
    alignItems: "center",
    backgroundColor: "#E8EDE8",
    borderColor: "#D4DDD6",
    borderRadius: 12,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 28,
  },
  coverImage: { borderRadius: 9 },
  coverImageShade: { backgroundColor: "rgba(17, 24, 20, 0.38)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  coverEditorCard: {
    backgroundColor: "#FAF8F2",
    borderColor: "#FFFFFFB8",
    borderRadius: 28,
    borderWidth: 1,
    elevation: 16,
    maxWidth: 460,
    padding: 22,
    width: "100%",
  },
  coverEditorContent: { padding: 22 },
  coverEditorHeader: { alignItems: "center", flexDirection: "row", gap: 13 },
  coverEditorHeading: { flex: 1 },
  coverEditorPreviewRow: { flexDirection: "row", gap: 18, marginTop: 18 },
  coverEditorPreview: {
    backgroundColor: "#D8D2C7",
    borderColor: "#C8C2B7",
    borderRadius: 13,
    borderWidth: 1,
    elevation: 4,
    height: 158,
    overflow: "hidden",
    width: 111,
  },
  coverEditorPreviewFace: { flex: 1, justifyContent: "flex-end", padding: 13 },
  coverEditorPreviewTitle: { color: "#F8F0E2", flex: 1, fontFamily: "serif", fontSize: 16, fontWeight: "800", lineHeight: 22, textAlignVertical: "center" },
  coverEditorPreviewAuthor: { color: "#FFFFFFB5", fontSize: 9 },
  coverEditorIntro: { flex: 1, justifyContent: "center" },
  coverEditorLabel: { color: "#37483F", fontSize: 14, fontWeight: "800" },
  coverEditorCopy: { color: "#858981", fontSize: 11, lineHeight: 17, marginTop: 7 },
  imageCoverButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#406653", borderRadius: 14, flexDirection: "row", gap: 7, marginTop: 14, minHeight: 42, paddingHorizontal: 15 },
  imageCoverButtonText: { color: "#F8F4EA", fontSize: 12, fontWeight: "800" },
  colorSlotRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  colorSlot: { alignItems: "center", backgroundColor: "#EFECE5", borderColor: "#D9D5CC", borderRadius: 15, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 52, paddingHorizontal: 10 },
  colorSlotActive: { backgroundColor: "#E8EFEA", borderColor: "#648272", borderWidth: 1.5 },
  colorSlotDot: { borderColor: "#FFFFFF", borderRadius: 10, borderWidth: 2, height: 20, width: 20 },
  colorSlotLabel: { color: "#68716B", fontSize: 10, fontWeight: "700", marginLeft: 7 },
  colorHexInput: { color: "#33413A", flex: 1, fontSize: 11, fontWeight: "800", marginLeft: 5, paddingHorizontal: 0, textAlign: "right" },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 15 },
  colorChoice: { borderColor: "#FFFFFF", borderRadius: 13, borderWidth: 2, elevation: 1, height: 30, width: 30 },  renameBackdrop: { alignItems: "center", backgroundColor: "rgba(25,32,28,0.48)", flex: 1, justifyContent: "center", padding: 26 },
  renameCard: { backgroundColor: "#FAF8F2", borderColor: "#FFFFFFB8", borderRadius: 26, borderWidth: 1, elevation: 16, maxWidth: 420, padding: 22, width: "100%" },
  renameIcon: { alignItems: "center", backgroundColor: "#E6EEE8", borderRadius: 16, height: 42, justifyContent: "center", marginBottom: 15, width: 42 },
  renameTitle: { color: "#272D29", fontSize: 21, fontWeight: "800" },
  renameHint: { color: "#7C807A", fontSize: 13, marginTop: 7 },
  renameInput: { backgroundColor: "#F0EEE7", borderColor: "#CCD5CE", borderRadius: 16, borderWidth: 1, color: "#29312C", fontSize: 16, marginTop: 18, minHeight: 52, paddingHorizontal: 16 },
  renameActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 18 },
  renameCancel: { alignItems: "center", backgroundColor: "#ECE9E1", borderRadius: 15, justifyContent: "center", minHeight: 46, paddingHorizontal: 20 },
  renameCancelText: { color: "#626761", fontSize: 14, fontWeight: "700" },
  renameSave: { alignItems: "center", backgroundColor: "#3D6653", borderRadius: 15, justifyContent: "center", minHeight: 46, minWidth: 92, paddingHorizontal: 20 },
  renameSaveText: { color: "#F8F4EA", fontSize: 14, fontWeight: "700" },
  renameDisabled: { opacity: 0.45 },
  importCard: {
    alignItems: "center",
    backgroundColor: "#F7F5EF",
    borderColor: "#BFC9C1",
    borderRadius: 20,
    borderStyle: "dashed",
    borderWidth: 1.5,
    flexDirection: "row",
    minHeight: 146,
    padding: 18,
  },
  importIllustration: { height: 82, width: 72 },
  importBookBack: {
    backgroundColor: "#D9E1DA",
    borderColor: "#B9C6BC",
    borderRadius: 9,
    borderWidth: 1,
    height: 68,
    left: 12,
    position: "absolute",
    top: 3,
    transform: [{ rotate: "7deg" }],
    width: 46,
  },
  importBookFront: {
    alignItems: "center",
    backgroundColor: "#EFF2EC",
    borderColor: "#AFC0B4",
    borderRadius: 9,
    borderWidth: 1.5,
    elevation: 2,
    height: 68,
    justifyContent: "center",
    left: 4,
    position: "absolute",
    top: 9,
    transform: [{ rotate: "-4deg" }],
    width: 46,
  },
  importCopy: { flex: 1, paddingHorizontal: 12 },
  emptyTitle: { color: "#405249", fontSize: 15, fontWeight: "900" },
  emptyText: { color: "#8B918C", fontSize: 10.5, lineHeight: 17, marginTop: 6 },
  importArrow: {
    alignItems: "center",
    backgroundColor: "#496757",
    borderRadius: 16,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
});
