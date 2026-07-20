import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type VolumeKeyDirection = "next" | "previous";

type NativeReaderControls = {
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
  setVolumeKeysEnabled: (enabled: boolean) => void;
};

const nativeReaderControls = NativeModules.ModuReaderControls as NativeReaderControls | undefined;

export const supportsVolumeKeyTurns = Platform.OS === "android" && Boolean(nativeReaderControls);

export function setVolumeKeyTurnsEnabled(enabled: boolean) {
  nativeReaderControls?.setVolumeKeysEnabled(enabled);
}

export function subscribeToVolumeKeyTurns(
  listener: (direction: VolumeKeyDirection) => void,
) {
  if (!nativeReaderControls) return { remove: () => undefined };
  const emitter = new NativeEventEmitter(nativeReaderControls as never);
  return emitter.addListener("moduVolumeKeyTurn", listener);
}
