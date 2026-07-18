import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

type Props = {
  onFinished: () => void;
};

export function BrandLaunchScreen({ onFinished }: Props) {
  const backdropOpacity = useRef(new Animated.Value(1)).current;
  const sealOpacity = useRef(new Animated.Value(0)).current;
  const sealScale = useRef(new Animated.Value(0.82)).current;
  const inkY = useRef(new Animated.Value(22)).current;
  const readY = useRef(new Animated.Value(22)).current;
  const wordOpacity = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    let active = true;
    const bounce = (value: Animated.Value) =>
      Animated.sequence([
        Animated.spring(value, {
          damping: 11,
          mass: 0.55,
          stiffness: 250,
          toValue: -11,
          useNativeDriver: true,
        }),
        Animated.spring(value, {
          damping: 12,
          mass: 0.6,
          stiffness: 230,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]);

    const animation = Animated.sequence([
      Animated.delay(70),
      Animated.parallel([
        Animated.timing(sealOpacity, {
          duration: 260,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(sealScale, {
          damping: 14,
          mass: 0.72,
          stiffness: 190,
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(wordOpacity, {
          duration: 170,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.stagger(85, [bounce(inkY), bounce(readY)]),
      ]),
      Animated.parallel([
        Animated.timing(subtitleOpacity, {
          duration: 260,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(subtitleY, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(260),
      Animated.timing(backdropOpacity, {
        duration: 280,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (active && finished) onFinished();
    });
    return () => {
      active = false;
      animation.stop();
    };
  }, [backdropOpacity, inkY, onFinished, readY, sealOpacity, sealScale, subtitleOpacity, subtitleY, wordOpacity]);

  return (
    <Animated.View pointerEvents="auto" style={[styles.root, { opacity: backdropOpacity }]}>
      <View pointerEvents="none" style={styles.halo} />
      <Animated.View style={[styles.seal, { opacity: sealOpacity, transform: [{ scale: sealScale }] }]}>
        <Text style={styles.sealText}>墨</Text>
      </Animated.View>
      <Animated.View style={[styles.wordmark, { opacity: wordOpacity }]}>
        <Animated.Text style={[styles.word, { transform: [{ translateY: inkY }] }]}>墨</Animated.Text>
        <Animated.Text style={[styles.word, { transform: [{ translateY: readY }] }]}>读</Animated.Text>
      </Animated.View>
      <Animated.Text
        style={[
          styles.subtitle,
          { opacity: subtitleOpacity, transform: [{ translateY: subtitleY }] },
        ]}
      >
        让文字安静抵达
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: "#F7F4ED",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 5000,
  },
  halo: {
    backgroundColor: "#E7EDE7",
    borderRadius: 170,
    height: 290,
    opacity: 0.52,
    position: "absolute",
    transform: [{ translateY: -42 }],
    width: 290,
  },
  seal: {
    alignItems: "center",
    backgroundColor: "#3E5E4E",
    borderColor: "#F3DFC0",
    borderRadius: 34,
    borderWidth: 2,
    height: 116,
    justifyContent: "center",
    shadowColor: "#25382E",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    width: 116,
  },
  sealText: {
    color: "#F3DFC0",
    fontFamily: "serif",
    fontSize: 60,
    fontWeight: "900",
  },
  wordmark: {
    flexDirection: "row",
    marginTop: 28,
  },
  word: {
    color: "#29483A",
    fontFamily: "serif",
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 3,
  },
  subtitle: {
    color: "#7E877F",
    fontFamily: "serif",
    fontSize: 13,
    letterSpacing: 3.2,
    marginTop: 12,
  },
});