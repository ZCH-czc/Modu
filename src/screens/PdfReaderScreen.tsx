import {
  Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  } from "expo-keep-awake";
import { useEffect,
  useMemo,
  useRef,
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
import { SpotlightTour, type SpotlightStep } from "../components/SpotlightTour";
import { useSpotlightGuide } from "../hooks/useSpotlightGuide";
import type { Book, ReaderPreferences } from "../types";
import {
  setVolumeKeyTurnsEnabled,
  subscribeToVolumeKeyTurns,
  supportsVolumeKeyTurns,
} from "../services/readerControls";

type PdfReaderScreenProps = {
  book: Book;
  preferences: ReaderPreferences;
  onBack: () => void;
  guideEnabled?: boolean;
  guideResetToken?: number;
};

export function PdfReaderScreen({
  book,
  preferences,
  onBack,
  guideEnabled = false,
  guideResetToken = 0,
}: PdfReaderScreenProps) {
  const Alert = useAppAlert();
  const webRef = useRef<WebView>(null);
  const [base64, setBase64] = useState<string>();
  const [loading, setLoading] = useState(true);
  const backGuideRef = useRef<View>(null);
  const contentGuideRef = useRef<View>(null);
  const pdfGuide = useSpotlightGuide("pdf-reader-v1", guideEnabled, guideResetToken);
  const pdfGuideSteps = useMemo<SpotlightStep[]>(() => [
    { key: "document", target: contentGuideRef, icon: "document-text-outline", title: "阅读 PDF 文档", description: "上下滑动浏览页面。墨读只保留当前页附近的渲染结果，长文档也不会一次占满内存。" },
    { key: "back", target: backGuideRef, icon: "arrow-back", title: "返回书架", description: "点这里离开 PDF。再次打开时，文件仍会从本地读取，不会上传。", placement: "below" },
  ], []);

  useEffect(() => {
    if (preferences.keepScreenAwake) {
      void activateKeepAwakeAsync("modu-pdf-reader");
    }

    return () => {
      void deactivateKeepAwake("modu-pdf-reader");
    };
  }, [preferences.keepScreenAwake]);

  useEffect(() => {
    const enabled = preferences.volumeKeys && supportsVolumeKeyTurns;
    if (!enabled) return;
    setVolumeKeyTurnsEnabled(true);
    const subscription = subscribeToVolumeKeyTurns((direction) => {
      const factor = direction === "previous" ? -0.88 : 0.88;
      webRef.current?.injectJavaScript(
        `window.scrollBy({ top: window.innerHeight * ${factor}, behavior: "smooth" }); true;`,
      );
    });
    return () => {
      subscription.remove();
      setVolumeKeyTurnsEnabled(false);
    };
  }, [preferences.volumeKeys]);

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
    #viewer{padding:12px 0 28px}
    .page-shell{position:relative;width:100%;min-height:240px;margin:0 auto 14px;display:grid;place-items:start center;contain:layout paint style}
    .page-shell::before{content:attr(data-label);position:absolute;inset:18px 0 auto;text-align:center;color:#8f9792;font-size:12px}
    .page-shell[data-state="ready"]::before{display:none}
    canvas{display:block;background:white;box-shadow:0 3px 18px #0008}
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
      const holders=[];
      const rendered=new Map();
      const rendering=new Map();
      let estimatedHeight=Math.max(window.innerHeight*1.08,window.innerWidth*1.34);
      let activePage=1;
      for(let n=1;n<=pdf.numPages;n++){
        const holder=document.createElement("section");
        holder.className="page-shell";
        holder.dataset.page=String(n);
        holder.dataset.label="正在准备第 "+n+" 页";
        holder.style.height=estimatedHeight+"px";
        viewer.appendChild(holder);
        holders.push(holder);
      }
      const recycleAround=(center)=>{
        rendered.forEach((canvas,pageNumber)=>{
          if(Math.abs(pageNumber-center)<=2)return;
          canvas.remove();
          rendered.delete(pageNumber);
          const holder=holders[pageNumber-1];
          if(holder)holder.dataset.state="idle";
        });
      };
      const renderPage=(pageNumber)=>{
        if(pageNumber<1||pageNumber>pdf.numPages||rendered.has(pageNumber))return Promise.resolve();
        const pending=rendering.get(pageNumber);
        if(pending)return pending;
        const holder=holders[pageNumber-1];
        holder.dataset.state="loading";
        const task=(async()=>{
          const page=await pdf.getPage(pageNumber);
          const baseViewport=page.getViewport({scale:1});
          const cssWidth=window.innerWidth*.96;
          const cssScale=cssWidth/baseViewport.width;
          const pixelScale=cssScale*Math.min(window.devicePixelRatio||1,2);
          const viewport=page.getViewport({scale:pixelScale});
          const canvas=document.createElement("canvas");
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          canvas.style.width=cssWidth+"px";
          const cssHeight=baseViewport.height*cssScale;
          canvas.style.height=cssHeight+"px";
          holder.style.height=cssHeight+"px";
          if(pageNumber===1){
            estimatedHeight=cssHeight;
            holders.forEach((item,index)=>{if(index>0&&!rendered.has(index+1))item.style.height=estimatedHeight+"px";});
          }
          holder.replaceChildren(canvas);
          await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
          rendered.set(pageNumber,canvas);
          holder.dataset.state="ready";
          recycleAround(activePage);
        })().catch(()=>{holder.dataset.state="error";holder.dataset.label="第 "+pageNumber+" 页暂时无法显示";})
          .finally(()=>rendering.delete(pageNumber));
        rendering.set(pageNumber,task);
        return task;
      };
      const warmWindow=(pageNumber)=>{
        activePage=Math.max(1,Math.min(pdf.numPages,pageNumber));
        [activePage-1,activePage,activePage+1].forEach((page)=>{void renderPage(page);});
        recycleAround(activePage);
      };
      const observer=new IntersectionObserver((entries)=>{
        const visible=entries.filter((entry)=>entry.isIntersecting)
          .sort((a,b)=>Math.abs(a.boundingClientRect.top)-Math.abs(b.boundingClientRect.top));
        if(!visible.length)return;
        warmWindow(Number(visible[0].target.dataset.page||1));
      },{rootMargin:"110% 0px",threshold:.01});
      holders.forEach((holder)=>observer.observe(holder));
      warmWindow(1);
    }catch(error){
      document.getElementById("state").textContent="PDF 加载失败，请检查网络或文件内容。";
    }
  </script>
</body>
</html>`;
  }, [base64]);

  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.safeArea}>
      <View collapsable={false} pointerEvents="none" ref={contentGuideRef} style={styles.guideTarget} />
      <View style={styles.header}>
        <Pressable collapsable={false} onPress={onBack} ref={backGuideRef} style={styles.backButton}>
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
          ref={webRef}
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
      <SpotlightTour onComplete={pdfGuide.complete} steps={pdfGuideSteps} visible={pdfGuide.visible} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#1D211F", flex: 1 },
  guideTarget: { height: 170, left: "28%", position: "absolute", right: "28%", top: "38%" },
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
