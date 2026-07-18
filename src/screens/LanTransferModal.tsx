import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  NativeEventEmitter,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from "react-native";
import Animated, { SlideInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { IOSPopupModal } from "../components/IOSPopupModal";
import { Text } from "../i18n";

export type LanTransferRequest = {
  id: string;
  name: string;
  path: string;
  size: number;
};

type ServerInfo = { ip: string; port: number; url: string };
type NativeLanTransfer = {
  startServer: (port: number) => Promise<ServerInfo>;
  stopServer: () => Promise<void>;
  resolveTransfer: (id: string, accepted: boolean) => Promise<void>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onAccept: (request: LanTransferRequest) => Promise<void>;
};

const nativeTransfer = NativeModules.LanTransfer as NativeLanTransfer | undefined;
const SERVER_PORT = 8765;

export function LanTransferModal({ visible, onClose, onAccept }: Props) {
  const [server, setServer] = useState<ServerInfo>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [requests, setRequests] = useState<LanTransferRequest[]>([]);
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState<string>();
  const activeRequest = requests[0];
  const supported = Platform.OS === "android" && Boolean(nativeTransfer);

  useEffect(() => {
    if (!visible) return;
    setServer(undefined);
    setError(undefined);
    setRequests([]);
    setNotice(undefined);
    if (!supported || !nativeTransfer) {
      setError("当前安装包尚未包含局域网接收服务，请安装新的 development build。");
      return;
    }

    let active = true;
    setStarting(true);
    const emitter = new NativeEventEmitter(nativeTransfer as never);
    const subscription = emitter.addListener("lanTransferRequest", (request: LanTransferRequest) => {
      if (!active) return;
      setRequests((current) => current.some((item) => item.id === request.id) ? current : [...current, request]);
    });
    nativeTransfer.startServer(SERVER_PORT)
      .then((info) => {
        if (!active) return;
        setServer(info);
        if (info.ip === "0.0.0.0") setError("没有找到可用的 Wi-Fi 地址，请确认设备已连接无线网络。");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "局域网接收服务启动失败。");
      })
      .finally(() => {
        if (active) setStarting(false);
      });

    return () => {
      active = false;
      subscription.remove();
      void nativeTransfer.stopServer().catch(() => undefined);
    };
  }, [supported, visible]);

  const address = server?.url;
  const addressHost = useMemo(() => address?.replace(/^https?:\/\//, ""), [address]);

  const rejectActive = async () => {
    if (!activeRequest || !nativeTransfer || resolving) return;
    setResolving(true);
    try {
      await nativeTransfer.resolveTransfer(activeRequest.id, false);
      setNotice(`已婉拒《${activeRequest.name}》`);
    } finally {
      setRequests((current) => current.filter((item) => item.id !== activeRequest.id));
      setResolving(false);
    }
  };

  const acceptActive = async () => {
    if (!activeRequest || !nativeTransfer || resolving) return;
    setResolving(true);
    try {
      await onAccept(activeRequest);
      await nativeTransfer.resolveTransfer(activeRequest.id, true);
      setNotice(`《${activeRequest.name}》已收入书架`);
      setRequests((current) => current.filter((item) => item.id !== activeRequest.id));
    } catch {
      await nativeTransfer.resolveTransfer(activeRequest.id, false).catch(() => undefined);
      setRequests((current) => current.filter((item) => item.id !== activeRequest.id));
    } finally {
      setResolving(false);
    }
  };

  return (
    <Modal animationType="none" navigationBarTranslucent onRequestClose={onClose} statusBarTranslucent visible={visible}>
      <Animated.View entering={SlideInDown.duration(260)} style={styles.root}>
        <SafeAreaView edges={["top", "bottom", "left", "right"]} style={styles.safe}>
          <View style={styles.header}>
            <View style={styles.brand}>
              <View style={styles.seal}><Text style={styles.sealText}>墨</Text></View>
              <View><Text style={styles.eyebrow}>MODU · NEARBY</Text><Text style={styles.title}>局域网传书</Text></View>
            </View>
            <Pressable accessibilityLabel="关闭局域网传书" onPress={onClose} style={styles.close}>
              <Ionicons color="#334039" name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <View style={styles.heroIcon}><Ionicons color="#F1DDBB" name="paper-plane-outline" size={27} /></View>
              <Text style={styles.heroTitle}>让故事越过一段无线电波</Text>
              <Text style={styles.heroText}>在同一个 Wi-Fi 下，用另一台设备打开下方地址，就能把书送到墨读。</Text>
            </View>

            <View style={styles.addressCard}>
              <Text style={styles.cardEyebrow}>在另一台设备的浏览器中打开</Text>
              {starting ? (
                <View style={styles.starting}><ActivityIndicator color="#4A6A59" /><Text style={styles.startingText}>正在点亮接收页面…</Text></View>
              ) : error ? (
                <View style={styles.errorRow}><Ionicons color="#A7655D" name="alert-circle-outline" size={20} /><Text style={styles.errorText}>{error}</Text></View>
              ) : (
                <>
                  <Text selectable style={styles.address}>{addressHost}</Text>
                  <Pressable onPress={() => address && void Share.share({ message: address })} style={styles.shareButton}>
                    <Ionicons color="#F8F3E9" name="share-outline" size={17} />
                    <Text style={styles.shareText}>分享地址</Text>
                  </Pressable>
                </>
              )}
            </View>

            <View style={styles.stepsCard}>
              <Step index="1" title="连接同一个 Wi-Fi" text="手机和发送设备需要彼此看得见" />
              <Step index="2" title="打开网页并选择书籍" text="支持 EPUB、TXT、PDF，单本不超过 25 MB" />
              <Step index="3" title="在墨读确认接收" text="未经你的同意，文件不会进入书架" last />
            </View>

            <View style={styles.statusCard}>
              <View style={styles.statusPulse} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>{requests.length ? `有 ${requests.length} 本书等待确认` : (notice || "正在聆听附近的书")}</Text>
                <Text style={styles.statusText}>此页面关闭后，局域网接收服务会立即停止</Text>
              </View>
              <Ionicons color="#799084" name="wifi-outline" size={23} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>

      <IOSPopupModal visible={Boolean(activeRequest)} onRequestClose={() => void rejectActive()}>
        {activeRequest ? (
          <View style={styles.requestCard}>
            <View style={styles.requestIcon}><Ionicons color="#466656" name="book-outline" size={25} /></View>
            <Text style={styles.requestEyebrow}>附近有一本书抵达</Text>
            <Text numberOfLines={2} style={styles.requestName}>{activeRequest.name}</Text>
            <Text style={styles.requestMeta}>{formatSize(activeRequest.size)} · 等待你的允许</Text>
            <View style={styles.requestActions}>
              <Pressable disabled={resolving} onPress={() => void rejectActive()} style={styles.rejectButton}><Text style={styles.rejectText}>婉拒</Text></Pressable>
              <Pressable disabled={resolving} onPress={() => void acceptActive()} style={styles.acceptButton}>
                {resolving ? <ActivityIndicator color="#F8F3E9" size="small" /> : <Text style={styles.acceptText}>收入书架</Text>}
              </Pressable>
            </View>
            <Text style={styles.requestSafety}>确认后才会解析并保存到本机</Text>
          </View>
        ) : null}
      </IOSPopupModal>
    </Modal>
  );
}

function Step({ index, title, text, last }: { index: string; title: string; text: string; last?: boolean }) {
  return (
    <View style={[styles.step, last && styles.stepLast]}>
      <View style={styles.stepIndex}><Text style={styles.stepIndexText}>{index}</Text></View>
      <View style={styles.stepCopy}><Text style={styles.stepTitle}>{title}</Text><Text style={styles.stepText}>{text}</Text></View>
    </View>
  );
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#F4F1EA", flex: 1 },
  safe: { flex: 1 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 13 },
  brand: { alignItems: "center", flexDirection: "row", gap: 12 },
  seal: { alignItems: "center", backgroundColor: "#3E5E4E", borderRadius: 15, height: 44, justifyContent: "center", width: 44 },
  sealText: { color: "#F3DFC0", fontFamily: "serif", fontSize: 21, fontWeight: "900" },
  eyebrow: { color: "#8B918B", fontSize: 8, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: "#29312C", fontFamily: "serif", fontSize: 22, fontWeight: "800", marginTop: 1 },
  close: { alignItems: "center", backgroundColor: "#E8E6DF", borderRadius: 16, height: 42, justifyContent: "center", width: 42 },
  content: { alignSelf: "center", maxWidth: 720, paddingBottom: 40, paddingHorizontal: 20, width: "100%" },
  hero: { alignItems: "center", paddingBottom: 25, paddingHorizontal: 20, paddingTop: 20 },
  heroIcon: { alignItems: "center", backgroundColor: "#416150", borderRadius: 22, height: 64, justifyContent: "center", width: 64 },
  heroTitle: { color: "#2F3A33", fontFamily: "serif", fontSize: 23, fontWeight: "800", marginTop: 18, textAlign: "center" },
  heroText: { color: "#888D87", fontSize: 12, lineHeight: 19, marginTop: 8, maxWidth: 430, textAlign: "center" },
  addressCard: { alignItems: "center", backgroundColor: "#FBF9F4", borderColor: "#DCD8CF", borderRadius: 24, borderWidth: 1, padding: 20 },
  cardEyebrow: { color: "#8B908A", fontSize: 10, fontWeight: "700" },
  address: { color: "#355545", fontSize: 23, fontWeight: "900", letterSpacing: 0.3, marginTop: 12 },
  starting: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 60 },
  startingText: { color: "#77827B", fontSize: 12 },
  errorRow: { alignItems: "center", flexDirection: "row", gap: 9, minHeight: 60 },
  errorText: { color: "#9A625B", flex: 1, fontSize: 11, lineHeight: 17 },
  shareButton: { alignItems: "center", backgroundColor: "#466756", borderRadius: 15, flexDirection: "row", gap: 7, marginTop: 15, minHeight: 44, paddingHorizontal: 18 },
  shareText: { color: "#F8F3E9", fontSize: 12, fontWeight: "800" },
  stepsCard: { backgroundColor: "#FBF9F4", borderColor: "#DCD8CF", borderRadius: 24, borderWidth: 1, marginTop: 14, paddingHorizontal: 17 },
  step: { alignItems: "center", borderBottomColor: "#E5E1D9", borderBottomWidth: 1, flexDirection: "row", minHeight: 72 },
  stepLast: { borderBottomWidth: 0 },
  stepIndex: { alignItems: "center", backgroundColor: "#E7EEE9", borderRadius: 11, height: 31, justifyContent: "center", width: 31 },
  stepIndexText: { color: "#466756", fontSize: 11, fontWeight: "900" },
  stepCopy: { flex: 1, marginLeft: 12 },
  stepTitle: { color: "#3A443E", fontSize: 12.5, fontWeight: "800" },
  stepText: { color: "#99958E", fontSize: 9.5, marginTop: 4 },
  statusCard: { alignItems: "center", backgroundColor: "#E6EEE8", borderRadius: 21, flexDirection: "row", marginTop: 14, minHeight: 72, paddingHorizontal: 17 },
  statusPulse: { backgroundColor: "#5E8971", borderColor: "#BFD2C7", borderRadius: 7, borderWidth: 4, height: 14, width: 14 },
  statusCopy: { flex: 1, marginLeft: 12 },
  statusTitle: { color: "#3D594B", fontSize: 12.5, fontWeight: "800" },
  statusText: { color: "#7F8E85", fontSize: 9.5, marginTop: 4 },
  requestCard: { alignItems: "center", backgroundColor: "#FBF9F4", borderRadius: 28, maxWidth: 430, padding: 24, width: "100%" },
  requestIcon: { alignItems: "center", backgroundColor: "#E6EEE8", borderRadius: 19, height: 55, justifyContent: "center", width: 55 },
  requestEyebrow: { color: "#75847B", fontSize: 10, fontWeight: "800", letterSpacing: 1.3, marginTop: 15 },
  requestName: { color: "#2C332F", fontFamily: "serif", fontSize: 22, fontWeight: "800", lineHeight: 29, marginTop: 8, textAlign: "center" },
  requestMeta: { color: "#98938C", fontSize: 11, marginTop: 7 },
  requestActions: { flexDirection: "row", gap: 10, marginTop: 22, width: "100%" },
  rejectButton: { alignItems: "center", backgroundColor: "#ECE9E2", borderRadius: 16, flex: 1, height: 48, justifyContent: "center" },
  rejectText: { color: "#6E716D", fontSize: 13, fontWeight: "800" },
  acceptButton: { alignItems: "center", backgroundColor: "#426653", borderRadius: 16, flex: 1.25, height: 48, justifyContent: "center" },
  acceptText: { color: "#F8F3E9", fontSize: 13, fontWeight: "800" },
  requestSafety: { color: "#A09B94", fontSize: 9.5, marginTop: 13 },
});