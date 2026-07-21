import {
  Ionicons } from "@expo/vector-icons";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  type AccessibilityRole,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput, useI18n } from "../i18n";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  FadeOut,
  LinearTransition,
  SlideInDown,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  deleteBookSource,
  importBookSources,
  refreshBookSource,
  searchSource,
  searchSources,
  setBookSourceEnabled,
} from "../services/bookSources";
import { useAppAlert } from "../components/AppDialog";
import type { ImportedBookSource, OnlineBookResult } from "../types";

type Props = {
  visible: boolean;
  sources: ImportedBookSource[];
  addedBookUrls: string[];
  onSourcesChange: (sources: ImportedBookSource[]) => void;
  onAdd: (book: OnlineBookResult) => Promise<void>;
  onClose: () => void;
  onRead: (book: OnlineBookResult) => Promise<void>;
};

type Feedback = { id: number; text: string };

const sourceLayout = LinearTransition.springify().damping(20).stiffness(190);
const ALL_SOURCES_ID = "__all__";

export function BookSourceModal({
  visible,
  sources,
  addedBookUrls,
  onSourcesChange,
  onAdd,
  onClose,
  onRead,
}: Props) {
  const Alert = useAppAlert();
  const { t } = useI18n();
  const [importValue, setImportValue] = useState("");
  const [keyword, setKeyword] = useState("");
  const [activeSourceId, setActiveSourceId] = useState<string>(ALL_SOURCES_ID);
  const [results, setResults] = useState<OnlineBookResult[]>([]);
  const [busy, setBusy] = useState<"import" | "search" | "read" | string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [hasSearched, setHasSearched] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ completed: number; total: number; failed: number }>();
  const [managerVisible, setManagerVisible] = useState(false);
  const importFocus = useSharedValue(0);
  const searchFocus = useSharedValue(0);

  const addedUrls = useMemo(() => new Set(addedBookUrls), [addedBookUrls]);
  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources],
  );
  const searchingAll = activeSourceId === ALL_SOURCES_ID;
  const activeSource = sources.find(
    (source) => source.id === activeSourceId && source.enabled,
  );

  useEffect(() => {
    if (activeSourceId !== ALL_SOURCES_ID && !activeSource && enabledSources.length) {
      setActiveSourceId(ALL_SOURCES_ID);
    }
  }, [activeSource, activeSourceId, enabledSources.length]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(undefined), 2400);
    return () => clearTimeout(timer);
  }, [feedback]);

  const importCardStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(importFocus.value, [0, 1], ["#DEDAD1", "#7D998A"]),
    transform: [{ scale: interpolate(importFocus.value, [0, 1], [1, 1.006]) }],
  }));
  const searchCardStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(searchFocus.value, [0, 1], ["#DEDAD1", "#7D998A"]),
  }));

  const showError = (title: string, error: unknown) => {
    Alert.alert(title, error instanceof Error ? error.message : "操作失败，请稍后再试。");
  };
  const announce = (text: string) => setFeedback({ id: Date.now(), text });
  const resetSearch = () => {
    setResults([]);
    setHasSearched(false);
  };

  const handleImport = async () => {
    if (!importValue.trim() || busy) return;
    setBusy("import");
    try {
      const imported = await importBookSources(importValue, sources);
      onSourcesChange(imported.sources);
      setImportValue("");
      const last = imported.sources[imported.sources.length - 1];
      if (last) setActiveSourceId(ALL_SOURCES_ID);
      resetSearch();
      announce("已导入或更新 " + imported.imported + " 个书源");
    } catch (error) {
      showError("书源导入失败", error);
    } finally {
      setBusy(undefined);
    }
  };

  const handleRefresh = async (source: ImportedBookSource) => {
    if (busy) return;
    setBusy("refresh-" + source.id);
    try {
      onSourcesChange(await refreshBookSource(source, sources));
      announce("“" + source.config.bookSourceName + "”已更新");
    } catch (error) {
      showError("书源更新失败", error);
    } finally {
      setBusy(undefined);
    }
  };

  const handleToggle = async (source: ImportedBookSource) => {
    try {
      const next = await setBookSourceEnabled(source.id, !source.enabled, sources);
      onSourcesChange(next);
      if (source.enabled && activeSourceId === source.id) {
        setActiveSourceId(ALL_SOURCES_ID);
        resetSearch();
      }
    } catch (error) {
      showError("状态保存失败", error);
    }
  };

  const handleDelete = (source: ImportedBookSource) => {
    Alert.alert(
      "删除书源",
      "删除“" + source.config.bookSourceName + "”后，书架中来自该书源的书将暂时无法打开。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            try {
              onSourcesChange(await deleteBookSource(source.id, sources));
              resetSearch();
            } catch (error) {
              showError("删除失败", error);
            }
          },
        },
      ],
    );
  };

  const handleSelectSource = (source: ImportedBookSource) => {
    if (!source.enabled || activeSourceId === source.id) return;
    setActiveSourceId(source.id);
    resetSearch();
  };

  const handleSearch = async () => {
    if (!keyword.trim() || !enabledSources.length || busy) return;
    setBusy("search");
    setHasSearched(true);
    setResults([]);
    setSearchProgress(
      searchingAll ? { completed: 0, total: enabledSources.length, failed: 0 } : undefined,
    );
    try {
      if (searchingAll) {
        const response = await searchSources(
          enabledSources,
          keyword.trim(),
          (completed, total, failed) => setSearchProgress({ completed, total, failed }),
        );
        setResults(response.results);
        if (response.failed) announce(response.failed + " 个书源暂时无法连接");
      } else if (activeSource) {
        setResults(await searchSource(activeSource, keyword.trim()));
      }
    } catch (error) {
      showError("搜索失败", error);
    } finally {
      setBusy(undefined);
    }
  };

  const handleAdd = async (book: OnlineBookResult) => {
    if (busy) return;
    setBusy("add|" + book.bookUrl);
    try {
      await onAdd(book);
      announce("已加入书架，打开时将按章载入");
    } catch (error) {
      showError("加入书架失败", error);
    } finally {
      setBusy(undefined);
    }
  };
  const handleRead = async (book: OnlineBookResult) => {
    if (busy) return;
    setBusy("read");
    try {
      await onRead(book);
      onClose();
    } catch (error) {
      showError("打开失败", error);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (managerVisible) setManagerVisible(false);
        else onClose();
      }}
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.heading}>在线书源</Text>
              <Text style={styles.subheading}>搜索喜欢的书，加入书架后即可阅读</Text>
            </View>
            <View style={styles.headerActions}>
              <MotionPressable
                accessibilityLabel="管理书源"
                onPress={() => setManagerVisible(true)}
                style={styles.headerButton}
              >
                <Ionicons color="#52675C" name="library-outline" size={20} />
              </MotionPressable>
              <MotionPressable
                accessibilityLabel="关闭书源页面"
                onPress={onClose}
                style={styles.close}
              >
                <Ionicons color="#38443D" name="close" size={21} />
              </MotionPressable>
            </View>
          </View>

          <FlatList
            contentContainerStyle={styles.content}
            data={results}
            keyExtractor={(item) => item.sourceId + "|" + item.bookUrl}
            initialNumToRender={4}
            keyboardShouldPersistTaps="handled"
            maxToRenderPerBatch={4}
            removeClippedSubviews={Platform.OS === "android"}
            updateCellsBatchingPeriod={64}
            windowSize={5}
            ListHeaderComponent={
              <>
                {feedback ? (
                  <Animated.View
                    entering={FadeInDown.springify().damping(18)}
                    exiting={FadeOut.duration(150)}
                    key={feedback.id}
                    style={styles.feedback}
                  >
                    <View style={styles.feedbackIcon}>
                      <Ionicons color="#F7F3EA" name="checkmark" size={14} />
                    </View>
                    <Text style={styles.feedbackText}>{feedback.text}</Text>
                  </Animated.View>
                ) : null}

                {!enabledSources.length ? (
                  <Animated.View
                    entering={FadeInDown.duration(220)}
                    style={styles.sourceWelcome}
                  >
                    <View style={styles.welcomeIcon}>
                      <Ionicons color="#567061" name="library-outline" size={27} />
                    </View>
                    <Text style={styles.welcomeTitle}>
                      {sources.length ? "没有启用的书源" : "添加一个书源"}
                    </Text>
                    <Text style={styles.welcomeText}>
                      {sources.length
                        ? "在书源管理中启用后即可搜索"
                        : "导入后就能搜索并将书籍加入书架"}
                    </Text>
                    <MotionPressable
                      onPress={() => setManagerVisible(true)}
                      style={styles.managePrimary}
                    >
                      <Ionicons color="#F8F4EA" name="add" size={17} />
                      <Text style={styles.managePrimaryText}>书源管理</Text>
                    </MotionPressable>
                  </Animated.View>
                ) : (
                  <>
                    <View style={styles.searchHeadingRow}>
                      <View>
                        <Text style={styles.sectionTitle}>搜索书籍</Text>
                        <Text style={styles.sectionHint}>选择书源并输入书名或作者</Text>
                      </View>
                      <MotionPressable
                        accessibilityLabel={t("管理书源")}
                        accessibilityRole="button"
                        onPress={() => setManagerVisible(true)}
                        style={styles.manageLink}
                      >
                        <Ionicons color="#60766A" name="settings-outline" size={18} />
                      </MotionPressable>
                    </View>

                    <ScrollView
                      contentContainerStyle={styles.sourcePicker}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      <Animated.View entering={FadeInRight.duration(160)}>
                        <Pressable
                          onPress={() => {
                            if (activeSourceId === ALL_SOURCES_ID) return;
                            setActiveSourceId(ALL_SOURCES_ID);
                            resetSearch();
                          }}
                          style={[styles.sourceChip, searchingAll && styles.sourceChipActive]}
                        >
                          <View style={[styles.sourceChipDot, searchingAll && styles.sourceChipDotActive]} />
                          <Text style={[styles.sourceChipText, searchingAll && styles.sourceChipTextActive]}>
                            全部书源
                          </Text>
                        </Pressable>
                      </Animated.View>
                      {enabledSources.map((source, index) => {
                        const active = activeSource?.id === source.id;
                        return (
                          <Animated.View
                            entering={FadeInRight.delay(index * 35).duration(180)}
                            key={source.id}
                          >
                            <Pressable
                              onPress={() => handleSelectSource(source)}
                              style={[
                                styles.sourceChip,
                                active && styles.sourceChipActive,
                              ]}
                            >
                              <View
                                style={[
                                  styles.sourceChipDot,
                                  active && styles.sourceChipDotActive,
                                ]}
                              />
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.sourceChipText,
                                  active && styles.sourceChipTextActive,
                                ]}
                              >
                                {source.config.bookSourceName}
                              </Text>
                            </Pressable>
                          </Animated.View>
                        );
                      })}
                    </ScrollView>

                    <Animated.View style={[styles.searchCard, searchCardStyle]}>
                      <View style={styles.sourcePill}>
                        <Ionicons color="#60786B" name="globe-outline" size={14} />
                        <Text numberOfLines={1} style={styles.sourcePillText}>
                          {searchingAll
                            ? "全部书源 · " + enabledSources.length + " 个"
                            : activeSource?.config.bookSourceName}
                        </Text>
                      </View>
                      <View style={styles.searchRow}>
                        <TextInput
                          onBlur={() => {
                            searchFocus.value = withTiming(0, { duration: 160 });
                          }}
                          onChangeText={setKeyword}
                          onFocus={() => {
                            searchFocus.value = withSpring(1, {
                              damping: 20,
                              stiffness: 220,
                            });
                          }}
                          onSubmitEditing={() => void handleSearch()}
                          placeholder="搜索书名或作者"
                          placeholderTextColor="#A7A198"
                          returnKeyType="search"
                          style={styles.searchInput}
                          value={keyword}
                        />
                        <ActionButton
                          busy={busy === "search"}
                          disabled={!keyword.trim() || Boolean(busy)}
                          icon="search"
                          onPress={() => void handleSearch()}
                          style={styles.searchButton}
                        />
                      </View>
                    </Animated.View>

                    {busy === "search" ? (
                      <Animated.Text
                        entering={FadeIn.duration(120)}
                        exiting={FadeOut.duration(100)}
                        style={styles.resultCaption}
                      >
                        {searchProgress
                          ? t("正在搜索 {completed} / {total}", { completed: searchProgress.completed, total: searchProgress.total })
                          : "正在搜索…"}
                      </Animated.Text>
                    ) : results.length ? (
                      <Animated.Text
                        entering={FadeInDown.duration(180)}
                        style={styles.resultCaption}
                      >
                        {t("找到 {count} 本书", { count: results.length })}
                      </Animated.Text>
                    ) : hasSearched ? (
                      <Animated.Text
                        entering={FadeIn.duration(180)}
                        style={styles.resultCaption}
                      >
                        {t("没有匹配结果，可以换个关键词")}
                      </Animated.Text>
                    ) : (
                      <Text style={styles.resultCaption}>搜索结果会显示在下方</Text>
                    )}
                  </>
                )}
              </>
            }
            ListEmptyComponent={
              busy === "search" ? (
                <SearchSkeleton />
              ) : (
                <Animated.View entering={FadeIn.duration(180)} style={styles.resultsEmpty}>
                  <Ionicons color="#C1BCB2" name="search-outline" size={34} />
                  <Text style={styles.resultsEmptyText}>
                    {hasSearched ? "试试书名简称或作者名" : "输入关键词开始搜索"}
                  </Text>
                </Animated.View>
              )
            }
            renderItem={({ item, index }) => {
              const added = addedUrls.has(item.bookUrl);
              return (
                <ResultCard
                  added={added}
                  busy={busy === "add|" + item.bookUrl}
                  disabled={Boolean(busy)}
                  index={index}
                  item={item}
                  onAction={() =>
                    void (added ? handleRead(item) : handleAdd(item))
                  }
                />
              );
            }}
            showsVerticalScrollIndicator={false}
          />

          {busy === "read" ? (
            <Animated.View
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(120)}
              style={styles.loadingOverlay}
            >
              <Animated.View
                entering={FadeInDown.springify().damping(20)}
                style={styles.loadingCard}
              >
                <ActivityIndicator color="#4F6D5D" size="large" />
                <Text style={styles.loadingTitle}>正在整理目录与正文</Text>
                <Text style={styles.loadingText}>首次打开会比本地书稍慢</Text>
              </Animated.View>
            </Animated.View>
          ) : null}
        </KeyboardAvoidingView>

        {managerVisible ? (
          <View style={styles.managerOverlay}>
            <Pressable
              accessibilityLabel="关闭书源管理"
              onPress={() => setManagerVisible(false)}
              style={StyleSheet.absoluteFill}
            />
            <SafeAreaView edges={["top", "bottom"]} style={styles.managerSafe}>
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.managerKeyboard}
              >
                <Animated.View
                  entering={SlideInDown.duration(230)}
                  style={styles.managerSheet}
                >
                  <View style={styles.managerHeader}>
                    <View>
                      <Text style={styles.managerTitle}>书源管理</Text>
                      <Text style={styles.managerSubtitle}>添加、更新或停用书源</Text>
                    </View>
                    <MotionPressable
                      accessibilityLabel="关闭"
                      onPress={() => setManagerVisible(false)}
                      style={styles.managerClose}
                    >
                      <Ionicons color="#46544C" name="close" size={20} />
                    </MotionPressable>
                  </View>

                  <ScrollView
                    contentContainerStyle={styles.managerContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                  >
                    {feedback ? (
                      <Animated.View
                        entering={FadeInDown.duration(180)}
                        key={feedback.id}
                        style={styles.feedback}
                      >
                        <View style={styles.feedbackIcon}>
                          <Ionicons color="#F7F3EA" name="checkmark" size={14} />
                        </View>
                        <Text style={styles.feedbackText}>{feedback.text}</Text>
                      </Animated.View>
                    ) : null}

                    <Text style={styles.managerSectionTitle}>导入书源</Text>
                    <Animated.View style={[styles.card, importCardStyle]}>
                      <TextInput
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline
                        onBlur={() => {
                          importFocus.value = withTiming(0, { duration: 160 });
                        }}
                        onChangeText={setImportValue}
                        onFocus={() => {
                          importFocus.value = withSpring(1, {
                            damping: 20,
                            stiffness: 220,
                          });
                        }}
                        placeholder="粘贴书源链接或 JSON"
                        placeholderTextColor="#AAA49B"
                        style={styles.importInput}
                        value={importValue}
                      />
                      <ActionButton
                        busy={busy === "import"}
                        disabled={!importValue.trim() || Boolean(busy)}
                        icon="download-outline"
                        label={busy === "import" ? "正在导入…" : "导入书源"}
                        onPress={() => void handleImport()}
                        style={styles.primaryButton}
                      />
                    </Animated.View>

                    <Text style={styles.managerSectionTitle}>
                      已导入 · {sources.length}
                    </Text>
                    {!sources.length ? (
                      <View style={styles.managerEmpty}>
                        <Ionicons color="#A7A198" name="library-outline" size={25} />
                        <Text style={styles.managerEmptyText}>还没有书源</Text>
                      </View>
                    ) : (
                      <View style={styles.managerSources}>
                        {sources.map((source, index) => (
                          <SourceCard
                            active={activeSource?.id === source.id}
                            busy={busy}
                            index={index}
                            key={source.id}
                            onDelete={() => handleDelete(source)}
                            onRefresh={() => void handleRefresh(source)}
                            onSelect={() => handleSelectSource(source)}
                            onToggle={() => void handleToggle(source)}
                            source={source}
                            wide
                          />
                        ))}
                      </View>
                    )}
                  </ScrollView>
                </Animated.View>
              </KeyboardAvoidingView>
            </SafeAreaView>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function SourceCard({
  source,
  active,
  index,
  busy,
  onSelect,
  onToggle,
  onRefresh,
  onDelete,
  wide = false,
}: {
  source: ImportedBookSource;
  active: boolean;
  index: number;
  busy?: string;
  onSelect: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  wide?: boolean;
}) {
  const activeProgress = useSharedValue(active ? 1 : 0);
  const pressProgress = useSharedValue(0);

  useEffect(() => {
    activeProgress.value = withSpring(active ? 1 : 0, {
      damping: 20,
      stiffness: 210,
      mass: 0.65,
    });
  }, [active, activeProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeProgress.value,
      [0, 1],
      ["#F9F7F1", "#EFF3EF"],
    ),
    borderColor: interpolateColor(
      activeProgress.value,
      [0, 1],
      ["#DCD8CF", "#789283"],
    ),
    transform: [
      { scale: interpolate(pressProgress.value, [0, 1], [1, 0.975]) },
      { translateY: interpolate(activeProgress.value, [0, 1], [0, -2]) },
    ],
  }));
  const markStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeProgress.value,
      [0, 1],
      ["#E5EBE7", "#52705F"],
    ),
  }));

  return (
    <Animated.View
      entering={
        wide
          ? FadeInDown.delay(Math.min(index, 6) * 35).duration(180)
          : FadeInRight.delay(Math.min(index, 6) * 45).springify().damping(19)
      }
      layout={sourceLayout}
      style={wide ? styles.sourceCardContainerWide : undefined}
    >
      <Animated.View
        style={[
          styles.sourceCard,
          wide && styles.sourceCardWide,
          !source.enabled && styles.sourceCardDisabled,
          cardStyle,
        ]}
      >
        <Pressable
          disabled={!source.enabled}
          onPress={onSelect}
          onPressIn={() => {
            pressProgress.value = withSpring(1, { damping: 18, stiffness: 320 });
          }}
          onPressOut={() => {
            pressProgress.value = withSpring(0, { damping: 18, stiffness: 280 });
          }}
        >
          <View style={styles.sourceTop}>
            <Animated.View style={[styles.sourceMark, markStyle]}>
              <Ionicons
                color={active ? "#F7F2E8" : "#557063"}
                name="book-outline"
                size={16}
              />
            </Animated.View>
            <SourceSwitch value={source.enabled} onChange={onToggle} />
          </View>
          <Text numberOfLines={1} style={styles.sourceName}>
            {source.config.bookSourceName}
          </Text>
          <Text numberOfLines={1} style={styles.sourceUrl}>
            {source.config.bookSourceUrl}
          </Text>
        </Pressable>
        <View style={styles.sourceActions}>
          <MotionPressable
            disabled={!source.importUrl || Boolean(busy)}
            onPress={onRefresh}
            style={styles.sourceAction}
          >
            {busy === "refresh-" + source.id ? (
              <BusyGlyph color="#60766A" name="refresh-outline" />
            ) : (
              <Ionicons
                color={source.importUrl ? "#60766A" : "#BBB6AD"}
                name="refresh-outline"
                size={16}
              />
            )}
          </MotionPressable>
          <MotionPressable onPress={onDelete} style={styles.sourceAction}>
            <Ionicons color="#A16B65" name="trash-outline" size={16} />
          </MotionPressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function ResultCard({
  item,
  index,
  disabled,
  added,
  busy,
  onAction,
}: {
  item: OnlineBookResult;
  index: number;
  disabled: boolean;
  added: boolean;
  busy: boolean;
  onAction: () => void;
}) {
  return (
    <Animated.View layout={sourceLayout} style={styles.resultCard}>
      <View style={styles.resultBadge}>
        <Text style={styles.resultBadgeText}>{item.name.slice(0, 1)}</Text>
      </View>
      <View style={styles.resultText}>
        <Text numberOfLines={1} style={styles.resultTitle}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.resultMeta}>
          {item.author || "未知作者"}
          {item.wordCount ? " · " + item.wordCount : ""}
          {item.sourceName ? " · " + item.sourceName : ""}
        </Text>
        {item.latestChapter ? (
          <Text numberOfLines={1} style={styles.resultChapter}>
            {item.latestChapter}
          </Text>
        ) : null}
      </View>
      <MotionPressable
        disabled={disabled}
        onPress={onAction}
        style={[styles.readButton, added ? styles.readButtonAdded : {}]}
      >
        {busy ? (
          <BusyGlyph name="add" />
        ) : (
          <Ionicons
            color="#F8F4EA"
            name={added ? "book-outline" : "add"}
            size={14}
          />
        )}
        <Text style={styles.readButtonText}>
          {busy ? "添加中" : added ? "阅读" : "加入书架"}
        </Text>
      </MotionPressable>
    </Animated.View>
  );
}

function ActionButton({
  busy,
  disabled,
  icon,
  label,
  onPress,
  style,
}: {
  busy: boolean;
  disabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  style: object;
}) {
  return (
    <MotionPressable
      disabled={disabled}
      onPress={onPress}
      style={[style, disabled ? styles.disabled : {}]}
    >
      {busy ? (
        <BusyGlyph name={icon} />
      ) : (
        <Ionicons color="#F8F4EA" name={icon} size={18} />
      )}
      {label ? <Text style={styles.primaryText}>{label}</Text> : null}
    </MotionPressable>
  );
}

function MotionPressable({
  children,
  disabled,
  onPress,
  style,
  accessibilityLabel,
  accessibilityRole,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onPress: () => void;
  style: object | object[];
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}) {
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.97]) }],
  }));

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        progress.value = withTiming(1, { duration: 80 });
      }}
      onPressOut={() => {
        progress.value = withTiming(0, { duration: 130 });
      }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

function BusyGlyph({
  name,
  color = "#F8F4EA",
}: {
  name: keyof typeof Ionicons.glyphMap;
  color?: string;
}) {
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 720 }), -1, false);
    return () => cancelAnimation(spin);
  }, [spin]);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: spin.value * 360 + "deg" }],
  }));

  return (
    <Animated.View style={spinStyle}>
      <Ionicons color={color} name={name} size={18} />
    </Animated.View>
  );
}

function SearchSkeleton() {
  return (
    <View>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonBadge} />
          <View style={styles.skeletonText}>
            <View style={styles.skeletonLineWide} />
            <View style={styles.skeletonLineShort} />
          </View>
          <View style={styles.skeletonButton} />
        </View>
      ))}
    </View>
  );
}

function SourceSwitch({
  value,
  onChange,
}: {
  value: boolean;
  onChange: () => void;
}) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 210 });
  }, [progress, value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["#D8D4CC", "#789787"],
    ),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [3, 21]) },
      { scale: interpolate(progress.value, [0, 0.5, 1], [1, 0.97, 1]) },
    ],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={onChange}
    >
      <Animated.View style={[styles.switchTrack, trackStyle]}>
        <Animated.View style={[styles.switchThumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { backgroundColor: "#F4F1EA", flex: 1 },
  header: {
    alignItems: "center",
    borderBottomColor: "#DEDAD1",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  eyebrow: {
    color: "#8C8C84",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  heading: {
    color: "#292E29",
    fontFamily: "serif",
    fontSize: 28,
    fontWeight: "800",
  },
  subheading: { color: "#8C8F88", fontSize: 10, marginTop: 3 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  headerButton: {
    alignItems: "center",
    backgroundColor: "#E6EBE6",
    borderRadius: 15,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  sourceWelcome: {
    alignItems: "center",
    backgroundColor: "#FAF8F3",
    borderColor: "#DDD9D0",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 34,
  },
  welcomeIcon: {
    alignItems: "center",
    backgroundColor: "#E7EEE9",
    borderRadius: 20,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  welcomeTitle: { color: "#3C443F", fontSize: 15, fontWeight: "900", marginTop: 15 },
  welcomeText: { color: "#969189", fontSize: 10, marginTop: 6, textAlign: "center" },
  managePrimary: {
    alignItems: "center",
    backgroundColor: "#3D5D4C",
    borderRadius: 14,
    flexDirection: "row",
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  managePrimaryText: { color: "#F8F4EA", fontSize: 11, fontWeight: "800" },
  searchHeadingRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionHint: { color: "#9A958D", fontSize: 9.5, marginTop: -5 },
  manageLink: {
    alignItems: "center",
    backgroundColor: "#E8ECE8",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  sourcePicker: { gap: 8, paddingBottom: 11, paddingTop: 15, paddingRight: 18 },
  sourceChip: {
    alignItems: "center",
    backgroundColor: "#E9E6DF",
    borderColor: "#DDD9D1",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sourceChipActive: { backgroundColor: "#E0E9E2", borderColor: "#819B8C" },
  sourceChipDot: { backgroundColor: "#AAA59D", borderRadius: 4, height: 7, width: 7 },
  sourceChipDotActive: { backgroundColor: "#4E6D5C" },
  sourceChipText: { color: "#7D7B75", fontSize: 10, fontWeight: "700" },
  sourceChipTextActive: { color: "#496052" },
  managerOverlay: {
    backgroundColor: "#19201973",
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  managerSafe: { flex: 1, justifyContent: "flex-end" },
  managerKeyboard: { flex: 1, justifyContent: "flex-end" },
  managerSheet: {
    backgroundColor: "#F5F2EB",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    elevation: 18,
    maxHeight: "88%",
    minHeight: 480,
    overflow: "hidden",
  },
  managerHeader: {
    alignItems: "center",
    borderBottomColor: "#DDD9D0",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  managerTitle: { color: "#303731", fontSize: 18, fontWeight: "900" },
  managerSubtitle: { color: "#969189", fontSize: 9.5, marginTop: 3 },
  managerClose: {
    alignItems: "center",
    backgroundColor: "#E7E3DB",
    borderRadius: 14,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  managerContent: { paddingBottom: 42, paddingHorizontal: 18 },
  managerSectionTitle: {
    color: "#414741",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 9,
    marginTop: 18,
  },
  managerEmpty: {
    alignItems: "center",
    borderColor: "#DCD7CE",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    padding: 24,
  },
  managerEmptyText: { color: "#9C978F", fontSize: 10, marginTop: 7 },
  managerSources: { gap: 10 },  close: {
    alignItems: "center",
    backgroundColor: "#E8E4DC",
    borderRadius: 15,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  content: { paddingBottom: 52, paddingHorizontal: 18 },
  notice: {
    alignItems: "center",
    backgroundColor: "#E8EEE9",
    borderRadius: 16,
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    padding: 13,
  },
  noticeText: { color: "#607168", flex: 1, fontSize: 10.5, lineHeight: 17 },
  feedback: {
    alignItems: "center",
    backgroundColor: "#EDF2ED",
    borderColor: "#CCD9D0",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 9,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feedbackIcon: {
    alignItems: "center",
    backgroundColor: "#587565",
    borderRadius: 10,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  feedbackText: { color: "#53675C", flex: 1, fontSize: 10.5, fontWeight: "700" },
  sectionTitle: {
    color: "#383D38",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 10,
    marginTop: 22,
  },
  card: {
    backgroundColor: "#FBF9F4",
    borderColor: "#DEDAD1",
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  importInput: {
    color: "#3B403B",
    fontSize: 11,
    lineHeight: 17,
    minHeight: 62,
    paddingHorizontal: 5,
    paddingTop: 3,
    textAlignVertical: "top",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#3D5D4C",
    borderRadius: 14,
    flexDirection: "row",
    gap: 7,
    height: 43,
    justifyContent: "center",
    marginTop: 9,
  },
  primaryText: { color: "#F8F4EA", fontSize: 12, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  emptySource: {
    alignItems: "center",
    backgroundColor: "#F9F6F0",
    borderColor: "#DCD7CE",
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    padding: 24,
  },
  emptySourceTitle: {
    color: "#666A65",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  emptySourceText: { color: "#A19B92", fontSize: 9.5, marginTop: 4 },
  sourceStrip: { gap: 10, paddingRight: 18 },
  sourceCardContainerWide: { width: "100%" },
  sourceCardWide: { width: "100%" },
  sourceCard: {
    backgroundColor: "#F9F7F1",
    borderColor: "#DCD8CF",
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    width: 192,
  },
  sourceCardDisabled: { opacity: 0.58 },
  sourceTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sourceMark: {
    alignItems: "center",
    backgroundColor: "#E5EBE7",
    borderRadius: 11,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  sourceName: {
    color: "#333A35",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 10,
  },
  sourceUrl: { color: "#969189", fontSize: 8.5, marginTop: 4 },
  sourceActions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 8,
  },
  sourceAction: {
    alignItems: "center",
    backgroundColor: "#ECE9E2",
    borderRadius: 9,
    height: 30,
    justifyContent: "center",
    width: 34,
  },
  switchTrack: { borderRadius: 11, height: 22, width: 42 },
  switchThumb: {
    backgroundColor: "#FFFFFF",
    borderRadius: 9,
    elevation: 2,
    height: 18,
    position: "absolute",
    top: 2,
    width: 18,
  },
  searchCard: {
    backgroundColor: "#FBF9F4",
    borderColor: "#DEDAD1",
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  sourcePill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginBottom: 10,
  },
  sourcePillText: {
    color: "#66736B",
    flex: 1,
    fontSize: 10,
    fontWeight: "700",
  },
  searchRow: { flexDirection: "row", gap: 9 },
  searchInput: {
    backgroundColor: "#ECE9E2",
    borderRadius: 14,
    color: "#363C37",
    flex: 1,
    fontSize: 12,
    height: 44,
    paddingHorizontal: 13,
  },
  searchButton: {
    alignItems: "center",
    backgroundColor: "#3D5D4C",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 48,
  },
  resultCaption: {
    color: "#969189",
    fontSize: 9.5,
    marginBottom: 3,
    marginTop: 15,
  },
  resultsEmpty: { alignItems: "center", paddingBottom: 34, paddingTop: 30 },
  resultsEmptyText: { color: "#A8A299", fontSize: 10, marginTop: 8 },
  resultCard: {
    alignItems: "center",
    backgroundColor: "#FAF8F3",
    borderBottomColor: "#E5E0D8",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 78,
    paddingHorizontal: 7,
    paddingVertical: 10,
  },
  resultBadge: {
    alignItems: "center",
    backgroundColor: "#DDE7E0",
    borderRadius: 13,
    height: 45,
    justifyContent: "center",
    width: 45,
  },
  resultBadgeText: {
    color: "#496555",
    fontFamily: "serif",
    fontSize: 18,
    fontWeight: "900",
  },
  resultText: { flex: 1, marginLeft: 11 },
  resultTitle: { color: "#343934", fontSize: 13, fontWeight: "900" },
  resultMeta: { color: "#8B8982", fontSize: 9.5, marginTop: 4 },
  resultChapter: { color: "#A09B93", fontSize: 8.5, marginTop: 3 },
  readButton: {
    alignItems: "center",
    backgroundColor: "#526F60",
    borderRadius: 12,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  readButtonAdded: { backgroundColor: "#708578" },
  readButtonText: { color: "#F8F4EA", fontSize: 9.5, fontWeight: "800" },
  skeletonCard: {
    alignItems: "center",
    borderBottomColor: "#E5E0D8",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 78,
    paddingHorizontal: 7,
    paddingVertical: 10,
  },
  skeletonBadge: {
    backgroundColor: "#E0E5E0",
    borderRadius: 13,
    height: 45,
    width: 45,
  },
  skeletonText: { flex: 1, gap: 8, marginLeft: 11 },
  skeletonLineWide: {
    backgroundColor: "#E2E0DA",
    borderRadius: 4,
    height: 9,
    width: "58%",
  },
  skeletonLineShort: {
    backgroundColor: "#EBE8E2",
    borderRadius: 4,
    height: 7,
    width: "38%",
  },
  skeletonButton: {
    backgroundColor: "#DCE3DE",
    borderRadius: 12,
    height: 32,
    width: 74,
  },
  loadingOverlay: {
    alignItems: "center",
    backgroundColor: "#1B211D77",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  loadingCard: {
    alignItems: "center",
    backgroundColor: "#FBF8F1",
    borderRadius: 22,
    elevation: 8,
    minWidth: 230,
    padding: 24,
  },
  loadingTitle: {
    color: "#3A443E",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 13,
  },
  loadingText: { color: "#989189", fontSize: 9.5, marginTop: 5 },
});