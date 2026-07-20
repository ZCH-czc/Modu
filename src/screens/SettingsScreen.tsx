import {
  Ionicons } from "@expo/vector-icons";
import { useEffect,
  useRef,
  useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, useI18n, type LanguagePreference } from "../i18n";
import Animated, {
  Easing,
  LinearTransition,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppAlert } from "../components/AppDialog";
import { IOSPopupModal } from "../components/IOSPopupModal";
import { ReadingInsightsModal } from "../components/ReadingInsightsModal";
import {
  checkForAppUpdate,
  CURRENT_APP_VERSION,
  type AppUpdateResult,
} from "../services/appUpdate";
import { summarizeReadingStats } from "../services/readingStats";
import type { ReadingStats } from "../services/readingStats";
import type {
  Book,
  PageTurn,
  ReaderFont,
  ReaderOrientation,
  ReaderPreferences,
  ReaderTheme,
  TextAlignment,
} from "../types";
import { getReaderFontFamily, readerFontOptions } from "../utils/readerFonts";

interface Props {
  preferences: ReaderPreferences;
  books: Book[];
  importedBooks: Book[];
  readingGoalMinutes: number;
  readingStats: ReadingStats;
  sourceCount: number;
  onManageSources: () => void;
  onOpenLanTransfer: () => void;
  onOpenGuide: () => void;
  onReadingGoalChange: (minutes: number) => void;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  onVolumeKeysChange: (enabled: boolean) => void;
  onDeleteBook: (book: Book) => void;
  onClearCache: () => Promise<string>;
  onExportBackup: () => Promise<{ canceled: boolean; fileCount?: number }>;
  onExportAnnotations: () => Promise<{ canceled: boolean }>;
  onRestoreBackup: () => Promise<{ canceled: boolean; fileCount?: number }>;
  onClearHistory: () => Promise<void>;
}

const themes: Array<{ key: ReaderTheme; label: string; color: string }> = [
  { key: "paper", label: "羊皮纸", color: "#F4E8CF" },
  { key: "white", label: "纯白", color: "#FFFFFF" },
  { key: "green", label: "护眼", color: "#DCE7D7" },
  { key: "night", label: "夜间", color: "#222622" },
];

export function SettingsScreen(props: Props) {
  const Alert = useAppAlert();
  const { language, setLanguage } = useI18n();
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [insightsVisible, setInsightsVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateVisible, setUpdateVisible] = useState(false);
  const [updateResult, setUpdateResult] = useState<AppUpdateResult>();

  const clearCache = async () => {
    setBusy(true);
    try {
      const size = await props.onClearCache();
      Alert.alert("缓存已清理", size);
    } finally {
      setBusy(false);
    }
  };

  const clearHistory = () => {
    Alert.alert("清除阅读记录", "所有书籍的阅读位置会被重置，确定继续吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清除",
        style: "destructive",
        onPress: async () => {
          await props.onClearHistory();
          Alert.alert("已完成", "阅读位置已全部重置。");
        },
      },
    ]);
  };

const exportAnnotations = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await props.onExportAnnotations();
      if (!result.canceled) {
        Alert.alert("批注已导出", "划线与笔记已经整理成 Markdown 文件。");
      }
    } catch (error) {
      Alert.alert(
        "导出失败",
        error instanceof Error ? error.message : "暂时无法导出批注。",
      );
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await props.onExportBackup();
      if (!result.canceled) {
        Alert.alert(
          "备份已写好",
          `藏书、设置、进度与书签已收进备份，包含 ${result.fileCount ?? 0} 个本地文件。`,
        );
      }
    } catch (error) {
      Alert.alert(
        "备份失败",
        error instanceof Error ? error.message : "暂时无法写出备份文件。",
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = () => {
    if (busy) return;
    Alert.alert(
      "恢复墨读备份",
      "恢复会替换当前书架、设置、阅读进度与书签。现有本地数据仍建议先另存一份备份。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "选择备份",
          onPress: async () => {
            setBusy(true);
            try {
              const result = await props.onRestoreBackup();
              if (!result.canceled) {
                Alert.alert(
                  "已恢复",
                  `书架已经回到备份时的模样，并恢复了 ${result.fileCount ?? 0} 个本地文件。`,
                );
              }
            } catch (error) {
              Alert.alert(
                "恢复失败",
                error instanceof Error ? error.message : "无法读懂这个备份文件。",
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const checkUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await checkForAppUpdate();
      setUpdateResult(result);
      setUpdateVisible(true);
    } catch (error) {
      Alert.alert(
        "检查更新失败",
        error instanceof Error ? error.message : "暂时无法连接 GitHub Releases，请稍后重试。",
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  const openUpdateDownload = async () => {
    if (!updateResult) return;
    try {
      await Linking.openURL(updateResult.update.downloadUrl);
      setUpdateVisible(false);
    } catch {
      Alert.alert("无法打开下载页面", "请稍后前往 GitHub Releases 手动下载最新版本。");
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>字里行间</Text>
            <Text style={styles.heading}>阅读偏好</Text>
          </View>
          <View style={styles.seal}><Text style={styles.sealText}>墨</Text></View>
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="leaf-outline" size={24} color="#F3DFC0" />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>愿每一次翻页，都有清风作伴</Text>
          </View>
        </View>

        <Section title="语言与地区">
          <SegmentRow<LanguagePreference>
            title="应用语言"
            value={language}
            options={[
              ["system", "跟随系统"],
              ["zh-CN", "简体中文"],
              ["en", "英语"],
            ]}
            onChange={(value) => void setLanguage(value)}
          />
        </Section>

        <Section title="纸页风貌">
          <Text style={styles.label}>阅读主题</Text>
          <View style={styles.themeRow}>
            {themes.map((theme) => (
              <ThemeOption
                active={props.preferences.theme === theme.key}
                key={theme.key}
                onPress={() => props.onChange({ theme: theme.key })}
                theme={theme}
              />
            ))}
          </View>
          <FontPicker
            value={props.preferences.fontFamily}
            onChange={(fontFamily) => props.onChange({ fontFamily })}
          />
          <Divider />
          <StepperRow
            title="字号"
            value={String(props.preferences.fontSize)}
            onMinus={() => props.onChange({ fontSize: Math.max(15, props.preferences.fontSize - 1) })}
            onPlus={() => props.onChange({ fontSize: Math.min(30, props.preferences.fontSize + 1) })}
          />
          <StepperRow
            title="行距"
            value={props.preferences.lineHeight.toFixed(1)}
            onMinus={() => props.onChange({
              lineHeight: Math.max(1.4, +(props.preferences.lineHeight - 0.1).toFixed(1)),
            })}
            onPlus={() => props.onChange({
              lineHeight: Math.min(2.4, +(props.preferences.lineHeight + 0.1).toFixed(1)),
            })}
          />
          <StepperRow
            title="段落间距"
            value={String(props.preferences.paragraphSpacing)}
            onMinus={() => props.onChange({
              paragraphSpacing: Math.max(6, props.preferences.paragraphSpacing - 2),
            })}
            onPlus={() => props.onChange({
              paragraphSpacing: Math.min(30, props.preferences.paragraphSpacing + 2),
            })}
          />
          <StepperRow
            last
            title="页边距"
            value={String(props.preferences.horizontalPadding)}
            onMinus={() => props.onChange({
              horizontalPadding: Math.max(16, props.preferences.horizontalPadding - 2),
            })}
            onPlus={() => props.onChange({
              horizontalPadding: Math.min(44, props.preferences.horizontalPadding + 2),
            })}
          />
        </Section>

        <Section title="排版与翻页">
          <SegmentRow<TextAlignment>
            title="文字对齐"
            value={props.preferences.textAlignment}
            options={[["justify", "两端对齐"], ["left", "左对齐"]]}
            onChange={(textAlignment) => props.onChange({ textAlignment })}
          />
          <SegmentRow<PageTurn>
            title="翻页动画"
            value={props.preferences.pageTurn}
            options={[["slide", "滑动"], ["cover", "覆盖"], ["none", "无动画"]]}
            onChange={(pageTurn) => props.onChange({ pageTurn })}
          />
          <SwitchRow
            icon="hand-left-outline"
            title="点击屏幕翻页"
            description="点击左右区域前后翻页"
            value={props.preferences.tapToTurn}
            onChange={(tapToTurn) => props.onChange({ tapToTurn })}
          />
          <SwitchRow
            icon="volume-medium-outline"
            title="音量键翻页"
            description="兼容支持音量键控制的设备"
            value={props.preferences.volumeKeys}
            onChange={props.onVolumeKeysChange}
          />
          <SwitchRow
            last
            icon="analytics-outline"
            title="显示阅读进度"
            description="显示页码与百分比"
            value={props.preferences.showProgress}
            onChange={(showProgress) => props.onChange({ showProgress })}
          />
        </Section>

        <Section title="屏幕与光">
          <SegmentRow<ReaderOrientation>
            title="屏幕方向"
            value={props.preferences.orientation}
            options={[["auto", "自动"], ["portrait", "竖屏"], ["landscape", "横屏"]]}
            onChange={(orientation) => props.onChange({ orientation })}
          />
          <SwitchRow
            icon="sunny-outline"
            title="阅读时保持亮屏"
            description="阅读器打开时不自动锁屏"
            value={props.preferences.keepScreenAwake}
            onChange={(keepScreenAwake) => props.onChange({ keepScreenAwake })}
          />
          <SwitchRow
            icon="contrast-outline"
            title="跟随系统亮度"
            description="关闭后使用阅读器独立亮度"
            value={props.preferences.followSystemBrightness}
            onChange={(followSystemBrightness) => props.onChange({ followSystemBrightness })}
          />
          {!props.preferences.followSystemBrightness ? (
            <Animated.View
              layout={LinearTransition.duration(180)}
            >
              <StepperRow
                title="阅读亮度"
                description="仅影响当前应用"
                value={Math.round(props.preferences.brightness * 100) + "%"}
                onMinus={() => props.onChange({
                  brightness: Math.max(0.1, +(props.preferences.brightness - 0.05).toFixed(2)),
                })}
                onPlus={() => props.onChange({
                  brightness: Math.min(1, +(props.preferences.brightness + 0.05).toFixed(2)),
                })}
              />
            </Animated.View>
          ) : null}
          <SwitchRow
            last
            icon="scan-outline"
            title="沉浸阅读"
            description="打开书籍时默认隐藏工具栏"
            value={props.preferences.immersiveMode}
            onChange={(immersiveMode) => props.onChange({ immersiveMode })}
          />
        </Section>

        <Section title={"\u6bcf\u65e5\u4e00\u9875"}>
          <ReadingGoalRow
            goalMinutes={props.readingGoalMinutes}
            onChange={props.onReadingGoalChange}
            stats={props.readingStats}
          />
        </Section>

        <Section title="进度与提醒">
          <SwitchRow
            icon="save-outline"
            title="自动保存阅读进度"
            description="翻页后自动记录当前位置"
            value={props.preferences.autoSync}
            onChange={(autoSync) => props.onChange({ autoSync })}
          />
          <SwitchRow
            icon="notifications-outline"
            title="每日阅读提醒"
            description="每天在设定时间提醒你继续阅读"
            value={props.preferences.notifications}
            onChange={(notifications) => props.onChange({ notifications })}
          />
          {props.preferences.notifications ? (
            <Animated.View
              layout={LinearTransition.duration(180)}
            >
              <StepperRow
                last
                title="提醒时间"
                description="每天的提醒小时"
                value={
                  String(props.preferences.reminderHour).padStart(2, "0") +
                  ":" +
                  String(props.preferences.reminderMinute).padStart(2, "0")
                }
                onMinus={() => props.onChange({
                  reminderHour: (props.preferences.reminderHour + 23) % 24,
                })}
                onPlus={() => props.onChange({
                  reminderHour: (props.preferences.reminderHour + 1) % 24,
                })}
              />
            </Animated.View>
          ) : null}
        </Section>

        <Section title="藏书与数据">
          <ActionRow
            icon="wifi-outline"
            title="局域网传书"
            value="打开"
            onPress={props.onOpenLanTransfer}
          />
          <ActionRow
            icon="globe-outline"
            title="在线书源"
            value={props.sourceCount ? props.sourceCount + " 个" : "导入"}
            onPress={props.onManageSources}
          />
          <ActionRow
            icon="download-outline"
            title="离线书籍"
            value={props.importedBooks.length + " 本"}
            onPress={() => setLibraryVisible(true)}
          />
          <ActionRow
            icon="footsteps-outline"
            title="阅读足迹"
            value="查看"
            onPress={() => setInsightsVisible(true)}
          />
          <ActionRow
            icon="document-text-outline"
            title="导出批注"
            value="Markdown"
            onPress={() => void exportAnnotations()}
          />
          <ActionRow
            icon="archive-outline"
            title="备份书库"
            value={busy ? "处理中…" : "写出文件"}
            onPress={() => void exportBackup()}
          />
          <ActionRow
            icon="folder-open-outline"
            title="恢复书库"
            value="选择备份"
            onPress={restoreBackup}
          />
          <ActionRow
            icon="trash-outline"
            title="清理缓存"
            value={busy ? "处理中" : "立即清理"}
            onPress={() => void clearCache()}
          />
          <ActionRow
            icon="refresh-outline"
            title="清除阅读记录"
            value="重置位置"
            onPress={clearHistory}
          />
          <ActionRow
            icon="compass-outline"
            title="新手引导"
            value="重新查看"
            onPress={props.onOpenGuide}
          />
          <ActionRow
            icon="cloud-download-outline"
            title="系统更新"
            value={checkingUpdate ? "检查中…" : `v${CURRENT_APP_VERSION}`}
            onPress={() => void checkUpdate()}
          />
          <ActionRow
            last
            icon="information-circle-outline"
            title="关于墨读"
            value="v1.5.6"
            onPress={() => setAboutVisible(true)}
          />
        </Section>
      </ScrollView>

      <LibraryModal
        books={props.importedBooks}
        onClose={() => setLibraryVisible(false)}
        onDelete={props.onDeleteBook}
        visible={libraryVisible}
      />
      <UpdateModal
        onClose={() => setUpdateVisible(false)}
        onDownload={() => void openUpdateDownload()}
        result={updateResult}
        visible={updateVisible}
      />
      <ReadingInsightsModal
        books={props.books}
        onClose={() => setInsightsVisible(false)}
        stats={props.readingStats}
        visible={insightsVisible}
      />
      <AboutModal visible={aboutVisible} onClose={() => setAboutVisible(false)} />
    </SafeAreaView>
  );
}

function ReadingGoalRow({
  goalMinutes,
  onChange,
  stats,
}: {
  goalMinutes: number;
  onChange: (minutes: number) => void;
  stats: ReadingStats;
}) {
  const { resolvedLanguage, t } = useI18n();
  const summary = summarizeReadingStats(stats);
  const todayMinutes = Math.floor(summary.todayMs / 60000);
  const ratio = Math.max(0, Math.min(1, summary.todayMs / (goalMinutes * 60000)));
  const achieved = ratio >= 1;
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(ratio);

  useEffect(() => {
    progress.value = withTiming(ratio, { duration: 420 });
  }, [progress, ratio]);

  const fillStyle = useAnimatedStyle(() => ({
    width: trackWidth * progress.value,
  }));
  const progressDescription = achieved
    ? t("\u4eca\u65e5\u7684\u4e66\u9875\u5df2\u7ecf\u5706\u6ee1")
    : resolvedLanguage === "en"
      ? "Today " + todayMinutes + " / " + goalMinutes + " min"
      : "\u4eca\u65e5\u5df2\u8bfb " + todayMinutes + " / " + goalMinutes + " \u5206\u949f";

  return (
    <View style={[styles.goalRow, styles.last]}>
      <View style={styles.goalHeading}>
        <View style={[styles.rowIcon, achieved && styles.goalIconAchieved]}>
          <Ionicons
            color={achieved ? "#F6EFE2" : "#527261"}
            name={achieved ? "checkmark" : "hourglass-outline"}
            size={19}
          />
        </View>
        <View style={styles.goalCopy}>
          <Text style={styles.rowTitle}>{t("\u6bcf\u65e5\u9605\u8bfb\u76ee\u6807")}</Text>
          <Text style={styles.rowDescription}>{progressDescription}</Text>
        </View>
        <View style={styles.goalStepper}>
          <StepButton icon="remove" onPress={() => onChange(goalMinutes - 5)} />
          <Text style={styles.goalValue}>{goalMinutes}</Text>
          <StepButton icon="add" onPress={() => onChange(goalMinutes + 5)} />
        </View>
      </View>
      <View
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        style={styles.goalTrack}
      >
        <Animated.View style={[styles.goalFill, achieved && styles.goalFillAchieved, fillStyle]} />
      </View>
      <View style={styles.goalFooter}>
        <Text style={styles.goalFootnote}>
          {t("\u6bcf\u5929\u7559\u4e00\u6bb5\u65f6\u95f4\uff0c\u4e0e\u5b57\u53e5\u5b89\u9759\u76f8\u5904")}
        </Text>
        <Text style={styles.goalPercent}>{Math.round(ratio * 100)}%</Text>
      </View>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      <Animated.View layout={LinearTransition.duration(180)} style={styles.card}>
        {children}
      </Animated.View>
    </>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function ThemeOption({
  theme,
  active,
  onPress,
}: {
  theme: (typeof themes)[number];
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(active ? 1 : 0, { damping: 17, stiffness: 250, mass: 0.55 });
  }, [active, progress]);
  const ringStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], ["#00000000", "#6E8D7D"]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.94, 1]) }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], ["#999289", "#446454"]),
  }));
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={styles.themeItem}>
      <Animated.View style={[styles.themeOuter, ringStyle]}>
        <View style={[
          styles.themeSwatch,
          { backgroundColor: theme.color, borderColor: theme.key === "white" ? "#D8D4CC" : theme.color },
        ]}>
          {active ? <Ionicons name="checkmark" size={17} color={theme.key === "night" ? "#FFF" : "#315D4B"} /> : null}
        </View>
      </Animated.View>
      <Animated.Text style={[styles.themeLabel, labelStyle]}>{t(theme.label)}</Animated.Text>
    </Pressable>
  );
}

function FontPicker({
  value,
  onChange,
}: {
  value: ReaderFont;
  onChange: (font: ReaderFont) => void;
}) {
  return (
    <View style={styles.fontPicker}>
      <Text style={styles.label}>正文字体</Text>
      <View style={styles.fontOptions}>
        {readerFontOptions.map((option) => (
          <FontOption
            active={value === option.key}
            key={option.key}
            onPress={() => onChange(option.key)}
            option={option}
          />
        ))}
      </View>
    </View>
  );
}

function FontOption({
  option,
  active,
  onPress,
}: {
  option: (typeof readerFontOptions)[number];
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const progress = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(active ? 1 : 0, { damping: 17, stiffness: 250, mass: 0.55 });
  }, [active, progress]);
  const optionStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["#F0ECE5", "#E4ECE6"]),
    borderColor: interpolateColor(progress.value, [0, 1], ["#DDD8CF", "#6E8D7D"]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.98, 1]) }],
  }));
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={onPress} style={styles.fontOptionHit}>
      <Animated.View style={[styles.fontOption, optionStyle]}>
        <Animated.Text style={[styles.fontSample, { fontFamily: getReaderFontFamily(option.key) }]}>{t(option.sample)}</Animated.Text>
        <Text style={[styles.fontLabel, active && styles.fontLabelActive]}>{t(option.label)}</Text>
        {active ? <Ionicons color="#4D705E" name="checkmark-circle" size={16} style={styles.fontCheck} /> : null}
      </Animated.View>
    </Pressable>
  );
}
function StepperRow({
  title,
  description,
  value,
  onMinus,
  onPlus,
  last,
}: {
  title: string;
  description?: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  last?: boolean;
}) {
  const previousValue = useRef(value);
  const valueProgress = useSharedValue(0);
  useEffect(() => {
    if (previousValue.current !== value) {
      previousValue.current = value;
      valueProgress.value = withSequence(
        withTiming(-1, { duration: 55, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [value, valueProgress]);
  const valueStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: valueProgress.value * 2 },
      { scale: interpolate(Math.abs(valueProgress.value), [0, 1], [1, 0.97]) },
    ],
  }));
  return (
    <View style={[styles.row, styles.stepperRow, last && styles.last]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {description ? <Text style={styles.rowDescription}>{description}</Text> : null}
      </View>
      <View style={styles.stepper}>
        <StepButton icon="remove" onPress={onMinus} />
        <Animated.Text style={[styles.stepValue, valueStyle]}>{value}</Animated.Text>
        <StepButton icon="add" onPress={onPlus} />
      </View>
    </View>
  );
}

function StepButton({
  icon,
  onPress,
}: {
  icon: "add" | "remove";
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => { scale.value = withTiming(0.9, { duration: 80 }); }}
      onPressOut={() => { scale.value = withTiming(1, { duration: 120 }); }}
      style={styles.stepButton}
    >
      <Animated.View style={animated}>
        <Ionicons name={icon} size={16} color="#587064" />
      </Animated.View>
    </Pressable>
  );
}

function SegmentRow<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: Array<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex(([key]) => key === value));
  const position = useSharedValue(index);
  useEffect(() => {
    position.value = withTiming(index, { duration: 230, easing: Easing.out(Easing.cubic) });
  }, [index, position]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * (width / options.length) }],
  }));
  return (
    <View style={styles.segmentRow}>
      <Text style={styles.label}>{title}</Text>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width - 6)}
        style={styles.segmented}
      >
        <Animated.View
          style={[
            styles.segmentIndicator,
            { width: width ? width / options.length : 0 },
            indicatorStyle,
          ]}
        />
        {options.map(([key, label]) => (
          <Pressable key={key} onPress={() => onChange(key)} style={styles.segment}>
            <Text style={[styles.segmentText, value === key && styles.segmentTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SwitchRow({
  icon,
  title,
  description,
  value,
  onChange,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.last]}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={19} color="#4C695B" /></View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <SmoothSwitch value={value} onChange={() => onChange(!value)} />
    </View>
  );
}

function SmoothSwitch({ value, onChange }: { value: boolean; onChange: () => void }) {
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 210, easing: Easing.out(Easing.cubic) });
  }, [progress, value]);
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ["#D7D3CB", "#759786"]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [3, 23]) },
      { scale: interpolate(progress.value, [0, 0.5, 1], [1, 0.97, 1]) },
    ],
  }));
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onChange} style={styles.switchHit}>
      <Animated.View style={[styles.switchTrack, trackStyle]}>
        <Animated.View style={[styles.switchThumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

function ActionRow({
  icon,
  title,
  value,
  onPress,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  value: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.actionRow,
      last && styles.last,
      pressed && styles.pressed,
    ]}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={19} color="#4C695B" /></View>
      <Text style={[styles.rowTitle, styles.actionTitle]}>{title}</Text>
      <Text style={styles.actionValue}>{value}</Text>
      <Ionicons name="chevron-forward" size={16} color="#BBB5AC" />
    </Pressable>
  );
}

function LibraryModal({
  visible,
  books,
  onClose,
  onDelete,
}: {
  visible: boolean;
  books: Book[];
  onClose: () => void;
  onDelete: (book: Book) => void;
}) {
  const Alert = useAppAlert();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>离线书籍</Text>
              <Text style={styles.modalSubtitle}>管理已导入的 EPUB 与 PDF</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={20} color="#44443F" />
            </Pressable>
          </View>
          <ScrollView>
            {!books.length ? (
              <View style={styles.empty}>
                <Ionicons name="folder-open-outline" size={36} color="#B0A99E" />
                <Text style={styles.emptyText}>还没有导入本地书籍</Text>
              </View>
            ) : books.map((book) => (
              <View key={book.id} style={styles.bookRow}>
                <View style={styles.fileBadge}>
                  <Text style={styles.fileBadgeText}>{book.format.toUpperCase()}</Text>
                </View>
                <View style={styles.fileText}>
                  <Text style={styles.fileTitle} numberOfLines={1}>{book.title}</Text>
                  <Text style={styles.fileMeta}>{book.author}</Text>
                </View>
                <Pressable
                  onPress={() => Alert.alert("删除书籍", "确定删除《" + book.title + "》吗？", [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => onDelete(book) },
                  ])}
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={18} color="#A45E58" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function UpdateModal({
  visible,
  result,
  onClose,
  onDownload,
}: {
  visible: boolean;
  result?: AppUpdateResult;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { resolvedLanguage } = useI18n();
  if (!result) return null;
  const available = result.status === "available";
  const published = result.update.publishedAt
    ? new Date(result.update.publishedAt).toLocaleDateString(
        resolvedLanguage === "zh-CN" ? "zh-CN" : "en-US",
        { year: "numeric", month: "short", day: "numeric" },
      )
    : undefined;
  const size = result.update.downloadSize
    ? `${(result.update.downloadSize / 1024 / 1024).toFixed(1)} MB`
    : undefined;

  return (
    <IOSPopupModal onRequestClose={onClose} visible={visible}>
      <View style={styles.updateCard}>
        <View style={[styles.updateIcon, !available && styles.updateIconCurrent]}>
          <Ionicons
            color={available ? "#F3DFC0" : "#496455"}
            name={available ? "cloud-download-outline" : "checkmark-outline"}
            size={30}
          />
        </View>
        <Text style={styles.updateEyebrow}>{available ? "NEW RELEASE" : "UP TO DATE"}</Text>
        <Text style={styles.updateTitle}>{available ? "发现新版本" : "已是最新版"}</Text>
        <Text style={styles.updateVersion}>
          {available
            ? `v${CURRENT_APP_VERSION}  →  v${result.update.version}`
            : `${resolvedLanguage === "zh-CN" ? "墨读" : "Modu"} v${CURRENT_APP_VERSION}`}
        </Text>
        {available ? (
          <>
            <View style={styles.updateMetaRow}>
              {published ? <Text style={styles.updateMeta}>{published}</Text> : null}
              {size ? <Text style={styles.updateMeta}>{size}</Text> : null}
              {result.update.downloadName ? (
                <Text numberOfLines={1} style={styles.updateMeta}>{result.update.downloadName}</Text>
              ) : null}
            </View>
            <ScrollView
              contentContainerStyle={styles.updateNotesContent}
              showsVerticalScrollIndicator={false}
              style={styles.updateNotes}
            >
              <Text style={styles.updateNotesText}>{result.update.notes}</Text>
            </ScrollView>
            <Pressable onPress={onDownload} style={styles.updatePrimaryButton}>
              <Ionicons color="#FFF9EE" name="download-outline" size={17} />
              <Text style={styles.updatePrimaryText}>前往下载</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.updateSecondaryButton}>
              <Text style={styles.updateSecondaryText}>稍后再说</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.updateCurrentText}>你正在使用 GitHub Releases 上的最新稳定版本。</Text>
            <Pressable onPress={onClose} style={styles.updatePrimaryButton}>
              <Text style={styles.updatePrimaryText}>知道了</Text>
            </Pressable>
          </>
        )}
      </View>
    </IOSPopupModal>
  );
}

function AboutModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <IOSPopupModal
      onRequestClose={onClose}
      visible={visible}
    >
        <View style={styles.aboutCard}>
          <View style={styles.aboutLogo}><Text style={styles.aboutLogoText}>墨</Text></View>
          <Text style={styles.aboutTitle}>墨读 1.5.6</Text>
          <Text style={styles.aboutText}>
            愿每一次翻页，都像灯下展开的一封信。墨读替你收好本地与远方的书，也记住每一次停笔，让文字安静抵达，让片刻闲暇有处停泊。
          </Text>
          <Pressable onPress={onClose} style={styles.aboutButton}>
            <Text style={styles.aboutButtonText}>知道了</Text>
          </Pressable>
        </View>
    </IOSPopupModal>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: "#F4F1EA", flex: 1 },
  content: { alignSelf: "center", maxWidth: 720, paddingBottom: 132, paddingHorizontal: 20, paddingTop: 14, width: "100%" },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  eyebrow: { color: "#8B8A82", fontSize: 8, fontWeight: "900", letterSpacing: 1.8 },
  heading: { color: "#292D28", fontFamily: "serif", fontSize: 29, fontWeight: "800" },
  seal: {
    alignItems: "center",
    backgroundColor: "#3E5E4E",
    borderRadius: 16,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sealText: { color: "#F3DFC0", fontFamily: "serif", fontSize: 20, fontWeight: "900" },
  profile: {
    alignItems: "center",
    backgroundColor: "#344F42",
    borderRadius: 22,
    flexDirection: "row",
    marginTop: 17,
    padding: 15,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "#FFFFFF18",
    borderRadius: 16,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  profileText: { flex: 1, marginLeft: 12 },
  profileName: { color: "#F4F0E7", fontSize: 14, fontWeight: "900" },
  sectionHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 9,
    marginTop: 24,
    paddingHorizontal: 3,
  },
  sectionTitle: { color: "#3C403B", fontSize: 15, fontWeight: "900" },
  sectionSubtitle: { color: "#9A958D", fontSize: 8.5 },
  card: {
    backgroundColor: "#FBF9F4",
    borderColor: "#DEDAD1",
    borderRadius: 22,
    borderWidth: 1,
    elevation: 1,
    overflow: "hidden",
    paddingHorizontal: 14,
    shadowColor: "#26372E",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  label: { color: "#4B4D48", fontSize: 11, fontWeight: "800", marginTop: 14 },
  themeRow: { flexDirection: "row", justifyContent: "space-between", paddingBottom: 14, paddingTop: 10 },
  themeItem: { alignItems: "center", flex: 1 },
  themeOuter: { borderRadius: 18, borderWidth: 2, padding: 3 },
  themeSwatch: {
    alignItems: "center",
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  themeLabel: { fontSize: 9.5, fontWeight: "700", marginTop: 6 },
  fontPicker: { paddingBottom: 14 },
  fontOptions: { flexDirection: "row", gap: 8, paddingTop: 9 },
  fontOptionHit: { flex: 1 },
  fontOption: {
    alignItems: "center",
    borderRadius: 15,
    borderWidth: 1,
    minHeight: 70,
    overflow: "hidden",
    paddingHorizontal: 5,
    paddingVertical: 10,
  },
  fontSample: { color: "#34463D", fontSize: 16 },
  fontLabel: { color: "#89867F", fontSize: 9, fontWeight: "700", marginTop: 7 },
  goalRow: { minHeight: 126, paddingVertical: 15 },
  goalHeading: { alignItems: "center", flexDirection: "row" },
  goalIconAchieved: { backgroundColor: "#416451" },
  goalCopy: { flex: 1, marginLeft: 11, minWidth: 0 },
  goalStepper: { alignItems: "center", backgroundColor: "#EAF0EC", borderRadius: 13, flexDirection: "row", height: 38 },
  goalValue: { color: "#334B3F", fontSize: 11, fontWeight: "900", minWidth: 28, textAlign: "center" },
  goalTrack: { backgroundColor: "#DFE4DF", borderRadius: 5, height: 7, marginTop: 14, overflow: "hidden" },
  goalFill: { backgroundColor: "#789486", borderRadius: 5, height: 7 },
  goalFillAchieved: { backgroundColor: "#416451" },
  goalFooter: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  goalFootnote: { color: "#9B968E", flex: 1, fontSize: 8.5 },
  goalPercent: { color: "#577064", fontSize: 9, fontWeight: "900", marginLeft: 8 },
  fontLabelActive: { color: "#486756" },
  fontCheck: { position: "absolute", right: 5, top: 5 },
  divider: { backgroundColor: "#DED9D0", height: 1 },
  row: {
    alignItems: "center",
    borderBottomColor: "#E5E0D8",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 67,
  },
  stepperRow: { minHeight: 58 },
  last: { borderBottomWidth: 0 },
  rowIcon: {
    alignItems: "center",
    backgroundColor: "#E9F0EB",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  rowText: { flex: 1, marginLeft: 11 },
  rowTitle: { color: "#3B3E39", fontSize: 12.5, fontWeight: "800" },
  rowDescription: { color: "#9B968E", fontSize: 9.5, marginTop: 4 },
  stepper: {
    alignItems: "center",
    backgroundColor: "#EAF0EC",
    borderRadius: 13,
    flexDirection: "row",
    height: 38,
  },
  stepButton: { alignItems: "center", height: 38, justifyContent: "center", width: 34 },
  stepValue: { color: "#334B3F", fontSize: 11.5, fontWeight: "900", minWidth: 42, textAlign: "center" },
  segmentRow: { paddingBottom: 14 },
  segmented: {
    backgroundColor: "#EEEAE3",
    borderRadius: 13,
    flexDirection: "row",
    height: 40,
    marginTop: 9,
    overflow: "hidden",
    padding: 3,
  },
  segmentIndicator: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    bottom: 3,
    elevation: 2,
    left: 3,
    position: "absolute",
    top: 3,
  },
  segment: { alignItems: "center", flex: 1, justifyContent: "center", zIndex: 1 },
  segmentText: { color: "#969087", fontSize: 10, fontWeight: "600" },
  segmentTextActive: { color: "#496455", fontWeight: "900" },
  switchHit: { paddingVertical: 8 },
  switchTrack: { borderRadius: 14, height: 28, width: 48 },
  switchThumb: {
    backgroundColor: "#FFFFFF",
    borderRadius: 11,
    elevation: 3,
    height: 22,
    position: "absolute",
    top: 3,
    width: 22,
  },
  actionRow: {
    alignItems: "center",
    borderBottomColor: "#E5E0D8",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 61,
  },
  actionTitle: { flex: 1, marginLeft: 11 },
  actionValue: { color: "#938E86", fontSize: 11, marginRight: 4 },
  pressed: { opacity: 0.55 },
  modalBackdrop: { backgroundColor: "#00000055", flex: 1, justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#F8F5EE",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "76%",
    minHeight: 360,
    padding: 20,
  },
  modalHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  modalTitle: { color: "#31322E", fontSize: 22, fontWeight: "900" },
  modalSubtitle: { color: "#989187", fontSize: 10, marginTop: 3 },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#EAE6DD",
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 230 },
  emptyText: { color: "#999187", fontSize: 12, marginTop: 10 },
  bookRow: {
    alignItems: "center",
    borderBottomColor: "#E2DDD4",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 66,
  },
  fileBadge: {
    alignItems: "center",
    backgroundColor: "#385E4D",
    borderRadius: 13,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  fileBadgeText: { color: "#F2DFC0", fontSize: 8, fontWeight: "900" },
  fileText: { flex: 1, marginLeft: 11 },
  fileTitle: { color: "#363732", fontSize: 13, fontWeight: "800" },
  fileMeta: { color: "#999187", fontSize: 9.5, marginTop: 3 },
  deleteButton: {
    alignItems: "center",
    backgroundColor: "#F1E4E1",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  updateCard: {
    alignItems: "center",
    backgroundColor: "#FCFAF6",
    borderRadius: 25,
    padding: 24,
    width: "100%",
  },
  updateIcon: {
    alignItems: "center",
    backgroundColor: "#315D4B",
    borderRadius: 20,
    height: 62,
    justifyContent: "center",
    width: 62,
  },
  updateIconCurrent: { backgroundColor: "#E7EFEA" },
  updateEyebrow: { color: "#789083", fontSize: 8, fontWeight: "900", letterSpacing: 1.8, marginTop: 14 },
  updateTitle: { color: "#353630", fontSize: 20, fontWeight: "900", marginTop: 5 },
  updateVersion: { color: "#496455", fontSize: 11, fontWeight: "800", marginTop: 7 },
  updateMetaRow: { flexDirection: "row", gap: 8, marginTop: 12, maxWidth: "100%" },
  updateMeta: {
    backgroundColor: "#EDF1ED",
    borderRadius: 9,
    color: "#788078",
    flexShrink: 1,
    fontSize: 8.5,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  updateNotes: {
    alignSelf: "stretch",
    backgroundColor: "#F4F1EA",
    borderRadius: 16,
    marginTop: 14,
    maxHeight: 180,
  },
  updateNotesContent: { padding: 14 },
  updateNotesText: { color: "#6F716B", fontSize: 10.5, lineHeight: 18 },
  updateCurrentText: { color: "#817A70", fontSize: 11, lineHeight: 19, marginTop: 13, textAlign: "center" },
  updatePrimaryButton: {
    alignItems: "center",
    backgroundColor: "#315D4B",
    borderRadius: 14,
    flexDirection: "row",
    gap: 7,
    height: 46,
    justifyContent: "center",
    marginTop: 16,
    width: "100%",
  },
  updatePrimaryText: { color: "#FFF9EE", fontSize: 12, fontWeight: "800" },
  updateSecondaryButton: { alignItems: "center", height: 38, justifyContent: "center", marginTop: 3, width: "100%" },
  updateSecondaryText: { color: "#7F817A", fontSize: 10.5, fontWeight: "700" },
  aboutBackdrop: { alignItems: "center", backgroundColor: "#00000066", flex: 1, justifyContent: "center", padding: 30 },
  aboutCard: { alignItems: "center", backgroundColor: "#FCFAF6", borderRadius: 25, padding: 24, width: "100%" },
  aboutLogo: {
    alignItems: "center",
    backgroundColor: "#315D4B",
    borderRadius: 19,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  aboutLogoText: { color: "#F3DFC0", fontSize: 26, fontWeight: "900" },
  aboutTitle: { color: "#353630", fontSize: 18, fontWeight: "900", marginTop: 14 },
  aboutText: { color: "#817A70", fontSize: 11, lineHeight: 20, marginTop: 10, textAlign: "center" },
  aboutButton: {
    alignItems: "center",
    backgroundColor: "#315D4B",
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    marginTop: 20,
    width: "100%",
  },
  aboutButtonText: { color: "#FFF9EE", fontSize: 12, fontWeight: "800" },
});
