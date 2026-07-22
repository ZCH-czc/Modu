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
  "1.5.12": [
    {
      title: "引导更清楚",
      detail: "重新绘制功能演示，让书架、网页寻书与阅读器的用法一眼可见。",
    },
    {
      title: "阅读更从容",
      detail: "继续优化本地与网页阅读的预排版、懒加载和翻页衔接。",
    },
    {
      title: "诊断更直接",
      detail: "新增性能检测，可记录掉帧时所在页面、组件区域与帧率并导出日志。",
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
        title: "这一页又添了新墨",
        detail: "这个版本带来了一些体验改进与问题修复。",
      },
    ],
  };
}

export async function markChangelogSeen(version = CURRENT_APP_VERSION) {
  await AsyncStorage.setItem(LAST_SEEN_VERSION_KEY, version);
}
