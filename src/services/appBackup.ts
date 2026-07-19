import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import JSZip from "jszip";

const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 160 * 1024 * 1024;
const MAX_EMBEDDED_FILES = 500;
const EXCLUDED_KEYS = new Set(["modu.reading-reminder-id.v1"]);

type BackupFile = {
  originalUri: string;
  archivePath: string;
};

type BackupManifest = {
  format: "modu-backup";
  version: number;
  createdAt: string;
  storage: Array<[string, string]>;
  files: BackupFile[];
};

export type BackupResult = {
  canceled: boolean;
  fileCount?: number;
  uri?: string;
};

function isBackupKey(key: string) {
  return key.startsWith("modu.") && !EXCLUDED_KEYS.has(key);
}

function collectFileUris(value: unknown, target: Set<string>) {
  if (typeof value === "string") {
    if (value.startsWith("file://")) target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFileUris(item, target));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectFileUris(item, target));
  }
}

export async function exportAppBackup(): Promise<BackupResult> {
  if (Platform.OS !== "android") {
    throw new Error("当前版本仅支持在 Android 上选择备份保存位置。");
  }
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return { canceled: true };

  const keys = (await AsyncStorage.getAllKeys()).filter(isBackupKey);
  const storage = (await AsyncStorage.multiGet(keys)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const fileUris = new Set<string>();
  storage.forEach(([, value]) => {
    try {
      collectFileUris(JSON.parse(value), fileUris);
    } catch {
      // Plain preference values do not contain local file references.
    }
  });

  const zip = new JSZip();
  const files: BackupFile[] = [];
  let totalBytes = 0;
  for (const originalUri of [...fileUris].slice(0, MAX_EMBEDDED_FILES)) {
    try {
      const info = await FileSystem.getInfoAsync(originalUri);
      if (!info.exists || info.isDirectory) continue;
      totalBytes += info.size ?? 0;
      if (totalBytes > MAX_BACKUP_BYTES) {
        throw new Error("藏书文件超过 160 MB，请先移除不需要备份的大文件。");
      }
      const extension = originalUri.match(/\.[a-z0-9]{1,8}(?:\?|$)/i)?.[0] ?? ".bin";
      const archivePath = `files/${String(files.length).padStart(4, "0")}${extension}`;
      zip.file(
        archivePath,
        await FileSystem.readAsStringAsync(originalUri, {
          encoding: FileSystem.EncodingType.Base64,
        }),
        { base64: true },
      );
      files.push({ originalUri, archivePath });
    } catch (error) {
      if (error instanceof Error && error.message.includes("160 MB")) throw error;
    }
  }

  const manifest: BackupManifest = {
    format: "modu-backup",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    storage,
    files,
  };
  zip.file("manifest.json", JSON.stringify(manifest));
  const base64 = await zip.generateAsync({
    type: "base64",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  const date = new Date().toISOString().slice(0, 10);
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    `Modu-backup-${date}.modubackup`,
    "application/zip",
  );
  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { canceled: false, fileCount: files.length, uri };
}

export async function restoreAppBackup(): Promise<BackupResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ["application/zip", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return { canceled: true };
  const asset = picked.assets[0];
  if (!asset || (asset.size ?? 0) > MAX_BACKUP_BYTES) {
    throw new Error("备份文件无效或超过 160 MB。");
  }

  const zip = await JSZip.loadAsync(
    await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    }),
    { base64: true },
  );
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("这不是有效的墨读备份。");
  const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
  if (
    manifest.format !== "modu-backup" ||
    manifest.version !== BACKUP_VERSION ||
    !Array.isArray(manifest.storage) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > MAX_EMBEDDED_FILES
  ) {
    throw new Error("备份版本不受支持。");
  }

  const restoreRoot = `${FileSystem.documentDirectory}restored-backup-${Date.now()}/`;
  await FileSystem.makeDirectoryAsync(restoreRoot, { intermediates: true });
  const uriMap = new Map<string, string>();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const archived = zip.file(entry.archivePath);
    if (!archived || !entry.originalUri.startsWith("file://")) continue;
    const extension = entry.archivePath.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ".bin";
    const restoredUri = `${restoreRoot}${String(index).padStart(4, "0")}${extension}`;
    await FileSystem.writeAsStringAsync(restoredUri, await archived.async("base64"), {
      encoding: FileSystem.EncodingType.Base64,
    });
    uriMap.set(entry.originalUri, restoredUri);
  }

  const restoredStorage = manifest.storage
    .filter(([key, value]) => isBackupKey(key) && typeof value === "string")
    .map(([key, value]) => {
      let restoredValue = value;
      uriMap.forEach((replacement, original) => {
        restoredValue = restoredValue.split(original).join(replacement);
      });
      return [key, restoredValue] as [string, string];
    });
  const existingKeys = (await AsyncStorage.getAllKeys()).filter(isBackupKey);
  if (existingKeys.length) await AsyncStorage.multiRemove(existingKeys);
  if (restoredStorage.length) await AsyncStorage.multiSet(restoredStorage);
  return { canceled: false, fileCount: uriMap.size };
}