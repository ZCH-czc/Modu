import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AppState,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { enCommon } from "./en-common";
import { enReader } from "./en-reader";
import { enSettings } from "./en-settings";
import { enSources } from "./en-sources";

export type LanguagePreference = "system" | "zh-CN" | "en";
export type ResolvedLanguage = Exclude<LanguagePreference, "system">;
export type TranslationParams = Record<string, string | number>;

const STORAGE_KEY = "modu.language.v1";
const english: Record<string, string> = {
  ...enCommon,
  ...enSettings,
  ...enReader,
  ...enSources,
};

function detectSystemLanguage(): ResolvedLanguage {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return locale.startsWith("zh") ? "zh-CN" : "en";
  } catch {
    return "zh-CN";
  }
}

let activeLanguage: ResolvedLanguage = detectSystemLanguage();

function interpolate(value: string, params?: TranslationParams) {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ""));
}

function translatePattern(source: string): string | undefined {
  let match: RegExpMatchArray | null;
  if ((match = source.match(/^(\d+) 本$/))) return `${match[1]} books`;
  if ((match = source.match(/^(\d+) 个$/))) return match[1];
  if ((match = source.match(/^(\d+) 章$/))) return `${match[1]} chapters`;
  if ((match = source.match(/^第 (\d+) 页$/))) return `Page ${match[1]}`;
  if ((match = source.match(/^第 (\d+) 章$/))) return `Chapter ${match[1]}`;
  if ((match = source.match(/^正在下载 (\d+) \/ (\d+) 章$/))) return `Downloading ${match[1]} of ${match[2]}`;
  if ((match = source.match(/^已收录 (\d+) 章( · 停止)?$/))) return `${match[1]} chapters saved${match[2] ? " · Stop" : ""}`;
  if ((match = source.match(/^已清理 (\d+) 个缓存项目$/))) return `Cleared ${match[1]} cached items`;
  if ((match = source.match(/^已导入或更新 (\d+) 个书源$/))) return `Imported or updated ${match[1]} sources`;
  if ((match = source.match(/^《(.+)》已加入书架。$/))) return `“${match[1]}” was added to your library.`;
  if ((match = source.match(/^《(.+)》已保存在本机。$/))) return `“${match[1]}” was saved on this device.`;
  if ((match = source.match(/^《(.+)》已可离线阅读。$/))) return `“${match[1]}” is available offline.`;
  if ((match = source.match(/^确定将《(.+)》从书架移除吗？$/))) return `Remove “${match[1]}” from your library?`;
  if ((match = source.match(/^确定删除《(.+)》吗？$/))) return `Delete “${match[1]}”?`;
  if ((match = source.match(/^移除(.+)$/))) return `Remove ${match[1]}`;
  if ((match = source.match(/^(.+)，(.+)，阅读进度 (\d+)%$/))) return `${match[1]}, ${match[2]}, ${match[3]}% read`;
  if ((match = source.match(/^网络请求失败（HTTP (\d+)）。$/))) return `Network request failed (HTTP ${match[1]}).`;
  return undefined;
}

export function translate(
  source: string,
  params?: TranslationParams,
  language: ResolvedLanguage = activeLanguage,
) {
  const value = interpolate(source, params);
  if (language === "zh-CN" || !value.trim()) return value;
  return english[value] ?? translatePattern(value) ?? value;
}

type I18nContextValue = {
  language: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
  setLanguage: (language: LanguagePreference) => Promise<void>;
  t: (source: string, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: React.PropsWithChildren) {
  const [language, setLanguageState] = useState<LanguagePreference>("system");
  const [systemLanguage, setSystemLanguage] = useState(detectSystemLanguage);
  const [ready, setReady] = useState(false);
  const resolvedLanguage = language === "system" ? systemLanguage : language;

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === "system" || saved === "zh-CN" || saved === "en") setLanguageState(saved);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    activeLanguage = resolvedLanguage;
  }, [resolvedLanguage]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setSystemLanguage(detectSystemLanguage());
    });
    return () => subscription.remove();
  }, []);

  const setLanguage = useCallback(async (next: LanguagePreference) => {
    setLanguageState(next);
    activeLanguage = next === "system" ? detectSystemLanguage() : next;
    await AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (source: string, params?: TranslationParams) => translate(source, params, resolvedLanguage),
    [resolvedLanguage],
  );
  const value = useMemo(
    () => ({ language, resolvedLanguage, setLanguage, t }),
    [language, resolvedLanguage, setLanguage, t],
  );

  if (!ready) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}

function translateChildren(children: React.ReactNode, t: I18nContextValue["t"]): React.ReactNode {
  if (typeof children === "string") return t(children);
  if (Array.isArray(children)) return children.map((child) => translateChildren(child, t));
  return children;
}

export function Text({ children, ...props }: TextProps) {
  const { t } = useI18n();
  return <NativeText {...props}>{translateChildren(children, t)}</NativeText>;
}

export function TextInput({ placeholder, ...props }: TextInputProps) {
  const { t } = useI18n();
  return <NativeTextInput {...props} placeholder={placeholder ? t(placeholder) : placeholder} />;
}
