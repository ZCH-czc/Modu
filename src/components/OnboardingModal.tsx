import {
  Ionicons } from "@expo/vector-icons";
import { useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text } from "../i18n";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  visible: boolean;
  onComplete: () => void;
};

const pages = [
  {
    eyebrow: "WELCOME TO MODU",
    title: "把想读的，都放进来",
    text: "导入 EPUB 与 PDF，连接在线书源，或者直接从网页提取正文。书架会把本地与远方的文字收在一起。",
    icon: "library-outline" as const,
    tips: ["右上角“导入”添加本地书", "书源与网页寻书都在书架顶部"],
  },
  {
    eyebrow: "WEB READER",
    title: "网页，也可以像一本书",
    text: "在网页寻书中打开章节，点“阅读模式”即可净化正文。加入书架后，新章节与阅读位置会自动接着保存。",
    icon: "compass-outline" as const,
    tips: ["支持左右分页与上下滚动", "从书架重开会回到上次章节"],
  },
  {
    eyebrow: "READING",
    title: "翻页应该顺着手指",
    text: "左右滑动或点击屏幕两侧前后翻页，轻点中央呼出工具栏。章节、进度与阅读外观都在手边。",
    icon: "book-outline" as const,
    tips: ["左右：翻页", "中央：显示或隐藏工具栏"],
  },
  {
    eyebrow: "YOUR STYLE",
    title: "把阅读调成自己的样子",
    text: "主题、字号、行距、页边距、亮度与翻页方式都能调整。墨读会记住你的选择，并用于下一次阅读。",
    icon: "options-outline" as const,
    tips: ["夜间与护眼主题", "沉浸阅读与常亮控制"],
  },
  {
    eyebrow: "READY",
    title: "现在，安静地读下去",
    text: "阅读进度和网页收藏保存在本机。以后如果想再看一次说明，可在“设置 → 新手引导”重新打开。",
    icon: "leaf-outline" as const,
    tips: ["设置中可随时重看", "长按或移除按钮管理书架"],
  },
];

export function OnboardingModal({ visible, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const translate = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 32, 560);
  const page = pages[index];
  const last = index === pages.length - 1;

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    translate.setValue(0);
    opacity.setValue(1);
  }, [opacity, translate, visible]);

  const progress = useMemo(() => (index + 1) / pages.length, [index]);

  const move = (next: number) => {
    if (next < 0 || next >= pages.length || next === index) return;
    const direction = next > index ? 1 : -1;
    Animated.parallel([
      Animated.timing(translate, {
        toValue: direction * -24,
        duration: 120,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setIndex(next);
      translate.setValue(direction * 24);
      Animated.parallel([
        Animated.timing(translate, {
          toValue: 0,
          duration: 190,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 170,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  return (
    <Modal animationType="fade" onRequestClose={onComplete} statusBarTranslucent transparent visible={visible}>
      <SafeAreaView style={styles.backdrop}>
        <View style={[styles.card, { width: cardWidth }]}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={styles.topRow}>
            <Text style={styles.counter}>{String(index + 1).padStart(2, "0")} / {String(pages.length).padStart(2, "0")}</Text>
            <Pressable accessibilityLabel="跳过新手引导" onPress={onComplete} style={styles.skip}>
              <Text style={styles.skipText}>跳过</Text>
            </Pressable>
          </View>
          <Animated.View style={[styles.page, { opacity, transform: [{ translateX: translate }] }]}>
            <View style={styles.icon}><Ionicons color="#F2E5CF" name={page.icon} size={31} /></View>
            <Text style={styles.eyebrow}>{page.eyebrow}</Text>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.text}>{page.text}</Text>
            <View style={styles.tips}>
              {page.tips.map((tip) => (
                <View key={tip} style={styles.tipRow}>
                  <View style={styles.tipDot} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          </Animated.View>
          <View style={styles.footer}>
            <Pressable disabled={index === 0} onPress={() => move(index - 1)} style={[styles.back, index === 0 && styles.disabled]}>
              <Ionicons color="#53685C" name="chevron-back" size={19} />
              <Text style={styles.backText}>上一步</Text>
            </Pressable>
            <Pressable onPress={() => (last ? onComplete() : move(index + 1))} style={styles.next}>
              <Text style={styles.nextText}>{last ? "开始阅读" : "继续"}</Text>
              <Ionicons color="#F7F2E8" name={last ? "checkmark" : "chevron-forward"} size={19} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(24,31,27,0.48)", flex: 1, justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#F8F5EE", borderColor: "rgba(255,255,255,0.72)", borderRadius: 32, borderWidth: 1, minHeight: 590, overflow: "hidden", padding: 24 },
  progressTrack: { backgroundColor: "#E2DED5", height: 3, left: 0, position: "absolute", right: 0, top: 0 },
  progressFill: { backgroundColor: "#496B59", height: 3 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  counter: { color: "#8B8B83", fontSize: 10, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: 1.4 },
  skip: { alignItems: "center", backgroundColor: "#ECE9E1", borderRadius: 14, height: 38, justifyContent: "center", paddingHorizontal: 15 },
  skipText: { color: "#68736C", fontSize: 12, fontWeight: "700" },
  page: { flex: 1, paddingTop: 28 },
  icon: { alignItems: "center", backgroundColor: "#3E6250", borderRadius: 24, height: 68, justifyContent: "center", width: 68 },
  eyebrow: { color: "#708277", fontSize: 9, fontWeight: "900", letterSpacing: 2.2, marginTop: 27 },
  title: { color: "#28322C", fontFamily: "serif", fontSize: 30, fontWeight: "800", lineHeight: 40, marginTop: 9 },
  text: { color: "#747A75", fontSize: 14, lineHeight: 23, marginTop: 16 },
  tips: { backgroundColor: "#EEEBE3", borderRadius: 20, gap: 12, marginTop: 24, padding: 17 },
  tipRow: { alignItems: "center", flexDirection: "row" },
  tipDot: { backgroundColor: "#6D8D7B", borderRadius: 4, height: 7, marginRight: 10, width: 7 },
  tipText: { color: "#506158", flex: 1, fontSize: 12, lineHeight: 18 },
  footer: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 18 },
  back: { alignItems: "center", borderColor: "#D8D4CB", borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 3, height: 52, justifyContent: "center", width: 110 },
  backText: { color: "#53685C", fontSize: 13, fontWeight: "700" },
  next: { alignItems: "center", backgroundColor: "#3E6652", borderRadius: 18, flex: 1, flexDirection: "row", gap: 5, height: 52, justifyContent: "center" },
  nextText: { color: "#F7F2E8", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.28 },
});
