import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import type {
  Book,
  PageTurn,
  ReaderOrientation,
  ReaderPreferences,
  ReaderTheme,
  TextAlignment,
} from "../types";

interface Props {
  preferences: ReaderPreferences;
  importedBooks: Book[];
  sourceCount: number;
  onManageSources: () => void;
  onOpenGuide: () => void;
  onChange: (patch: Partial<ReaderPreferences>) => void;
  onVolumeKeysChange: (enabled: boolean) => void;
  onDeleteBook: (book: Book) => void;
  onClearCache: () => Promise<string>;
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
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [aboutVisible, setAboutVisible] = useState(false);
  const [busy, setBusy] = useState(false);

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

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>阅读偏好</Text>
            <Text style={styles.heading}>阅读设置</Text>
          </View>
          <View style={styles.seal}><Text style={styles.sealText}>墨</Text></View>
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Ionicons name="leaf-outline" size={24} color="#F3DFC0" />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>静心阅读者</Text>
          </View>
        </View>

        <Section title="阅读外观">
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

        <Section title="屏幕与设备">
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

        <Section title="书籍与数据">
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
            last
            icon="information-circle-outline"
            title="关于墨读"
            value="v1.5.0"
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
      <AboutModal visible={aboutVisible} onClose={() => setAboutVisible(false)} />
    </SafeAreaView>
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
      <Animated.Text style={[styles.themeLabel, labelStyle]}>{theme.label}</Animated.Text>
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

function AboutModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.aboutBackdrop}>
        <View style={styles.aboutCard}>
          <View style={styles.aboutLogo}><Text style={styles.aboutLogoText}>墨</Text></View>
          <Text style={styles.aboutTitle}>墨读 1.5.0</Text>
          <Text style={styles.aboutText}>
            愿每一次翻页，都像灯下展开的一封信。墨读替你收好本地与远方的书，也记住每一次停笔，让文字安静抵达，让片刻闲暇有处停泊。
          </Text>
          <Pressable onPress={onClose} style={styles.aboutButton}>
            <Text style={styles.aboutButtonText}>知道了</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
