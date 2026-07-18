import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native";

type IOSPopupModalProps = {
  children: React.ReactNode;
  onDismiss?: () => void;
  onRequestClose: () => void;
  visible: boolean;
};

export function IOSPopupModal({
  children,
  onDismiss,
  onRequestClose,
  visible,
}: IOSPopupModalProps) {
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    progress.stopAnimation();
    if (visible) {
      if (!mounted) {
        setMounted(true);
        return;
      }
      progress.setValue(0);
      requestAnimationFrame(() => {
        Animated.spring(progress, {
          damping: 19,
          mass: 0.72,
          stiffness: 285,
          toValue: 1,
          useNativeDriver: true,
        }).start();
      });
      return;
    }
    if (!mounted) return;
    Animated.timing(progress, {
      duration: 145,
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      onDismissRef.current?.();
    });
  }, [mounted, progress, visible]);

  if (!mounted) return null;

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onRequestClose}
      statusBarTranslucent
      transparent
      visible
    >
      <Animated.View style={styles.backdrop}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.dim, { opacity: progress }]}
        />
        <Pressable onPress={onRequestClose} style={StyleSheet.absoluteFill} />
        <Animated.View
          renderToHardwareTextureAndroid
          style={[styles.motion, {
            transform: [
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.88, 1],
                }),
              },
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [14, 0],
                }),
              },
            ],
          }]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  motion: { alignItems: "center", width: "100%" },
  dim: { backgroundColor: "rgba(24, 31, 27, 0.48)" },
  backdrop: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
});