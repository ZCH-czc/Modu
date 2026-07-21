export type LegadoPayload =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string };

type JsonPathToken =
  | { type: "property"; key: string }
  | { type: "recursive"; key: string }
  | { type: "wildcard" }
  | { type: "index"; index: number }
  | { type: "slice"; start?: number; end?: number; step: number }
  | { type: "union"; entries: Array<string | number> };

const MAX_JSON_RESULTS = 2000;
const MAX_RECURSIVE_DEPTH = 32;

export function parseLegadoPayload(text: string): LegadoPayload {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const jsonp = trimmed.match(/^[A-Za-z_$][\w$.\[\]]*\s*\(\s*([\s\S]*?)\s*\)\s*;?$/);
  const candidates = jsonp ? [trimmed, jsonp[1]] : [trimmed];
  for (const candidate of candidates) {
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try {
      return { kind: "json", value: JSON.parse(candidate) as unknown };
    } catch {
      // Some sites return JSON-looking HTML or invalid JSON; keep the original text.
    }
  }
  return { kind: "text", value: text };
}

export function isLegadoJsonRule(rule?: string): boolean {
  if (!rule) return false;
  const value = stripRuleTransforms(rule).trim();
  return /^@Json:/i.test(value) || /^\$(?:\.|\[)/.test(value);
}

export function selectLegadoJsonValues(root: unknown, rule: string): unknown[] {
  for (const alternative of splitTopLevel(rule, "||")) {
    const combined = splitTopLevel(alternative, "&&")
      .flatMap((part) => evaluateJsonPath(root, stripJsonPrefix(stripRuleTransforms(part))));
    if (combined.length) return combined.slice(0, MAX_JSON_RESULTS);
  }
  return [];
}

export function extractLegadoJsonValue(root: unknown, rule?: string): string {
  if (!rule) return "";
  for (const alternative of splitTopLevel(rule, "||")) {
    const values = splitTopLevel(alternative, "&&")
      .map((part) => extractJsonRulePart(root, part))
      .filter(Boolean);
    if (values.length) return values.join("\n");
  }
  return "";
}

export function splitLegadoRule(value: string, separator: string): string[] {
  return splitTopLevel(value, separator);
}
export function renderLegadoPagePattern(template: string, page: number): string {
  return template.replace(/<([^<>]+)>/g, (match, body: string) => {
    const values = splitTopLevel(body, ",").map((item) => item.trim()).filter(Boolean);
    if (!values.length) return match;
    return values[Math.min(Math.max(page - 1, 0), values.length - 1)];
  });
}

function extractJsonRulePart(root: unknown, rawRule: string): string {
  const parts = rawRule.split("##");
  const pathRule = stripJsonPrefix(parts[0].trim());
  let value: string;

  if (/\{\$[.[]/.test(pathRule)) {
    value = pathRule.replace(/\{(\$[^{}]+)\}/g, (_, path: string) =>
      stringifyJsonValues(evaluateJsonPath(root, path)),
    );
  } else {
    value = stringifyJsonValues(evaluateJsonPath(root, pathRule));
  }

  if (parts[1]) {
    try {
      const expression = new RegExp(parts[1], "g");
      if (parts.length > 3) {
        const match = value.match(expression)?.[0];
        value = match ? match.replace(expression, parts[2] || "") : "";
      } else {
        value = value.replace(expression, parts[2] || "");
      }
    } catch {
      // Invalid replacement expressions are ignored.
    }
  }
  return value.trim();
}

function stringifyJsonValues(values: unknown[]): string {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => typeof value === "object" ? JSON.stringify(value) : String(value))
    .join("\n")
    .trim();
}

function evaluateJsonPath(root: unknown, rawPath: string): unknown[] {
  const trimmed = rawPath.trim();
  const path = trimmed.startsWith("$") || trimmed.startsWith("@")
    ? trimmed
    : "$." + trimmed;
  if (!path) return [];
  if (path === "$" || path === "@") return [root];
  const tokens = tokenizeJsonPath(path);
  if (!tokens) return [];
  let current: unknown[] = [root];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const value of current) applyJsonToken(value, token, next);
    current = next.slice(0, MAX_JSON_RESULTS);
    if (!current.length) break;
  }
  return current;
}

function applyJsonToken(value: unknown, token: JsonPathToken, output: unknown[]) {
  if (output.length >= MAX_JSON_RESULTS) return;
  if (token.type === "property") {
    if (isRecord(value) && token.key in value) output.push(value[token.key]);
    return;
  }
  if (token.type === "recursive") {
    collectRecursive(value, token.key, output, 0);
    return;
  }
  if (token.type === "wildcard") {
    if (Array.isArray(value)) output.push(...value);
    else if (isRecord(value)) output.push(...Object.values(value));
    return;
  }
  if (token.type === "index") {
    if (!Array.isArray(value)) return;
    const index = token.index < 0 ? value.length + token.index : token.index;
    if (index >= 0 && index < value.length) output.push(value[index]);
    return;
  }
  if (token.type === "union") {
    for (const entry of token.entries) {
      if (typeof entry === "number" && Array.isArray(value)) {
        const index = entry < 0 ? value.length + entry : entry;
        if (index >= 0 && index < value.length) output.push(value[index]);
      } else if (typeof entry === "string" && isRecord(value) && entry in value) {
        output.push(value[entry]);
      }
    }
    return;
  }
  if (!Array.isArray(value)) return;
  const step = token.step || 1;
  const start = normalizeSliceIndex(token.start, value.length, step > 0 ? 0 : value.length - 1);
  const end = normalizeSliceIndex(token.end, value.length, step > 0 ? value.length : -1);
  if (step > 0) {
    for (let index = start; index < end; index += step) output.push(value[index]);
  } else {
    for (let index = start; index > end; index += step) output.push(value[index]);
  }
}

function collectRecursive(value: unknown, key: string, output: unknown[], depth: number) {
  if (depth > MAX_RECURSIVE_DEPTH || output.length >= MAX_JSON_RESULTS) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRecursive(item, key, output, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  if (key in value) output.push(value[key]);
  Object.values(value).forEach((item) => collectRecursive(item, key, output, depth + 1));
}

function tokenizeJsonPath(rawPath: string): JsonPathToken[] | undefined {
  const path = stripJsonPrefix(rawPath);
  if (!path.startsWith("$") && !path.startsWith("@")) return undefined;
  const tokens: JsonPathToken[] = [];
  let index = 1;
  while (index < path.length) {
    if (path.startsWith("..", index)) {
      index += 2;
      const read = readProperty(path, index);
      if (!read.key) return undefined;
      tokens.push({ type: "recursive", key: read.key });
      index = read.end;
      continue;
    }
    if (path[index] === ".") {
      index += 1;
      if (path[index] === "*") {
        tokens.push({ type: "wildcard" });
        index += 1;
        continue;
      }
      const read = readProperty(path, index);
      if (!read.key) return undefined;
      tokens.push({ type: "property", key: read.key });
      index = read.end;
      continue;
    }
    if (path[index] !== "[") return undefined;
    const close = findBracketEnd(path, index);
    if (close < 0) return undefined;
    const body = path.slice(index + 1, close).trim();
    const token = parseBracketToken(body);
    if (!token) return undefined;
    tokens.push(token);
    index = close + 1;
  }
  return tokens;
}

function parseBracketToken(body: string): JsonPathToken | undefined {
  if (body === "*") return { type: "wildcard" };
  if (/^-?\d+$/.test(body)) return { type: "index", index: Number(body) };
  const quoted = body.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return { type: "property", key: unescapeQuoted(quoted[2], quoted[1]) };
  if (body.includes(":")) {
    const parts = body.split(":");
    if (parts.length > 3 || parts.some((part) => part && !/^-?\d+$/.test(part.trim()))) return undefined;
    const step = parts[2]?.trim() ? Number(parts[2]) : 1;
    if (!step) return undefined;
    return {
      type: "slice",
      start: parts[0]?.trim() ? Number(parts[0]) : undefined,
      end: parts[1]?.trim() ? Number(parts[1]) : undefined,
      step,
    };
  }
  if (body.includes(",")) {
    const entries = splitTopLevel(body, ",").map((entry) => {
      const value = entry.trim();
      if (/^-?\d+$/.test(value)) return Number(value);
      const match = value.match(/^(['"])([\s\S]*)\1$/);
      return match ? unescapeQuoted(match[2], match[1]) : undefined;
    });
    if (entries.some((entry) => entry === undefined)) return undefined;
    return { type: "union", entries: entries as Array<string | number> };
  }
  return undefined;
}

function readProperty(path: string, start: number) {
  let end = start;
  while (end < path.length && path[end] !== "." && path[end] !== "[") end += 1;
  return { key: path.slice(start, end).trim(), end };
}

function findBracketEnd(path: string, start: number) {
  let quote = "";
  for (let index = start + 1; index < path.length; index += 1) {
    const character = path[index];
    if (quote) {
      if (character === quote && path[index - 1] !== "\\") quote = "";
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "]") {
      return index;
    }
  }
  return -1;
}

function splitTopLevel(value: string, separator: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "[" || character === "(" || character === "{") depth += 1;
    else if (character === "]" || character === ")" || character === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && value.startsWith(separator, index)) {
      result.push(value.slice(start, index));
      start = index + separator.length;
      index += separator.length - 1;
    }
  }
  result.push(value.slice(start));
  return result.map((item) => item.trim()).filter(Boolean);
}

function stripRuleTransforms(rule: string) {
  return rule.split("##")[0].trim().split("@js:")[0].trim();
}

function stripJsonPrefix(rule: string) {
  return rule.trim().replace(/^@Json:/i, "");
}

function normalizeSliceIndex(value: number | undefined, length: number, fallback: number) {
  if (value === undefined) return fallback;
  return value < 0 ? Math.max(0, length + value) : Math.min(length, value);
}

function unescapeQuoted(value: string, quote: string) {
  return value.replace(new RegExp("\\\\" + quote, "g"), quote).replace(/\\\\/g, "\\");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
