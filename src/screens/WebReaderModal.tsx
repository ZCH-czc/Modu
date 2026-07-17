import {
  Ionicons } from "@expo/vector-icons";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  BackHandler,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text, TextInput } from "../i18n";
import Animated, { FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from "react-native-gesture-handler";
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from "react-native-webview";

import { useAppAlert } from "../components/AppDialog";
import type { WebChapterExtraction, WebPageExtraction, WebReaderFlow } from "../types";

type ContinuousCapture = {
  author?: string;
  bookTitle?: string;
  chapters: WebChapterExtraction[];
  visited: Set<string>;
};

type Props = {
  visible: boolean;
  onAdd: (extraction: WebPageExtraction, silent?: boolean) => Promise<void>;
  onClose: () => void;
  onRead: (extraction: WebPageExtraction) => void;
  initialExtraction?: WebPageExtraction;
  webReaderFlow: WebReaderFlow;
  onWebReaderFlowChange: (flow: WebReaderFlow) => void;
};

type ReaderModeTheme = "paper" | "white" | "green" | "night";
type ReaderPanel = "chapters" | "appearance" | undefined;
const READER_MODE_THEMES: Record<ReaderModeTheme,{background:string;text:string;muted:string;panel:string;accent:string}> = {
  paper:{background:"#F5EBD8",text:"#3E342B",muted:"#88776A",panel:"#EFE0C6",accent:"#A86643"},
  white:{background:"#FAFAF8",text:"#242422",muted:"#777772",panel:"#F0F0EC",accent:"#557564"},
  green:{background:"#DDE8D8",text:"#26372A",muted:"#657568",panel:"#CEDDC8",accent:"#4E7358"},
  night:{background:"#151816",text:"#D8DDD8",muted:"#7D897F",panel:"#222723",accent:"#87A68E"},
};
const READER_THEME_OPTIONS: ReaderModeTheme[]=["paper","white","green","night"];

const START_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{height:100%;margin:0;background:#f7f4ed;color:#24332b;font-family:system-ui,sans-serif}body{display:grid;place-items:center}.card{width:min(82vw,520px);text-align:center}.mark{width:76px;height:76px;border-radius:24px;margin:auto;display:grid;place-items:center;background:#e6eee8;color:#4f705e;font-size:34px}.title{font-size:28px;font-weight:700;margin:24px 0 10px}.text{font-size:15px;line-height:1.7;color:#7e837f}.hint{margin-top:28px;padding:14px 18px;border:1px solid #dedbd3;border-radius:18px;background:#fbfaf6;color:#56675e;font-size:14px}
</style></head><body><div class="card"><div class="mark">◌</div><div class="title">网页寻书</div><div class="text">在上方输入网址、书名或作者。<br>打开正文页后，点“提取正文”。</div><div class="hint">仅处理你已经能够正常访问的页面</div></div></body></html>`;

const EXTRACTION_SCRIPT = "\n(function () {\n  try {\n    if (!/^https?:$/.test(location.protocol)) throw new Error('请先打开具体网页');\n    var copy = document.cloneNode(true);\n    copy.querySelectorAll('script,style,noscript,svg,canvas,iframe,video,audio,nav,footer,form,input,textarea,select,button,[role=\"navigation\"],[aria-hidden=\"true\"],.ad,.ads,.advertisement,.recommend,.related,.comment,.comments').forEach(function (node) { node.remove(); });\n    var selectors = ['article','main','[role=\"main\"]','#chaptercontent','#content','#content1','.chapter-content','.read-content','.reading-content','.article-content','.entry-content','.post-content','.novel-content','.content'];\n    var candidates = [];\n    selectors.forEach(function (selector) { copy.querySelectorAll(selector).forEach(function (node) { if (candidates.indexOf(node) < 0) candidates.push(node); }); });\n    if (copy.body) candidates.push(copy.body);\n    var best = null, bestScore = -1;\n    candidates.forEach(function (node) {\n      var text = (node.innerText || node.textContent || '').trim();\n      if (text.length < 120) return;\n      var links = Array.prototype.slice.call(node.querySelectorAll('a')).reduce(function (sum, link) { return sum + (link.textContent || '').trim().length; }, 0);\n      var score = text.length + node.querySelectorAll('p,br').length * 80 + (/chapter|article|read|content|novel|text/.test(((node.id || '') + ' ' + (node.className || '')).toLowerCase()) ? 1200 : 0) - links * 1.6;\n      if (score > bestScore) { best = node; bestScore = score; }\n    });\n    if (!best) throw new Error('没有识别到足够长的正文');\n    best.querySelectorAll('br').forEach(function (br) { br.replaceWith('\\n'); });\n    var lines = (best.innerText || best.textContent || '').split(/\\n+/).map(function (line) { return line.replace(/[\\t\\u00a0 ]+/g, ' ').trim(); }).filter(function (line) { return line.length > 0; });\n    var content = lines.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n').trim();\n    if (content.length < 120) throw new Error('正文太短，请打开具体章节后重试');\n    if (content.length > 500000) content = content.slice(0, 500000);\n    var heading = document.querySelector('article h1, main h1, h1');\n    var title = ((heading && heading.textContent) || document.title || '网页摘录').replace(/[\\t\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();\n    var bookNode = document.querySelector('meta[property=\"og:novel:book_name\"],meta[property$=\"book_name\"],meta[name=\"book_name\"],meta[property=\"og:title\"]');\n    var bookTitle = bookNode ? (bookNode.getAttribute('content') || '') : '';\n    if (!bookTitle) bookTitle = title.replace(/(?:第.{1,16}[章节回卷集部篇]|chapter\\s*\\d+)[\\s\\S]*$/i, '').replace(/[-_|].*$/, '').trim();\n    var authorNode = document.querySelector('meta[name=\"author\"],meta[property$=\"author\"],[rel=\"author\"],.author,[class*=\"author\"],[id*=\"author\"]');\n    var author = authorNode ? (authorNode.getAttribute('content') || authorNode.textContent || '') : '';\n    if (!author) { var m = ((document.body && document.body.innerText) || '').slice(0,1200).match(/(?:作者|作\\s*者)\\s*[：:]\\s*([^\\n]{1,32})/); author = m ? m[1] : ''; }\n    author = author.replace(/^(?:作者|作\\s*者)\\s*[：:]?\\s*/, '').trim();\n    var nextUrl = '', relNext = document.querySelector('link[rel=\"next\"],a[rel=\"next\"]');\n    if (relNext) nextUrl = relNext.href || relNext.getAttribute('href') || '';\n    if (!nextUrl) Array.prototype.some.call(document.querySelectorAll('a'), function (link) {\n      var label = (link.textContent || '').replace(/\\s+/g, '');\n      if (/^(下一章|下章|下一页|下一篇|继续阅读|nextchapter|next)$/i.test(label) && link.href) { nextUrl = link.href; return true; }\n      return false;\n    });\n    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-extraction', payload:{ bookTitle:bookTitle.slice(0,120), title:title.slice(0,120), author:author.slice(0,80), content:content, url:location.href, nextUrl:nextUrl } }));\n  } catch (error) {\n    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-extraction-error', message:error && error.message ? error.message : '正文提取失败' }));\n  }\n})();\ntrue;\n";

export function WebReaderModal({ visible, onAdd, onClose, onRead, initialExtraction, webReaderFlow, onWebReaderFlowChange }: Props) {
  const Alert = useAppAlert();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [address, setAddress] = useState("");
  const [url, setUrl] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [preview, setPreview] = useState<WebPageExtraction>();
  const [saving, setSaving] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const captureRef = useRef<ContinuousCapture | undefined>(undefined);
  const [capturing, setCapturing] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [readerMode,setReaderMode]=useState(false);
  const [readerHistory,setReaderHistory]=useState<WebPageExtraction[]>([]);
  const [readerIndex,setReaderIndex]=useState(0);
  const [readerTheme,setReaderTheme]=useState<ReaderModeTheme>("paper");
  const [readerFontSize,setReaderFontSize]=useState(19);
  const [readerPageIndex,setReaderPageIndex]=useState(0);
  const [readerPanel,setReaderPanel]=useState<ReaderPanel>();
  const [readerLoading,setReaderLoading]=useState(false);
  const savedBookRef=useRef(false);
  const readerPageDrag=useRef(new RNAnimated.Value(0)).current;
  const readerPageAnimatingRef=useRef(false);
  const readerPageTargetRef=useRef<"start"|"end">("start");
  const readerRequestRef=useRef(false);
  const readerNavigationRef=useRef(false);
  const readerScrollRef=useRef<ScrollView>(null);
  const {width:screenWidth,height:screenHeight}=useWindowDimensions();
  const readerPalette=READER_MODE_THEMES[readerTheme];
  const readerColumnWidth=Math.min(screenWidth-38,720);
  const readerPageLimit=Math.max(150,Math.floor((readerColumnWidth/readerFontSize)*(Math.max(screenHeight-insets.top-insets.bottom-250,260)/(readerFontSize*1.82))*.76));
  const readerPages=useMemo(()=>paginateReaderContent(preview?.content??"",readerPageLimit),[preview?.content,readerPageLimit]);

  const source = useMemo(() => (url ? { uri: url } : { html: START_HTML }), [url]);

  useEffect(() => {
    if (!visible) return;
    if (!initialExtraction) {
      savedBookRef.current = false;
      setReaderMode(false);
      setReaderPanel(undefined);
      setReaderLoading(false);
      setReaderHistory([]);
      setReaderIndex(0);
      setPreview(undefined);
      return;
    }
    savedBookRef.current = true;
    const history = toReaderHistory(initialExtraction);
    const savedIndex = Math.max(0, history.findIndex((chapter) => chapter.url === initialExtraction.url));
    const selected = history[savedIndex] ?? history[0];
    setReaderHistory(history);
    setReaderIndex(savedIndex);
    setPreview(selected);
    setReaderPanel(undefined);
    setReaderLoading(false);
    setReaderMode(true);
    setAddress(selected.url);
    setUrl(selected.url);
    requestAnimationFrame(() => readerScrollRef.current?.scrollTo({ animated: false, y: 0 }));
  }, [initialExtraction, visible]);

  useEffect(() => {
    if (!preview || !readerMode) return;
    const target=readerPageTargetRef.current;
    readerPageTargetRef.current="start";
    setReaderPageIndex(target==="end"?Math.max(readerPages.length-1,0):0);
    readerPageDrag.setValue(0);
    if(webReaderFlow==="scroll") requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
  }, [preview?.url, readerMode, readerPages.length, readerPageDrag, webReaderFlow]);

  const navigate = () => {
    captureRef.current = undefined;
    setCapturing(false);
    const target = normalizeAddress(address);
    if (!target) return;
    setPreview(undefined);
    if (target === url) webRef.current?.reload();
    else setUrl(target);
  };

  const closeOrGoBack = () => {
    if(readerPanel){setReaderPanel(undefined);return;}
    if(readerMode){
      readerRequestRef.current=false;
      readerNavigationRef.current=false;
      setReaderLoading(false);
      setReaderMode(false);
      setPreview(undefined);
      return;
    }
    if(preview){setPreview(undefined);return;}
    if(canGoBack) webRef.current?.goBack(); else onClose();
  };

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeOrGoBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, onClose, preview, readerMode, readerPanel, visible]);

  const handleNavigation = (state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
    setLoading(state.loading);
    if (/^https?:\/\//i.test(state.url)) {
      setCurrentUrl(state.url);
      setAddress(state.url);
    }
  };


  const finishContinuousCapture = () => {
    const session = captureRef.current;
    if (!session || !session.chapters.length) return;
    const first = session.chapters[0];
    const completed: WebPageExtraction = {
      bookTitle: session.bookTitle || first.title,
      title: session.bookTitle || first.title,
      author: session.author,
      content: first.content,
      url: first.url,
      chapters: [...session.chapters],
    };
    if (readerMode) {
      const history = toReaderHistory(completed);
      setReaderHistory(history);
      setReaderIndex(0);
      setPreview(history[0]);
      setReaderLoading(false);
    } else {
      setPreview(completed);
    }
    captureRef.current = undefined;
    setCapturing(false);
    setExtracting(false);
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    setExtracting(false);
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        message?: string;
        payload?: WebPageExtraction;
      };
      if (message.type === "modu-extraction" && message.payload) {
        const session = captureRef.current;
        if(!session){
          const payload=message.payload;
          const navigating=readerNavigationRef.current;
          const open=readerRequestRef.current||navigating||readerMode;
          readerRequestRef.current=false;
          readerNavigationRef.current=false;
          setReaderLoading(false);
          setPreview(payload);
          if(open){
            if(navigating){
              const found=readerHistory.findIndex((item)=>item.url===payload.url);
              const nextHistory=found>=0?readerHistory:[...readerHistory,payload];
              const nextIndex=found>=0?found:nextHistory.length-1;
              setReaderHistory(nextHistory);
              setReaderIndex(nextIndex);
              if(savedBookRef.current){
                void onAdd({
                  ...payload,
                  bookTitle:payload.bookTitle||nextHistory[0]?.bookTitle||nextHistory[0]?.title,
                  chapters:nextHistory.map(({title,content,url})=>({title,content,url})),
                },true);
              }
            }else{
              setReaderHistory(toReaderHistory(payload));
              setReaderIndex(0);
            }
            setReaderMode(true);
            requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
          }
          return;
        }
        const payload = message.payload;
        if (!session.visited.has(payload.url)) {
          session.visited.add(payload.url);
          session.chapters.push({ title: payload.title, content: payload.content, url: payload.url });
          if (!session.bookTitle) session.bookTitle = payload.bookTitle || payload.title;
          if (!session.author) session.author = payload.author;
          setCaptureCount(session.chapters.length);
        }
        const next = payload.nextUrl;
        if (next && !session.visited.has(next) && session.chapters.length < 300) {
          setAddress(next);
          setUrl(next);
        } else {
          finishContinuousCapture();
        }
      } else if (message.type === "modu-extraction-error") {
        readerRequestRef.current=false; readerNavigationRef.current=false; setReaderLoading(false);
        if (captureRef.current?.chapters.length) {
          finishContinuousCapture();
          Alert.alert("连续收录已停止", message.message || "后续页面未识别到正文，已保留前面的章节。");
        } else {
          Alert.alert("没有提取到正文", message.message || "请打开具体章节页面后再试。");
        }
      }
    } catch {
      readerRequestRef.current=false; readerNavigationRef.current=false; setReaderLoading(false);
      if (captureRef.current?.chapters.length) finishContinuousCapture();
      else Alert.alert("提取失败", "页面返回了无法识别的内容。");
    }
  };

  const extract = (openReader=false) => {
    if (!currentUrl || loading || extracting) return;
    readerRequestRef.current=openReader;
    setExtracting(true);
    webRef.current?.injectJavaScript(EXTRACTION_SCRIPT);
  };


  const startContinuousCapture = () => {
    if (!preview?.nextUrl) return;
    captureRef.current = {
      author: preview.author,
      bookTitle: preview.bookTitle || preview.title,
      chapters: [{ title: preview.title, content: preview.content, url: preview.url }],
      visited: new Set([preview.url]),
    };
    setCaptureCount(1);
    setCapturing(true);
    if (readerMode) setReaderLoading(true);
    else setPreview(undefined);
    setAddress(preview.nextUrl);
    setUrl(preview.nextUrl);
  };

  const handleLoadEnd = () => {
    setLoading(false);
    if(readerNavigationRef.current){
      setTimeout(()=>{
        if(!readerNavigationRef.current)return;
        setExtracting(true);
        webRef.current?.injectJavaScript(EXTRACTION_SCRIPT);
      },180);
      return;
    }
    if (!captureRef.current) return;
    setTimeout(() => {
      if (!captureRef.current) return;
      setExtracting(true);
      webRef.current?.injectJavaScript(EXTRACTION_SCRIPT);
    }, 180);
  };

  const recoverWebView = () => {
    setLoading(false);
    setExtracting(false);
    setCanGoBack(false);
    setCanGoForward(false);
    setCurrentUrl("");
    setUrl(undefined);
    setReaderMode(false); setReaderPanel(undefined); setReaderLoading(false);
    readerRequestRef.current=false; readerNavigationRef.current=false;
    setWebViewKey((value) => value + 1);
    Alert.alert("网页已恢复", "页面渲染出现异常，已返回起始页，请重新打开。");
  };

  const enterReaderMode=(extraction=preview)=>{
    if(!extraction)return;
    const history=toReaderHistory(extraction);
    setReaderHistory(history); setPreview(history[0]);
    setReaderIndex(0); setReaderPanel(undefined); setReaderMode(true);
    requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
  };
  const openReaderChapter=(index:number,target:"start"|"end"="start")=>{
    const chapter=readerHistory[index]; if(!chapter)return;
    readerPageTargetRef.current=target;
    setReaderIndex(index); setPreview(chapter); setReaderPanel(undefined);
    if(savedBookRef.current){
      void onAdd({
        ...chapter,
        bookTitle:chapter.bookTitle||readerHistory[0]?.bookTitle||readerHistory[0]?.title,
        chapters:readerHistory.map(({title,content,url})=>({title,content,url})),
      },true);
    }
    requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
  };
  const openNextReaderChapter=()=>{
    if(readerIndex<readerHistory.length-1){openReaderChapter(readerIndex+1);return;}
    if(!preview?.nextUrl||readerLoading)return;
    readerNavigationRef.current=true; setReaderLoading(true);
    setAddress(preview.nextUrl); setUrl(preview.nextUrl);
  };
  const canTurnReaderPrevious=readerPageIndex>0||readerIndex>0;
  const canTurnReaderNext=readerPageIndex<readerPages.length-1||readerIndex<readerHistory.length-1||Boolean(preview?.nextUrl);
  const settleReaderPage=()=>{
    RNAnimated.timing(readerPageDrag,{toValue:0,duration:150,easing:Easing.out(Easing.cubic),useNativeDriver:true})
      .start(()=>{readerPageAnimatingRef.current=false;});
  };
  const turnReaderPage=(direction:-1|1)=>{
    if(webReaderFlow!=="paged"||readerPageAnimatingRef.current||readerLoading)return;
    const canTurn=direction<0?canTurnReaderPrevious:canTurnReaderNext;
    if(!canTurn){settleReaderPage();return;}
    readerPageAnimatingRef.current=true;
    RNAnimated.timing(readerPageDrag,{
      toValue:direction*-screenWidth,
      duration:170,
      easing:Easing.out(Easing.cubic),
      useNativeDriver:true,
    }).start(({finished})=>{
      if(!finished){readerPageAnimatingRef.current=false;return;}
      readerPageDrag.setValue(direction*screenWidth*.12);
      if(direction<0){
        if(readerPageIndex>0)setReaderPageIndex((page)=>page-1);
        else openReaderChapter(readerIndex-1,"end");
      }else if(readerPageIndex<readerPages.length-1){
        setReaderPageIndex((page)=>page+1);
      }else{
        openNextReaderChapter();
      }
      requestAnimationFrame(()=>settleReaderPage());
    });
  };
  const onReaderPageGesture=useMemo(
    ()=>RNAnimated.event<PanGestureHandlerGestureEvent>(
      [{nativeEvent:{translationX:readerPageDrag}}],
      {useNativeDriver:true},
    ),
    [readerPageDrag],
  );
  const onReaderPageGestureStateChange=useCallback((event:PanGestureHandlerStateChangeEvent)=>{
    if(event.nativeEvent.oldState!==State.ACTIVE||webReaderFlow!=="paged")return;
    const {translationX,velocityX}=event.nativeEvent;
    const committed=Math.abs(translationX)>screenWidth*.14||Math.abs(velocityX)>520;
    if(!committed){settleReaderPage();return;}
    turnReaderPage(translationX<0?1:-1);
  },[screenWidth,webReaderFlow,readerPageIndex,readerIndex,readerPages.length,readerHistory.length,preview?.nextUrl,readerLoading]);

  const composeReaderExtraction=()=>{
    const current=preview??readerHistory[readerIndex]; if(!current)return undefined;
    return {...current,bookTitle:current.bookTitle||readerHistory[0]?.bookTitle||readerHistory[0]?.title,
      chapters:readerHistory.map(({title,content,url})=>({title,content,url}))} satisfies WebPageExtraction;
  };
  const saveReaderBook=async()=>{
    const extraction=composeReaderExtraction(); if(!extraction||saving)return;
    setSaving(true); try{await onAdd(extraction); savedBookRef.current=true;}finally{setSaving(false);}
  };
  const openPagedReader=()=>{
    const extraction=composeReaderExtraction(); if(!extraction)return;
    setReaderMode(false); setReaderPanel(undefined); onRead(extraction);
  };

  const addToShelf = async () => {
    if (!preview || saving) return;
    setSaving(true);
    try {
      await onAdd(preview);
      setPreview(undefined);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal animationType="slide" onRequestClose={closeOrGoBack} statusBarTranslucent visible>
      <View style={styles.overlay}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}>
              <Ionicons color="#4F705E" name="compass-outline" size={19} />
            </View>
            <View>
              <Text style={styles.title}>网页寻书</Text>
              <Text style={styles.subtitle}>浏览并提取当前正文</Text>
            </View>
          </View>
          <Pressable accessibilityLabel="关闭网页寻书" onPress={onClose} style={styles.close}>
            <Ionicons color="#39473F" name="close" size={22} />
          </Pressable>
        </View>

        <View style={styles.addressRow}>
          <View style={styles.addressBox}>
            <Ionicons color="#829087" name="search-outline" size={17} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setAddress}
              onSubmitEditing={navigate}
              placeholder="输入网址、书名或作者"
              placeholderTextColor="#A6A39C"
              returnKeyType="go"
              selectTextOnFocus
              style={styles.addressInput}
              value={address}
            />
          </View>
          <Pressable onPress={navigate} style={styles.goButton}>
            <Ionicons color="#F7F3EA" name="arrow-forward" size={19} />
          </Pressable>
        </View>

        <View style={styles.browser}>
          <WebView
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            androidLayerType="hardware"
            cacheEnabled
            domStorageEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            javaScriptEnabled
            key={webViewKey}
            mixedContentMode="never"
            onError={() => {
              setLoading(false);
              setCurrentUrl("");
            }}
            onLoadEnd={handleLoadEnd}
            onLoadStart={() => setLoading(true)}
            onMessage={handleMessage}
            onNavigationStateChange={handleNavigation}
            onRenderProcessGone={recoverWebView}
            onShouldStartLoadWithRequest={(request) =>
              /^(https?:|about:blank)/i.test(request.url)
            }
            originWhitelist={["http://*", "https://*", "about:blank"]}
            overScrollMode="never"
            ref={webRef}
            renderError={() => (
              <View style={styles.webError}>
                <View style={styles.webErrorIcon}>
                  <Ionicons color="#60776A" name="cloud-offline-outline" size={25} />
                </View>
                <Text style={styles.webErrorTitle}>网页暂时打不开</Text>
                <Text style={styles.webErrorText}>请检查网络或地址后再试</Text>
                <Pressable onPress={() => webRef.current?.reload()} style={styles.retryButton}>
                  <Text style={styles.retryText}>重新加载</Text>
                </Pressable>
              </View>
            )}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={source}
            startInLoadingState
            thirdPartyCookiesEnabled
          />
          {loading ? (
            <Animated.View entering={FadeIn.duration(100)} exiting={FadeOut.duration(100)} style={styles.loadingLine} />
          ) : null}
        </View>

        <View style={styles.toolbar}>
          <View style={styles.navButtons}>
            <ToolButton disabled={!canGoBack} icon="arrow-back" onPress={() => webRef.current?.goBack()} />
            <ToolButton disabled={!canGoForward} icon="arrow-forward" onPress={() => webRef.current?.goForward()} />
            <ToolButton icon="refresh" onPress={() => webRef.current?.reload()} />
          </View>
          <Pressable
            disabled={!capturing && (!currentUrl || loading || extracting)}
            onPress={capturing ? finishContinuousCapture : () => extract(true)}
            style={[styles.extractButton, (!capturing && (!currentUrl || loading)) && styles.buttonDisabled]}
          >
            {extracting && !capturing ? (
              <ActivityIndicator color="#F8F4EA" size="small" />
            ) : (
              <Ionicons color="#F8F4EA" name={capturing ? "stop-circle-outline" : "book-outline"} size={17} />
            )}
            <Text style={styles.extractText}>
              {capturing ? "已收录 " + captureCount + " 章 · 停止" : extracting ? "正在整理" : "阅读模式"}
            </Text>
          </Pressable>
        </View>

        {preview && !readerMode ? (
          <View style={styles.previewShade}>
            <Pressable onPress={() => setPreview(undefined)} style={StyleSheet.absoluteFill} />
            <Animated.View entering={SlideInDown.duration(220)} style={styles.previewCard}>
              <View style={styles.previewHandle} />
              <View style={styles.previewIcon}>
                <Ionicons color="#4E705D" name="leaf-outline" size={22} />
              </View>
              <Text numberOfLines={2} style={styles.previewTitle}>{preview.title}</Text>
              <Text style={styles.previewMeta}>
                {preview.author || "未识别作者"} · {preview.chapters?.length ? preview.chapters.length + " 章" : preview.content.length.toLocaleString() + " 字"}
              </Text>
              <Text numberOfLines={3} style={styles.previewText}>{preview.content}</Text>
              <Text style={styles.privacy}>正文仅保存在本机，不会上传。</Text>
              {preview.nextUrl && !preview.chapters?.length ? (
                <Pressable onPress={startContinuousCapture} style={styles.continuousButton}>
                  <Ionicons color="#4E695A" name="albums-outline" size={17} />
                  <Text style={styles.continuousText}>连续收录后续章节</Text>
                </Pressable>
              ) : null}
              <View style={styles.previewActions}>
                <Pressable onPress={() => enterReaderMode(preview)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>阅读模式</Text>
                </Pressable>
                <Pressable disabled={saving} onPress={() => void addToShelf()} style={styles.primaryButton}>
                  {saving ? <ActivityIndicator color="#F8F4EA" size="small" /> : <Text style={styles.primaryText}>加入书架</Text>}
                </Pressable>
              </View>
            </Animated.View>
          </View>
        ) : null}

        {readerMode && preview ? (
          <Animated.View entering={SlideInDown.duration(220)} style={[styles.readerMode,{backgroundColor:readerPalette.background,paddingTop:insets.top}]}>
            <View style={[styles.readerHeader,{backgroundColor:`${readerPalette.background}F2`,borderColor:`${readerPalette.muted}28`}]}>
              <Pressable accessibilityLabel="退出网页阅读模式" onPress={closeOrGoBack} style={styles.readerIcon}>
                <Ionicons color={readerPalette.text} name="chevron-down" size={23}/>
              </Pressable>
              <View style={styles.readerHeaderText}>
                <Text numberOfLines={1} style={[styles.readerBook,{color:readerPalette.text}]}>{preview.bookTitle||preview.title}</Text>
                <Text numberOfLines={1} style={[styles.readerChapter,{color:readerPalette.muted}]}>{preview.title}</Text>
              </View>
              <Pressable accessibilityLabel="转为分页阅读" onPress={openPagedReader} style={styles.readerIcon}>
                <Ionicons color={readerPalette.text} name="reader-outline" size={21}/>
              </Pressable>
            </View>

            {webReaderFlow==="scroll" ? (
              <ScrollView contentContainerStyle={[styles.readerContent,{paddingBottom:118+insets.bottom}]} ref={readerScrollRef} showsVerticalScrollIndicator={false}>
                <View style={{alignSelf:"center",width:readerColumnWidth}}>
                  <Text style={[styles.readerEyebrow,{color:readerPalette.accent}]}>WEB READER</Text>
                  <Text style={[styles.readerTitle,{color:readerPalette.text}]}>{preview.title}</Text>
                  <Text style={[styles.readerMeta,{color:readerPalette.muted}]}>{preview.author||"摘自当前网页"} · 第 {readerIndex+1} 章</Text>
                  <View style={[styles.readerRule,{backgroundColor:`${readerPalette.muted}35`}]}/>
                  {preview.content.split(/\n{2,}/).map((item)=>item.trim()).filter(Boolean).map((paragraph,index)=>(
                    <Text key={preview.url+"-"+index} selectable style={[styles.readerParagraph,{color:readerPalette.text,fontSize:readerFontSize,lineHeight:readerFontSize*1.82}]}>
                      {paragraph}
                    </Text>
                  ))}
                  <View style={styles.readerEnd}>
                    <View style={[styles.readerEndLine,{backgroundColor:`${readerPalette.muted}45`}]}/>
                    <Ionicons color={readerPalette.accent} name="leaf-outline" size={18}/>
                    <View style={[styles.readerEndLine,{backgroundColor:`${readerPalette.muted}45`}]}/>
                  </View>
                </View>
              </ScrollView>
            ) : (
              <PanGestureHandler
                activeOffsetX={[-10,10]}
                failOffsetY={[-14,14]}
                onGestureEvent={onReaderPageGesture}
                onHandlerStateChange={onReaderPageGestureStateChange}
              >
                <RNAnimated.View style={[styles.readerPaged,{paddingBottom:88+insets.bottom,transform:[{translateX:readerPageDrag}]}]}>
                  <View style={[styles.readerPagedBody,{width:readerColumnWidth}]}>
                    {readerPageIndex===0 ? (
                      <>
                        <Text style={[styles.readerEyebrow,{color:readerPalette.accent}]}>WEB READER</Text>
                        <Text style={[styles.readerTitle,{color:readerPalette.text}]}>{preview.title}</Text>
                        <Text style={[styles.readerMeta,{color:readerPalette.muted}]}>{preview.author||"摘自当前网页"} · 第 {readerIndex+1} 章</Text>
                        <View style={[styles.readerRule,{backgroundColor:`${readerPalette.muted}35`}]}/>
                      </>
                    ) : (
                      <Text numberOfLines={1} style={[styles.readerPagedChapter,{color:readerPalette.muted}]}>{preview.title}</Text>
                    )}
                    {(readerPages[readerPageIndex]??"").split(/\n{2,}/).map((item)=>item.trim()).filter(Boolean).map((paragraph,index)=>(
                      <Text key={preview.url+"-"+readerPageIndex+"-"+index} style={[styles.readerParagraph,{color:readerPalette.text,fontSize:readerFontSize,lineHeight:readerFontSize*1.82}]}>
                        {paragraph}
                      </Text>
                    ))}
                    <Text style={[styles.readerPageNumber,{color:readerPalette.muted}]}>{readerPageIndex+1} / {readerPages.length}</Text>
                  </View>
                  <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                    <Pressable accessibilityLabel="网页阅读上一页" disabled={!canTurnReaderPrevious} onPress={()=>turnReaderPage(-1)} style={styles.readerLeftTap}/>
                    <Pressable accessibilityLabel="网页阅读下一页" disabled={!canTurnReaderNext} onPress={()=>turnReaderPage(1)} style={styles.readerRightTap}/>
                  </View>
                </RNAnimated.View>
              </PanGestureHandler>
            )}

            {readerPanel ? (
              <View style={[styles.readerPanel,{backgroundColor:readerPalette.background,borderColor:`${readerPalette.muted}35`,bottom:Math.max(84,insets.bottom+78)}]}>
                <View style={styles.readerPanelHeader}>
                  <Text style={[styles.readerPanelTitle,{color:readerPalette.text}]}>{readerPanel==="chapters"?"已浏览章节":"阅读外观"}</Text>
                  <Pressable onPress={()=>setReaderPanel(undefined)} style={[styles.readerPanelClose,{backgroundColor:readerPalette.panel}]}>
                    <Ionicons color={readerPalette.text} name="close" size={18}/>
                  </Pressable>
                </View>
                {readerPanel==="chapters" ? (
                  <>
                  {preview.nextUrl && !capturing ? (
                    <Pressable onPress={startContinuousCapture} style={[styles.readerCaptureButton,{borderColor:`${readerPalette.muted}50`}]}>
                      <Ionicons color={readerPalette.accent} name="albums-outline" size={17}/>
                      <Text style={[styles.readerCaptureText,{color:readerPalette.text}]}>连续收录后续章节</Text>
                    </Pressable>
                  ) : null}
                  <ScrollView showsVerticalScrollIndicator={false} style={styles.readerChapterList}>
                    {readerHistory.map((chapter,index)=>{
                      const selected=index===readerIndex;
                      return (
                        <Pressable key={chapter.url+"-"+index} onPress={()=>openReaderChapter(index)} style={[styles.readerChapterItem,selected&&{backgroundColor:`${readerPalette.accent}18`}]}>
                          <Text style={[styles.readerChapterNo,{color:selected?readerPalette.accent:readerPalette.muted}]}>{String(index+1).padStart(2,"0")}</Text>
                          <Text numberOfLines={1} style={[styles.readerChapterName,{color:selected?readerPalette.accent:readerPalette.text,fontWeight:selected?"700":"500"}]}>{chapter.title}</Text>
                          {selected?<Ionicons color={readerPalette.accent} name="radio-button-on" size={16}/>:null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  </>
                ) : (
                  <>
                    <View style={styles.readerThemes}>
                      {READER_THEME_OPTIONS.map((theme)=>{
                        const option=READER_MODE_THEMES[theme],selected=theme===readerTheme;
                        return (
                          <Pressable accessibilityLabel={"阅读主题 "+theme} key={theme} onPress={()=>setReaderTheme(theme)}
                            style={[styles.readerTheme,{backgroundColor:option.background,borderColor:selected?readerPalette.accent:`${readerPalette.muted}30`,borderWidth:selected?2:1}]}>
                            {selected?<Ionicons color={option.text} name="checkmark" size={17}/>:null}
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={[styles.readerFlowRow,{backgroundColor:readerPalette.panel}]}>
                      <Text style={[styles.readerFlowLabel,{color:readerPalette.text}]}>阅读方式</Text>
                      {([["paged","左右翻页"],["scroll","上下滚动"]] as const).map(([flow,label])=>(
                        <Pressable key={flow} onPress={()=>onWebReaderFlowChange(flow)}
                          style={[styles.readerFlowOption,webReaderFlow===flow&&{backgroundColor:readerPalette.background}]}>
                          <Text style={[styles.readerFlowText,{color:webReaderFlow===flow?readerPalette.accent:readerPalette.muted}]}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={[styles.readerFontRow,{backgroundColor:readerPalette.panel}]}>
                      <Text style={[styles.readerFontLabel,{color:readerPalette.text}]}>字号</Text>
                      <Pressable disabled={readerFontSize<=15} onPress={()=>setReaderFontSize((v)=>Math.max(15,v-1))} style={styles.readerFontButton}>
                        <Ionicons color={readerPalette.text} name="remove" size={19}/>
                      </Pressable>
                      <Text style={[styles.readerFontValue,{color:readerPalette.text}]}>{readerFontSize}</Text>
                      <Pressable disabled={readerFontSize>=28} onPress={()=>setReaderFontSize((v)=>Math.min(28,v+1))} style={styles.readerFontButton}>
                        <Ionicons color={readerPalette.text} name="add" size={19}/>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            ) : null}

            <View style={[styles.readerToolbar,{backgroundColor:`${readerPalette.background}F4`,borderColor:`${readerPalette.muted}30`,bottom:Math.max(10,insets.bottom+6)}]}>
              <Pressable accessibilityLabel={webReaderFlow==="paged"?"上一页":"上一章"}
                disabled={webReaderFlow==="paged"?!canTurnReaderPrevious:readerIndex===0}
                onPress={()=>webReaderFlow==="paged"?turnReaderPage(-1):openReaderChapter(readerIndex-1)}
                style={[styles.readerTool,(webReaderFlow==="paged"?!canTurnReaderPrevious:readerIndex===0)&&styles.readerDisabled]}>
                <Ionicons color={readerPalette.text} name="chevron-back" size={20}/>
              </Pressable>
              <Pressable accessibilityLabel="网页阅读章节" onPress={()=>setReaderPanel(readerPanel==="chapters"?undefined:"chapters")} style={styles.readerCenterTool}>
                <Ionicons color={readerPalette.accent} name="list-outline" size={19}/>
                <Text style={[styles.readerCenterText,{color:readerPalette.text}]}>
                  {webReaderFlow==="paged"?`章节 ${readerIndex+1}/${readerHistory.length} · ${readerPageIndex+1}/${readerPages.length}`:`章节 ${readerIndex+1}/${readerHistory.length}`}
                </Text>
              </Pressable>
              <Pressable accessibilityLabel={webReaderFlow==="paged"?"下一页":"下一章"}
                disabled={webReaderFlow==="paged"?!canTurnReaderNext:readerIndex>=readerHistory.length-1&&!preview.nextUrl}
                onPress={()=>webReaderFlow==="paged"?turnReaderPage(1):openNextReaderChapter()}
                style={[styles.readerTool,(webReaderFlow==="paged"?!canTurnReaderNext:readerIndex>=readerHistory.length-1&&!preview.nextUrl)&&styles.readerDisabled]}>
                <Ionicons color={readerPalette.text} name="chevron-forward" size={20}/>
              </Pressable>
              <Pressable accessibilityLabel="阅读外观" onPress={()=>setReaderPanel(readerPanel==="appearance"?undefined:"appearance")} style={styles.readerTool}>
                <Text style={[styles.readerAa,{color:readerPalette.text}]}>Aa</Text>
              </Pressable>
              <Pressable accessibilityLabel="加入书架" disabled={saving} onPress={()=>void saveReaderBook()} style={styles.readerTool}>
                {saving?<ActivityIndicator color={readerPalette.accent} size="small"/>:<Ionicons color={readerPalette.text} name="bookmark-outline" size={20}/>}
              </Pressable>
            </View>

            {readerLoading ? (
              <View style={[styles.readerLoading,{backgroundColor:`${readerPalette.background}E8`}]}>
                <ActivityIndicator color={readerPalette.accent} size="large"/>
                <Text style={[styles.readerLoadingText,{color:readerPalette.muted}]}>
                  {capturing?"已收录 "+captureCount+" 章":"正在整理下一章"}
                </Text>
                {capturing ? (
                  <Pressable onPress={finishContinuousCapture} style={[styles.readerStopButton,{borderColor:`${readerPalette.muted}60`}]}>
                    <Text style={[styles.readerStopText,{color:readerPalette.text}]}>停止并保留</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </Animated.View>
        ) : null}
      </SafeAreaView>
      </View>
    </Modal>
  );
}

function ToolButton({ disabled, icon, onPress }: { disabled?: boolean; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.toolButton, disabled && styles.toolDisabled]}>
      <Ionicons color={disabled ? "#C8C5BD" : "#52685C"} name={icon} size={20} />
    </Pressable>
  );
}

function toReaderHistory(extraction:WebPageExtraction){
  if(!extraction.chapters?.length)return [extraction];
  return extraction.chapters.map((chapter,index,chapters)=>({
    author:extraction.author,bookTitle:extraction.bookTitle||extraction.title,
    content:chapter.content,title:chapter.title,url:chapter.url,
    nextUrl:chapters[index+1]?.url||(index===chapters.length-1?extraction.nextUrl:undefined),
  }));
}

function paginateReaderContent(content:string,limit:number){
  const paragraphs=content.split(/\n{2,}/).map((item)=>item.trim()).filter(Boolean);
  if(!paragraphs.length)return [""];
  const pages:string[]=[];
  let page="";
  const push=()=>{if(page.trim())pages.push(page.trim());page="";};
  paragraphs.forEach((paragraph)=>{
    let rest=paragraph;
    while(rest.length){
      const activeLimit=pages.length===0?Math.max(90,Math.floor(limit*.52)):limit;
      const space=Math.max(activeLimit-page.length-(page?2:0),0);
      if(space===0){push();continue;}
      const chunk=rest.slice(0,space);
      page+=(page?"\n\n":"")+chunk;
      rest=rest.slice(chunk.length);
      if(rest.length)push();
    }
  });
  push();
  return pages.length?pages:[""];
}

function normalizeAddress(value: string) {
  const input = value.trim();
  if (!input) return undefined;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(input)) return "https://" + input;
  return "https://www.bing.com/search?q=" + encodeURIComponent(input + " 小说");
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "#F7F4ED", elevation: 100, zIndex: 100 },
  safe: { flex: 1, backgroundColor: "#F7F4ED" },
  header: { minHeight: 72, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIcon: { width: 40, height: 40, borderRadius: 15, backgroundColor: "#E6EEE8", alignItems: "center", justifyContent: "center" },
  title: { color: "#25332B", fontSize: 19, fontWeight: "700" },
  subtitle: { color: "#929088", fontSize: 11, marginTop: 2 },
  close: { width: 42, height: 42, borderRadius: 17, backgroundColor: "#ECE9E1", alignItems: "center", justifyContent: "center" },
  addressRow: { paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", gap: 9 },
  addressBox: { flex: 1, height: 48, borderRadius: 17, backgroundColor: "#ECEAE3", flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 },
  addressInput: { flex: 1, color: "#2D3832", fontSize: 14, paddingVertical: 0 },
  goButton: { width: 48, height: 48, borderRadius: 17, backgroundColor: "#426753", alignItems: "center", justifyContent: "center" },
  browser: { flex: 1, overflow: "hidden", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#DDD9D0", backgroundColor: "#FFFFFF" },
  webError: { alignItems: "center", backgroundColor: "#F7F4ED", flex: 1, justifyContent: "center", padding: 28 },
  webErrorIcon: { alignItems: "center", backgroundColor: "#E7ECE7", borderRadius: 20, height: 58, justifyContent: "center", width: 58 },
  webErrorTitle: { color: "#34443B", fontSize: 18, fontWeight: "700", marginTop: 18 },
  webErrorText: { color: "#929088", fontSize: 13, marginTop: 7 },
  retryButton: { borderColor: "#6A8174", borderRadius: 16, borderWidth: 1, marginTop: 20, paddingHorizontal: 22, paddingVertical: 11 },
  retryText: { color: "#526C5E", fontSize: 13, fontWeight: "700" },
  loadingLine: { position: "absolute", left: 0, right: "35%", top: 0, height: 2, backgroundColor: "#557967" },
  toolbar: { minHeight: Platform.OS === "android" ? 76 : 70, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FBF9F4" },
  navButtons: { flexDirection: "row", gap: 8 },
  toolButton: { width: 43, height: 43, borderRadius: 16, backgroundColor: "#ECEFEA", alignItems: "center", justifyContent: "center" },
  toolDisabled: { backgroundColor: "#F0EEE8" },
  extractButton: { minWidth: 128, height: 46, borderRadius: 18, backgroundColor: "#426753", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 17 },
  buttonDisabled: { backgroundColor: "#AAB8B0" },
  extractText: { color: "#F8F4EA", fontSize: 14, fontWeight: "700" },
  previewShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(30,37,33,0.36)", justifyContent: "flex-end" },
  previewCard: { backgroundColor: "#FBF9F4", borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 22, paddingBottom: 28 },
  previewHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "#D4D0C7", alignSelf: "center", marginBottom: 20 },
  previewIcon: { width: 46, height: 46, borderRadius: 17, backgroundColor: "#E7EFE9", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  previewTitle: { color: "#26332C", fontSize: 22, lineHeight: 29, fontWeight: "700" },
  previewMeta: { color: "#7E827D", fontSize: 13, marginTop: 8 },
  previewText: { color: "#5D625E", fontSize: 14, lineHeight: 22, marginTop: 16 },
  privacy: { color: "#9A9890", fontSize: 11, marginTop: 14 },
  continuousButton: { alignItems: "center", borderColor: "#A9B8AF", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 18, minHeight: 48 },
  continuousText: { color: "#4E695A", fontSize: 14, fontWeight: "700" },
  previewActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  secondaryButton: { flex: 1, height: 50, borderRadius: 18, borderWidth: 1, borderColor: "#70897B", alignItems: "center", justifyContent: "center" },
  secondaryText: { color: "#4E695A", fontSize: 15, fontWeight: "700" },
  primaryButton: { flex: 1.2, height: 50, borderRadius: 18, backgroundColor: "#426B55", alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#F8F4EA", fontSize: 15, fontWeight: "700" },
  readerMode:{position:"absolute",left:0,right:0,top:0,bottom:0,zIndex:20},
  readerHeader:{minHeight:64,paddingHorizontal:10,flexDirection:"row",alignItems:"center",borderBottomWidth:1},
  readerIcon:{width:44,height:44,alignItems:"center",justifyContent:"center"},
  readerHeaderText:{flex:1,alignItems:"center",paddingHorizontal:8},
  readerBook:{fontSize:14,fontWeight:"700"},
  readerChapter:{fontSize:10,marginTop:3},
  readerContent:{paddingTop:24,paddingBottom:118},
  readerPaged:{flex:1,overflow:"hidden",paddingTop:22},
  readerPagedBody:{alignSelf:"center",flex:1},
  readerPagedChapter:{fontFamily:"serif",fontSize:13,marginBottom:18},
  readerPageNumber:{fontSize:10,marginTop:"auto",paddingBottom:8,textAlign:"center",fontVariant:["tabular-nums"]},
  readerLeftTap:{bottom:0,left:0,position:"absolute",top:0,width:"32%"},
  readerRightTap:{bottom:0,position:"absolute",right:0,top:0,width:"32%"},
  readerEyebrow:{fontSize:10,fontWeight:"800",letterSpacing:2.2,marginBottom:15},
  readerTitle:{fontFamily:"serif",fontSize:26,fontWeight:"700",lineHeight:36},
  readerMeta:{fontSize:12,marginTop:9},
  readerRule:{height:1,width:72,marginTop:21,marginBottom:24},
  readerParagraph:{fontFamily:"serif",letterSpacing:.2,marginBottom:17},
  readerEnd:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:12,marginTop:30,marginBottom:12},
  readerEndLine:{width:52,height:1},
  readerToolbar:{position:"absolute",left:10,right:10,bottom:10,minHeight:68,borderRadius:23,borderWidth:1,flexDirection:"row",alignItems:"center",paddingHorizontal:8,overflow:"hidden"},
  readerTool:{width:46,height:48,alignItems:"center",justifyContent:"center"},
  readerDisabled:{opacity:.24},
  readerCenterTool:{flex:1,height:48,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},
  readerCenterText:{fontSize:12,fontWeight:"700"},
  readerAa:{fontFamily:"serif",fontSize:16,fontWeight:"700"},
  readerLoading:{position:"absolute",left:0,right:0,top:0,bottom:0,alignItems:"center",justifyContent:"center"},
  readerLoadingText:{fontSize:13,marginTop:13},
  readerStopButton:{marginTop:16,minHeight:42,paddingHorizontal:20,borderRadius:15,borderWidth:1,alignItems:"center",justifyContent:"center"},
  readerStopText:{fontSize:13,fontWeight:"700"},
  readerPanel:{position:"absolute",left:10,right:10,bottom:84,maxHeight:"58%",borderRadius:24,borderWidth:1,paddingBottom:12,zIndex:25,overflow:"hidden"},
  readerPanelHeader:{minHeight:58,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  readerPanelTitle:{fontSize:17,fontWeight:"800"},
  readerPanelClose:{width:34,height:34,borderRadius:17,alignItems:"center",justifyContent:"center"},
  readerChapterList:{flexGrow:0},
  readerCaptureButton:{marginHorizontal:16,marginBottom:8,minHeight:46,borderRadius:16,borderWidth:1,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},
  readerCaptureText:{fontSize:13,fontWeight:"700"},
  readerChapterItem:{minHeight:54,paddingHorizontal:16,flexDirection:"row",alignItems:"center"},
  readerChapterNo:{width:30,marginRight:11,fontSize:10,fontVariant:["tabular-nums"]},
  readerChapterName:{flex:1,fontSize:14,marginRight:8},
  readerThemes:{flexDirection:"row",gap:14,paddingHorizontal:16,paddingVertical:9},
  readerTheme:{width:50,height:50,borderRadius:18,alignItems:"center",justifyContent:"center"},
  readerFlowRow:{minHeight:52,marginHorizontal:16,marginTop:8,borderRadius:17,padding:4,flexDirection:"row",alignItems:"center"},
  readerFlowLabel:{fontSize:13,fontWeight:"700",marginLeft:9,marginRight:"auto"},
  readerFlowOption:{minHeight:38,borderRadius:13,paddingHorizontal:12,alignItems:"center",justifyContent:"center"},
  readerFlowText:{fontSize:11,fontWeight:"700"},
  readerFontRow:{minHeight:56,marginHorizontal:16,marginTop:10,borderRadius:18,paddingHorizontal:12,flexDirection:"row",alignItems:"center"},
  readerFontLabel:{flex:1,fontSize:14,fontWeight:"700"},
  readerFontButton:{width:40,height:40,alignItems:"center",justifyContent:"center"},
  readerFontValue:{width:32,textAlign:"center",fontSize:14,fontWeight:"800",fontVariant:["tabular-nums"]},
});
