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
    title: "让书架只留下想读的书",
    text: "在书架里搜索、排序或切换紧凑列表，也可以为藏书改名、换封面，或移走已经读完的故事。",
    icon: "library-outline",
    image: require("../../assets/onboarding/library-organize.gif"),
    tips: ["调色盘支持双色渐变，也可以使用自己的图片", "删除藏书前会再次确认，不会误触消失"],
  },
  {
    key: "local-import",
    eyebrow: "LOCAL IMPORT",
    title: "把一本书安静地带进来",
    text: "EPUB、TXT 与 PDF 都可以直接导入。解析进度会写在眼前，完成一章就能先读，不必等整本书。",
    icon: "download-outline",
    image: require("../../assets/onboarding/local-import.gif"),
    tips: ["长篇 EPUB 与 TXT 会按需解析，减少等待和内存占用", "导入过程中不要重复选择同一个文件"],
  },
  {
    key: "book-sources",
    eyebrow: "BOOK SOURCES",
    title: "让远方的书源保持流动",
    text: "书源规则由你导入和更新。搜索到书后，可以按章节加入书架立即开读，也可以选择下载整本。",
    icon: "globe-outline",
    image: require("../../assets/onboarding/book-sources.gif"),
    tips: ["规则保存在本机，不会被写死在应用里", "来源失效时可在书源管理中更新或停用"],
  },
  {
    key: "nearby-transfer",
    eyebrow: "NEARBY TRANSFER",
    title: "隔着一张桌子，也能传来一本书",
    text: "在同一 Wi-Fi 下，用另一台设备打开墨读给出的地址，就能发送 EPUB、TXT 或 PDF。文件抵达前仍由你确认。",
    icon: "wifi-outline",
    image: require("../../assets/onboarding/nearby-transfer.gif"),
    tips: ["传书页面只在局域网内开放", "未确认的文件不会进入书架"],
  },  {
    key: "web-finder",
    eyebrow: "WEB FINDER",
    title: "先在网页里找到故事",
    text: "输入网址、书名或作者。访问记录会生成历史联想，常去的网站也可以收藏在首页。",
    icon: "search-outline",
    image: require("../../assets/onboarding/web-finder.gif"),
    tips: ["地址栏既能打开网址，也能搜索书名", "收藏网页不会自动把书加入书架"],
  },
  {
    key: "web-browser",
    eyebrow: "WEBVIEW",
    title: "把目录交给墨读",
    text: "遇到章节目录时，可以主动标记当前页面。墨读会重新识别章节，并把目录交给阅读模式。",
    icon: "compass-outline",
    image: require("../../assets/onboarding/web-browser.gif"),
    tips: ["工具栏提供前进、后退、历史与网页收藏", "目录标记适合识别不够标准的小说网站"],
  },
  {
    key: "web-reader",
    eyebrow: "WEB READER",
    title: "让网页变成书页",
    text: "阅读模式会整理正文并预排下一页。左右滑动翻页，轻点中央显示章节、外观和收藏工具。",
    icon: "book-outline",
    image: require("../../assets/onboarding/web-reader.gif"),
    tips: ["阅读与收藏是两个独立动作", "也可以在阅读外观里切换为上下滚动"],
  },
  {
    key: "local-reader",
    eyebrow: "LOCAL READER",
    title: "本地书，也顺着手指翻",
    text: "EPUB 与 TXT 会按章节懒加载并预排相邻页。轻点中央打开菜单，章节、搜索、书签与批注都在这里。",
    icon: "library-outline",
    image: require("../../assets/onboarding/local-reader.gif"),
    tips: ["左右滑动或点击两侧翻页", "长按正文可以划线并写下本地批注"],
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