import {
  Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { memo,
  useCallback,
  useMemo,
  useState } from "react";
import { FlatList,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text, TextInput } from "../i18n";
import type { DimensionValue } from "react-native";

import { IOSPopupModal } from "../components/IOSPopupModal";
import type { Book } from "../types";

type HomeShelfProps = {
  books: Book[];
  importedCount: number;
  onBrowseWeb: () => void;
  onImport: () => void;
  onOnline: () => void;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
  onRename: (book: Book, title: string) => Promise<void>;
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

export function HomeShelf({
  books,
  importedCount,
  onBrowseWeb,
  onImport,
  onOnline,
  onOpen,
  onRemove,
  onRename,
}: HomeShelfProps) {
  const { width } = useWindowDimensions();
  const [renameBook, setRenameBook] = useState<Book>();
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
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
  const isTablet = width >= 700;
  const columns = width >= 1120 ? 3 : isTablet ? 2 : 1;
  const contentWidth = Math.min(width, 1180);
  const contentPadding = isTablet ? 28 : 18;
  const columnGap = 14;
  const cardWidth =
    (contentWidth - contentPadding * 2 - columnGap * (columns - 1)) / columns;

  const items = useMemo<ShelfListItem[]>(
    () => [
      ...books.map((book, colorIndex) => ({
        kind: "book" as const,
        book,
        colorIndex,
      })),
      { kind: "import" as const },
    ],
    [books],
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
        />
      ) : (
        <ImportCard cardWidth={cardWidth} onImport={onImport} />
      ),
    [beginRename, cardWidth, isTablet, onImport, onOpen, onRemove],
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
          <View>
            <Text style={styles.sectionTitle}>我的藏书</Text>
            <Text style={styles.sectionSubtitle}>近来翻过的页，与珍藏的故事</Text>
          </View>
          <View style={styles.layoutBadge}>
            <Ionicons name={columns > 1 ? "grid-outline" : "list-outline"} color="#6D7E74" size={14} />
            <Text style={styles.layoutText}>{columns > 1 ? columns + " 列" : "紧凑列表"}</Text>
          </View>
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
}: {
  book: Book;
  cardWidth: number;
  colorIndex: number;
  isTablet: boolean;
  onOpen: (book: Book) => void;
  onRemove: (book: Book) => void;
  onRename: (book: Book) => void;
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
        onLongPress={() => book.format !== "sample" && onRename(book)}
        onPress={openBook}
        style={({ pressed }) => [
          styles.card,
          isTablet && styles.cardTablet,
          pressed && styles.cardPressed,
        ]}
      >
        <View pointerEvents="none" style={styles.cardTopLine} />
        <View style={[styles.coverFrame, isTablet && styles.coverFrameTablet]}>
          <LinearGradient
            colors={book.coverColors ?? coverColors[colorIndex % coverColors.length]}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={styles.cover}
          >
            <View style={styles.coverSpine} />
            <View style={styles.coverInnerLine} />
            <Text style={styles.coverMonogram}>墨</Text>
            <View style={styles.coverRule} />
            <Text numberOfLines={3} style={styles.coverTitle}>{book.title}</Text>
            <Text numberOfLines={1} style={styles.coverAuthor}>{book.author}</Text>
            <View style={styles.formatPill}>
              <Text style={styles.formatText}>{formatLabel}</Text>
            </View>
          </LinearGradient>
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
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  headerTablet: { paddingHorizontal: 28, paddingTop: 22 },
  eyebrow: { color: "#85887F", fontSize: 8, fontWeight: "900", letterSpacing: 2.1 },
  title: { color: "#242A25", fontFamily: "serif", fontSize: 32, fontWeight: "800", lineHeight: 42 },
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
    minHeight: 92,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 14,
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
  summaryNumber: { color: "#2F4037", fontSize: 23, fontWeight: "900" },
  summaryLabel: { color: "#81877F", fontSize: 10, fontWeight: "600", marginTop: 1 },
  summaryDivider: { backgroundColor: "#C4C9C1", height: 40, marginHorizontal: 15, width: 1.5 },
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
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
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
  renameBackdrop: { alignItems: "center", backgroundColor: "rgba(25,32,28,0.48)", flex: 1, justifyContent: "center", padding: 26 },
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
