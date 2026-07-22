import AsyncStorage from "@react-native-async-storage/async-storage";

const SPOTLIGHT_GUIDES_KEY = "modu.spotlight-guides.v1";

async function loadCompletedGuides() {
  try {
    const stored = await AsyncStorage.getItem(SPOTLIGHT_GUIDES_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function hasCompletedSpotlightGuide(id: string) {
  return (await loadCompletedGuides()).includes(id);
}

export async function completeSpotlightGuide(id: string) {
  const completed = await loadCompletedGuides();
  if (completed.includes(id)) return;
  await AsyncStorage.setItem(SPOTLIGHT_GUIDES_KEY, JSON.stringify([...completed, id]));
}

export async function resetSpotlightGuides() {
  await AsyncStorage.removeItem(SPOTLIGHT_GUIDES_KEY);
}
