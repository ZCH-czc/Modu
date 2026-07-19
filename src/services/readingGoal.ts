import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "modu.reading-goal.v1";
const DEFAULT_MINUTES = 30;

export async function loadReadingGoal() {
  try {
    const value = Number(await AsyncStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(value) && value >= 5 && value <= 180) return Math.round(value / 5) * 5;
  } catch {
    // Fall through to the calm default.
  }
  return DEFAULT_MINUTES;
}

export async function saveReadingGoal(minutes: number) {
  const normalized = Math.max(5, Math.min(180, Math.round(minutes / 5) * 5));
  await AsyncStorage.setItem(STORAGE_KEY, String(normalized));
  return normalized;
}
