import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { HTMLElement, parse } from "node-html-parser";

import {
  extractLegadoJsonValue,
  parseLegadoPayload,
  renderLegadoPagePattern,
  selectLegadoJsonValues,
  splitLegadoRule,
} from "./legadoRuleEngine";

import type {
  Book,
  BookSourceConfig,
  ImportedBookSource,
  OnlineBookResult,
  OnlineChapter,
  SoNovelSourceRule,
} from "../types";

const SOURCES_KEY = "modu.book-sources.v1";
const ONLINE_BOOKS_KEY = "modu.online-books.v1";
const REQUEST_TIMEOUT = 12000;
const ONLINE_CACHE_ROOT = (FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? "") + "online-chapters";
const AGGREGATE_CONCURRENCY = 4;

export type BookSourceBrowserRequest = {
  url: string;
  headers: Record<string, string>;
  body?: string;
  method: string;
  delayMs?: number;
};
type BookSourceBrowserRequestHandler = (request: BookSourceBrowserRequest) => Promise<string>;
let bookSourceBrowserRequestHandler: BookSourceBrowserRequestHandler | undefined;
export function setBookSourceBrowserRequestHandler(handler: BookSourceBrowserRequestHandler | undefined) {
  bookSourceBrowserRequestHandler = handler;
}

export async function loadBookSources(): Promise<ImportedBookSource[]> {
  const raw = await AsyncStorage.getItem(SOURCES_KEY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as ImportedBookSource[];
    return items.filter((item) => item?.config?.bookSourceUrl);
  } catch {
    return [];
  }
}

export async function importBookSources(
  input: string,
  current: ImportedBookSource[],
): Promise<{ sources: ImportedBookSource[]; imported: number }> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("请输入书源 JSON 或书源直链。");
  const importUrl = /^https?:\/\//i.test(trimmed)
    ? normalizeBookSourceImportUrl(trimmed)
    : undefined;
  const payload = importUrl ? await requestText(importUrl, {}) : trimmed;
  const configs = parseSourcePayload(payload);
  if (!configs.length) throw new Error("没有找到可导入的书源配置。");
  const now = Date.now();
  const next = [...current];

  for (const config of configs) {
    validateSource(config);
    const id = sourceId(config.bookSourceUrl);
    const index = next.findIndex((item) => item.id === id);
    const previous = index >= 0 ? next[index] : undefined;
    const item: ImportedBookSource = {
      id,
      importUrl: importUrl ?? previous?.importUrl,
      config,
      importedAt: previous?.importedAt ?? now,
      updatedAt: now,
      enabled: previous?.enabled ?? config.enabled !== false,
    };
    if (index >= 0) next[index] = item;
    else next.push(item);
  }

  await persistSources(next);
  return { sources: next, imported: configs.length };
}

export async function refreshBookSource(
  source: ImportedBookSource,
  current: ImportedBookSource[],
): Promise<ImportedBookSource[]> {
  if (!source.importUrl) throw new Error("这个书源是从 JSON 文本导入的，没有可刷新的地址。");
  const payload = await requestText(source.importUrl, {});
  const configs = parseSourcePayload(payload);
  const matched = configs.find(
    (item) => normalizeBase(item.bookSourceUrl) === normalizeBase(source.config.bookSourceUrl),
  );
  if (!matched) throw new Error("更新内容中找不到同一个书源。");
  validateSource(matched);
  const next = current.map((item) =>
    item.id === source.id
      ? { ...item, config: matched, updatedAt: Date.now() }
      : item,
  );
  await persistSources(next);
  return next;
}

export async function setBookSourceEnabled(
  id: string,
  enabled: boolean,
  current: ImportedBookSource[],
): Promise<ImportedBookSource[]> {
  const next = current.map((item) => (item.id === id ? { ...item, enabled } : item));
  await persistSources(next);
  return next;
}

export async function deleteBookSource(
  id: string,
  current: ImportedBookSource[],
): Promise<ImportedBookSource[]> {
  const next = current.filter((item) => item.id !== id);
  await persistSources(next);
  return next;
}

export async function loadOnlineBooks(): Promise<Book[]> {
  const raw = await AsyncStorage.getItem(ONLINE_BOOKS_KEY);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as Book[]).map((book) => ({
      ...book,
      pages: [],
      pageTitles: [],
    }));
  } catch {
    return [];
  }
}

export async function saveOnlineBooks(books: Book[]) {
  const stored = books.map((book) => ({ ...book, pages: [], pageTitles: [] }));
  await AsyncStorage.setItem(ONLINE_BOOKS_KEY, JSON.stringify(stored));
}

export function createOnlineBook(result: OnlineBookResult): Book {
  const id = "web-" + hash(result.sourceId + "|" + result.bookUrl);
  const palette = palettes[parseInt(hash(result.bookUrl).slice(-2), 36) % palettes.length];
  return {
    id,
    title: result.name || "未命名书籍",
    author: result.author || "未知作者",
    category: "在线书籍",
    progress: 0,
    currentChapter: result.latestChapter || "尚未阅读",
    lastRead: "来自动态书源",
    coverColors: palette,
    accent: "#8FA899",
    pages: [],
    pageTitles: [],
    format: "web",
    sourceId: result.sourceId,
    bookUrl: result.bookUrl,
    tocUrl: result.tocUrl,
    coverUrl: result.coverUrl,
    onlineChapterIndex: 0,
    downloadedChapterCount: 0,
    fullyDownloaded: false,
  };
}


export async function searchSource(
  source: ImportedBookSource,
  keyword: string,
): Promise<OnlineBookResult[]> {
  const config = source.config;
  if (!source.enabled) throw new Error("请先启用这个书源。");
  if (config.sourceFormat === "so-novel" && config.soNovel) {
    return searchSoNovelSource(source, keyword);
  }
  if (!config.searchUrl || !config.ruleSearch) {
    throw new Error("这个书源没有可用的搜索规则。");
  }
  if (!config.ruleSearch.bookList) throw new Error("书源缺少搜索列表规则。");
  const request = sourceRequest(renderTemplate(config.searchUrl, keyword, 1), config);
  const responseText = await requestText(request.url, request.headers, request);
  const payload = parseSourceRulePayload(responseText);
  const results: OnlineBookResult[] = [];
  for (const node of selectSourceRuleNodes(payload, config.ruleSearch.bookList)) {
    const name = extractSourceRule(node, config.ruleSearch.name);
    const bookUrl = resolveOptionalUrl(extractSourceRule(node, config.ruleSearch.bookUrl), config.bookSourceUrl);
    if (!name || !bookUrl) continue;
    results.push({
      sourceId: source.id,
      sourceName: config.bookSourceName,
      name,
      author: cleanAuthor(extractSourceRule(node, config.ruleSearch.author)),
      bookUrl,
      coverUrl: resolveOptionalUrl(extractSourceRule(node, config.ruleSearch.coverUrl), config.bookSourceUrl),
      intro: extractSourceRule(node, config.ruleSearch.intro),
      wordCount: extractSourceRule(node, config.ruleSearch.wordCount),
      latestChapter: extractSourceRule(node, config.ruleSearch.lastChapter),
    });
  }
  return results;
}

export async function searchSources(
  sources: ImportedBookSource[],
  keyword: string,
  onProgress?: (completed: number, total: number, failed: number) => void,
): Promise<{ results: OnlineBookResult[]; failed: number }> {
  const available = sources.filter((source) =>
    source.enabled && (source.config.sourceFormat === "so-novel"
      ? source.config.soNovel?.search?.disabled !== true && Boolean(source.config.soNovel?.search)
      : Boolean(source.config.searchUrl && source.config.ruleSearch)),
  );
  if (!available.length) throw new Error("没有可用的搜索书源。");
  let cursor = 0;
  let completed = 0;
  let failed = 0;
  const collected: OnlineBookResult[] = [];
  const worker = async () => {
    while (cursor < available.length) {
      const source = available[cursor++];
      try { collected.push(...await searchSource(source, keyword)); }
      catch { failed += 1; }
      finally {
        completed += 1;
        onProgress?.(completed, available.length, failed);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(AGGREGATE_CONCURRENCY, available.length) },
    () => worker(),
  ));
  const seen = new Set<string>();
  const results = collected.filter((item) => {
    const key = item.sourceId + "|" + item.bookUrl;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!results.length && failed === available.length) {
    throw new Error("所有书源都暂时无法连接，请稍后重试。");
  }
  return { results, failed };
}

async function searchSoNovelSource(
  source: ImportedBookSource,
  keyword: string,
): Promise<OnlineBookResult[]> {
  const rule = source.config.soNovel!;
  const section = rule.search;
  if (!section?.url || !section.result || !section.bookName || section.disabled) {
    throw new Error("这个书源没有可用的搜索规则。");
  }
  assertNoUnsafeScript(section);
  const request = soNovelSearchRequest(rule, keyword);
  const html = await requestText(request.url, request.headers, { body: request.body, method: request.method });
  const root = parse(html);
  const base = section.baseUri || request.url;
  return selectNodes(root, section.result).flatMap((node) => {
    const name = extractSoValue(node, section.bookName);
    const bookUrl = resolveOptionalUrl(extractSoLink(node, section.bookName), base);
    if (!name || !bookUrl) return [];
    return [{
      sourceId: source.id,
      sourceName: source.config.bookSourceName,
      name,
      author: cleanAuthor(extractSoValue(node, section.author)),
      bookUrl,
      coverUrl: resolveOptionalUrl(extractSoLink(node, section.coverUrl), base),
      intro: extractSoValue(node, section.intro),
      wordCount: extractSoValue(node, section.wordCount),
      latestChapter: extractSoValue(node, section.latestChapter),
    }];
  });
}

function soNovelSearchRequest(rule: SoNovelSourceRule, keyword: string): SourceRequest {
  const section = rule.search!;
  const method = (section.method || "GET").toUpperCase();
  const url = resolveUrl(formatPercent(section.url!, encodeURIComponent(keyword)), section.baseUri || rule.url);
  const headers = sourceHeaders({ bookSourceName: rule.name, bookSourceUrl: rule.url }, url);
  if (section.cookies) headers.Cookie = section.cookies;
  let body: string | undefined;
  if (method !== "GET" && section.data !== undefined) {
    body = soNovelFormBody(section.data, keyword);
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  }
  return { url, method, body, headers };
}

function soNovelFormBody(data: string | Record<string, unknown>, keyword: string) {
  const pairs: Array<[string, string]> = [];
  if (typeof data === "object") {
    for (const [key, value] of Object.entries(data)) pairs.push([key, String(value)]);
  } else {
    const raw = data.trim().replace(/^\{/, "").replace(/\}$/, "");
    for (const part of raw.split(",")) {
      const colon = part.indexOf(":");
      if (colon < 1) continue;
      pairs.push([
        part.slice(0, colon).trim().replace(/^['"]|['"]$/g, ""),
        part.slice(colon + 1).trim().replace(/^['"]|['"]$/g, ""),
      ]);
    }
  }
  return pairs.map(([key, value]) =>
    encodeURIComponent(key) + "=" + encodeURIComponent(formatPercent(value, keyword)),
  ).join("&");
}

function formatPercent(value: string, replacement: string) {
  return value.replace(/%s/g, replacement);
}

function assertNoUnsafeScript(section: Record<string, unknown>) {
  if (Object.values(section).some((value) => typeof value === "string" && /@js:|@java:/i.test(value))) {
    throw new Error("该书源需要执行自定义脚本，安全模式不支持。");
  }
}

function applySafePrefixTransform(value: string, rule: string) {
  const match = rule.match(/@js:\s*r\s*=\s*(['"])([^'"]+)\1\s*\+\s*r\s*;?$/i);
  return match ? match[2] + value : value;
}

function assertSafeBookSection(section: Record<string, unknown>) {
  for (const value of Object.values(section)) {
    if (typeof value !== "string" || !/@js:|@java:/i.test(value)) continue;
    if (!/@js:\s*r\s*=\s*(['"])[^'"]+\1\s*\+\s*r\s*;?$/i.test(value)) {
      throw new Error("该书源需要执行自定义脚本，安全模式不支持。");
    }
  }
}

function extractSoValue(root: HTMLElement, rule?: string) {
  if (!rule) return "";
  const value = extract(root, rule);
  if (value) return applySafePrefixTransform(value, rule);
  const selector = rule.split("@js:")[0].split("@")[0];
  try {
    const node = selector ? selectSelectorPath(root, selector)[0] : root;
    return applySafePrefixTransform(node?.getAttribute("content") || node?.getAttribute("value") || "", rule);
  } catch { return ""; }
}

function extractSoLink(root: HTMLElement, rule?: string) {
  if (!rule) return "";
  const base = rule.split("@js:")[0].split("@java:")[0];
  const pieces = base.split("@");
  const explicit = pieces.length > 1 ? pieces.pop() : undefined;
  try {
    const node = pieces.join("@") ? selectSelectorPath(root, pieces.join("@"))[0] : root;
    return explicit && explicit !== "text"
      ? applySafePrefixTransform(node?.getAttribute(explicit) || "", rule)
      : applySafePrefixTransform(node?.getAttribute("href") || node?.getAttribute("src") || node?.getAttribute("content") || node?.getAttribute("value") || "", rule);
  } catch { return ""; }
}

export async function loadBookInfo(
  source: ImportedBookSource,
  result: OnlineBookResult,
): Promise<OnlineBookResult> {
  if (source.config.sourceFormat === "so-novel" && source.config.soNovel) {
    const rules = source.config.soNovel.book;
    if (!rules) return result;
    assertSafeBookSection(rules);
    const html = await requestText(result.bookUrl, sourceHeaders(source.config, result.bookUrl));
    const root = parse(html);
    return {
      ...result,
      name: extractSoValue(root, rules.bookName) || result.name,
      author: cleanAuthor(extractSoValue(root, rules.author)) || result.author,
      intro: extractSoValue(root, rules.intro) || result.intro,
      wordCount: extractSoValue(root, rules.wordCount) || result.wordCount,
      coverUrl: resolveOptionalUrl(extractSoLink(root, rules.coverUrl), rules.baseUri || result.bookUrl) || result.coverUrl,
      latestChapter: extractSoValue(root, rules.latestChapter) || result.latestChapter,
    };
  }
  const rules = source.config.ruleBookInfo;
  if (!rules) return result;
  const request = sourceRequest(result.bookUrl, source.config);
  const responseText = await requestText(request.url, request.headers, request);
  const payload = parseSourceRulePayload(responseText);
  const variables = extractLegadoVariables(payload, rules.init);
  const read = (rule?: string, preserveHtml = false) => extractLegadoValue(payload, rule, variables, preserveHtml);
  return {
    ...result,
    name: read(rules.name) || result.name,
    author: cleanAuthor(read(rules.author)) || result.author,
    intro: read(rules.intro, true) || result.intro,
    wordCount: read(rules.wordCount) || result.wordCount,
    coverUrl: resolveOptionalUrl(read(rules.coverUrl), request.url) || result.coverUrl,
    latestChapter: read(rules.lastChapter) || result.latestChapter,
    tocUrl: resolveOptionalUrl(read(rules.tocUrl), request.url) || result.tocUrl,
  };
}
function extractLegadoVariables(root: SourceRulePayload, init?: string) {
  const values: Record<string, string> = {};
  if (!init || !init.startsWith("@put:")) return values;
  const pairs = init.matchAll(/([A-Za-z_][\w]*)\s*:\s*"((?:\\.|[^"])*)"/g);
  for (const match of pairs) {
    let rule = match[2];
    try { rule = JSON.parse('"' + rule + '"') as string; } catch {}
    values[match[1]] = extractStaticAlternatives(root, rule);
  }
  return values;
}
function extractStaticAlternatives(root: SourceRulePayload, rule: string, preserveHtml = false) {
  return extractSourceRule(root, rule, preserveHtml);
}
function extractLegadoValue(root: SourceRulePayload, rule: string | undefined, variables: Record<string, string>, preserveHtml = false) {
  if (!rule) return "";
  const variable = rule.match(/@get:\{([^}]+)\}/);
  if (!variable || variable.index === undefined) return extractStaticAlternatives(root, rule, preserveHtml);
  const value = variables[variable[1].trim()] || "";
  return (rule.slice(0, variable.index) + value + rule.slice(variable.index + variable[0].length)).trim();
}

export async function loadChapterList(
  source: ImportedBookSource,
  bookUrl: string,
): Promise<OnlineChapter[]> {
  if (source.config.sourceFormat === "so-novel" && source.config.soNovel) return loadSoNovelChapterList(source.config.soNovel, bookUrl);
  const rules = source.config.ruleToc;
  if (!rules?.chapterList) throw new Error("这个书源缺少目录规则。");
  const queue = [bookUrl];
  const visited = new Set<string>();
  const raw: OnlineChapter[] = [];
  while (queue.length && visited.size < 32) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const request = sourceRequest(url, source.config);
    const responseText = await requestText(request.url, request.headers, request);
    const payload = parseSourceRulePayload(responseText);
    const matchedNodes = selectSourceRuleNodes(payload, rules.chapterList);
    for (const node of matchedNodes) {
      const name = extractSourceRule(node, rules.chapterName);
      const chapterUrl = resolveOptionalUrl(extractSourceRule(node, rules.chapterUrl), request.url);
      if (name && chapterUrl) raw.push({ name, url: chapterUrl });
    }
    if (!matchedNodes.length && payload.kind === "html") {
      raw.push(...discoverConservativeChapterLinks(payload.value, request.url));
      const discoveredToc = discoverTableOfContentsUrl(payload.value, request.url);
      if (discoveredToc && !visited.has(discoveredToc) && !queue.includes(discoveredToc)) {
        queue.push(discoveredToc);
      }
    }
    const next = resolveOptionalUrl(extractSourceRule(payload, rules.nextTocUrl), request.url);
    if (next && !visited.has(next) && !queue.includes(next)) queue.push(next);
  }
  const unique = new Map<string, OnlineChapter>();
  for (const chapter of raw) unique.set(chapter.url, chapter);
  return [...unique.values()];
}

function discoverTableOfContentsUrl(root: HTMLElement, baseUrl: string) {
  const labels = /^(?:目录|章节目录|全部章节|章节列表|返回目录|更多章节|contents?|catalog)$/i;
  for (const link of root.querySelectorAll("a")) {
    const label = normalizeText(link.textContent).replace(/\s+/g, "");
    if (!labels.test(label)) continue;
    const resolved = resolveOptionalUrl(link.getAttribute("href") || "", baseUrl);
    if (resolved && resolved !== baseUrl) return resolved;
  }
  return undefined;
}

function discoverConservativeChapterLinks(root: HTMLElement, baseUrl: string) {
  const candidates = root.querySelectorAll("a").flatMap((link) => {
    const name = normalizeText(link.textContent);
    const href = resolveOptionalUrl(link.getAttribute("href") || "", baseUrl);
    if (!href || !/^(?:第.{0,18}[章节回卷集部篇]|chapter\s*[\divxlcdm]+)/i.test(name)) return [];
    return [{ name, url: href } satisfies OnlineChapter];
  });
  if (candidates.length < 3) return [];
  return [...new Map(candidates.map((chapter) => [chapter.url, chapter])).values()];
}
async function loadSoNovelChapterList(
  rule: SoNovelSourceRule,
  bookUrl: string,
): Promise<OnlineChapter[]> {
  const toc = rule.toc;
  if (!toc?.item) throw new Error("这个书源缺少目录规则。");
  assertNoUnsafeScript(toc);
  const token = captureBookToken(rule.book?.url, bookUrl);
  const template = toc.url || (toc.baseUri?.includes("%s") ? toc.baseUri : undefined);
  const firstUrl = template ? resolveUrl(formatPercent(template, token), rule.url) : bookUrl;
  const queue = [firstUrl];
  const visited = new Set<string>();
  const raw: OnlineChapter[] = [];
  while (queue.length && visited.size < 16) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const html = await requestText(url, sourceHeaders(
      { bookSourceName: rule.name, bookSourceUrl: rule.url },
      bookUrl,
    ));
    const root = parse(html);
    const base = toc.baseUri ? formatPercent(toc.baseUri, token) : url;
    for (const node of selectNodes(root, toc.item)) {
      const name = normalizeText(node.textContent);
      const chapterUrl = resolveOptionalUrl(
        node.getAttribute("href") || node.getAttribute("value") || "",
        base,
      );
      if (name && chapterUrl) raw.push({ name, url: chapterUrl });
    }
    if (toc.nextPage) {
      for (const node of selectNodes(root, toc.nextPage)) {
        const next = resolveOptionalUrl(
          node.getAttribute("href") || node.getAttribute("value") || "",
          base,
        );
        if (next && !visited.has(next) && !queue.includes(next)) queue.push(next);
      }
    }
  }
  const unique = new Map<string, OnlineChapter>();
  for (const chapter of raw) unique.set(chapter.url, chapter);
  const chapters = [...unique.values()];
  return toc.isDesc ? chapters.reverse() : chapters;
}

function captureBookToken(pattern: string | undefined, bookUrl: string) {
  if (!pattern) return "";
  try { return new RegExp(pattern).exec(bookUrl)?.[1] || ""; }
  catch { return ""; }
}

export async function loadChapterContent(
  source: ImportedBookSource,
  chapter: OnlineChapter,
): Promise<string> {
  if (source.config.sourceFormat === "so-novel" && source.config.soNovel) {
    return loadSoNovelChapterContent(source.config.soNovel, chapter);
  }
  const rules = source.config.ruleContent;
  if (!rules?.content) throw new Error("这个书源缺少正文规则。");
  if (isInitTxtRule(rules.content)) return loadInitTxtContent(source, chapter);
  const parts: string[] = [];
  const visited = new Set<string>();
  let url: string | undefined = chapter.url;

  for (let page = 0; url && page < 8; page += 1) {
    if (visited.has(url)) break;
    visited.add(url);
    const request = sourceRequest(url, source.config);
    const responseText = await requestText(request.url, request.headers, request);
    const payload = parseSourceRulePayload(responseText);
    const rawContent = extractSourceRule(payload, rules.content, true);
    const text = htmlToReadableText(rawContent);
    if (text) parts.push(text);

    const nextRaw = extractSourceRule(payload, rules.nextContentUrl);
    const next = resolveOptionalUrl(nextRaw, request.url);
    if (!next || visited.has(next)) break;
    url = next;
  }

  const content = parts.join("\n\n").trim();
  if (!content) throw new Error("正文规则没有匹配到可读内容。");
  return content;
}


function isInitTxtRule(rule: string) {
  return /initTxt\s*\(/i.test(rule) && /java\.ajax/i.test(rule);
}
async function loadInitTxtContent(source: ImportedBookSource, chapter: OnlineChapter) {
  const chapterRequest = sourceRequest(chapter.url, source.config);
  const html = await requestText(chapterRequest.url, chapterRequest.headers, chapterRequest);
  const endpointMatch = html.match(/initTxt\s*\(\s*["']([^"']+)["']/i);
  const endpoint = endpointMatch ? resolveOptionalUrl(endpointMatch[1], chapterRequest.url) : undefined;
  if (!endpoint) throw new Error("正文接口没有返回可识别的章节地址。");
  const endpointRequest = sourceRequest(endpoint, source.config);
  const payload = await requestText(endpointRequest.url, endpointRequest.headers, endpointRequest);
  const callback = payload.match(/_txt_call\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*$/i);
  if (!callback) throw new Error("正文接口返回格式与书源规则不一致。");
  let data: { content?: string; replace?: Record<string, string> };
  try { data = JSON.parse(callback[1]) as { content?: string; replace?: Record<string, string> }; }
  catch { throw new Error("正文接口返回了无法解析的数据。"); }
  let content = data.content || "";
  for (const [replacement, pattern] of Object.entries(data.replace || {})) {
    try { content = content.replace(new RegExp(pattern, "gi"), replacement); } catch {}
  }
  const readable = htmlToReadableText(content);
  if (!readable) throw new Error("本章暂时没有可读正文。");
  return readable;
}

async function loadSoNovelChapterContent(
  rule: SoNovelSourceRule,
  chapter: OnlineChapter,
): Promise<string> {
  const section = rule.chapter;
  if (!section?.content) throw new Error("这个书源缺少正文规则。");
  assertSafeContentSection(section);
  const parts: string[] = [];
  const visited = new Set<string>();
  let url: string | undefined = chapter.url;
  for (let page = 0; url && page < 12; page += 1) {
    if (visited.has(url)) break;
    visited.add(url);
    const html = await requestText(url, sourceHeaders(
      { bookSourceName: rule.name, bookSourceUrl: rule.url },
      chapter.url,
    ));
    const root = parse(html);
    removeFilteredNodes(root, section.filterTag);
    let raw = extract(root, section.content, true);
    raw = applySafeContentTransforms(raw, section.content);
    let text = htmlToReadableText(raw);
    text = applyTextFilter(text, section.filterTxt);
    if (text) parts.push(text);
    const next = resolveOptionalUrl(extractSoLink(root, section.nextPage), url);
    if (!next || visited.has(next)) break;
    url = next;
  }
  const content = parts.join("\n\n").trim();
  if (!content) throw new Error("正文规则没有匹配到可读内容。");
  return content;
}

function assertSafeContentSection(section: Record<string, unknown>) {
  for (const value of Object.values(section)) {
    if (typeof value !== "string" || !/@js:|@java:/i.test(value)) continue;
    if (!/qsbs\.bb|base64\.decode/i.test(value)) {
      throw new Error("该书源需要执行自定义脚本，安全模式不支持。");
    }
  }
}

function removeFilteredNodes(root: HTMLElement, selectorList?: string) {
  if (!selectorList) return;
  for (const selector of selectorList.split(",").map((item) => item.trim()).filter(Boolean)) {
    try { root.querySelectorAll(selector).forEach((node) => node.remove()); }
    catch {}
  }
}

function applyTextFilter(text: string, pattern?: string) {
  if (!pattern) return text;
  try { return text.replace(new RegExp(pattern, "gi"), "").replace(/\n{3,}/g, "\n\n").trim(); }
  catch { return text; }
}

function applySafeContentTransforms(html: string, rule: string) {
  if (!/qsbs\.bb|base64\.decode/i.test(rule)) return html;
  return html.replace(
    /<script[^>]*>\s*document\.writeln\(qsbs\.bb\(['"]([^'"]+)['"]\)\);?\s*<\/script>/gi,
    (_, encoded: string) => decodeBase64Utf8(encoded),
  );
}

function decodeBase64Utf8(value: string) {
  try {
    const binary = globalThis.atob(value.replace(/\s/g, ""));
    let escaped = "";
    for (let index = 0; index < binary.length; index += 1) {
      escaped += "%" + binary.charCodeAt(index).toString(16).padStart(2, "0");
    }
    return decodeURIComponent(escaped);
  } catch { return ""; }
}

export async function readCachedOnlineChapter(
  bookId: string,
  chapter: OnlineChapter,
): Promise<string | undefined> {
  if (!ONLINE_CACHE_ROOT) return undefined;
  const path = chapterCachePath(bookId, chapter.url);
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists || info.isDirectory) return undefined;
  try {
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return undefined;
  }
}

export async function loadOnlineChapter(
  source: ImportedBookSource,
  bookId: string,
  chapter: OnlineChapter,
): Promise<{ content: string; fromCache: boolean }> {
  const cached = await readCachedOnlineChapter(bookId, chapter);
  if (cached) return { content: cached, fromCache: true };

  const content = await loadChapterContent(source, chapter);
  await writeCachedOnlineChapter(bookId, chapter, content);
  return { content, fromCache: false };
}

export async function countCachedOnlineChapters(bookId: string): Promise<number> {
  if (!ONLINE_CACHE_ROOT) return 0;
  const directory = onlineBookCacheDirectory(bookId);
  const info = await FileSystem.getInfoAsync(directory);
  if (!info.exists || !info.isDirectory) return 0;
  try {
    const files = await FileSystem.readDirectoryAsync(directory);
    return files.filter((name) => name.endsWith(".txt")).length;
  } catch {
    return 0;
  }
}

export async function downloadOnlineBook(
  source: ImportedBookSource,
  book: Book,
  chapters: OnlineChapter[],
  onProgress: (completed: number, total: number) => void,
): Promise<number> {
  if (!chapters.length) throw new Error("这本书还没有可下载的章节。");
  let cursor = 0;
  let completed = 0;
  let firstError: unknown;

  const worker = async () => {
    while (cursor < chapters.length) {
      const index = cursor;
      cursor += 1;
      try {
        await loadOnlineChapter(source, book.id, chapters[index]);
        completed += 1;
        onProgress(completed, chapters.length);
      } catch (error) {
        firstError ??= error;
      }
    }
  };

  await Promise.all([worker(), worker()]);
  if (firstError) {
    throw new Error(
      "已下载 " + completed + " / " + chapters.length + " 章，部分章节暂时无法获取。",
    );
  }
  return completed;
}

export async function deleteOnlineBookCache(bookId: string): Promise<void> {
  if (!ONLINE_CACHE_ROOT) return;
  const directory = onlineBookCacheDirectory(bookId);
  const info = await FileSystem.getInfoAsync(directory);
  if (info.exists) {
    await FileSystem.deleteAsync(directory, { idempotent: true });
  }
}

export async function clearOnlineChapterCache(): Promise<void> {
  if (!ONLINE_CACHE_ROOT) return;
  const info = await FileSystem.getInfoAsync(ONLINE_CACHE_ROOT);
  if (info.exists) {
    await FileSystem.deleteAsync(ONLINE_CACHE_ROOT, { idempotent: true });
  }
}

async function writeCachedOnlineChapter(
  bookId: string,
  chapter: OnlineChapter,
  content: string,
) {
  if (!ONLINE_CACHE_ROOT) return;
  const directory = onlineBookCacheDirectory(bookId);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.writeAsStringAsync(chapterCachePath(bookId, chapter.url), content);
}

function onlineBookCacheDirectory(bookId: string) {
  return ONLINE_CACHE_ROOT + "/" + encodeURIComponent(bookId);
}

function chapterCachePath(bookId: string, chapterUrl: string) {
  return onlineBookCacheDirectory(bookId) + "/" + hash(chapterUrl) + ".txt";
}
export function paginateOnlineText(text: string, target = 720): string[] {
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > target) {
      pages.push(current.trim());
      current = "";
    }
    if (paragraph.length > target * 1.7) {
      for (let index = 0; index < paragraph.length; index += target) {
        if (current) {
          pages.push(current.trim());
          current = "";
        }
        pages.push(paragraph.slice(index, index + target).trim());
      }
    } else {
      current += (current ? "\n\n" : "") + paragraph;
    }
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length ? pages : ["本章暂无正文。"];
}

async function persistSources(sources: ImportedBookSource[]) {
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
}

function normalizeBookSourceImportUrl(url: string) {
  const yiove = url.match(/^https?:\/\/shuyuan\.yiove\.com\/book-source\/([0-9a-f-]{36})(?:[/?#]|$)/i);
  return yiove
    ? "https://shuyuan-api.yiove.com/import/book-source/" + yiove[1]
    : url;
}

function parseSourcePayload(payload: string): BookSourceConfig[] {
  let parsed: unknown;
  const cleaned = payload.replace(/^\uFEFF/, "");
  try { parsed = JSON.parse(cleaned); } catch {
    try { parsed = JSON.parse(cleaned.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/,\s*([}\]])/g, "$1")); }
    catch { throw new Error("\u5bfc\u5165\u5185\u5bb9\u4e0d\u662f\u6709\u6548\u7684\u4e66\u6e90 JSON\u3002"); }
  }
  const object = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  const value = object && "data" in object ? object.data : object && Array.isArray(object.sources) ? object.sources : object && Array.isArray(object.rules) ? object.rules : parsed;
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if ("bookSourceUrl" in item) return [{ ...(item as BookSourceConfig), sourceFormat: (item as BookSourceConfig).sourceFormat || "legado" }];
    if (isSoNovelRule(item)) return [adaptSoNovelRule(item)];
    return [];
  });
}

function isSoNovelRule(value: object): value is SoNovelSourceRule {
  const item = value as Partial<SoNovelSourceRule>;
  return typeof item.url === "string" && typeof item.name === "string" && Boolean(item.search || item.book || item.toc || item.chapter);
}

function adaptSoNovelRule(rule: SoNovelSourceRule): BookSourceConfig {
  return { bookSourceName: rule.name, bookSourceUrl: rule.url, bookSourceGroup: "So Novel", enabled: rule.disabled !== true && /^https:/i.test(rule.url), sourceFormat: "so-novel", soNovel: rule };
}

function validateSource(config: BookSourceConfig) {
  if (!config.bookSourceName || !config.bookSourceUrl) {
    throw new Error("书源缺少名称或地址。");
  }
  if (!/^https?:\/\//i.test(config.bookSourceUrl)) {
    throw new Error("目前只支持 HTTP/HTTPS 书源。");
  }
}

function renderTemplate(template: string, keyword: string, page: number) {
  const withoutSafePrelude = template.replace(
    /\{\{\s*cookie\.(?:removeCookie|clearCookie)\([^{}]*\)\s*\}\}/gi,
    "",
  );
  const rendered = renderLegadoPagePattern(withoutSafePrelude, page)
    .replace(/\{\{\s*key\s*\}\}/gi, encodeURIComponent(keyword))
    .replace(/\{\{\s*page\s*\}\}/gi, String(page));
  if (/\{\{[\s\S]*?\}\}/.test(rendered)) {
    throw new Error("该书源包含需要执行脚本的 URL 规则，安全模式暂不支持。");
  }
  return rendered.trim();
}

type SourceRequest = {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  useWebView?: boolean;
  webViewDelayTime?: number;
};

function sourceRequest(rendered: string, config: BookSourceConfig): SourceRequest {
  let rawUrl = rendered.trim();
  let method = "GET";
  let body: string | undefined;
  let extraHeaders: Record<string, string> = {};
  let useWebView = false;
  let webViewDelayTime: number | undefined;

  const legacyPost = rawUrl.match(/^([\s\S]*?)@post->([\s\S]*)$/i);
  if (legacyPost) {
    rawUrl = legacyPost[1].trim();
    method = "POST";
    body = legacyPost[2].trim();
  } else {
    const optionSuffix = rawUrl.match(/^([\s\S]*?),\s*(\{[\s\S]*\})\s*$/);
    if (optionSuffix) {
      try {
        const options = JSON.parse(optionSuffix[2]) as {
          method?: string;
          body?: string;
          headers?: string | Record<string, string>;
          webView?: boolean | string;
          webViewDelayTime?: number | string;
        };
        rawUrl = optionSuffix[1].trim();
        method = (options.method || (options.body ? "POST" : "GET")).toUpperCase();
        body = typeof options.body === "string" ? options.body : undefined;
        extraHeaders = normalizeHeaders(options.headers);
        useWebView = options.webView === true ||
          (typeof options.webView === "string" && options.webView.toLowerCase() !== "false");
        const parsedDelay = Number(options.webViewDelayTime);
        if (Number.isFinite(parsedDelay) && parsedDelay > 0) {
          webViewDelayTime = Math.min(parsedDelay, 8000);
        }
      } catch {
        // Keep the complete URL when the suffix is not valid request JSON.
      }
    }
  }

  const headers = {
    ...sourceHeaders(config, config.bookSourceUrl),
    ...extraHeaders,
  };
  if (body && !findHeader(headers, "content-type")) {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  }
  return {
    url: resolveUrl(rawUrl, config.bookSourceUrl),
    method,
    body,
    headers,
    useWebView,
    webViewDelayTime,
  };
}

function normalizeHeaders(value?: string | Record<string, string>) {
  if (!value) return {};
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    const headers: Record<string, string> = {};
    value.split(/\r?\n/).forEach((line) => {
      const colon = line.indexOf(":");
      if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    });
    return headers;
  }
}

function findHeader(headers: Record<string, string>, name: string) {
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function secureRequestUrl(url: string) {
  if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "kkbiquge.net" || parsed.hostname.endsWith(".kkbiquge.net"))
    ) {
      return url;
    }
  } catch {}
  return url.replace(/^http:\/\//i, "https://");
}

function sourceHeaders(config: BookSourceConfig, referer?: string) {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
    "Cache-Control": "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  };
  if (typeof config.header === "string") {
    try {
      Object.assign(headers, JSON.parse(config.header));
    } catch {
      config.header.split(/\r?\n/).forEach((line) => {
        const colon = line.indexOf(":");
        if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      });
    }
  } else if (config.header) {
    Object.assign(headers, config.header);
  }
  if (referer && !findHeader(headers, "referer")) {
    headers.Referer = secureRequestUrl(referer);
  }
  return headers;
}


type SourceRulePayload =
  | { kind: "html"; value: HTMLElement }
  | { kind: "json"; value: unknown };

function parseSourceRulePayload(responseText: string): SourceRulePayload {
  const payload = parseLegadoPayload(responseText);
  return payload.kind === "json"
    ? payload
    : { kind: "html", value: parse(payload.value) };
}

function selectSourceRuleNodes(payload: SourceRulePayload, rule?: string): SourceRulePayload[] {
  if (!rule) return [];
  if (payload.kind === "json") {
    return selectLegadoJsonValues(payload.value, rule).map((value) => ({ kind: "json", value }));
  }
  const selector = safeStaticSelector(rule);
  if (!selector) return [];
  return selectNodes(payload.value, selector).map((value) => ({ kind: "html", value }));
}

function extractSourceRule(payload: SourceRulePayload, rule?: string, preserveHtml = false) {
  return payload.kind === "json"
    ? extractLegadoJsonValue(payload.value, rule)
    : extract(payload.value, rule, preserveHtml);
}
function safeStaticSelector(rule?: string) {
  if (!rule) return "";
  if (!rule.trim().startsWith("@js:")) return rule;
  const script = rule.slice(rule.indexOf("@js:") + 4);
  const assigned = script.match(/\b(?:path|selector)\s*=\s*['"]([^'"]+)['"]/i);
  const literal = script.match(/java\.getElement\s*\(\s*['"]([^'"]+)['"]\s*\)/i);
  const selector = assigned?.[1] || literal?.[1] || "";
  return selector && !/[{}();]/.test(selector) ? selector : "";
}
function looksLikeBrowserChallenge(status: number, text: string) {
  return [401, 403, 429, 503].includes(status) ||
    /\/@wafjs\b|cf-chl-|challenge-platform|captcha|<title>\s*loading/i.test(text);
}

async function requestText(
  url: string,
  headers: Record<string, string>,
  request: { body?: string; method?: string; useWebView?: boolean; webViewDelayTime?: number } = {},
) {
  const requestUrl = secureRequestUrl(url);
  const browserRequest: BookSourceBrowserRequest = {
    url: requestUrl,
    headers,
    body: request.body,
    method: request.method ?? "GET",
    delayMs: request.webViewDelayTime,
  };
  let lastError: unknown;

  if (request.useWebView) {
    if (bookSourceBrowserRequestHandler) return bookSourceBrowserRequestHandler(browserRequest);
    throw new Error("这个书源需要使用内置网页引擎，请在应用中重试。");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(requestUrl, {
        body: request.body,
        headers,
        method: request.method ?? "GET",
        signal: controller.signal,
      });
      const text = await response.text();
      if (looksLikeBrowserChallenge(response.status, text)) {
        if (bookSourceBrowserRequestHandler) return await bookSourceBrowserRequestHandler(browserRequest);
        throw new Error("这个书源需要完成一次网页验证，请在应用中重试。");
      }
      if ([502, 504].includes(response.status) && attempt === 0) {
        await waitForSourceRetry();
        continue;
      }
      if (!response.ok) throw new Error("这个书源暂时不可用（状态 " + response.status + "）。");
      return text;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (error instanceof Error && error.name === "AbortError") {
        if (attempt === 0) {
          await waitForSourceRetry();
          continue;
        }
        throw new Error("书源响应超时，请检查网络后重试。");
      }
      if (/CLEARTEXT|UnknownServiceException/i.test(message)) {
        throw new Error("这个书源仍在使用不安全的旧地址，请更新书源后重试。");
      }
      if (/fetch failed|Network request failed|java\.net\.|Failed to connect|socket|connection.*closed/i.test(message)) {
        if (attempt === 0) {
          await waitForSourceRetry();
          continue;
        }
        if (bookSourceBrowserRequestHandler) return await bookSourceBrowserRequestHandler(browserRequest);
        throw new Error("无法连接到这个书源，请检查网络或切换其他书源。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("书源请求失败，请稍后重试。");
}

function waitForSourceRetry() {
  return new Promise<void>((resolve) => setTimeout(resolve, 320));
}

function selectNodes(root: HTMLElement, rule: string): HTMLElement[] {
  for (const alternative of splitLegadoRule(rule, "||")) {
    const nodes = splitLegadoRule(alternative, "&&")
      .flatMap((part) => selectSelectorPath(root, part));
    if (nodes.length) return nodes;
  }
  return [];
}

function selectSelectorPath(root: HTMLElement, expression: string): HTMLElement[] {
  if (!expression) return [];
  const safeExpression = normalizeCompatibleSelector(
    expression.split("@js:")[0].replace(/^@?CSS:/i, ""),
  );
  const segments = safeExpression.split("@").map((item) => item.trim()).filter(Boolean);
  let current: HTMLElement[] = [root];

  for (const rawSegment of segments) {
    const normalized = normalizeSelector(rawSegment);
    if (!normalized.selector) continue;
    try {
      const matches = current.flatMap((node) =>
        node.querySelectorAll(normalized.selector),
      );
      if (normalized.index === undefined) {
        current = matches;
      } else {
        const index =
          normalized.index < 0 ? matches.length + normalized.index : normalized.index;
        current = matches[index] ? [matches[index]] : [];
      }
    } catch {
      return [];
    }
    if (!current.length) break;
  }
  return current;
}

function normalizeCompatibleSelector(expression: string) {
  const value = expression.trim().replace(/^XPath:/i, "");
  if (!value.startsWith("/")) return value;
  return value
    .replace(/^\/+/, "")
    .replace(/\/\//g, " ")
    .replace(/\//g, " > ")
    .replace(/\[@id=['"]([^'"]+)['"]\]/g, "#$1")
    .replace(/\[@class=['"]([^'"]+)['"]\]/g, (_, classes: string) =>
      "." + classes.trim().split(/\s+/).join("."),
    )
    .replace(/\[(\d+)\]/g, ":nth-of-type($1)")
    .trim();
}

function normalizeSelector(raw: string) {
  let selector = raw.replace(/^-/, "").trim();
  if (/^class\./i.test(selector)) {
    selector =
      "." +
      selector
        .slice(6)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(".");
  } else if (/^id\./i.test(selector)) {
    selector = "#" + selector.slice(3).trim();
  } else if (/^tag\./i.test(selector)) {
    selector = selector.slice(4).trim();
  }

  const ordinal = selector.match(/^([\s\S]*?)\.(-?\d+)$/);
  return {
    selector: (ordinal?.[1] ?? selector).trim(),
    index: ordinal ? Number(ordinal[2]) : undefined,
  };
}

function extract(root: HTMLElement, rule?: string, preserveHtml = false): string {
  if (!rule) return "";
  for (const alternative of splitLegadoRule(rule, "||")) {
    const values = splitLegadoRule(alternative, "&&")
      .map((part) => extractSingle(root, part, preserveHtml))
      .filter(Boolean);
    if (values.length) return values.join("\n");
  }
  return "";
}

function extractSingle(root: HTMLElement, rule: string, preserveHtml: boolean) {
  if (!rule) return "";
  const replacementParts = rule.split("##");
  const baseRule = replacementParts[0].trim().split("@js:")[0];
  const pieces = baseRule.split("@");
  const property = pieces.length > 1 ? pieces.pop()?.trim() || "text" : "text";
  const selector = pieces.join("@").replace(/^@?CSS:/i, "").trim();
  let node: HTMLElement | undefined;

  if (!selector) {
    node = root;
  } else if (selector.startsWith("text.")) {
    const label = selector.slice(5).trim();
    node = root
      .querySelectorAll("a")
      .find((item) => normalizeText(item.textContent).includes(label));
  } else {
    node = selectSelectorPath(root, selector)[0];
  }
  if (!node) return "";

  let value =
    property === "text"
      ? preserveHtml ? node.innerHTML : normalizeText(node.textContent)
      : property === "html"
        ? node.innerHTML
        : node.getAttribute(property) || "";
  if (!preserveHtml && property === "html") value = htmlToReadableText(value);

  if (replacementParts.length > 1 && replacementParts[1]) {
    try {
      value = value.replace(
        new RegExp(replacementParts[1], "g"),
        replacementParts[2] || "",
      );
    } catch {
      // Invalid replacement expressions are ignored instead of executing source code.
    }
  }
  return value.trim();
}

function htmlToReadableText(html: string) {
  const withBreaks = html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, "\n\n");
  return parse(withBreaks)
    .textContent.replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanAuthor(value: string) {
  return value.replace(/^\s*(作者|作\s*者)\s*[：:]?\s*/i, "").trim();
}

function resolveOptionalUrl(value: string, base: string): string | undefined {
  if (!value) return undefined;
  const decorated = splitRequestDecoratedUrl(value);
  try {
    return new URL(decorated.url, base).toString() + decorated.suffix;
  } catch {
    return undefined;
  }
}

function splitRequestDecoratedUrl(value: string) {
  const legacyPost = value.match(/^([\s\S]*?)@post->([\s\S]*)$/i);
  if (legacyPost) {
    return { url: legacyPost[1].trim(), suffix: "@post->" + legacyPost[2] };
  }
  const optionSuffix = value.match(/^([\s\S]*?),\s*(\{[\s\S]*\})\s*$/);
  if (optionSuffix) {
    try {
      JSON.parse(optionSuffix[2]);
      return { url: optionSuffix[1].trim(), suffix: "," + optionSuffix[2] };
    } catch {}
  }
  return { url: value, suffix: "" };
}

function resolveUrl(value: string, base: string) {
  const resolved = resolveOptionalUrl(value, base);
  if (!resolved) throw new Error("书源生成了无效地址。");
  return resolved;
}

function normalizeBase(value: string) {
  return value.replace(/\/+$/, "").toLowerCase();
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sourceId(url: string) {
  return "source-" + hash(normalizeBase(url));
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

const palettes = [
  ["#315044", "#17271F"],
  ["#76543E", "#3B281F"],
  ["#536273", "#28333D"],
  ["#676144", "#333022"],
] as const;
