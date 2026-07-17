import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  setBookSourceBrowserRequestHandler,
  type BookSourceBrowserRequest,
} from "../services/bookSources";

type PendingRequest = {
  id: number;
  request: BookSourceBrowserRequest;
  resolve: (html: string) => void;
  reject: (error: Error) => void;
};

export function BookSourceBrowserBridge() {
  const webRef = useRef<WebView>(null);
  const queueRef = useRef<PendingRequest[]>([]);
  const activeRef = useRef<PendingRequest | undefined>(undefined);
  const sequenceRef = useRef(0);
  const [active, setActive] = useState<PendingRequest>();

  const pump = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    activeRef.current = next;
    setActive(next);
  }, []);

  const finish = useCallback((id: number, html?: string, error?: Error) => {
    const pending = activeRef.current;
    if (!pending || pending.id !== id) return;
    activeRef.current = undefined;
    setActive(undefined);
    if (error) pending.reject(error);
    else pending.resolve(html ?? "");
    requestAnimationFrame(pump);
  }, [pump]);

  useEffect(() => {
    setBookSourceBrowserRequestHandler((request) =>
      new Promise<string>((resolve, reject) => {
        queueRef.current.push({
          id: ++sequenceRef.current,
          request,
          resolve,
          reject,
        });
        pump();
      }),
    );
    return () => {
      setBookSourceBrowserRequestHandler(undefined);
      const error = new Error("网页验证已取消。");
      activeRef.current?.reject(error);
      queueRef.current.forEach((item) => item.reject(error));
      activeRef.current = undefined;
      queueRef.current = [];
    };
  }, [pump]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      finish(active.id, undefined, new Error("网页验证超时，请稍后重试。"));
    }, 45000);
    return () => clearTimeout(timer);
  }, [active, finish]);

  const origin = useMemo(() => {
    if (!active) return "about:blank";
    try {
      return new URL(active.request.url).origin + "/";
    } catch {
      return active.request.url;
    }
  }, [active]);

  const injectRequest = useCallback(() => {
    if (!active) return;
    const blockedHeaders = new Set(["cookie", "host", "origin", "referer", "user-agent"]);
    const headers = Object.fromEntries(
      Object.entries(active.request.headers).filter(
        ([name]) => !blockedHeaders.has(name.toLowerCase()),
      ),
    );
    const options = {
      method: active.request.method,
      headers,
      body: active.request.body,
      credentials: "include",
      redirect: "follow",
    };
    const script = `
(function () {
  var requestId = ${JSON.stringify(active.id)};
  if (window.__moduSourceRequest === requestId) return true;
  window.__moduSourceRequest = requestId;
  function send(payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function run(attempt) {
    var challenge = /loading|wafjs/i.test(
      (document.title || "") + " " + ((document.body && document.body.innerText) || "").slice(0, 500)
    );
    if (challenge && attempt < 30) {
      setTimeout(function () { run(attempt + 1); }, 500);
      return;
    }
    fetch(${JSON.stringify(active.request.url)}, ${JSON.stringify(options)})
      .then(function (response) {
        return response.text().then(function (text) {
          send({
            channel: "modu-source-browser",
            id: requestId,
            ok: response.ok,
            status: response.status,
            text: text.slice(0, 6000000)
          });
        });
      })
      .catch(function (error) {
        send({
          channel: "modu-source-browser",
          id: requestId,
          ok: false,
          status: 0,
          message: error && error.message ? error.message : "网页请求失败"
        });
      });
  }
  setTimeout(function () { run(0); }, 700);
})();
true;
`;
    webRef.current?.injectJavaScript(script);
  }, [active]);

  const handleMessage = (event: WebViewMessageEvent) => {
    if (!active) return;
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        channel?: string;
        id?: number;
        ok?: boolean;
        status?: number;
        text?: string;
        message?: string;
      };
      if (message.channel !== "modu-source-browser" || message.id !== active.id) return;
      if (message.ok && message.text) {
        finish(active.id, message.text);
      } else {
        finish(
          active.id,
          undefined,
          new Error(
            message.status
              ? "网页验证后请求仍失败（HTTP " + message.status + "）。"
              : message.message || "网页验证失败。",
          ),
        );
      }
    } catch {
      finish(active.id, undefined, new Error("网页验证返回了无法识别的数据。"));
    }
  };

  if (!active) return null;

  let host = "当前书源";
  try {
    host = new URL(active.request.url).hostname;
  } catch {}

  return (
    <Modal
      animationType="fade"
      onRequestClose={() =>
        finish(active.id, undefined, new Error("用户取消了网页验证。"))
      }
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.heading}>
            <View style={styles.icon}>
              <Ionicons color="#4E705D" name="shield-checkmark-outline" size={20} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>完成书源网页验证</Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {host} 正在确认访问环境
              </Text>
            </View>
            <ActivityIndicator color="#4E705D" />
          </View>
          <View style={styles.browser}>
            <WebView
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              cacheEnabled
              domStorageEnabled
              javaScriptEnabled
              mixedContentMode="never"
              onError={() =>
                finish(active.id, undefined, new Error("书源验证页面无法打开。"))
              }
              onLoadEnd={injectRequest}
              onMessage={handleMessage}
              originWhitelist={["http://*", "https://*"]}
              ref={webRef}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled
              source={{ uri: origin }}
              thirdPartyCookiesEnabled
            />
          </View>
          <View style={styles.footer}>
            <Text style={styles.hint}>验证完成后会自动继续搜索，无需重复输入。</Text>
            <Pressable
              onPress={() =>
                finish(active.id, undefined, new Error("用户取消了网页验证。"))
              }
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(25, 31, 28, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#F8F5EE",
    borderColor: "#D8DDD7",
    borderRadius: 26,
    borderWidth: 1,
    elevation: 18,
    maxWidth: 520,
    overflow: "hidden",
    width: "100%",
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
    padding: 16,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "#E5EEE8",
    borderRadius: 15,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  copy: { flex: 1 },
  title: { color: "#2D3A33", fontSize: 16, fontWeight: "800" },
  subtitle: { color: "#858A84", fontSize: 11, marginTop: 3 },
  browser: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#E1DED6",
    borderBottomWidth: 1,
    borderTopColor: "#E1DED6",
    borderTopWidth: 1,
    height: 330,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  hint: { color: "#858A84", flex: 1, fontSize: 11, lineHeight: 17 },
  cancel: {
    backgroundColor: "#E9ECE8",
    borderRadius: 13,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  cancelText: { color: "#52645A", fontSize: 12, fontWeight: "800" },
});
