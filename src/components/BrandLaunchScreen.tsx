import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

type Props = {
  onFinished: () => void;
};

export function BrandLaunchScreen({ onFinished }: Props) {
  const backdropOpacity = useRef(new Animated.Value(1)).current;
  const atmosphereOpacity = useRef(new Animated.Value(0)).current;
  const sealOpacity = useRef(new Animated.Value(0)).current;
  const sealScale = useRef(new Animated.Value(0.76)).current;
  const sealTurn = useRef(new Animated.Value(0)).current;
  const inkOpacity = useRef(new Animated.Value(0)).current;
  const readOpacity = useRef(new Animated.Value(0)).current;
  const inkY = useRef(new Animated.Value(18)).current;
  const readY = useRef(new Animated.Value(18)).current;
  const brushScale = useRef(new Animated.Value(0)).current;
  const subtitleOpacity = useRef(new Animated.Value(0)).current;
  const subtitleY = useRef(new Animated.Value(7)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    const rise = (opacity: Animated.Value, y: Animated.Value) =>
      Animated.parallel([
        Animated.timing(opacity, {
          duration: 220,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(y, {
          damping: 10,
          mass: 0.58,
          stiffness: 210,
          toValue: 0,
          useNativeDriver: true,
        }),
      ]);

    const floating = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          duration: 1300,
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    const animation = Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(atmosphereOpacity, {
          duration: 520,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(sealOpacity, {
          duration: 300,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.spring(sealScale, {
          damping: 13,
          mass: 0.72,
          stiffness: 170,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(sealTurn, {
          duration: 520,
          easing: Easing.out(Easing.back(1.2)),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
      Animated.stagger(105, [rise(inkOpacity, inkY), rise(readOpacity, readY)]),
      Animated.parallel([
        Animated.timing(brushScale, {
          duration: 420,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(subtitleOpacity, {
          delay: 90,
          duration: 360,
          easing: Easing.out(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(subtitleY, {
          delay: 90,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(720),
      Animated.timing(backdropOpacity, {
        duration: 360,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    floating.start();
    animation.start(({ finished }) => {
      if (active && finished) onFinished();
    });
    return () => {
      active = false;
      animation.stop();
      floating.stop();
    };
  }, [atmosphereOpacity, backdropOpacity, brushScale, drift, inkOpacity, inkY, onFinished, readOpacity, readY, sealOpacity, sealScale, sealTurn, subtitleOpacity, subtitleY]);

  const sealRotation = sealTurn.interpolate({
    inputRange: [0, 1],
    outputRange: ["-7deg", "0deg"],
  });
  const leafY = drift.interpolate({ inputRange: [0, 1], outputRange: [-3, 5] });
  const leafX = drift.interpolate({ inputRange: [0, 1], outputRange: [-2, 4] });

  return (
    <Animated.View pointerEvents="auto" style={[styles.root, { opacity: backdropOpacity }]}>
      <Animated.View pointerEvents="none" style={[styles.atmosphere, { opacity: atmosphereOpacity }]}>
        <View style={styles.paperMoon} />
        <View style={styles.inkWash} />
        <View style={styles.fineRing} />
        <Animated.View style={[styles.leaf, { transform: [{ translateX: leafX }, { translateY: leafY }, { rotate: "-34deg" }] }]} />
        <Animated.View style={[styles.mote, styles.moteOne, { transform: [{ translateY: leafY }] }]} />
        <Animated.View style={[styles.mote, styles.moteTwo, { transform: [{ translateX: leafX }] }]} />
      </Animated.View>

      <Text style={styles.eyebrow}>MODU · READER</Text>
      <Animated.View
        style={[
          styles.seal,
          {
            opacity: sealOpacity,
            transform: [{ scale: sealScale }, { rotate: sealRotation }],
          },
        ]}
      >
        <Text style={styles.sealText}>墨</Text>
        <View pointerEvents="none" style={styles.sealShine} />
      </Animated.View>

      <View style={styles.wordmark}>
        <Animated.Text style={[styles.word, { opacity: inkOpacity, transform: [{ translateY: inkY }] }]}>墨</Animated.Text>
        <Animated.Text style={[styles.word, { opacity: readOpacity, transform: [{ translateY: readY }] }]}>读</Animated.Text>
      </View>
      <Animated.View style={[styles.brush, { transform: [{ scaleX: brushScale }] }]} />
      <Animated.Text style={[styles.subtitle, { opacity: subtitleOpacity, transform: [{ translateY: subtitleY }] }]}>
        翻一页人间，留一寸静意
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
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 5000,
  },
  atmosphere: { ...StyleSheet.absoluteFill },
  paperMoon: {
    backgroundColor: "#E8EEE8",
    borderRadius: 190,
    height: 330,
    left: "50%",
    marginLeft: -165,
    marginTop: -190,
    opacity: 0.7,
    position: "absolute",
    top: "50%",
    width: 330,
  },
  inkWash: {
    backgroundColor: "#D9E3DC",
    borderRadius: 150,
    height: 205,
    left: "50%",
    marginLeft: -66,
    opacity: 0.34,
    position: "absolute",
    top: "28%",
    transform: [{ rotate: "-18deg" }],
    width: 115,
  },
  fineRing: {
    borderColor: "#B8C8BE",
    borderRadius: 178,
    borderWidth: 1,
    height: 356,
    left: "50%",
    marginLeft: -178,
    opacity: 0.34,
    position: "absolute",
    top: "26%",
    width: 356,
  },
  leaf: {
    borderColor: "#688473",
    borderRadius: 22,
    borderTopLeftRadius: 3,
    borderWidth: 1.4,
    height: 34,
    left: "50%",
    marginLeft: 108,
    opacity: 0.7,
    position: "absolute",
    top: "34%",
    width: 18,
  },
  mote: { backgroundColor: "#799080", borderRadius: 3, height: 4, opacity: 0.42, position: "absolute", width: 4 },
  moteOne: { left: "23%", top: "40%" },
  moteTwo: { bottom: "33%", right: "24%" },
  eyebrow: {
    color: "#8B978F",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 3.4,
    marginBottom: 17,
  },
  seal: {
    alignItems: "center",
    backgroundColor: "#3E5E4E",
    borderColor: "#EEDAB8",
    borderRadius: 31,
    borderWidth: 2,
    height: 104,
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#25382E",
    shadowOffset: { width: 0, height: 13 },
    shadowOpacity: 0.17,
    shadowRadius: 22,
    width: 104,
  },
  sealText: { color: "#F3DFC0", fontFamily: "serif", fontSize: 57, fontWeight: "900" },
  sealShine: { backgroundColor: "#FFFFFF22", height: 1, left: 18, position: "absolute", right: 18, top: 10 },
  wordmark: { flexDirection: "row", marginTop: 25 },
  word: { color: "#29483A", fontFamily: "serif", fontSize: 42, fontWeight: "900", letterSpacing: 4 },
  brush: { backgroundColor: "#698074", borderRadius: 2, height: 2, marginTop: 4, opacity: 0.58, width: 78 },
  subtitle: { color: "#747F78", fontFamily: "serif", fontSize: 13, letterSpacing: 2.6, marginTop: 15 },
});
