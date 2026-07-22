import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Ionicons } from "@expo/vector-icons";
import { useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Animated as RNAnimated,
  BackHandler,
  Easing,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { Text, TextInput, useI18n } from "../i18n";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideInRight, SlideOutRight } from "react-native-reanimated";
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
import { PerformanceRegion } from "../components/PerformanceMonitor";
import type { ReaderFont, WebChapterExtraction, WebChapterLink, WebPageExtraction, WebReaderFlow } from "../types";
import { getReaderFontFamily, readerFontOptions } from "../utils/readerFonts";
import { mergeWebChapterLinks } from "../services/webCapture";
import {
  setVolumeKeyTurnsEnabled,
  subscribeToVolumeKeyTurns,
  supportsVolumeKeyTurns,
} from "../services/readerControls";

type WebVisit = { url: string; title: string; visitedAt: number };
type WebCatalogHint = WebVisit & {
  bookTitle?: string;
  chapterLinks?: WebChapterLink[];
};
type BrowserPanel = "history" | "catalog" | undefined;
const WEB_HISTORY_KEY = "modu.web-history.v1";
const WEB_FAVORITES_KEY = "modu.web-favorites.v1";
const WEB_CATALOG_HINTS_KEY = "modu.web-catalog-hints.v1";

type ContinuousCapture = {
  author?: string;
  bookTitle?: string;
  tocUrl?: string;
  chapters: WebChapterExtraction[];
  visited: Set<string>;
};

type Props = {
  visible: boolean;
  onAdd: (extraction: WebPageExtraction, silent?: boolean) => Promise<void>;
  onClose: () => void;
  onRead: (extraction: WebPageExtraction) => void;
  onResolveSource?: (url: string, title: string) => Promise<WebPageExtraction | undefined>;
  initialExtraction?: WebPageExtraction;
  initialUrl?: string;
  readerFont: ReaderFont;
  onReaderFontChange: (font: ReaderFont) => void;
  webReaderFlow: WebReaderFlow;
  volumeKeysEnabled: boolean;
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

type WebReaderParagraphsProps = {
  color: string;
  content: string;
  contentKey: string;
  fontFamily?: string;
  fontSize: number;
  selectable?: boolean;
};

const WebReaderParagraphs = memo(function WebReaderParagraphs({
  color,
  content,
  contentKey,
  fontFamily,
  fontSize,
  selectable = false,
}: WebReaderParagraphsProps) {
  const paragraphs = useMemo(
    () => content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean),
    [content],
  );
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <Text
          key={`${contentKey}-${index}`}
          selectable={selectable}
          style={[
            styles.readerParagraph,
            {
              color,
              fontFamily,
              fontSize,
              lineHeight: fontSize * 1.82,
            },
          ]}
        >
          {paragraph}
        </Text>
      ))}
    </>
  );
});

const START_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
html,body{height:100%;margin:0;background:#f7f4ed;color:#24332b;font-family:system-ui,sans-serif}body{display:grid;place-items:center}.card{width:min(82vw,520px);text-align:center}.mark{width:76px;height:76px;border-radius:24px;margin:auto;display:grid;place-items:center;background:#e6eee8;color:#4f705e;font-size:34px}.title{font-size:28px;font-weight:700;margin:24px 0 10px}.text{font-size:15px;line-height:1.7;color:#7e837f}.hint{margin-top:28px;padding:14px 18px;border:1px solid #dedbd3;border-radius:18px;background:#fbfaf6;color:#56675e;font-size:14px}
</style></head><body><div class="card"><div class="mark">◌</div><div class="title">去故事生长的地方</div><div class="text">输入网址、书名或作者。<br>打开正文，让墨读替你拂去喧闹。</div><div class="hint">只带回你能够正常抵达的文字</div></div></body></html>`;

const EXTRACTION_SCRIPT = "\n(function () {\n  try {\n    if (!/^https?:$/.test(location.protocol)) throw new Error('请先打开具体网页');\n    var copy = document.cloneNode(true);\n    copy.querySelectorAll('script,style,noscript,svg,canvas,iframe,video,audio,nav,footer,form,input,textarea,select,button,[role=\"navigation\"],[aria-hidden=\"true\"],.ad,.ads,.advertisement,.recommend,.related,.comment,.comments').forEach(function (node) { node.remove(); });\n    var selectors = ['article','main','[role=\"main\"]','#chaptercontent','#content','#content1','.chapter-content','.read-content','.reading-content','.article-content','.entry-content','.post-content','.novel-content','.content'];\n    var candidates = [];\n    selectors.forEach(function (selector) { copy.querySelectorAll(selector).forEach(function (node) { if (candidates.indexOf(node) < 0) candidates.push(node); }); });\n    if (copy.body) candidates.push(copy.body);\n    var best = null, bestScore = -1;\n    candidates.forEach(function (node) {\n      var text = (node.innerText || node.textContent || '').trim();\n      if (text.length < 120) return;\n      var links = Array.prototype.slice.call(node.querySelectorAll('a')).reduce(function (sum, link) { return sum + (link.textContent || '').trim().length; }, 0);\n      var score = text.length + node.querySelectorAll('p,br').length * 80 + (/chapter|article|read|content|novel|text/.test(((node.id || '') + ' ' + (node.className || '')).toLowerCase()) ? 1200 : 0) - links * 1.6;\n      if (score > bestScore) { best = node; bestScore = score; }\n    });\n    if (!best) throw new Error('没有识别到足够长的正文');\n    best.querySelectorAll('br').forEach(function (br) { br.replaceWith('\\n'); });\n    var lines = (best.innerText || best.textContent || '').split(/\\n+/).map(function (line) { return line.replace(/[\\t\\u00a0 ]+/g, ' ').trim(); }).filter(function (line) { return line.length > 0; });\n    var content = lines.join('\\n\\n').replace(/\\n{3,}/g, '\\n\\n').trim();\n    if (content.length < 120) throw new Error('正文太短，请打开具体章节后重试');\n    if (content.length > 500000) content = content.slice(0, 500000);\n    var heading = document.querySelector('.header .title, #chaptercontent h1, .chapter-title, .chaptername, .chapter-name, article h1, main h1, h1');\n    var title = ((heading && heading.textContent) || document.title || '网页摘录').replace(/[\\t\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();\n    var bookNode = document.querySelector('meta[property=\"og:novel:book_name\"],meta[property$=\"book_name\"],meta[name=\"book_name\"],meta[property=\"og:title\"]');\n    var bookTitle = bookNode ? (bookNode.getAttribute('content') || '') : '';\n    var cachedBook = null;\n    try { var runtimeId = typeof id !== 'undefined' ? id : null; if (runtimeId !== null && window.lastread && typeof window.lastread.get === 'function') cachedBook = window.lastread.get(runtimeId); } catch (ignore) {}\n    if (!bookTitle && cachedBook && cachedBook.length > 2) bookTitle = cachedBook[1] || '';\n    if (!bookTitle) bookTitle = title.replace(/(?:第.{1,16}[章节回卷集部篇]|chapter\\s*\\d+)[\\s\\S]*$/i, '').replace(/[-_|].*$/, '').trim();\n    var authorNode = document.querySelector('meta[name=\"author\"],meta[property$=\"author\"],[rel=\"author\"],.author,[class*=\"author\"],[id*=\"author\"]');\n    var author = authorNode ? (authorNode.getAttribute('content') || authorNode.textContent || '') : '';\n    if (!author && cachedBook && cachedBook.length > 2) author = cachedBook[2] || '';\n    if (!author) { var m = ((document.body && document.body.innerText) || '').slice(0,1200).match(/(?:作者|作\\s*者)\\s*[：:]\\s*([^\\n]{1,32})/); author = m ? m[1] : ''; }\n    author = author.replace(/^(?:作者|作\\s*者)\\s*[：:]?\\s*/, '').trim();\n    var chapterLinks = [], chapterSeen = {};\n    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (link) {\n      var label = (link.textContent || '').replace(/[\\t\\n\\u00a0 ]+/g, ' ').trim();\n      var compact = label.replace(/\\s+/g, '');\n      var href = link.href || '';\n      if (!href || !/^https?:/i.test(href) || label.length < 2 || label.length > 100) return;\n      if (!/(?:第[零〇一二两三四五六七八九十百千万0-9]+[章节回卷集部篇]|chapter\\s*[0-9]+|序章|楔子|番外)/i.test(compact)) return;\n      if (chapterSeen[href]) return; chapterSeen[href] = true;\n      chapterLinks.push({ title: label.slice(0, 100), url: href });\n    });\n    if (chapterLinks.length < 3) chapterLinks = [];\n    if (chapterLinks.length > 2000) chapterLinks = chapterLinks.slice(0, 2000);\n    var tocUrl = '';\n    Array.prototype.some.call(document.querySelectorAll('a'), function (link) {\n      var tocLabel = (link.textContent || '').replace(/\\s+/g, '');\n      if (/^(目录|章节目录|全部章节|章节列表|返回目录|返回书页|书籍首页|更多章节|contents?|catalog)$/i.test(tocLabel) && link.href) { tocUrl = link.href; return true; }\n      return false;\n    });\n    var nextUrl = '', relNext = document.querySelector('link[rel=\"next\"],a[rel=\"next\"]');\n    if (relNext) nextUrl = relNext.href || relNext.getAttribute('href') || '';\n    if (!nextUrl) Array.prototype.some.call(document.querySelectorAll('a'), function (link) {\n      var label = (link.textContent || '').replace(/\\s+/g, '');\n      if (/^(下一章|下章|下一页|下一篇|继续阅读|nextchapter|next)$/i.test(label) && link.href) { nextUrl = link.href; return true; }\n      return false;\n    });\n    var routeMatch = location.href.match(/\\/#\\/book\\/(\\d+)\\/(\\d+)(?:_\\d+)?\\.html/i);\n    if (routeMatch) {\n      if (!tocUrl) tocUrl = location.origin + '/#/book/' + routeMatch[1] + '/';\n      if (!nextUrl) nextUrl = location.origin + '/#/book/' + routeMatch[1] + '/' + (Number(routeMatch[2]) + 1) + '.html';\n    }\n    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-extraction', payload:{ bookTitle:bookTitle.slice(0,120), title:title.slice(0,120), author:author.slice(0,80), content:content, url:location.href, nextUrl:nextUrl, tocUrl:tocUrl, chapterLinks:chapterLinks } }));\n  } catch (error) {\n    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-extraction-error', message:error && error.message ? error.message : '正文提取失败' }));\n  }\n})();\ntrue;\n";

const CATALOG_EXTRACTION_SCRIPT = String.raw`
(function () {
  try {
    if (!/^https?:$/.test(location.protocol)) throw new Error('请先打开网页目录');
    var seen = {}, links = [];
    var add = function (link, relaxed) {
      var label = (link.textContent || '').replace(/[\t\n\u00a0 ]+/g, ' ').trim();
      var compact = label.replace(/\s+/g, '');
      var href = link.href || '';
      if (!href || !/^https?:/i.test(href) || label.length < 1 || label.length > 100 || seen[href] || href.split('#')[0] === location.href.split('#')[0]) return;
      var looksLikeChapter = /(?:第[零〇一二两三四五六七八九十百千万0-9]+[章节回卷集部篇]|chapter\s*[0-9]+|序章|楔子|番外)/i.test(compact);
      var looksLikeChapterUrl = /\/(?:chapter|chap|read|book)\b|[_/-](?:chapter|chap|read)[_/-]?\d/i.test(href);
      var navigationLabel = /^(首页|主页|返回|上一页|下一页|登录|注册|书架|排行|分类|搜索|home|back|next|login|register)$/i.test(compact);
      var sameOrigin = false;
      try { sameOrigin = new URL(href).origin === location.origin; } catch (_) {}
      if (!looksLikeChapter && !(relaxed && (looksLikeChapterUrl || (sameOrigin && !navigationLabel)))) return;
      seen[href] = true;
      links.push({ title: label.slice(0, 100), url: href });
    };
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (link) { add(link, false); });
    if (links.length < 3) {
      seen = {}; links = [];
      var containers = Array.prototype.slice.call(document.querySelectorAll('#list,.list,.chapter-list,.chapters,.catalog,[class*="chapter"],[id*="chapter"],main,article'));
      var best = containers.sort(function (a, b) { return b.querySelectorAll('a[href]').length - a.querySelectorAll('a[href]').length; })[0];
      if ((!best || best.querySelectorAll('a[href]').length < 3) && document.body) best = document.body;
      if (best && best.querySelectorAll('a[href]').length >= 3) {
        Array.prototype.forEach.call(best.querySelectorAll('a[href]'), function (link) { add(link, true); });
      }
    }
    var bookNode = document.querySelector('meta[property="og:novel:book_name"],meta[property$="book_name"],meta[name="book_name"],meta[property="og:title"]');
    var bookLabel = document.querySelector('.bookname,.book-name,[class*="book-title"],article h1,main h1,h1');
    var bookTitle = ((bookNode && bookNode.getAttribute('content')) || (bookLabel && bookLabel.textContent) || document.title || '').replace(/[\t\n]+/g, ' ').trim();
    var publish = function (resolvedLinks) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-catalog', payload:{ bookTitle:bookTitle.slice(0,120), tocUrl:location.href, chapterLinks:resolvedLinks.slice(0,2000) } }));
    };
    var bqgRoute = location.href.match(/\/#\/book\/(\d+)\/?/i);
    if (bqgRoute && /(^|\.)bqg107\.xyz$/i.test(location.hostname) && links.length < 100 && typeof fetch === 'function') {
      fetch('/api/booklist?id=' + encodeURIComponent(bqgRoute[1]), { credentials:'include' })
        .then(function (response) { if (!response.ok) throw new Error('目录请求失败'); return response.json(); })
        .then(function (data) {
          if (!data || !Array.isArray(data.list) || data.list.length < 2) throw new Error('目录数据为空');
          publish(data.list.map(function (label, index) { return { title:String(label).slice(0,100), url:location.origin + '/book/' + bqgRoute[1] + '/' + (index + 1) + '.html' }; }));
        })
        .catch(function (error) {
          if (links.length >= 2) publish(links);
          else window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-catalog-error', message:error && error.message ? error.message : '章节目录提取失败' }));
        });
      return;
    }
    if (links.length < 2) throw new Error('这一页没有识别到章节目录');
    publish(links);
  } catch (error) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type:'modu-catalog-error', message:error && error.message ? error.message : '章节目录提取失败' }));
  }
})();
true;
`;
export function WebReaderModal({ visible, onAdd, onClose, onRead, onResolveSource, initialExtraction, initialUrl, readerFont, onReaderFontChange, webReaderFlow, onWebReaderFlowChange, volumeKeysEnabled }: Props) {
  const Alert = useAppAlert();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const [address, setAddress] = useState("");
  const [url, setUrl] = useState<string>();
  const [currentUrl, setCurrentUrl] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [webHistory, setWebHistory] = useState<WebVisit[]>([]);
  const [webFavorites, setWebFavorites] = useState<WebVisit[]>([]);
  const [catalogHints, setCatalogHints] = useState<WebCatalogHint[]>([]);
  const [addressFocused, setAddressFocused] = useState(false);
  const [browserPanel, setBrowserPanel] = useState<BrowserPanel>();
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
  const [chapterCatalog,setChapterCatalog]=useState<WebChapterLink[]>([]);
  const [readerIndex,setReaderIndex]=useState(0);
  const [readerTheme,setReaderTheme]=useState<ReaderModeTheme>("paper");
  const [readerFontSize,setReaderFontSize]=useState(19);
  const [readerPageIndex,setReaderPageIndex]=useState(0);
  const [readerPageGestureLocked,setReaderPageGestureLocked]=useState(false);
  const [readerControlsVisible,setReaderControlsVisible]=useState(false);
  const [readerPanel,setReaderPanel]=useState<ReaderPanel>();
  const [readerLoading,setReaderLoading]=useState(false);
  const savedBookRef=useRef(false);
  const readerPageDrag=useRef(new RNAnimated.Value(0)).current;
  const readerControlsProgress=useRef(new RNAnimated.Value(0)).current;
  const readerScrollTouchRef=useRef({x:0,y:0});
  const readerPageAnimatingRef=useRef(false);
  const readerPageTargetRef=useRef<"start"|"end">("start");
  const readerRequestRef=useRef(false);
  const extractionActionRef=useRef<"read"|"save"|undefined>(undefined);
  const readerNavigationRef=useRef(false);
  const catalogRequestRef=useRef(false);
  const catalogRequestKindRef=useRef<"marked"|"reader"|undefined>(undefined);
  const catalogRequestSeedRef=useRef<WebChapterLink[]>([]);
  const readerScrollRef=useRef<ScrollView>(null);
  const addressGuideRef=useRef<View>(null);
  const browserNavGuideRef=useRef<View>(null);
  const browserActionsGuideRef=useRef<View>(null);
  const readerGestureGuideRef=useRef<View>(null);
  const readerExitGuideRef=useRef<View>(null);
  const readerChapterGuideRef=useRef<View>(null);
  const readerAppearanceGuideRef=useRef<View>(null);
  const readerSaveGuideRef=useRef<View>(null);
  const {width:screenWidth,height:screenHeight}=useWindowDimensions();
  const isTabletToolbar=screenWidth>=600;
  const readerPalette=READER_MODE_THEMES[readerTheme];
  const readerFontFamily=getReaderFontFamily(readerFont);
  const readerColumnWidth=Math.min(screenWidth-38,screenWidth>=600?560:720);
  const readerFirstPageFactor=screenWidth>=600?.62:.72;
  const readerPageLimit=Math.max(150,Math.floor((readerColumnWidth/readerFontSize)*(Math.max(screenHeight-insets.top-insets.bottom-(screenWidth>=600?170:150),260)/(readerFontSize*1.82))*.8));
  const readerPages=useMemo(()=>paginateReaderContent(preview?.content??"",readerPageLimit,readerFirstPageFactor),[preview?.content,readerFirstPageFactor,readerPageLimit]);
  const previousReaderPage=useMemo(()=>{
    if(!preview)return undefined;
    if(readerPageIndex>0)return {chapter:preview,pages:readerPages,pageIndex:readerPageIndex-1};
    const chapter=readerHistory[readerIndex-1];
    if(!chapter)return undefined;
    const pages=paginateReaderContent(chapter.content,readerPageLimit,readerFirstPageFactor);
    return {chapter,pages,pageIndex:Math.max(pages.length-1,0)};
  },[preview,readerPageIndex,readerPages,readerHistory,readerIndex,readerFirstPageFactor,readerPageLimit]);
  const nextReaderPage=useMemo(()=>{
    if(!preview)return undefined;
    if(readerPageIndex<readerPages.length-1)return {chapter:preview,pages:readerPages,pageIndex:readerPageIndex+1};
    const chapter=readerHistory[readerIndex+1];
    if(!chapter)return undefined;
    const pages=paginateReaderContent(chapter.content,readerPageLimit,readerFirstPageFactor);
    return {chapter,pages,pageIndex:0};
  },[preview,readerPageIndex,readerPages,readerHistory,readerIndex,readerFirstPageFactor,readerPageLimit]);

  const previousReaderPageTranslate=useMemo(()=>readerPageDrag.interpolate({
    inputRange:[-screenWidth,0,screenWidth],outputRange:[-screenWidth,-screenWidth,0],extrapolate:"clamp",
  }),[readerPageDrag,screenWidth]);
  const nextReaderPageTranslate=useMemo(()=>readerPageDrag.interpolate({
    inputRange:[-screenWidth,0,screenWidth],outputRange:[0,screenWidth,screenWidth],extrapolate:"clamp",
  }),[readerPageDrag,screenWidth]);

  useEffect(()=>{
    if(visible&&readerMode&&webReaderFlow==="paged")return;
    readerPageDrag.stopAnimation();
    readerPageDrag.setValue(0);
    readerPageAnimatingRef.current=false;
    setReaderPageGestureLocked(false);
  },[readerMode,readerPageDrag,visible,webReaderFlow]);

  useEffect(()=>{
    RNAnimated.timing(readerControlsProgress,{
      toValue:readerControlsVisible?1:0,
      duration:readerControlsVisible?190:145,
      easing:readerControlsVisible?Easing.out(Easing.cubic):Easing.in(Easing.quad),
      useNativeDriver:true,
    }).start();
  },[readerControlsProgress,readerControlsVisible]);

  const source = useMemo(() => (url ? { uri: url } : { html: START_HTML }), [url]);
  const suggestions = useMemo(() => {
    const query = address.trim().toLocaleLowerCase();
    if (!query) return [];
    const merged = [...webFavorites, ...webHistory];
    const seen = new Set<string>();
    return merged.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return item.url.toLocaleLowerCase().includes(query) || item.title.toLocaleLowerCase().includes(query);
    }).slice(0, 6);
  }, [address, webFavorites, webHistory]);
  const isFavorite = Boolean(currentUrl && webFavorites.some((item) => item.url === currentUrl));
  const normalizedCurrentUrl = normalizeCatalogUrl(currentUrl);
  const currentCatalogHint = catalogHints.find((item) => normalizeCatalogUrl(item.url) === normalizedCurrentUrl);
  const isCatalogMarked = Boolean(currentCatalogHint);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(WEB_HISTORY_KEY),
      AsyncStorage.getItem(WEB_FAVORITES_KEY),
      AsyncStorage.getItem(WEB_CATALOG_HINTS_KEY),
    ])
      .then(([historyValue, favoritesValue, catalogValue]) => {
        if (historyValue) setWebHistory(JSON.parse(historyValue));
        if (favoritesValue) setWebFavorites(JSON.parse(favoritesValue));
        if (catalogValue) setCatalogHints(JSON.parse(catalogValue));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!currentCatalogHint?.chapterLinks?.length) return;
    setChapterCatalog(orderWebCatalogLinks(mergeWebChapterLinks(currentCatalogHint.chapterLinks)));
  }, [currentCatalogHint]);

  const rememberCatalogHint = useCallback((hint: WebCatalogHint) => {
    const normalized = normalizeCatalogUrl(hint.url);
    if (!normalized) return;
    setCatalogHints((current) => {
      const existing = current.find((item) => normalizeCatalogUrl(item.url) === normalized);
      const nextHint = {
        ...existing,
        ...hint,
        url: normalized,
        title: hint.title || existing?.title || normalized,
        visitedAt: Date.now(),
        chapterLinks: mergeWebChapterLinks(existing?.chapterLinks, hint.chapterLinks),
      };
      const next = [nextHint, ...current.filter((item) => normalizeCatalogUrl(item.url) !== normalized)].slice(0, 80);
      void AsyncStorage.setItem(WEB_CATALOG_HINTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const recordVisit = useCallback((target: string, title?: string) => {
    if (!/^https?:\/\//i.test(target)) return;
    setWebHistory((current) => {
      const next = [{ url: target, title: title?.trim() || target, visitedAt: Date.now() }, ...current.filter((item) => item.url !== target)].slice(0, 80);
      void AsyncStorage.setItem(WEB_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const openAddress = useCallback((target: string) => {
    Keyboard.dismiss();
    setAddressFocused(false);
    setBrowserPanel(undefined);
    setAddress(target);
    setPreview(undefined);
    if (target === url) webRef.current?.reload();
    else setUrl(target);
  }, [url]);

  const openHome = useCallback(() => {
    setUrl(undefined);
    setCurrentUrl("");
    setCurrentTitle("");
    setAddress("");
    setPreview(undefined);
    setBrowserPanel(undefined);
    setAddressFocused(false);
  }, []);

  const toggleFavorite = useCallback(() => {
    if (!currentUrl) return;
    setWebFavorites((current) => {
      const exists = current.some((item) => item.url === currentUrl);
      const next = exists
        ? current.filter((item) => item.url !== currentUrl)
        : [{ url: currentUrl, title: currentTitle || currentUrl, visitedAt: Date.now() }, ...current];
      void AsyncStorage.setItem(WEB_FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, [currentTitle, currentUrl]);

  useEffect(() => {
    if (!visible) return;
    setReaderControlsVisible(false);
    if (!initialExtraction) {
      savedBookRef.current = false;
      setReaderMode(false);
      setReaderPanel(undefined);
      setReaderLoading(false);
      setReaderHistory([]);
      setChapterCatalog([]);
      catalogRequestRef.current = false;
      setReaderIndex(0);
      setPreview(undefined);
      if (initialUrl) {
        setAddress(initialUrl);
        setCurrentUrl(initialUrl);
        setUrl(initialUrl);
        setWebViewKey((value) => value + 1);
      }
      return;
    }
    savedBookRef.current = true;
    const history = toReaderHistory(initialExtraction);
    const catalog = mergeWebChapterLinks(
      initialExtraction.chapterLinks,
      history.map(({ title, url }) => ({ title, url })),
    );
    const savedIndex = Math.max(0, history.findIndex((chapter) => chapter.url === initialExtraction.url));
    const selected = history[savedIndex] ?? history[0];
    const target = initialUrl || selected.url;
    const shouldRefreshCatalog = Boolean(initialExtraction.tocUrl && target === initialExtraction.tocUrl);
    catalogRequestRef.current = shouldRefreshCatalog;
    const orderedHistory = orderReaderHistory(history, catalog);
    const orderedIndex = Math.max(0, orderedHistory.findIndex((chapter) => chapter.url === selected.url));
    setReaderHistory(orderedHistory);
    setChapterCatalog(catalog);
    setReaderIndex(orderedIndex);
    setPreview({ ...selected, chapterLinks: catalog });
    setReaderPanel(undefined);
    setReaderLoading(shouldRefreshCatalog);
    setReaderMode(true);
    setAddress(target);
    setUrl(target);
    setWebViewKey((value) => value + 1);
    requestAnimationFrame(() => readerScrollRef.current?.scrollTo({ animated: false, y: 0 }));
  }, [initialExtraction, initialUrl, visible]);

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
    const target = normalizeAddress(address, currentUrl);
    if (!target) return;
    openAddress(target);
  };

  const exitReaderMode=()=>{
    readerRequestRef.current=false;
    readerNavigationRef.current=false;
    catalogRequestRef.current=false;
    setReaderLoading(false);
    setReaderPanel(undefined);
    setReaderControlsVisible(false);
    setReaderMode(false);
    setPreview(undefined);
  };

  const closeOrGoBack = () => {
    if(addressFocused){Keyboard.dismiss();setAddressFocused(false);return;}
    if(browserPanel){setBrowserPanel(undefined);return;}
    if(readerPanel){setReaderPanel(undefined);return;}
    if(readerMode){exitReaderMode();return;}
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
  }, [addressFocused, browserPanel, canGoBack, onClose, preview, readerControlsVisible, readerMode, readerPanel, visible]);

  const handleNavigation = (state: WebViewNavigation) => {
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
    setLoading(state.loading);
    setCurrentTitle(state.title || state.url);
    if (!state.loading) recordVisit(state.url, state.title);
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
      tocUrl: session.tocUrl,
      chapterLinks: mergeWebChapterLinks(chapterCatalog, session.chapters),
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
      if (message.type === "modu-catalog" && message.payload?.chapterLinks) {
        const requestKind = catalogRequestKindRef.current;
        catalogRequestRef.current = false;
        catalogRequestKindRef.current = undefined;
        setReaderLoading(false);
        const merged = orderWebCatalogLinks(mergeWebChapterLinks(
          message.payload.chapterLinks,
          catalogRequestSeedRef.current,
          readerHistory.map(({ title, url }) => ({ title, url })),
        ));
        setChapterCatalog(merged);
        const tocUrl = message.payload.tocUrl || currentUrl;
        if (tocUrl) {
          rememberCatalogHint({
            url: tocUrl,
            title: message.payload.bookTitle || currentTitle || tocUrl,
            bookTitle: message.payload.bookTitle,
            chapterLinks: merged,
            visitedAt: Date.now(),
          });
        }
        setReaderHistory((current) => orderReaderHistory(
          current.map((chapter) => ({ ...chapter, chapterLinks: merged })),
          merged,
        ));
        setPreview((current) => current ? {
          ...current,
          bookTitle: current.bookTitle || message.payload?.bookTitle,
          tocUrl: message.payload?.tocUrl || current.tocUrl,
          chapterLinks: merged,
        } : current);
        const current = preview ?? readerHistory[readerIndex];
        if (savedBookRef.current && current) {
          void onAdd({
            ...current,
            tocUrl: message.payload.tocUrl || current.tocUrl,
            chapterLinks: merged,
            chapters: readerHistory.map(({ title, content, url }) => ({ title, content, url })),
          }, true);
        }
        if (requestKind === "marked") setBrowserPanel("catalog");
        return;
      }
      if (message.type === "modu-catalog-error") {
        const requestKind = catalogRequestKindRef.current;
        catalogRequestRef.current = false;
        catalogRequestKindRef.current = undefined;
        setReaderLoading(false);
        Alert.alert(
          requestKind === "marked" ? t("目录页已标记") : t("没有识别到章节目录"),
          requestKind === "marked"
            ? t("标记已保存在本机，但暂时没有识别出清晰的章节入口。")
            : message.message || t("这一页没有找到清晰的章节入口。"),
        );
        return;
      }
      if (message.type === "modu-extraction" && message.payload) {
        const extracted = message.payload;
        const mergedCatalog = mergeWebChapterLinks(
          chapterCatalog,
          extracted.chapterLinks,
          [{ title: extracted.title, url: extracted.url }],
        );
        extracted.chapterLinks = mergedCatalog;
        setChapterCatalog(mergedCatalog);
        const session = captureRef.current;
        if(!session){
          const payload=extracted;
          const navigating=readerNavigationRef.current;
          const action=extractionActionRef.current;
          extractionActionRef.current=undefined;
          const open=action==="read"||readerRequestRef.current||navigating||readerMode;
          readerRequestRef.current=false;
          readerNavigationRef.current=false;
          setReaderLoading(false);
          if(action==="save"){
            void onAdd(payload).then(()=>{savedBookRef.current=true;}).catch(()=>Alert.alert("收藏失败", "暂时无法把这个网页加入书架。")).finally(()=>setSaving(false));
            setPreview(undefined);
            return;
          }
          setSaving(false);
          setPreview(payload);
          if(open){
            if(navigating){
              const found=readerHistory.findIndex((item)=>item.url===payload.url);
              const nextHistory=orderReaderHistory(found>=0?readerHistory:[...readerHistory,payload],mergedCatalog);
              const nextIndex=nextHistory.findIndex((item)=>item.url===payload.url);
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
        const payload = extracted;
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
        const fallbackAction = extractionActionRef.current;
        if (fallbackAction && !captureRef.current && onResolveSource && currentUrl) {
          extractionActionRef.current=undefined;
          setReaderLoading(true);
          void onResolveSource(currentUrl,currentTitle).then(async (resolved)=>{
            if(!resolved)throw new Error(message.message || "请打开具体章节页面后再试。");
            const catalog=mergeWebChapterLinks(chapterCatalog,resolved.chapterLinks,[{title:resolved.title,url:resolved.url}]);
            resolved.chapterLinks=catalog;
            setChapterCatalog(catalog);
            if(fallbackAction==="save"){
              await onAdd(resolved);
              savedBookRef.current=true;
              setPreview(undefined);
            }else{
              const history=orderReaderHistory(toReaderHistory(resolved),catalog);
              setReaderHistory(history);
              setReaderIndex(0);
              setPreview({...history[0],chapterLinks:catalog});
              setReaderMode(true);
            }
          }).catch((error)=>{
            Alert.alert("没有提取到正文",error instanceof Error?error.message:(message.message || "请打开具体章节页面后再试。"));
          }).finally(()=>{
            readerRequestRef.current=false;
            readerNavigationRef.current=false;
            setSaving(false);
            setReaderLoading(false);
          });
          return;
        }
        readerRequestRef.current=false; readerNavigationRef.current=false; catalogRequestRef.current=false; extractionActionRef.current=undefined; setSaving(false); setReaderLoading(false);
        if (captureRef.current?.chapters.length) {
          finishContinuousCapture();
          Alert.alert("连续收录已停止", message.message || "后续页面未识别到正文，已保留前面的章节。");
        } else {
          Alert.alert("没有提取到正文", message.message || "请打开具体章节页面后再试。");
        }
      }
    } catch {
      readerRequestRef.current=false; readerNavigationRef.current=false; catalogRequestRef.current=false; extractionActionRef.current=undefined; setSaving(false); setReaderLoading(false);
      if (captureRef.current?.chapters.length) finishContinuousCapture();
      else Alert.alert("提取失败", "页面返回了无法识别的内容。");
    }
  };

  const extract = (action: "read" | "save") => {
    if (!currentUrl || loading || extracting || saving) return;
    const landingChapter = getBookLandingChapterUrl(currentUrl, chapterCatalog);
    if (landingChapter) {
      extractionActionRef.current=action;
      readerRequestRef.current=true;
      if(action==="read"){
        setReaderHistory([]);
        setReaderIndex(0);
      }else{
        setSaving(true);
      }
      setExtracting(true);
      openAddress(landingChapter);
      return;
    }
    extractionActionRef.current=action;
    readerRequestRef.current=action==="read";
    if(action==="save") setSaving(true);
    setExtracting(true);
    webRef.current?.injectJavaScript(EXTRACTION_SCRIPT);
  };


  const markCurrentAsCatalog = () => {
    if (!currentUrl || loading || extracting || saving || capturing) return;
    rememberCatalogHint({
      url: currentUrl,
      title: currentTitle || currentUrl,
      visitedAt: Date.now(),
      chapterLinks: currentCatalogHint?.chapterLinks,
      bookTitle: currentCatalogHint?.bookTitle,
    });
    catalogRequestRef.current = true;
    catalogRequestKindRef.current = "marked";
    catalogRequestSeedRef.current = mergeWebChapterLinks(currentCatalogHint?.chapterLinks);
    setExtracting(true);
    webRef.current?.injectJavaScript(CATALOG_EXTRACTION_SCRIPT);
  };

  const startContinuousCapture = () => {
    if (!preview?.nextUrl) return;
    captureRef.current = {
      author: preview.author,
      bookTitle: preview.bookTitle || preview.title,
      tocUrl: preview.tocUrl,
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
    if(catalogRequestRef.current){
      setTimeout(()=>{
        if(!catalogRequestRef.current)return;
        setExtracting(true);
        webRef.current?.injectJavaScript(CATALOG_EXTRACTION_SCRIPT);
      },180);
      return;
    }
    if(readerNavigationRef.current||readerRequestRef.current){
      setTimeout(()=>{
        if(!readerNavigationRef.current&&!readerRequestRef.current)return;
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
    readerRequestRef.current=false; readerNavigationRef.current=false; catalogRequestRef.current=false;
    setWebViewKey((value) => value + 1);
    Alert.alert("网页已恢复", "页面渲染出现异常，已返回起始页，请重新打开。");
  };

  const enterReaderMode=(extraction=preview)=>{
    if(!extraction)return;
    const history=toReaderHistory(extraction);
    const catalog=mergeWebChapterLinks(chapterCatalog,extraction.chapterLinks,history);
    setChapterCatalog(catalog);
    setReaderHistory(orderReaderHistory(history,catalog)); setPreview({...history[0],chapterLinks:catalog});
    setReaderIndex(0); setReaderPanel(undefined); setReaderControlsVisible(false); setReaderMode(true);
    requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
  };
  const openWebCatalog=()=>{
    const target=preview?.tocUrl;
    if(!target||readerLoading)return;
    catalogRequestRef.current=true;
    catalogRequestKindRef.current="reader";
    catalogRequestSeedRef.current=mergeWebChapterLinks(chapterCatalog);
    setReaderPanel(undefined);
    setReaderLoading(true);
    setAddress(target);
    if(target===url)webRef.current?.reload();else setUrl(target);
  };
  const openCatalogChapter=(link:WebChapterLink)=>{
    setReaderControlsVisible(false);
    const loadedIndex=readerHistory.findIndex((chapter)=>chapter.url===link.url);
    if(loadedIndex>=0){openReaderChapter(loadedIndex);return;}
    if(readerLoading)return;
    readerNavigationRef.current=true;
    setReaderPanel(undefined);
    setReaderLoading(true);
    setAddress(link.url);
    if(link.url===url)webRef.current?.reload();else setUrl(link.url);
  };
  function openReaderChapter(index:number,target:"start"|"end"="start"){
    const chapter=readerHistory[index]; if(!chapter)return;
    readerPageTargetRef.current=target;
    setReaderIndex(index); setPreview(chapter); setReaderPanel(undefined); setReaderControlsVisible(false);
    if(savedBookRef.current){
      void onAdd({
        ...chapter,
        bookTitle:chapter.bookTitle||readerHistory[0]?.bookTitle||readerHistory[0]?.title,
        chapters:readerHistory.map(({title,content,url})=>({title,content,url})),
        chapterLinks:chapterCatalog,
      },true);
    }
    requestAnimationFrame(()=>readerScrollRef.current?.scrollTo({animated:false,y:0}));
  }
  const openNextReaderChapter=()=>{
    if(readerIndex<readerHistory.length-1){openReaderChapter(readerIndex+1);return;}
    if(!preview?.nextUrl||readerLoading)return;
    readerNavigationRef.current=true; setReaderLoading(true);
    setAddress(preview.nextUrl); setUrl(preview.nextUrl);
  };
  const canTurnReaderPrevious=readerPageIndex>0||readerIndex>0;
  const canTurnReaderNext=readerPageIndex<readerPages.length-1||readerIndex<readerHistory.length-1||Boolean(preview?.nextUrl);
  const settleReaderPage=()=>{
    readerPageAnimatingRef.current=true;
    setReaderPageGestureLocked(true);
    RNAnimated.timing(readerPageDrag,{toValue:0,duration:150,easing:Easing.out(Easing.cubic),useNativeDriver:true})
      .start(()=>{readerPageAnimatingRef.current=false;setReaderPageGestureLocked(false);});
  };
  const turnReaderPage=(direction:-1|1)=>{
    if(webReaderFlow!=="paged"||readerPageAnimatingRef.current||readerLoading)return;
    const canTurn=direction<0?canTurnReaderPrevious:canTurnReaderNext;
    if(!canTurn){settleReaderPage();return;}
    readerPageAnimatingRef.current=true;
    setReaderPageGestureLocked(true);
    RNAnimated.timing(readerPageDrag,{
      toValue:direction*-screenWidth,
      duration:170,
      easing:Easing.out(Easing.cubic),
      useNativeDriver:true,
    }).start(({finished})=>{
      if(!finished){readerPageAnimatingRef.current=false;setReaderPageGestureLocked(false);return;}
      if(direction<0){
        if(readerPageIndex>0)setReaderPageIndex((page)=>page-1);
        else openReaderChapter(readerIndex-1,"end");
      }else if(readerPageIndex<readerPages.length-1){
        setReaderPageIndex((page)=>page+1);
      }else{
        openNextReaderChapter();
      }
      requestAnimationFrame(()=>{
        readerPageDrag.setValue(0);
        readerPageAnimatingRef.current=false;
        setReaderPageGestureLocked(false);
      });
    });
  };
  const volumePageTurnRef=useRef(turnReaderPage);
  volumePageTurnRef.current=turnReaderPage;
  useEffect(()=>{
    const enabled=volumeKeysEnabled&&visible&&readerMode&&webReaderFlow==="paged"&&supportsVolumeKeyTurns;
    if(!enabled)return;
    setVolumeKeyTurnsEnabled(true);
    const subscription=subscribeToVolumeKeyTurns((direction)=>{
      volumePageTurnRef.current(direction==="previous"?-1:1);
    });
    return()=>{
      subscription.remove();
      setVolumeKeyTurnsEnabled(false);
    };
  },[readerMode,visible,volumeKeysEnabled,webReaderFlow]);
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
      chapters:readerHistory.map(({title,content,url})=>({title,content,url})),
      chapterLinks:mergeWebChapterLinks(chapterCatalog,readerHistory)} satisfies WebPageExtraction;
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
    <Animated.View
      entering={SlideInRight.duration(280)}
      exiting={SlideOutRight.duration(250)}
      style={styles.overlay}
    >
      <PerformanceRegion id="web-reader-content" label="网页寻书与网页阅读器内容" style={styles.performanceFill}>
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

        <View collapsable={false} ref={addressGuideRef} style={styles.addressRow}>
          <View style={styles.addressBox}>
            <Ionicons color="#829087" name="search-outline" size={17} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={() => setTimeout(() => setAddressFocused(false), 140)}
              onChangeText={setAddress}
              onFocus={() => setAddressFocused(true)}
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

        {addressFocused && suggestions.length ? (
          <View style={styles.suggestions}>
            {suggestions.map((item) => (
              <Pressable key={item.url} onPress={() => openAddress(item.url)} style={styles.suggestionItem}>
                <Ionicons color="#6E8176" name={webFavorites.some((favorite) => favorite.url === item.url) ? "star" : "time-outline"} size={16} />
                <View style={styles.suggestionCopy}>
                  <Text numberOfLines={1} style={styles.suggestionTitle}>{item.title}</Text>
                  <Text numberOfLines={1} style={styles.suggestionUrl}>{item.url}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.browser}>
          {url ? (
          <WebView
            accessibilityElementsHidden={!url || readerMode}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            androidLayerType="hardware"
            cacheEnabled
            domStorageEnabled
            importantForAccessibility={!url || readerMode ? "no-hide-descendants" : "auto"}
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
              /^(https?:|about:blank|javascript:)/i.test(request.url)
            }
            originWhitelist={["http://*", "https://*", "about:blank"]}
            overScrollMode="never"
            ref={webRef}
            renderError={() => (
              <View style={styles.webError}>
                <View style={styles.webErrorIcon}>
                  <Ionicons color="#60776A" name="cloud-offline-outline" size={25} />
                </View>
                <Text style={styles.webErrorTitle}>这一页暂时在远方</Text>
                <Text style={styles.webErrorText}>请检查网络或地址，稍后再相逢</Text>
                <Pressable onPress={() => webRef.current?.reload()} style={styles.retryButton}>
                  <Text style={styles.retryText}>再叩一次</Text>
                </Pressable>
              </View>
            )}
            setSupportMultipleWindows={false}
            sharedCookiesEnabled
            source={source}
            style={!url ? styles.hiddenWebView : undefined}
            startInLoadingState
            thirdPartyCookiesEnabled
          />
          ) : null}
          {!url ? (
            <ScrollView contentContainerStyle={styles.browserHome} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.browserHomeLayer}>
              <View style={styles.homeHero}>
                <View style={styles.homeMark}><Ionicons color="#4F705E" name="compass-outline" size={27} /></View>
                <Text style={styles.homeTitle}>循着文字，去找下一本书</Text>
                <Text style={styles.homeSubtitle}>输入一处地址或一个名字，让故事自己走近</Text>
              </View>
              <View style={styles.homeSectionHeader}>
                <Text style={styles.homeSectionTitle}>收藏网页</Text>
                <Text style={styles.homeSectionCount}>{webFavorites.length} 个</Text>
              </View>
              {webFavorites.length ? (
                <View style={styles.favoriteGrid}>
                  {webFavorites.map((item) => (
                    <Pressable key={item.url} onPress={() => openAddress(item.url)} style={styles.favoriteCard}>
                      <View style={styles.favoriteIcon}><Ionicons color="#4E6D5D" name="star" size={18} /></View>
                      <Text numberOfLines={2} style={styles.favoriteTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={styles.favoriteHost}>{safeHost(item.url)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.homeEmpty}>
                  <Ionicons color="#A4AAA4" name="star-outline" size={22} />
                  <Text style={styles.homeEmptyText}>把常去的故事入口留在这里</Text>
                </View>
              )}
              {webHistory.length ? (
                <>
                  <View style={styles.homeSectionHeader}>
                    <Text style={styles.homeSectionTitle}>最近访问</Text>
                    <Pressable onPress={() => setBrowserPanel("history")}><Text style={styles.homeHistoryLink}>查看全部</Text></Pressable>
                  </View>
                  {dedupeHistoryByOrigin(webHistory).slice(0, 4).map((item) => (
                    <Pressable key={item.url} onPress={() => openAddress(item.url)} style={styles.homeRecentItem}>
                      <Ionicons color="#78877E" name="time-outline" size={16} />
                      <Text numberOfLines={1} style={styles.homeRecentTitle}>{item.title}</Text>
                      <Ionicons color="#ADB1AC" name="chevron-forward" size={15} />
                    </Pressable>
                  ))}
                </>
              ) : null}
            </ScrollView>
          ) : null}
          {browserPanel === "history" ? (
            <View style={styles.historyPanel}>
              <View style={styles.historyHeader}>
                <View>
                  <Text style={styles.historyTitle}>浏览历史</Text>
                  <Text style={styles.historySubtitle}>来过的路，只静静留在本机</Text>
                </View>
                <Pressable onPress={() => setBrowserPanel(undefined)} style={styles.historyClose}><Ionicons color="#52655A" name="close" size={19} /></Pressable>
              </View>
              <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {webHistory.length ? webHistory.map((item) => (
                  <Pressable key={item.url} onPress={() => openAddress(item.url)} style={styles.historyItem}>
                    <View style={styles.historyIcon}><Ionicons color="#6A7F73" name="globe-outline" size={16} /></View>
                    <View style={styles.historyCopy}>
                      <Text numberOfLines={1} style={styles.historyItemTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={styles.historyItemUrl}>{item.url}</Text>
                    </View>
                  </Pressable>
                )) : <Text style={styles.historyEmpty}>还没有浏览历史</Text>}
              </ScrollView>
              {webHistory.length ? (
                <Pressable onPress={() => { setWebHistory([]); void AsyncStorage.removeItem(WEB_HISTORY_KEY); }} style={styles.clearHistoryButton}>
                  <Ionicons color="#9B5F58" name="trash-outline" size={16} />
                  <Text style={styles.clearHistoryText}>清除浏览历史</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {browserPanel === "catalog" ? (
            <View style={styles.historyPanel}>
              <View style={styles.historyHeader}>
                <View style={styles.catalogHeaderCopy}>
                  <Text style={styles.historyTitle}>{t("章节目录")}</Text>
                  <Text style={styles.historySubtitle}>{t("{count} 个章节入口 · 仅保存在本机", { count: chapterCatalog.length })}</Text>
                </View>
                <View style={styles.catalogHeaderActions}>
                  <Pressable
                    accessibilityLabel={t("重新识别目录页")}
                    disabled={extracting}
                    onPress={markCurrentAsCatalog}
                    style={styles.historyClose}
                  >
                    {extracting ? <ActivityIndicator color="#52655A" size="small" /> : <Ionicons color="#52655A" name="refresh" size={18} />}
                  </Pressable>
                  <Pressable accessibilityLabel={t("关闭章节目录")} onPress={() => setBrowserPanel(undefined)} style={styles.historyClose}>
                    <Ionicons color="#52655A" name="close" size={19} />
                  </Pressable>
                </View>
              </View>
              <FlatList
                data={chapterCatalog}
                initialNumToRender={18}
                keyExtractor={(item, index) => item.url + "-" + index}
                renderItem={({ item, index }) => (
                  <Pressable onPress={() => openAddress(item.url)} style={styles.catalogItem}>
                    <Text style={styles.catalogItemIndex}>{index + 1}</Text>
                    <Text numberOfLines={2} style={styles.catalogItemTitle}>{item.title}</Text>
                    <Ionicons color="#A3AAA4" name="chevron-forward" size={15} />
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
                style={styles.catalogList}
                windowSize={7}
              />
            </View>
          ) : null}
          {loading ? (
            <Animated.View entering={FadeIn.duration(100)} exiting={FadeOut.duration(100)} style={styles.loadingLine} />
          ) : null}
        </View>

        <View style={styles.toolbar}>
          <View style={[styles.toolbarContent,isTabletToolbar&&styles.toolbarContentTablet]}>
            <View collapsable={false} ref={browserNavGuideRef} style={[styles.navButtons,isTabletToolbar&&styles.navButtonsTablet]}>
            <ToolButton accessibilityLabel={t("网页寻书首页")} icon="home-outline" onPress={openHome} />
            <ToolButton accessibilityLabel={t("后退")} disabled={!canGoBack} icon="arrow-back" onPress={() => webRef.current?.goBack()} />
            <ToolButton accessibilityLabel={t("前进")} disabled={!canGoForward} icon="arrow-forward" onPress={() => webRef.current?.goForward()} />
            <ToolButton accessibilityLabel={t("浏览历史")} icon="time-outline" onPress={() => setBrowserPanel(browserPanel === "history" ? undefined : "history")} />
            <ToolButton accessibilityLabel={t(isFavorite ? "取消收藏网页" : "收藏当前网页")} disabled={!currentUrl} icon={isFavorite ? "star" : "star-outline"} onPress={toggleFavorite} />
            <ToolButton
              accessibilityLabel={t(isCatalogMarked && currentCatalogHint?.chapterLinks?.length ? "打开已识别目录" : isCatalogMarked ? "重新识别目录页" : "标记当前页为目录")}
              active={isCatalogMarked}
              disabled={!currentUrl || loading || extracting || saving || capturing}
              icon={isCatalogMarked ? "list-circle" : "list-circle-outline"}
              onPress={isCatalogMarked && currentCatalogHint?.chapterLinks?.length ? () => setBrowserPanel("catalog") : markCurrentAsCatalog}
            />
          </View>
          <View collapsable={false} ref={browserActionsGuideRef} style={styles.browserActions}>
            <Pressable
              accessibilityLabel={t("收藏到书架")}
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: !currentUrl || loading || extracting || saving || capturing }}
              disabled={!currentUrl || loading || extracting || saving || capturing}
              hitSlop={4}
              onPress={() => extract("save")}
              style={({ pressed }) => [
                styles.saveWebButton,
                (!currentUrl || loading || extracting || saving || capturing) && styles.buttonDisabled,
                pressed && styles.actionPressed,
              ]}
            >
              {saving ? <ActivityIndicator color="#426753" size="small" /> : <Ionicons color="#426753" name="bookmark-outline" size={21} />}
            </Pressable>
            <Pressable
              accessibilityLabel={t(capturing ? "停止并保留" : extracting && !saving ? "正在整理正文" : "阅读模式")}
              accessibilityRole="button"
              accessibilityState={{ busy: extracting && !capturing, disabled: !capturing && (!currentUrl || loading || extracting || saving) }}
              disabled={!capturing && (!currentUrl || loading || extracting || saving)}
              hitSlop={4}
              onPress={capturing ? finishContinuousCapture : () => extract("read")}
              style={({ pressed }) => [
                styles.extractButton,
                (!capturing && (!currentUrl || loading || saving)) && styles.buttonDisabled,
                pressed && styles.actionPressed,
              ]}
            >
              {extracting && !capturing && !saving ? <ActivityIndicator color="#F8F4EA" size="small" /> : <Ionicons color="#F8F4EA" name={capturing ? "stop-circle-outline" : "book-outline"} size={22} />}
            </Pressable>
          </View>
          </View>
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
              {preview.tocUrl ? (
                <Pressable onPress={()=>{enterReaderMode(preview);requestAnimationFrame(openWebCatalog);}} style={styles.continuousButton}>
                  <Ionicons color="#4E695A" name="list-circle-outline" size={18} />
                  <Text style={styles.continuousText}>整理章节目录</Text>
                </Pressable>
              ) : null}              {preview.nextUrl && !preview.chapters?.length ? (
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
          <Animated.View entering={SlideInDown.duration(220)} style={[styles.readerMode,{backgroundColor:readerPalette.background}]}>
            <View collapsable={false} pointerEvents="none" ref={readerGestureGuideRef} style={styles.readerGuideTarget}/>
            <RNAnimated.View
              pointerEvents={readerControlsVisible?"auto":"none"}
              style={[
                styles.readerHeader,
                {
                  backgroundColor:`${readerPalette.background}F2`,
                  borderColor:`${readerPalette.muted}28`,
                  top:Math.max(8,insets.top),
                  opacity:readerControlsProgress,
                  transform:[{translateY:readerControlsProgress.interpolate({inputRange:[0,1],outputRange:[-18,0]})}],
                },
              ]}
            >
              <Pressable accessibilityLabel="退出网页阅读模式" collapsable={false} onPress={exitReaderMode} ref={readerExitGuideRef} style={styles.readerIcon}>
                <Ionicons color={readerPalette.text} name="chevron-down" size={23}/>
              </Pressable>
              <View style={styles.readerHeaderText}>
                <Text numberOfLines={1} style={[styles.readerBook,{color:readerPalette.text}]}>{preview.bookTitle||preview.title}</Text>
                <Text numberOfLines={1} style={[styles.readerChapter,{color:readerPalette.muted}]}>{preview.title}</Text>
              </View>
              <Pressable accessibilityLabel="转为分页阅读" onPress={openPagedReader} style={styles.readerIcon}>
                <Ionicons color={readerPalette.text} name="reader-outline" size={21}/>
              </Pressable>
            </RNAnimated.View>

            {webReaderFlow==="scroll" ? (
              <ScrollView
                contentContainerStyle={styles.readerContent}
                onTouchStart={(event)=>{readerScrollTouchRef.current={x:event.nativeEvent.pageX,y:event.nativeEvent.pageY};}}
                onTouchEnd={(event)=>{
                  const dx=Math.abs(event.nativeEvent.pageX-readerScrollTouchRef.current.x);
                  const dy=Math.abs(event.nativeEvent.pageY-readerScrollTouchRef.current.y);
                  if(dx<9&&dy<9&&event.nativeEvent.pageX>screenWidth*.27&&event.nativeEvent.pageX<screenWidth*.73){
                    if(readerPanel)setReaderPanel(undefined);else setReaderControlsVisible((value)=>!value);
                  }
                }}
                ref={readerScrollRef}
                showsVerticalScrollIndicator={false}
              >
                <View style={{alignSelf:"center",width:readerColumnWidth}}>
                  <Text style={[styles.readerEyebrow,{color:readerPalette.accent}]}>WEB READER</Text>
                  <Text style={[styles.readerTitle,{color:readerPalette.text,fontFamily:readerFontFamily}]}>{preview.title}</Text>
                  <Text style={[styles.readerMeta,{color:readerPalette.muted}]}>{t("{source} · 第 {chapter} 章", { source: preview.author || t("摘自当前网页"), chapter: readerIndex + 1 })}</Text>
                  <View style={[styles.readerRule,{backgroundColor:`${readerPalette.muted}35`}]}/>
                  <WebReaderParagraphs
                    color={readerPalette.text}
                    content={preview.content}
                    contentKey={preview.url}
                    fontFamily={readerFontFamily}
                    fontSize={readerFontSize}
                    selectable
                  />
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
                enabled={!readerPageGestureLocked}
                failOffsetY={[-14,14]}
                onGestureEvent={onReaderPageGesture}
                onHandlerStateChange={onReaderPageGestureStateChange}
              >
                <RNAnimated.View style={styles.readerPaged}>
                  {[
                    {key:"previous",snapshot:previousReaderPage,translateX:previousReaderPageTranslate},
                    {key:"next",snapshot:nextReaderPage,translateX:nextReaderPageTranslate},
                  ].map(({key,snapshot,translateX})=>snapshot ? (
                    <RNAnimated.View key={key} pointerEvents="none" style={[styles.readerAdjacentPage,{transform:[{translateX}]}]}>
                      <View style={[styles.readerPagedBody,{width:readerColumnWidth}]}>
                        {snapshot.pageIndex===0 ? (
                          <>
                            <Text style={[styles.readerEyebrow,{color:readerPalette.accent}]}>WEB READER</Text>
                            <Text style={[styles.readerTitle,{color:readerPalette.text,fontFamily:readerFontFamily}]}>{snapshot.chapter.title}</Text>
                            <Text style={[styles.readerMeta,{color:readerPalette.muted}]}>{t("{source} · 第 {chapter} 章", { source: snapshot.chapter.author || t("摘自当前网页"), chapter: readerHistory.indexOf(snapshot.chapter) + 1 })}</Text>
                            <View style={[styles.readerRule,{backgroundColor:`${readerPalette.muted}35`}]}/>
                          </>
                        ) : (
                          <Text numberOfLines={1} style={[styles.readerPagedChapter,{color:readerPalette.muted,fontFamily:readerFontFamily}]}>{snapshot.chapter.title}</Text>
                        )}
                        <WebReaderParagraphs
                          color={readerPalette.text}
                          content={snapshot.pages[snapshot.pageIndex]??""}
                          contentKey={`${snapshot.chapter.url}-${snapshot.pageIndex}`}
                          fontFamily={readerFontFamily}
                          fontSize={readerFontSize}
                        />
                        <Text style={[styles.readerPageNumber,{color:readerPalette.muted}]}>{snapshot.pageIndex+1} / {snapshot.pages.length}</Text>
                      </View>
                    </RNAnimated.View>
                  ) : null)}
                  <RNAnimated.View style={[styles.readerPagedCurrent,{transform:[{translateX:readerPageDrag}]}]}>
                  <View style={[styles.readerPagedBody,{width:readerColumnWidth}]}>
                    {readerPageIndex===0 ? (
                      <>
                        <Text style={[styles.readerEyebrow,{color:readerPalette.accent}]}>WEB READER</Text>
                        <Text style={[styles.readerTitle,{color:readerPalette.text,fontFamily:readerFontFamily}]}>{preview.title}</Text>
                        <Text style={[styles.readerMeta,{color:readerPalette.muted}]}>{t("{source} · 第 {chapter} 章", { source: preview.author || t("摘自当前网页"), chapter: readerIndex + 1 })}</Text>
                        <View style={[styles.readerRule,{backgroundColor:`${readerPalette.muted}35`}]}/>
                      </>
                    ) : (
                      <Text numberOfLines={1} style={[styles.readerPagedChapter,{color:readerPalette.muted,fontFamily:readerFontFamily}]}>{preview.title}</Text>
                    )}
                    <WebReaderParagraphs
                      color={readerPalette.text}
                      content={readerPages[readerPageIndex]??""}
                      contentKey={`${preview.url}-${readerPageIndex}`}
                      fontFamily={readerFontFamily}
                      fontSize={readerFontSize}
                    />
                    <Text style={[styles.readerPageNumber,{color:readerPalette.muted}]}>{readerPageIndex+1} / {readerPages.length}</Text>
                  </View>
                  </RNAnimated.View>
                  <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                    <Pressable accessibilityLabel="网页阅读上一页" disabled={!canTurnReaderPrevious} onPress={()=>turnReaderPage(-1)} style={styles.readerLeftTap}/>
                    <Pressable accessibilityLabel="显示或隐藏网页阅读工具栏" onPress={()=>{if(readerPanel)setReaderPanel(undefined);else setReaderControlsVisible((value)=>!value);}} style={styles.readerCenterTap}/>
                    <Pressable accessibilityLabel="网页阅读下一页" disabled={!canTurnReaderNext} onPress={()=>turnReaderPage(1)} style={styles.readerRightTap}/>
                  </View>
                </RNAnimated.View>
              </PanGestureHandler>
            )}

            {readerPanel ? (
              <View style={[styles.readerPanel,{backgroundColor:readerPalette.background,borderColor:`${readerPalette.muted}35`,bottom:Math.max(84,insets.bottom+78)}]}>
                <View style={styles.readerPanelHeader}>
                  <Text style={[styles.readerPanelTitle,{color:readerPalette.text}]}>{readerPanel==="chapters"?t("{count} 章目录 · 已整理 {loaded} 章",{count:chapterCatalog.length||readerHistory.length,loaded:readerHistory.length}):"阅读外观"}</Text>
                  <Pressable onPress={()=>setReaderPanel(undefined)} style={[styles.readerPanelClose,{backgroundColor:readerPalette.panel}]}>
                    <Ionicons color={readerPalette.text} name="close" size={18}/>
                  </Pressable>
                </View>
                {readerPanel==="chapters" ? (
                  <>
                  {preview.tocUrl ? (
                    <Pressable onPress={openWebCatalog} style={[styles.readerCaptureButton,{borderColor:`${readerPalette.muted}50`}]}>
                      <Ionicons color={readerPalette.accent} name="list-circle-outline" size={18}/>
                      <Text style={[styles.readerCaptureText,{color:readerPalette.text}]}>从原网页刷新目录</Text>
                    </Pressable>
                  ) : null}
                  {preview.nextUrl && !capturing ? (
                    <Pressable onPress={startContinuousCapture} style={[styles.readerCaptureButton,{borderColor:`${readerPalette.muted}50`}]}>
                      <Ionicons color={readerPalette.accent} name="albums-outline" size={17}/>
                      <Text style={[styles.readerCaptureText,{color:readerPalette.text}]}>连续收录后续章节</Text>
                    </Pressable>
                  ) : null}
                  <ScrollView showsVerticalScrollIndicator={false} style={styles.readerChapterList}>
                    {(chapterCatalog.length
                      ? chapterCatalog
                      : readerHistory.map(({title,url})=>({title,url})))
                      .map((chapter,index)=>{
                        const loadedIndex=readerHistory.findIndex((item)=>item.url===chapter.url);
                        const loaded=loadedIndex>=0;
                        const selected=loaded&&loadedIndex===readerIndex;
                        return (
                          <Pressable key={chapter.url+"-"+index} onPress={()=>openCatalogChapter(chapter)} style={[styles.readerChapterItem,selected&&{backgroundColor:`${readerPalette.accent}18`}]}>
                            <Text style={[styles.readerChapterNo,{color:selected?readerPalette.accent:readerPalette.muted}]}>{String(index+1).padStart(2,"0")}</Text>
                            <Text numberOfLines={1} style={[styles.readerChapterName,{color:selected?readerPalette.accent:readerPalette.text,fontWeight:selected?"700":"500"}]}>{chapter.title}</Text>
                            <Ionicons color={loaded?readerPalette.accent:readerPalette.muted} name={selected?"radio-button-on":loaded?"checkmark-circle-outline":"cloud-download-outline"} size={16}/>
                          </Pressable>
                        );
                      })}
                  </ScrollView>
                  </>                ) : (
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
                    <View style={styles.readerFontChoices}>
                      {readerFontOptions.map((option) => {
                        const selected = option.key === readerFont;
                        return (
                          <Pressable
                            accessibilityLabel={"正文字体 " + option.label}
                            key={option.key}
                            onPress={() => onReaderFontChange(option.key)}
                            style={[
                              styles.readerFontChoice,
                              {
                                backgroundColor: selected ? `${readerPalette.accent}20` : readerPalette.panel,
                                borderColor: selected ? readerPalette.accent : `${readerPalette.muted}30`,
                              },
                            ]}
                          >
                            <Text style={[styles.readerFontChoiceSample,{color:readerPalette.text,fontFamily:getReaderFontFamily(option.key)}]}>{option.sample}</Text>
                            <Text style={[styles.readerFontChoiceLabel,{color:selected?readerPalette.accent:readerPalette.muted}]}>{option.label}</Text>
                          </Pressable>
                        );
                      })}
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

            <RNAnimated.View
              pointerEvents={readerControlsVisible?"auto":"none"}
              style={[
                styles.readerToolbar,
                {
                  backgroundColor:`${readerPalette.background}F4`,
                  borderColor:`${readerPalette.muted}30`,
                  opacity:readerControlsProgress,
                  transform:[{translateY:readerControlsProgress.interpolate({inputRange:[0,1],outputRange:[18,0]})}],
                },
              ]}
            >
              <Pressable accessibilityLabel={webReaderFlow==="paged"?"上一页":"上一章"}
                disabled={webReaderFlow==="paged"?!canTurnReaderPrevious:readerIndex===0}
                onPress={()=>webReaderFlow==="paged"?turnReaderPage(-1):openReaderChapter(readerIndex-1)}
                style={[styles.readerTool,(webReaderFlow==="paged"?!canTurnReaderPrevious:readerIndex===0)&&styles.readerDisabled]}>
                <Ionicons color={readerPalette.text} name="chevron-back" size={20}/>
              </Pressable>
              <Pressable accessibilityLabel="网页阅读章节" collapsable={false} onPress={()=>setReaderPanel(readerPanel==="chapters"?undefined:"chapters")} ref={readerChapterGuideRef} style={styles.readerCenterTool}>
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
              <Pressable accessibilityLabel="阅读外观" collapsable={false} onPress={()=>setReaderPanel(readerPanel==="appearance"?undefined:"appearance")} ref={readerAppearanceGuideRef} style={styles.readerTool}>
                <Text style={[styles.readerAa,{color:readerPalette.text}]}>Aa</Text>
              </Pressable>
              <Pressable accessibilityLabel="加入书架" collapsable={false} disabled={saving} onPress={()=>void saveReaderBook()} ref={readerSaveGuideRef} style={styles.readerTool}>
                {saving?<ActivityIndicator color={readerPalette.accent} size="small"/>:<Ionicons color={readerPalette.text} name="bookmark-outline" size={20}/>}
              </Pressable>
            </RNAnimated.View>

            {readerLoading ? (
              <View style={[styles.readerLoading,{backgroundColor:`${readerPalette.background}E8`}]}>
                <ActivityIndicator color={readerPalette.accent} size="large"/>
                <Text style={[styles.readerLoadingText,{color:readerPalette.muted}]}>
                  {capturing?"已收录 "+captureCount+" 章":catalogRequestRef.current?"正在整理网页目录":"正在整理下一章"}
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
      </PerformanceRegion>
    </Animated.View>
  );
}

function ToolButton({ accessibilityLabel, active, disabled, icon, onPress }: { accessibilityLabel: string; active?: boolean; disabled?: boolean; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.toolButton, active && styles.toolActive, disabled && styles.toolDisabled, pressed && !disabled && styles.toolPressed]}
    >
      <Ionicons color={disabled ? "#C8C5BD" : active ? "#F8F4EA" : "#52685C"} name={icon} size={20} />
    </Pressable>
  );
}

function orderWebCatalogLinks(links: WebChapterLink[]) {
  const parsed = links.map((item, index) => {
    const match = item.url.match(/\/book\/(\d+)\/(\d+)(?:_(\d+))?\.html(?:[?#]|$)/i);
    return { item, index, bookId: match?.[1], chapter: Number(match?.[2]), page: Number(match?.[3] ?? 1) };
  });
  const numbered = parsed.filter((entry) => entry.bookId && Number.isFinite(entry.chapter));
  if (numbered.length < Math.max(3, Math.floor(links.length * 0.8))) return links;
  if (new Set(numbered.map((entry) => entry.bookId)).size !== 1) return links;
  return [...parsed].sort((left, right) => {
    const leftValid = left.bookId && Number.isFinite(left.chapter);
    const rightValid = right.bookId && Number.isFinite(right.chapter);
    if (leftValid && rightValid) return left.chapter - right.chapter || left.page - right.page || left.index - right.index;
    if (leftValid) return -1;
    if (rightValid) return 1;
    return left.index - right.index;
  }).map((entry) => entry.item);
}
function orderReaderHistory(
  history: WebPageExtraction[],
  catalog: WebChapterLink[],
): WebPageExtraction[] {
  if (!catalog.length || history.length < 2) return history;
  const order = new Map(catalog.map((chapter, index) => [chapter.url, index]));
  return [...history].sort((left, right) =>
    (order.get(left.url) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.url) ?? Number.MAX_SAFE_INTEGER),
  );
}
function toReaderHistory(extraction:WebPageExtraction){
  if(!extraction.chapters?.length)return [extraction];
  return extraction.chapters.map((chapter,index,chapters)=>({
    author:extraction.author,bookTitle:extraction.bookTitle||extraction.title,tocUrl:extraction.tocUrl,
    content:chapter.content,title:chapter.title,url:chapter.url,
    nextUrl:chapters[index+1]?.url||(index===chapters.length-1?extraction.nextUrl:undefined),
  }));
}

function paginateReaderContent(content:string,limit:number,firstPageFactor=.68){
  const paragraphs=content.split(/\n{2,}/).map((item)=>item.trim()).filter(Boolean);
  if(!paragraphs.length)return [""];
  const pages:string[]=[];
  let page="";
  const push=()=>{if(page.trim())pages.push(page.trim());page="";};
  paragraphs.forEach((paragraph)=>{
    let rest=paragraph;
    while(rest.length){
      const activeLimit=pages.length===0?Math.max(90,Math.floor(limit*firstPageFactor)):limit;
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

function safeHost(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}

function dedupeHistoryByOrigin(history: WebVisit[]) {
  const seen = new Set<string>();
  return history.filter((item) => {
    let key = item.url;
    try { key = new URL(item.url).origin; } catch {}
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getBookLandingChapterUrl(currentUrl: string, chapterCatalog: WebChapterLink[]) {
  const firstKnownChapter = orderWebCatalogLinks(chapterCatalog)[0]?.url;
  const route = currentUrl.match(/^(https?:\/\/[^/]+)\/#\/book\/(\d+)\/?(?:[?#].*)?$/i);
  if (!route || !/(^|\.)bqg107\.xyz$/i.test(safeHost(route[1]))) return undefined;
  return firstKnownChapter || `${route[1]}/book/${route[2]}/1.html`;
}
function normalizeCatalogUrl(value: string) {
  if (!value.toLowerCase().startsWith("http://") && !value.toLowerCase().startsWith("https://")) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.replace(/#.*$/, "");
  }
}

function normalizeAddress(value: string, currentUrl?: string) {
  const input = value.trim();
  if (!input) return undefined;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(input)) return "https://" + input;
  const siteSearch = getSiteSearchUrl(currentUrl, input);
  if (siteSearch) return siteSearch;
  return "https://www.bing.com/search?q=" + encodeURIComponent(input + " 小说");
}

function getSiteSearchUrl(currentUrl: string | undefined, query: string) {
  if (!currentUrl) return undefined;
  try {
    const parsed = new URL(currentUrl);
    if (/(^|\.)bqg107\.xyz$/i.test(parsed.hostname)) {
      return parsed.origin + "/#/search?q=" + encodeURIComponent(query);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: "#F7F4ED", elevation: 100, zIndex: 100 },
  safe: { flex: 1, backgroundColor: "#F7F4ED" },
  performanceFill: { flex: 1 },
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
  suggestions: { backgroundColor: "#FBF9F4", borderColor: "#D8DDD7", borderRadius: 18, borderWidth: 1, elevation: 12, left: 16, maxHeight: 330, overflow: "hidden", position: "absolute", right: 73, shadowColor: "#26352D", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 18, top: 122, zIndex: 40 },
  suggestionItem: { alignItems: "center", borderBottomColor: "#E7E5DE", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 11, minHeight: 58, paddingHorizontal: 14 },
  suggestionCopy: { flex: 1, minWidth: 0 },
  suggestionTitle: { color: "#344139", fontSize: 13, fontWeight: "700" },
  suggestionUrl: { color: "#969991", fontSize: 10, marginTop: 3 },
  hiddenWebView: { opacity: 0 },
  browser: { flex: 1, overflow: "hidden", borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#DDD9D0", backgroundColor: "#FFFFFF" },
  browserHomeLayer: { ...StyleSheet.absoluteFill, backgroundColor: "#F7F4ED", zIndex: 20 },
  browserHome: { backgroundColor: "#F7F4ED", flexGrow: 1, padding: 20, paddingBottom: 36 },
  homeHero: { alignItems: "center", paddingBottom: 28, paddingTop: 18 },
  homeMark: { alignItems: "center", backgroundColor: "#E5EDE7", borderRadius: 23, height: 62, justifyContent: "center", width: 62 },
  homeTitle: { color: "#29372F", fontSize: 21, fontWeight: "800", marginTop: 17, textAlign: "center" },
  homeSubtitle: { color: "#898D87", fontSize: 12, lineHeight: 19, marginTop: 7, textAlign: "center" },
  homeSectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 11, marginTop: 18 },
  homeSectionTitle: { color: "#344239", fontSize: 15, fontWeight: "800" },
  homeSectionCount: { color: "#999C96", fontSize: 11 },
  favoriteGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  favoriteCard: { backgroundColor: "#FEFCF7", borderColor: "#DCE1DB", borderRadius: 18, borderWidth: 1, minHeight: 116, padding: 14, width: "48%" },
  favoriteIcon: { alignItems: "center", backgroundColor: "#E7EEE9", borderRadius: 12, height: 32, justifyContent: "center", width: 32 },
  favoriteTitle: { color: "#334139", fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 10 },
  favoriteHost: { color: "#9A9C97", fontSize: 9.5, marginTop: 5 },
  homeEmpty: { alignItems: "center", backgroundColor: "#FDFBF6", borderColor: "#D8DDD7", borderRadius: 18, borderStyle: "dashed", borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 62, paddingHorizontal: 16 },
  homeEmptyText: { color: "#8B918B", flex: 1, fontSize: 12 },
  homeHistoryLink: { color: "#52715F", fontSize: 11, fontWeight: "700" },
  homeRecentItem: { alignItems: "center", borderBottomColor: "#E4E2DB", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, minHeight: 48 },
  homeRecentTitle: { color: "#58625C", flex: 1, fontSize: 12 },
  historyPanel: { ...StyleSheet.absoluteFill, backgroundColor: "#F8F5EE", padding: 18, zIndex: 25 },
  historyHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  catalogHeaderCopy: { flex: 1, minWidth: 0 },
  catalogHeaderActions: { flexDirection: "row", gap: 8 },
  historyTitle: { color: "#2D3932", fontSize: 20, fontWeight: "800" },
  historySubtitle: { color: "#999B96", fontSize: 10.5, marginTop: 4 },
  historyClose: { alignItems: "center", backgroundColor: "#E8ECE7", borderRadius: 15, height: 38, justifyContent: "center", width: 38 },
  historyItem: { alignItems: "center", borderBottomColor: "#E2E0DA", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 11, minHeight: 62 },
  catalogItem: { alignItems: "center", borderBottomColor: "#E2E0DA", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 11, minHeight: 56, paddingHorizontal: 2 },
  catalogList: { flex: 1 },
  catalogItemTitle: { color: "#3B4740", flex: 1, fontSize: 13, fontWeight: "700" },
  catalogItemIndex: { color: "#799083", fontSize: 11, fontVariant: ["tabular-nums"], textAlign: "right", width: 32 },
  historyIcon: { alignItems: "center", backgroundColor: "#E8EDE9", borderRadius: 13, height: 36, justifyContent: "center", width: 36 },
  historyCopy: { flex: 1, minWidth: 0 },
  historyItemTitle: { color: "#3B4740", fontSize: 13, fontWeight: "700" },
  historyItemUrl: { color: "#999C97", fontSize: 10, marginTop: 4 },
  historyEmpty: { color: "#999C97", marginTop: 60, textAlign: "center" },
  clearHistoryButton: { alignItems: "center", borderColor: "#D9C7C3", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 12, minHeight: 46 },
  clearHistoryText: { color: "#9B5F58", fontSize: 13, fontWeight: "700" },
  webError: { alignItems: "center", backgroundColor: "#F7F4ED", flex: 1, justifyContent: "center", padding: 28 },
  webErrorIcon: { alignItems: "center", backgroundColor: "#E7ECE7", borderRadius: 20, height: 58, justifyContent: "center", width: 58 },
  webErrorTitle: { color: "#34443B", fontSize: 18, fontWeight: "700", marginTop: 18 },
  webErrorText: { color: "#929088", fontSize: 13, marginTop: 7 },
  retryButton: { borderColor: "#6A8174", borderRadius: 16, borderWidth: 1, marginTop: 20, paddingHorizontal: 22, paddingVertical: 11 },
  retryText: { color: "#526C5E", fontSize: 13, fontWeight: "700" },
  loadingLine: { position: "absolute", left: 0, right: "35%", top: 0, height: 2, backgroundColor: "#557967" },
  toolbar: { minHeight: Platform.OS === "android" ? 68 : 64, paddingHorizontal: 6, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: "#FBF9F4", borderTopColor: "#E7E3DA", borderTopWidth: StyleSheet.hairlineWidth },
  toolbarContent: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  toolbarContentTablet: { flex: 0, alignSelf: "center", gap: 10, width: 370 },
  navButtons: { flex: 1, minWidth: 0, flexDirection: "row", justifyContent: "space-between" },
  navButtonsTablet: { flex: 0, gap: 10, justifyContent: "flex-start" },
  toolButton: { width: 34, height: 44, borderRadius: 15, backgroundColor: "#ECEFEA", alignItems: "center", justifyContent: "center" },
  toolActive: { backgroundColor: "#557565" },
  toolPressed: { transform: [{ scale: 0.92 }], backgroundColor: "#E1E7E2" },
  toolDisabled: { backgroundColor: "#F0EEE8" },
  browserActions: { flexDirection: "row", gap: 4 },
  saveWebButton: { alignItems: "center", backgroundColor: "#E8EEE9", borderColor: "#CBD7CF", borderRadius: 17, borderWidth: 1, height: 46, justifyContent: "center", width: 44 },
  extractButton: { width: 46, height: 46, borderRadius: 17, backgroundColor: "#426753", alignItems: "center", justifyContent: "center" },
  actionPressed: { transform: [{ scale: 0.92 }] },
  buttonDisabled: { opacity: 0.46 },
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
  readerGuideTarget:{height:150,left:"32%",position:"absolute",right:"32%",top:"38%"},
  readerHeader:{position:"absolute",left:10,right:10,top:8,zIndex:22,height:64,borderRadius:22,paddingHorizontal:10,flexDirection:"row",alignItems:"center",overflow:"hidden"},
  readerIcon:{width:44,height:44,alignItems:"center",justifyContent:"center"},
  readerHeaderText:{flex:1,alignItems:"center",paddingHorizontal:8},
  readerBook:{fontSize:14,fontWeight:"700"},
  readerChapter:{fontSize:10,marginTop:3},
  readerContent:{paddingTop:32,paddingBottom:48},
  readerPaged:{flex:1,overflow:"hidden"},
  readerPagedBody:{alignSelf:"center",flex:1,paddingTop:30,paddingBottom:32},
  readerPagedCurrent:{flex:1},
  readerAdjacentPage:{...StyleSheet.absoluteFill,alignItems:"center"},
  readerPagedChapter:{fontFamily:"serif",fontSize:13,marginBottom:18},
  readerPageNumber:{fontSize:10,marginTop:"auto",paddingBottom:8,textAlign:"center",fontVariant:["tabular-nums"]},
  readerLeftTap:{bottom:0,left:0,position:"absolute",top:0,width:"32%"},
  readerCenterTap:{bottom:0,left:"32%",position:"absolute",top:0,width:"36%"},
  readerRightTap:{bottom:0,position:"absolute",right:0,top:0,width:"32%"},
  readerEyebrow:{fontSize:10,fontWeight:"800",letterSpacing:2.2,marginBottom:15},
  readerTitle:{fontFamily:"serif",fontSize:26,fontWeight:"700",lineHeight:36},
  readerMeta:{fontSize:12,marginTop:9},
  readerRule:{height:1,width:72,marginTop:21,marginBottom:24},
  readerParagraph:{fontFamily:"serif",letterSpacing:.2,marginBottom:17},
  readerEnd:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:12,marginTop:30,marginBottom:12},
  readerEndLine:{width:52,height:1},
  readerToolbar:{position:"absolute",left:10,right:10,bottom:8,zIndex:22,minHeight:68,borderRadius:23,flexDirection:"row",alignItems:"center",paddingHorizontal:8,overflow:"hidden"},
  readerTool:{width:46,height:48,alignItems:"center",justifyContent:"center"},
  readerDisabled:{opacity:.24},
  readerCenterTool:{flex:1,height:48,flexDirection:"row",gap:7,alignItems:"center",justifyContent:"center"},
  readerCenterText:{fontSize:12,fontWeight:"700"},
  readerAa:{fontFamily:"serif",fontSize:16,fontWeight:"700"},
  readerLoading:{position:"absolute",left:0,right:0,top:0,bottom:0,alignItems:"center",justifyContent:"center"},
  readerLoadingText:{fontSize:13,marginTop:13},
  readerStopButton:{marginTop:16,minHeight:42,paddingHorizontal:20,borderRadius:15,borderWidth:1,alignItems:"center",justifyContent:"center"},
  readerStopText:{fontSize:13,fontWeight:"700"},
  readerPanel:{position:"absolute",left:10,right:10,bottom:84,maxHeight:"58%",borderRadius:24,paddingBottom:12,zIndex:25,overflow:"hidden"},
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
  readerFontChoices:{flexDirection:"row",gap:7,marginHorizontal:16,marginTop:10},
  readerFontChoice:{alignItems:"center",borderRadius:15,borderWidth:1,flex:1,minHeight:62,justifyContent:"center",paddingHorizontal:4},
  readerFontChoiceSample:{fontSize:14},
  readerFontChoiceLabel:{fontSize:9,fontWeight:"700",marginTop:5},
  readerFontRow:{minHeight:56,marginHorizontal:16,marginTop:10,borderRadius:18,paddingHorizontal:12,flexDirection:"row",alignItems:"center"},
  readerFontLabel:{flex:1,fontSize:14,fontWeight:"700"},
  readerFontButton:{width:40,height:40,alignItems:"center",justifyContent:"center"},
  readerFontValue:{width:32,textAlign:"center",fontSize:14,fontWeight:"800",fontVariant:["tabular-nums"]},
});
