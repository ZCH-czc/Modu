import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text, useI18n } from "../i18n";

export type SpotlightStep = {
  key: string;
  target: RefObject<View | null>;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  placement?: "above" | "below" | "auto";
};

type SpotlightRect = { x: number; y: number; width: number; height: number };

type Props = {
  visible: boolean;
  steps: SpotlightStep[];
  onComplete: () => void;
};

const HOLE_PADDING = 8;

export function SpotlightTour({ visible, steps, onComplete }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect>();
  const cardMotion = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const step = steps[index];

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible || !step) return;
    let cancelled = false;
    setRect(undefined);
    const measure = (attempt = 0) => {
      requestAnimationFrame(() => {
        step.target.current?.measureInWindow((x, y, targetWidth, targetHeight) => {
          if (cancelled) return;
          if (targetWidth > 0 && targetHeight > 0) {
            setRect({ x, y, width: targetWidth, height: targetHeight });
            return;
          }
          if (attempt < 16) retryTimer.current = setTimeout(() => measure(attempt + 1), 80);
        });
        if (!step.target.current && attempt < 16) retryTimer.current = setTimeout(() => measure(attempt + 1), 80);
      });
    };
    measure();
    cardMotion.setValue(0);
    Animated.spring(cardMotion, { toValue: 1, damping: 18, stiffness: 210, mass: 0.8, useNativeDriver: true }).start();
    pulse.setValue(0);
    const pulseAnimation = Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    pulseAnimation.start();
    return () => {
      cancelled = true;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      pulseAnimation.stop();
    };
  }, [cardMotion, height, pulse, step, visible, width]);

  const geometry = useMemo(() => {
    if (!rect) return undefined;
    const hole = {
      x: Math.max(6, rect.x - HOLE_PADDING),
      y: Math.max(6, rect.y - HOLE_PADDING),
      width: Math.min(width - 12, rect.width + HOLE_PADDING * 2),
      height: Math.min(height - 12, rect.height + HOLE_PADDING * 2),
    };
    hole.width = Math.min(hole.width, width - hole.x - 6);
    hole.height = Math.min(hole.height, height - hole.y - 6);
    const cardWidth = Math.min(width - 32, 380);
    const estimatedCardHeight = 214;
    const belowTop = hole.y + hole.height + 16;
    const aboveTop = hole.y - estimatedCardHeight - 16;
    const wantsBelow = step.placement === "below" || (step.placement !== "above" && belowTop + estimatedCardHeight < height - insets.bottom - 12);
    const cardTop = wantsBelow
      ? Math.min(belowTop, height - insets.bottom - estimatedCardHeight - 12)
      : Math.max(insets.top + 54, aboveTop);
    const cardLeft = Math.max(16, Math.min(hole.x + hole.width / 2 - cardWidth / 2, width - cardWidth - 16));
    return { hole, cardWidth, cardTop, cardLeft };
  }, [height, insets.bottom, insets.top, rect, step?.placement, width]);

  if (!visible || !step || !geometry) return null;
  const { hole, cardWidth, cardTop, cardLeft } = geometry;
  const last = index === steps.length - 1;
  const next = () => last ? onComplete() : setIndex((current) => current + 1);

  return (
    <Modal animationType="none" onRequestClose={onComplete} statusBarTranslucent transparent visible>
      <View style={styles.root}>
        <Pressable onPress={() => undefined} style={[styles.shade, { left: 0, right: 0, top: 0, height: hole.y }]} />
        <Pressable onPress={() => undefined} style={[styles.shade, { left: 0, top: hole.y, width: hole.x, height: hole.height }]} />
        <Pressable onPress={() => undefined} style={[styles.shade, { left: hole.x + hole.width, right: 0, top: hole.y, height: hole.height }]} />
        <Pressable onPress={() => undefined} style={[styles.shade, { left: 0, right: 0, top: hole.y + hole.height, bottom: 0 }]} />
        <Animated.View pointerEvents="none" style={[styles.ring, hole, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }] }]} />
        <View pointerEvents="none" style={[styles.marker, { left: Math.max(12, hole.x - 7), top: Math.max(insets.top + 6, hole.y - 7) }]} />

        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <Text style={styles.counter}>{index + 1} / {steps.length}</Text>
          <Pressable accessibilityLabel={t("跳过场景引导")} onPress={onComplete} style={styles.skip}>
            <Text style={styles.skipText}>跳过</Text>
          </Pressable>
        </View>

        <Animated.View
          style={[
            styles.card,
            { left: cardLeft, top: cardTop, width: cardWidth, transform: [
              { translateY: cardMotion.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              { scale: cardMotion.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1] }) },
            ] },
          ]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.icon}><Ionicons color="#F7F2E8" name={step.icon} size={20} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.eyebrow}>LOOK HERE</Text>
              <Text style={styles.title}>{step.title}</Text>
            </View>
          </View>
          <Text style={styles.description}>{step.description}</Text>
          <View style={styles.actions}>
            {index > 0 ? (
              <Pressable onPress={() => setIndex((current) => current - 1)} style={styles.back}>
                <Ionicons color="#506359" name="chevron-back" size={18} />
              </Pressable>
            ) : <View />}
            <Pressable onPress={next} style={styles.next}>
              <Text style={styles.nextText}>{last ? "知道了" : "下一处"}</Text>
              <Ionicons color="#F7F2E8" name={last ? "checkmark" : "chevron-forward"} size={18} />
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shade: { backgroundColor: "rgba(18,24,21,0.68)", position: "absolute" },
  ring: { borderColor: "#E5D3A8", borderRadius: 22, borderWidth: 2, position: "absolute", shadowColor: "#F4DFC0", shadowOpacity: 0.65, shadowRadius: 12 },
  marker: { backgroundColor: "#E6CF9D", borderColor: "#FFF7E7", borderRadius: 8, borderWidth: 2, height: 15, position: "absolute", width: 15 },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", left: 16, position: "absolute", right: 16 },
  counter: { color: "#F4EEE3", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  skip: { backgroundColor: "rgba(248,245,238,0.92)", borderRadius: 15, paddingHorizontal: 15, paddingVertical: 9 },
  skipText: { color: "#51645A", fontSize: 12, fontWeight: "800" },
  card: { backgroundColor: "#F8F5EE", borderColor: "rgba(255,255,255,0.8)", borderRadius: 26, borderWidth: 1, padding: 19, position: "absolute", shadowColor: "#111713", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.24, shadowRadius: 22 },
  cardHeader: { alignItems: "center", flexDirection: "row" },
  icon: { alignItems: "center", backgroundColor: "#456A57", borderRadius: 18, height: 46, justifyContent: "center", width: 46 },
  cardCopy: { flex: 1, marginLeft: 13 },
  eyebrow: { color: "#89968E", fontSize: 8, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: "#29362F", fontSize: 20, fontWeight: "900", marginTop: 3 },
  description: { color: "#69736D", fontSize: 13, lineHeight: 21, marginTop: 14 },
  actions: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 17 },
  back: { alignItems: "center", backgroundColor: "#ECE9E1", borderRadius: 16, height: 44, justifyContent: "center", width: 50 },
  next: { alignItems: "center", backgroundColor: "#3F6652", borderRadius: 16, flexDirection: "row", gap: 4, height: 44, justifyContent: "center", minWidth: 116, paddingHorizontal: 17 },
  nextText: { color: "#F7F2E8", fontSize: 13, fontWeight: "800" },
});
