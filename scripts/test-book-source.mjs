import { parse } from "node-html-parser";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);
const sourceUrl = args.source;
const keyword = args.keyword;
const searchOverride = args["search-url"];
if (!sourceUrl || !keyword) {
  throw new Error("用法：node scripts/test-book-source.mjs --source=<url> --keyword=<书名> [--search-url=<模板>]");
}

const timer = (label) => {
  const started = performance.now();
  return () => ({ label, ms: Math.round(performance.now() - started) });
};
const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json",
      "User-Agent": "Mozilla/5.0 (Android 16; Mobile) ModuReaderSourceTest/1.0",
    },
  });
  const text = await response.text();
  return { response, text };
};
const resolveUrl = (value, base) => new URL(value, base).toString();
const normalizeText = (value) => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const htmlText = (html) =>
  parse(
    html
      .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, "\n\n"),
  ).textContent.replace(/\s+/g, " ").trim();

function extract(root, rule, preserveHtml = false) {
  if (!rule) return "";
  for (const alternative of rule.split("||")) {
    const pieces = alternative.trim().split("##");
    const base = pieces[0].trim();
    const at = base.lastIndexOf("@");
    let selector = at >= 0 ? base.slice(0, at).trim() : base;
    const property = at >= 0 ? base.slice(at + 1).trim() : "text";
    let node;
    if (!selector) node = root;
    else if (selector.startsWith("text.")) {
      const label = selector.slice(5);
      node = root.querySelectorAll("a").find((item) => normalizeText(item.textContent).includes(label));
    } else {
      const ordinal = selector.match(/^(.*)\.(\d+)$/);
      const index = ordinal ? Number(ordinal[2]) : 0;
      if (ordinal) selector = ordinal[1];
      node = root.querySelectorAll(selector)[index];
    }
    if (!node) continue;
    let value =
      property === "text"
        ? normalizeText(node.textContent)
        : property === "html"
          ? node.innerHTML
          : node.getAttribute(property) || "";
    if (!preserveHtml && property === "html") value = htmlText(value);
    if (pieces[1]) {
      try {
        value = value.replace(new RegExp(pieces[1], "g"), pieces[2] || "");
      } catch {}
    }
    if (value.trim()) return value.trim();
  }
  return "";
}

const importDone = timer("import");
const imported = await fetchText(sourceUrl);
if (!imported.response.ok) throw new Error("书源导入 HTTP " + imported.response.status);
const payload = JSON.parse(imported.text.replace(/^\uFEFF/, ""));
const config = Array.isArray(payload) ? payload[0] : payload?.data ?? payload;
if (!config?.bookSourceName || !config?.bookSourceUrl) throw new Error("书源 JSON 无效");
const timings = [importDone()];

const renderSearch = (template) =>
  template
    .replace(/\{\{\s*cookie\.(?:removeCookie|clearCookie)\([^{}]*\)\s*\}\}/gi, "")
    .replace(/\{\{\s*key\s*\}\}/gi, encodeURIComponent(keyword))
    .replace(/\{\{\s*page\s*\}\}/gi, "1");

const upstreamUrl = resolveUrl(renderSearch(config.searchUrl), config.bookSourceUrl);
const upstreamProbe = await fetch(upstreamUrl, { redirect: "manual" });
let effectiveTemplate = config.searchUrl;
let repaired = false;
if (!upstreamProbe.ok && searchOverride) {
  effectiveTemplate = searchOverride;
  repaired = true;
}
const searchUrl = resolveUrl(renderSearch(effectiveTemplate), config.bookSourceUrl);
const searchDone = timer("search");
const searched = await fetchText(searchUrl);
if (!searched.response.ok) throw new Error("搜索 HTTP " + searched.response.status);
const searchRoot = parse(searched.text);
const nodes = searchRoot.querySelectorAll(config.ruleSearch.bookList);
const results = nodes
  .map((node) => ({
    name: extract(node, config.ruleSearch.name),
    author: extract(node, config.ruleSearch.author),
    bookUrl: resolveUrl(extract(node, config.ruleSearch.bookUrl), config.bookSourceUrl),
  }))
  .filter((item) => item.name && item.bookUrl);
timings.push(searchDone());
const target = results.find((item) => item.name === keyword) ?? results.find((item) => item.name.includes(keyword));
if (!target) throw new Error("搜索结果中未找到“" + keyword + "”");

const detailDone = timer("detail");
const detailed = await fetchText(target.bookUrl);
if (!detailed.response.ok) throw new Error("详情 HTTP " + detailed.response.status);
const detailRoot = parse(detailed.text);
const detail = {
  name: extract(detailRoot, config.ruleBookInfo?.name) || target.name,
  author: extract(detailRoot, config.ruleBookInfo?.author) || target.author,
};
timings.push(detailDone());

const tocDone = timer("toc");
const chapterNodes = detailRoot.querySelectorAll(config.ruleToc.chapterList);
const chapters = chapterNodes
  .map((node) => ({
    name: extract(node, config.ruleToc.chapterName),
    url: resolveUrl(extract(node, config.ruleToc.chapterUrl), target.bookUrl),
  }))
  .filter((item) => item.name && item.url);
const unique = [...new Map(chapters.map((chapter) => [chapter.url, chapter])).values()];
if (!unique.length) throw new Error("目录规则未匹配章节");
timings.push(tocDone());

const contentDone = timer("content");
const chapterResponse = await fetchText(unique[0].url);
if (!chapterResponse.response.ok) throw new Error("正文 HTTP " + chapterResponse.response.status);
const chapterRoot = parse(chapterResponse.text);
const content = htmlText(extract(chapterRoot, config.ruleContent.content, true));
if (content.length < 80) throw new Error("正文过短，疑似规则失效");
timings.push(contentDone());

console.log(
  JSON.stringify(
    {
      passed: true,
      source: config.bookSourceName,
      sourceUrl: config.bookSourceUrl,
      keyword,
      upstreamSearchStatus: upstreamProbe.status,
      temporarySearchRepair: repaired,
      matched: detail,
      resultCount: results.length,
      chapterCount: unique.length,
      firstChapter: unique[0].name,
      firstChapterReadableCharacters: content.length,
      timings,
    },
    null,
    2,
  ),
);