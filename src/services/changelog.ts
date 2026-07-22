import AsyncStorage from "@react-native-async-storage/async-storage";

import { CURRENT_APP_VERSION } from "./appUpdate";

const LAST_SEEN_VERSION_KEY = "modu.changelog.last-seen-version.v1";

export type ChangelogEntry = {
  title: string;
  detail: string;
};

export type PendingChangelog = {
  firstOpen: boolean;
  version: string;
  entries: ChangelogEntry[];
};

const RELEASE_NOTES: Record<string, ChangelogEntry[]> = {
  "1.5.13": [
    {
      title: "字句更有余韵",
      detail: "重新润色八页功能引导，让操作说明清楚之余，也保留墨读安静克制的气息。",
    },
    {
      title: "页面更像墨读",
      detail: "统一书架、网页寻书、空状态与设置页的说明文案，让每一处提示都属于同一种声音。",
    },
    {
      title: "中英文一同落笔",
      detail: "同步调整英文表达，并在手机与平板尺寸下逐页校验引导布局。",
    },
  ],
};

export async function loadPendingChangelog(): Promise<PendingChangelog | undefined> {
  const lastSeenVersion = await AsyncStorage.getItem(LAST_SEEN_VERSION_KEY);
  if (lastSeenVersion === CURRENT_APP_VERSION) return undefined;
  return {
    firstOpen: lastSeenVersion === null,
    version: CURRENT_APP_VERSION,
    entries: RELEASE_NOTES[CURRENT_APP_VERSION] ?? [
      {
        title: "新一页，墨迹初干",
        detail: "这一版收拢了细小的改进，也替几处不顺手的地方理了理纸页。",
      },
    ],
  };
}

export async function markChangelogSeen(version = CURRENT_APP_VERSION) {
  await AsyncStorage.setItem(LAST_SEEN_VERSION_KEY, version);
}
