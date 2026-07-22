import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image as NativeImage,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "../i18n";

type Props = {
  visible: boolean;
  onComplete: () => void;
};

type GuidePage = {
  key: string;
  eyebrow: string;
  title: string;
  text: string;
  icon: keyof typeof Ionicons.glyphMap;
  image: number;
  tips: string[];
};

const pages: GuidePage[] = [
  {
    key: "library-organize",
    eyebrow: "YOUR LIBRARY",
    title: "让想读的故事，在这里落座",
    text: "搜索、排序、改名或换一幅封面；读完的故事，也可以轻轻移出书架，只留下仍想相逢的篇章。",
    icon: "library-outline",
    image: require("../../assets/onboarding/library-organize.gif"),
    tips: ["用两种颜色装点书封，也可以留下自己的图片", "移走藏书前会再次询问，不让故事因误触散失"],
  },
  {
    key: "local-import",
    eyebrow: "LOCAL IMPORT",
    title: "把枕边的书，安静带进墨读",
    text: "EPUB、TXT 与 PDF 都能直接导入。整理的进度写在眼前，完成一章便可先读，不必等候整本书。",
    icon: "download-outline",
    image: require("../../assets/onboarding/local-import.gif"),
    tips: ["长篇 EPUB 与 TXT 会按需展开，少一些等待，也少占一些内存", "导入尚未完成时，请勿重复选择同一个文件"],
  },
  {
    key: "book-sources",
    eyebrow: "BOOK SOURCES",
    title: "让远方的书，循着书源而来",
    text: "书源规则由你导入与更新。寻到一本书，可以从第一章立即开读，也可以等它完整落入书架。",
    icon: "globe-outline",
    image: require("../../assets/onboarding/book-sources.gif"),
    tips: ["规则只留在本机，也会随你的更新而生长", "某处书源沉寂时，可在管理页更新或停用"],
  },
  {
    key: "nearby-transfer",
    eyebrow: "NEARBY TRANSFER",
    title: "隔着一张桌子，也能传来一本书",
    text: "同在一片 Wi-Fi 下，另一台设备打开墨读给出的地址，便能送来 EPUB、TXT 或 PDF；书抵达书架前，仍要经过你的确认。",
    icon: "wifi-outline",
    image: require("../../assets/onboarding/nearby-transfer.gif"),
    tips: ["传书的小门，只向同一局域网里的设备打开", "没有得到确认的文件，不会悄悄落入书架"],
  },  {
    key: "web-finder",
    eyebrow: "WEB FINDER",
    title: "循着一个名字，去故事深处",
    text: "写下网址、书名或作者。墨读会记住来时的路，也把常去的故事入口留在首页。",
    icon: "search-outline",
    image: require("../../assets/onboarding/web-finder.gif"),
    tips: ["地址栏既能通往网址，也能循书名寻找", "收藏一处网页，不会自动把书收入书架"],
  },
  {
    key: "web-browser",
    eyebrow: "WEBVIEW",
    title: "让散落的章节，重新排成书页",
    text: "走到目录页时轻轻标记，墨读会沿着章节的线索重新辨认，再把完整目录交给阅读模式。",
    icon: "compass-outline",
    image: require("../../assets/onboarding/web-browser.gif"),
    tips: ["前进、后退、历史与网页收藏，都在下方工具栏", "遇到结构特别的网站，可用目录标记再试一次"],
  },
  {
    key: "web-reader",
    eyebrow: "WEB READER",
    title: "让网页褪去喧闹，只留下文字",
    text: "阅读模式会拂去页面的纷杂，并提前铺好下一页。左右翻动，轻点中央便可唤出章节、外观与收藏。",
    icon: "book-outline",
    image: require("../../assets/onboarding/web-reader.gif"),
    tips: ["只想读，或想收入书架，可以分别选择", "若更习惯长卷，也可切换为上下滚动"],
  },
  {
    key: "local-reader",
    eyebrow: "LOCAL READER",
    title: "指尖一动，书页便有了风",
    text: "EPUB 与 TXT 会按章节轻轻展开，并提前备好相邻书页。轻点中央，章节、搜索、书签与批注便来到手边。",
    icon: "library-outline",
    image: require("../../assets/onboarding/local-reader.gif"),
    tips: ["左右滑动，或轻点两侧翻过一页", "长按正文，可以划线，也可以留下一句批注"],
  },
];

export function OnboardingModal({ visible, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const cardProgress = useRef(new Animated.Value(0)).current;
  const pageTranslate = useRef(new Animated.Value(0)).current;
  const imageRefs = useRef<Array<Image | null>>([]);
  const closingRef = useRef(false);
  const { width, height } = useWindowDimensions();
  const page = pages[index];
  const last = index === pages.length - 1;
  const cardWidth = Math.min(width - 28, 620);
  const mediaHeight = Math.max(190, Math.min(height * 0.32, width >= 700 ? 300 : 248));
  const progress = useMemo(() => (index + 1) / pages.length, [index]);
  const shown = visible && assetsReady;
  const mountedIndexes = useMemo(() => new Set([index - 1, index, index + 1].filter((value) => value >= 0 && value < pages.length)), [index]);

  useEffect(() => {
    let active = true;
    const sources = pages.map((item) => NativeImage.resolveAssetSource(item.image).uri);
    void Image.prefetch(sources.slice(0, 3), "memory-disk").finally(() => {
      if (active) setAssetsReady(true);
    });
    void Image.prefetch(sources.slice(3), "disk").catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!shown) return;
    closingRef.current = false;
    setIndex(0);
    pageTranslate.setValue(0);
    cardProgress.setValue(0);
    const frame = requestAnimationFrame(() => {
      Animated.spring(cardProgress, {
        toValue: 1,
        damping: 22,
        stiffness: 250,
        mass: 0.82,
        useNativeDriver: true,
      }).start();
    });
    return () => cancelAnimationFrame(frame);
  }, [cardProgress, pageTranslate, shown]);

  useEffect(() => {
    if (!shown) return;
    const start = () => {
      imageRefs.current.forEach((ref) => {
        void ref?.startAnimating();
      });
    };
    const frame = requestAnimationFrame(start);
    const afterLoad = setTimeout(start, 100);
    const afterTransition = setTimeout(start, 360);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(afterLoad);
      clearTimeout(afterTransition);
    };
  }, [index, shown]);

  const dismiss = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(cardProgress, {
      toValue: 0,
      duration: 170,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onComplete());
  };

  const move = (next: number) => {
    if (next < 0 || next >= pages.length || next === index) return;
    const direction = next > index ? 1 : -1;
    Animated.timing(pageTranslate, {
      toValue: direction * -34,
      duration: 130,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setIndex(next);
      pageTranslate.setValue(direction * 34);
      Animated.timing(pageTranslate, {
        toValue: 0,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  };

  return (
    <Modal animationType="none" onRequestClose={dismiss} statusBarTranslucent transparent visible={shown}>
      <SafeAreaView style={styles.backdrop}>
        <Animated.View
          style={[
            styles.card,
            {
              maxHeight: height - 28,
              width: cardWidth,
              opacity: cardProgress,
              transform: [
                { translateY: cardProgress.interpolate({ inputRange: [0, 1], outputRange: [38, 0] }) },
                { scale: cardProgress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              ],
            },
          ]}
        >
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>

          <View style={styles.topRow}>
            <View style={styles.counterGroup}>
              <Text style={styles.counter}>{String(index + 1).padStart(2, "0")} / {String(pages.length).padStart(2, "0")}</Text>
              <Text style={styles.demoLabel}>动态演示</Text>
            </View>
            <Pressable accessibilityLabel="跳过新手引导" onPress={dismiss} style={styles.skip}>
              <Text style={styles.skipText}>跳过</Text>
            </Pressable>
          </View>

          <Animated.View style={[styles.page, { transform: [{ translateX: pageTranslate }] }]}>
            <View style={[styles.media, { height: mediaHeight }]}>
              {shown && pages
                .map((item, pageIndex) => ({ item, pageIndex }))
                .filter(({ pageIndex }) => mountedIndexes.has(pageIndex))
                .map(({ item, pageIndex }) => (
                <Image
                  key={item.key}
                  ref={(ref) => {
                    imageRefs.current[pageIndex] = ref;
                  }}
                  accessibilityIgnoresInvertColors
                  autoplay
                  contentFit="contain"
                  onDisplay={() => void imageRefs.current[pageIndex]?.startAnimating()}
                  source={item.image}
                  style={[styles.mediaImage, pageIndex !== index && styles.mediaImageHidden]}
                />
              ))}
            </View>

            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowBadge}>
                <Ionicons color="#F7F2E8" name={page.icon} size={16} />
              </View>
              <Text style={styles.eyebrow}>{page.eyebrow}</Text>
            </View>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.text}>{page.text}</Text>
            <View style={styles.tips}>
              {page.tips.map((tip) => (
                <View key={tip} style={styles.tipRow}>
                  <Ionicons color="#62806F" name="checkmark-circle" size={17} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          <View style={styles.footer}>
            <Pressable disabled={index === 0} onPress={() => move(index - 1)} style={[styles.back, index === 0 && styles.disabled]}>
              <Ionicons color="#53685C" name="chevron-back" size={20} />
              <Text style={styles.backText}>上一步</Text>
            </Pressable>
            <Pressable onPress={() => (last ? dismiss() : move(index + 1))} style={styles.next}>
              <Text style={styles.nextText}>{last ? "开始阅读" : "继续"}</Text>
              <Ionicons color="#F7F2E8" name={last ? "checkmark" : "chevron-forward"} size={20} />
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(24,31,27,0.54)", flex: 1, justifyContent: "center", padding: 14 },
  card: { backgroundColor: "#F8F5EE", borderColor: "rgba(255,255,255,0.78)", borderRadius: 30, borderWidth: 1, overflow: "hidden", padding: 20 },
  progressTrack: { backgroundColor: "#E2DED5", height: 3, left: 0, position: "absolute", right: 0, top: 0 },
  progressFill: { backgroundColor: "#496B59", height: 3 },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  counterGroup: { alignItems: "center", flexDirection: "row", gap: 9 },
  counter: { color: "#7A847D", fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: 1.2 },
  demoLabel: { color: "#8F968F", fontSize: 10, fontWeight: "700" },
  skip: { alignItems: "center", backgroundColor: "#ECE9E1", borderRadius: 14, height: 38, justifyContent: "center", paddingHorizontal: 15 },
  skipText: { color: "#596B61", fontSize: 13, fontWeight: "700" },
  page: { paddingTop: 16 },
  media: { backgroundColor: "#E6EDE7", borderRadius: 22, overflow: "hidden", position: "relative", width: "100%" },
  mediaImage: { bottom: 0, height: "100%", left: 0, position: "absolute", right: 0, top: 0, width: "100%" },
  mediaImageHidden: { opacity: 0 },
  mediaBadge: { alignItems: "center", backgroundColor: "#345C49", borderRadius: 18, bottom: 12, height: 42, justifyContent: "center", position: "absolute", right: 12, width: 42 },
  eyebrowRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 16 },
  eyebrowBadge: { alignItems: "center", backgroundColor: "#345C49", borderRadius: 10, height: 30, justifyContent: "center", width: 30 },
  eyebrow: { color: "#708277", fontSize: 9, fontWeight: "900", letterSpacing: 2.1 },
  title: { color: "#28322C", fontFamily: "serif", fontSize: 27, fontWeight: "800", lineHeight: 36, marginTop: 6 },
  text: { color: "#707872", fontSize: 14, lineHeight: 22, marginTop: 9 },
  tips: { gap: 8, marginTop: 13 },
  tipRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  tipText: { color: "#53645B", flex: 1, fontSize: 12, lineHeight: 18 },
  footer: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 18 },
  back: { alignItems: "center", borderColor: "#D8D4CB", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 2, height: 50, justifyContent: "center", width: 112 },
  backText: { color: "#53685C", fontSize: 13, fontWeight: "700" },
  next: { alignItems: "center", backgroundColor: "#3E6652", borderRadius: 17, flex: 1, flexDirection: "row", gap: 5, height: 50, justifyContent: "center" },
  nextText: { color: "#F7F2E8", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.25 },
});