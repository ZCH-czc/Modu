import {
  Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  } from "expo-keep-awake";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "../i18n";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { useAppAlert } from "../components/AppDialog";
import type { Book, ReaderPreferences } from "../types";

type PdfReaderScreenProps = {
  book: Book;
  preferences: ReaderPreferences;
  onBack: () => void;
};

export function PdfReaderScreen({
  book,
  preferences,
  onBack,
}: PdfReaderScreenProps) {
  const Alert = useAppAlert();
  const [base64, setBase64] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (preferences.keepScreenAwake) {
      void activateKeepAwakeAsync("modu-pdf-reader");
    }

    return () => {
      void deactivateKeepAwake("modu-pdf-reader");
    };
  }, [preferences.keepScreenAwake]);

  useEffect(() => {
    let active = true;
    if (!book.fileUri) {
      setLoading(false);
      return;
    }

    FileSystem.readAsStringAsync(book.fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    })
      .then((content) => {
        if (active) setBase64(content);
      })
      .catch(() => {
        Alert.alert("无法打开 PDF", "文件可能已被移动、损坏或体积过大。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [book.fileUri]);

  const html = useMemo(() => {
    if (!base64) return "";
    return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    html,body{margin:0;background:#282b2a;color:#fff;font-family:system-ui}
    #viewer{padding:12px 0}
    canvas{display:block;max-width:96%;height:auto!important;margin:0 auto 14px;background:white;box-shadow:0 3px 18px #0008}
    #state{padding:42px 20px;text-align:center;color:#ddd}
  </style>
</head>
<body>
  <div id="state">正在解析 PDF…</div><div id="viewer"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs" type="module"></script>
  <script type="module">
    import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
    pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
    const raw=atob("${base64}");
    const data=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) data[i]=raw.charCodeAt(i);
    try{
      const pdf=await pdfjsLib.getDocument({data}).promise;
      document.getElementById("state").remove();
      const viewer=document.getElementById("viewer");
      for(let n=1;n<=pdf.numPages;n++){
        const page=await pdf.getPage(n);
        const viewport=page.getViewport({scale:1.55});
        const canvas=document.createElement("canvas");
        canvas.width=viewport.width;canvas.height=viewport.height;
        viewer.appendChild(canvas);
        await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
      }
    }catch(error){
      document.getElementById("state").textContent="PDF 加载失败，请检查网络或文件内容。";
    }
  </script>
</body>
</html>`;
  }, [base64]);

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" color="#F5F5F1" size={24} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>
            {book.title}
          </Text>
          <Text style={styles.subtitle}>PDF 阅读器</Text>
        </View>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#D6B78A" size="large" />
          <Text style={styles.loadingText}>正在准备文档…</Text>
        </View>
      ) : base64 ? (
        <WebView
          allowFileAccess
          originWhitelist={["*"]}
          source={{ html }}
          style={styles.webview}
        />
      ) : (
        <View style={styles.loading}>
          <Ionicons name="document-outline" color="#8E9690" size={44} />
          <Text style={styles.loadingText}>没有可读取的 PDF 文件</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#1D211F", flex: 1 },
  header: {
    alignItems: "center",
    borderBottomColor: "#FFFFFF12",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 68,
    paddingHorizontal: 10,
  },
  backButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  titleBlock: { alignItems: "center", flex: 1 },
  title: { color: "#F5F5F1", fontSize: 15, fontWeight: "700" },
  subtitle: { color: "#8E9690", fontSize: 11, marginTop: 3 },
  loading: { alignItems: "center", flex: 1, gap: 14, justifyContent: "center" },
  loadingText: { color: "#A9B0AB", fontSize: 14 },
  webview: { backgroundColor: "#282B2A", flex: 1 },
});
