import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

import type { BookCoverAppearance } from "../types";

const STORAGE_KEY = "modu.book-appearance.v1";
const COVER_DIRECTORY = `${FileSystem.documentDirectory}book-covers/`;
const MAX_COVER_SIZE = 15 * 1024 * 1024;

export async function loadBookAppearances(): Promise<Record<string, BookCoverAppearance>> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as Record<string, BookCoverAppearance>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveBookAppearances(
  appearances: Record<string, BookCoverAppearance>,
) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(appearances));
}

export async function pickBookCoverImage(
  bookId: string,
): Promise<string | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "image/*",
    copyToCacheDirectory: true,
  });
  if (result.canceled) return undefined;

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_COVER_SIZE) {
    throw new Error("封面图片不能超过 15 MB。");
  }
  await FileSystem.makeDirectoryAsync(COVER_DIRECTORY, { intermediates: true });
  const extension = imageExtension(asset.name, asset.mimeType);
  const safeId = encodeURIComponent(bookId).replace(/%/g, "_");
  const destination = `${COVER_DIRECTORY}${safeId}-${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });

  return destination;
}

export async function deleteBookCoverImage(imageUri?: string) {
  if (!imageUri?.startsWith(COVER_DIRECTORY)) return;
  await FileSystem.deleteAsync(imageUri, { idempotent: true });
}
function imageExtension(name?: string, mimeType?: string) {
  const fromName = name?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromName && ["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(fromName)) {
    return fromName;
  }
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/heic" || mimeType === "image/heif") return "heic";
  return "jpg";
}
