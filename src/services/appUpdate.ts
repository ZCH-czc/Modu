import { Platform } from "react-native";

export const CURRENT_APP_VERSION = "1.5.5";
export const RELEASES_PAGE_URL = "https://github.com/ZCH-czc/Modu/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/ZCH-czc/Modu/releases/latest";

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  assets: GitHubAsset[];
};

export type AppUpdateInfo = {
  version: string;
  title: string;
  notes: string;
  publishedAt?: string;
  downloadUrl: string;
  downloadName?: string;
  downloadSize?: number;
  releaseUrl: string;
};

export type AppUpdateResult =
  | { status: "available"; update: AppUpdateInfo }
  | { status: "current"; update: AppUpdateInfo };

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "").split("+")[0];
}

function compareVersions(left: string, right: string) {
  const [leftCore, leftPre] = normalizeVersion(left).split("-", 2);
  const [rightCore, rightPre] = normalizeVersion(right).split("-", 2);
  const leftParts = leftCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = rightCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  return leftPre.localeCompare(rightPre);
}

function selectDownloadAsset(assets: GitHubAsset[]) {
  const extension = Platform.OS === "android"
    ? /\.apk$/i
    : Platform.OS === "windows"
      ? /\.(msixbundle|msix|exe)$/i
      : undefined;
  if (!extension) return undefined;
  const candidates = assets.filter((asset) => extension.test(asset.name));
  return candidates.find((asset) => /release|universal|android|windows/i.test(asset.name)) ?? candidates[0];
}

function cleanReleaseNotes(value: string | null) {
  if (!value?.trim()) return "这个版本带来了一些体验改进与问题修复。";
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 1800);
}

export async function checkForAppUpdate(): Promise<AppUpdateResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub Releases 请求失败（HTTP ${response.status}）。`);
    }
    const release = (await response.json()) as GitHubRelease;
    const asset = selectDownloadAsset(release.assets ?? []);
    const version = normalizeVersion(release.tag_name);
    const update: AppUpdateInfo = {
      version,
      title: release.name?.trim() || `墨读 ${version}`,
      notes: cleanReleaseNotes(release.body),
      publishedAt: release.published_at ?? undefined,
      downloadUrl: asset?.browser_download_url || release.html_url,
      downloadName: asset?.name,
      downloadSize: asset?.size,
      releaseUrl: release.html_url,
    };
    return compareVersions(version, CURRENT_APP_VERSION) > 0
      ? { status: "available", update }
      : { status: "current", update };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("检查更新超时，请确认网络连接后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}