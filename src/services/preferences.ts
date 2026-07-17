import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Brightness from 'expo-brightness';
import { Directory, Paths } from 'expo-file-system';
import * as ScreenOrientation from 'expo-screen-orientation';

import {
  ReaderOrientation,
  ReaderPreferences,
  ReadingProgress,
} from '../types';

const PREFERENCES_KEY = '@modu/preferences/v2';
const PROGRESS_KEY = '@modu/progress/v2';

export const defaultPreferences: ReaderPreferences = {
  theme: 'paper',
  fontSize: 19,
  lineHeight: 1.9,
  paragraphSpacing: 16,
  horizontalPadding: 27,
  textAlignment: 'justify',
  pageTurn: 'slide',
  tapToTurn: true,
  keepScreenAwake: true,
  volumeKeys: false,
  autoSync: true,
  notifications: false,
  reminderHour: 21,
  reminderMinute: 30,
  orientation: 'auto',
  followSystemBrightness: true,
  brightness: 0.65,
  showProgress: true,
  immersiveMode: false,
  webReaderFlow: 'paged',
};

export async function loadPreferences() {
  const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
  if (!raw) return defaultPreferences;
  try {
    return { ...defaultPreferences, ...(JSON.parse(raw) as ReaderPreferences) };
  } catch {
    return defaultPreferences;
  }
}

export async function savePreferences(preferences: ReaderPreferences) {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export async function applyOrientation(orientation: ReaderOrientation) {
  if (orientation === 'auto') {
    await ScreenOrientation.unlockAsync();
    return;
  }
  await ScreenOrientation.lockAsync(
    orientation === 'portrait'
      ? ScreenOrientation.OrientationLock.PORTRAIT_UP
      : ScreenOrientation.OrientationLock.LANDSCAPE,
  );
}

export async function applyBrightness(
  followSystemBrightness: boolean,
  brightness: number,
) {
  if (followSystemBrightness) {
    const system = await Brightness.getSystemBrightnessAsync();
    await Brightness.setBrightnessAsync(system);
    return;
  }
  await Brightness.setBrightnessAsync(
    Math.max(0.08, Math.min(1, brightness)),
  );
}

export async function configureDailyReminder(enabled: boolean) {
  return !enabled;
}

export async function loadProgressMap(): Promise<
  Record<string, ReadingProgress>
> {
  const raw = await AsyncStorage.getItem(PROGRESS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ReadingProgress>;
  } catch {
    return {};
  }
}

export async function saveReadingProgress(
  bookId: string,
  pageIndex: number,
) {
  const progress = await loadProgressMap();
  progress[bookId] = { pageIndex, updatedAt: Date.now() };
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

export async function clearReadingHistory() {
  await AsyncStorage.removeItem(PROGRESS_KEY);
}

export async function clearAppCache() {
  const cache = new Directory(Paths.cache);
  if (!cache.exists) return 0;
  let deleted = 0;
  for (const item of cache.list()) {
    try {
      const size = 'size' in item && typeof item.size === 'number' ? item.size : 0;
      item.delete();
      deleted += size;
    } catch {
      // Some Expo runtime files can be locked while the app is active.
    }
  }
  return deleted;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
