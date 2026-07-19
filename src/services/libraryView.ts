import AsyncStorage from "@react-native-async-storage/async-storage";

export type ShelfFilter = "all" | "local" | "web";
export type ShelfSort = "recent" | "title" | "progress";

export type LibraryViewPreferences = {
  filter: ShelfFilter;
  sort: ShelfSort;
};

const STORAGE_KEY = "modu.library-view.v1";

export const defaultLibraryViewPreferences: LibraryViewPreferences = {
  filter: "all",
  sort: "recent",
};

export async function loadLibraryViewPreferences(): Promise<LibraryViewPreferences> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultLibraryViewPreferences;
  try {
    const parsed = JSON.parse(stored) as Partial<LibraryViewPreferences>;
    return {
      filter: parsed.filter === "local" || parsed.filter === "web" ? parsed.filter : "all",
      sort: parsed.sort === "title" || parsed.sort === "progress" ? parsed.sort : "recent",
    };
  } catch {
    return defaultLibraryViewPreferences;
  }
}

export async function saveLibraryViewPreferences(preferences: LibraryViewPreferences) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
