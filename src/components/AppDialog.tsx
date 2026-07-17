import { Ionicons } from "@expo/vector-icons";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

export type AppAlertButton = {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void | Promise<void>;
};

type DialogState = {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
};

type DialogContextValue = {
  alert: (title: string, message?: string, buttons?: AppAlertButton[]) => void;
};

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>();

  const alert = useCallback(
    (title: string, message?: string, buttons?: AppAlertButton[]) => {
      Keyboard.dismiss();
      setDialog({
        id: Date.now(),
        title,
        message: sanitizeMessage(message),
        buttons: buttons?.length ? buttons : [{ text: "知道了" }],
      });
    },
    [],
  );

  const value = useMemo(() => ({ alert }), [alert]);
  const close = useCallback((button?: AppAlertButton) => {
    setDialog(undefined);
    if (button?.onPress) requestAnimationFrame(() => void button.onPress?.());
  }, []);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Modal
        animationType="fade"
        navigationBarTranslucent
        onRequestClose={() => close()}
        statusBarTranslucent
        transparent
        visible={Boolean(dialog)}
      >
        {dialog ? (
          <Animated.View entering={FadeIn.duration(150)} style={styles.backdrop}>
            <Pressable onPress={() => close()} style={StyleSheet.absoluteFill} />
            <Animated.View entering={FadeInDown.duration(220)} key={dialog.id} style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons color="#4E6D5D" name="leaf-outline" size={21} />
              </View>
              <Text style={styles.title}>{dialog.title}</Text>
              {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
              <View style={styles.actions}>
                {dialog.buttons.map((button, index) => {
                  const destructive = button.style === "destructive";
                  const primary = button.style !== "cancel" && index === dialog.buttons.length - 1;
                  return (
                    <Pressable
                      key={(button.text ?? "action") + index}
                      onPress={() => close(button)}
                      style={({ pressed }) => [
                        styles.button,
                        primary && styles.buttonPrimary,
                        destructive && styles.buttonDestructive,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.buttonText,
                          primary && styles.buttonTextPrimary,
                          destructive && styles.buttonTextDestructive,
                        ]}
                      >
                        {button.text ?? "确定"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          </Animated.View>
        ) : null}
      </Modal>
    </DialogContext.Provider>
  );
}

export function useAppAlert() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useAppAlert must be used inside AppDialogProvider");
  return context;
}

function sanitizeMessage(message?: string) {
  if (!message) return message;
  if (/CLEARTEXT|UnknownServiceException/i.test(message)) {
    return "这个书源仍在使用不安全的旧地址，请更新书源或切换其他书源。";
  }
  if (/java\.net\.|fetch failed|Network request failed/i.test(message)) {
    return "网络连接失败，请检查网络或稍后重试。";
  }
  return message.replace(/\s+at\s+[\s\S]*$/i, "").trim();
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(24, 31, 27, 0.48)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    backgroundColor: "#FAF8F2",
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 28,
    borderWidth: 1,
    elevation: 18,
    maxWidth: 420,
    padding: 22,
    shadowColor: "#17221C",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    width: "100%",
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: "#E9F0EB",
    borderRadius: 17,
    height: 42,
    justifyContent: "center",
    marginBottom: 16,
    width: 42,
  },
  title: { color: "#252A27", fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  message: { color: "#686B66", fontSize: 15, lineHeight: 23, marginTop: 10 },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 22 },
  button: {
    alignItems: "center",
    backgroundColor: "#ECE9E1",
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 84,
    paddingHorizontal: 18,
  },
  buttonPrimary: { backgroundColor: "#3D6653" },
  buttonDestructive: { backgroundColor: "#A75F58" },
  buttonPressed: { transform: [{ scale: 0.97 }] },
  buttonText: { color: "#5D625D", fontSize: 14, fontWeight: "700" },
  buttonTextPrimary: { color: "#F8F4EA" },
  buttonTextDestructive: { color: "#FFF7F4" },
});
