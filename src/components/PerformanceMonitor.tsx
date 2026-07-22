import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewProps,
} from "react-native";

import { Text } from "../i18n";
import { CURRENT_APP_VERSION } from "../services/appUpdate";
import { IOSPopupModal } from "./IOSPopupModal";

type PerformanceRegionSnapshot = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type JankEvent = {
  atMs: number;
  deltaMs: number;
  estimatedFps: number;
  missedFrames: number;
  screen: string;
  regions: PerformanceRegionSnapshot[];
};

type RefreshSegment = { atMs: number; targetFps: number };

type LiveStats = {
  elapsedMs: number;
  estimatedFps: number;
  jankCount: number;
  targetFps: number;
};

type PerformanceLogResult = LiveStats & {
  durationMs: number;
  fileName: string;
  uri: string;
};

type PerformanceMonitorContextValue = {
  isRecording: boolean;
  openPanel: () => void;
  setActiveScreen: (screen: string) => void;
  registerRegion: (region: PerformanceRegionSnapshot) => void;
  unregisterRegion: (id: string) => void;
};

const initialLive: LiveStats = {
  elapsedMs: 0,
  estimatedFps: 0,
  jankCount: 0,
  targetFps: 0,
};

const PerformanceMonitorContext = createContext<PerformanceMonitorContextValue | undefined>(undefined);

export function PerformanceMonitorProvider({ children }: { children: ReactNode }) {
  const { height, width } = useWindowDimensions();
  const [panelVisible, setPanelVisible] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [live, setLive] = useState<LiveStats>(initialLive);
  const [lastResult, setLastResult] = useState<PerformanceLogResult>();
  const [exportMessage, setExportMessage] = useState<string>();
  const panelVisibleRef = useRef(false);
  const ignoreNextFrameRef = useRef(false);
  const recordingRef = useRef(false);
  const frameRequestRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef(0);
  const lastFrameRef = useRef<number | undefined>(undefined);
  const lastUiUpdateRef = useRef(0);
  const calibrationRef = useRef<number[]>([]);
  const durationsRef = useRef<number[]>([]);
  const rollingFramesRef = useRef<number[]>([]);
  const eventsRef = useRef<JankEvent[]>([]);
  const totalJankRef = useRef(0);
  const lastJankAtRef = useRef(Number.NEGATIVE_INFINITY);
  const refreshSegmentsRef = useRef<RefreshSegment[]>([]);
  const baselineMsRef = useRef(1000 / 60);
  const targetFpsRef = useRef(60);
  const screenRef = useRef("书架");
  const regionsRef = useRef(new Map<string, PerformanceRegionSnapshot>());

  const registerRegion = useCallback((region: PerformanceRegionSnapshot) => {
    regionsRef.current.set(region.id, region);
  }, []);
  const unregisterRegion = useCallback((id: string) => {
    regionsRef.current.delete(id);
  }, []);
  const setActiveScreen = useCallback((screen: string) => {
    screenRef.current = screen;
  }, []);

  const sampleFrame = useCallback((timestamp: number) => {
    if (!recordingRef.current) return;
    const previous = lastFrameRef.current;
    lastFrameRef.current = timestamp;
    if (previous !== undefined) {
      const delta = timestamp - previous;
      const ignoreFrame = ignoreNextFrameRef.current;
      ignoreNextFrameRef.current = false;
      if (delta > 0 && delta < 1000 && !ignoreFrame) {
        durationsRef.current.push(delta);
        if (delta < 50) {
          calibrationRef.current.push(delta);
          if (calibrationRef.current.length > 48) calibrationRef.current.shift();
          if (calibrationRef.current.length >= 24) {
            const median = percentile(calibrationRef.current, 50);
            const stable = percentile(calibrationRef.current, 90) - percentile(calibrationRef.current, 10)
              <= Math.max(2.5, median * 0.2);
            const measured = 1000 / Math.max(1, median);
            const target = nearestRefreshRate(measured);
            if (stable && Math.abs(target - measured) / target < 0.18) {
              if (target !== targetFpsRef.current) {
                refreshSegmentsRef.current.push({
                  atMs: timestamp - startedAtRef.current,
                  targetFps: target,
                });
              }
              targetFpsRef.current = target;
              baselineMsRef.current = median;
            }
          }
        }
        if (calibrationRef.current.length >= 24) {
          const threshold = Math.max(baselineMsRef.current * 1.72, baselineMsRef.current + 6);
          if (delta > threshold && timestamp - lastJankAtRef.current >= 120) {
            lastJankAtRef.current = timestamp;
            totalJankRef.current += 1;
            if (eventsRef.current.length >= 500) eventsRef.current.shift();
            eventsRef.current.push({
              atMs: timestamp - startedAtRef.current,
              deltaMs: delta,
              estimatedFps: Math.min(targetFpsRef.current, 1000 / delta),
              missedFrames: Math.max(1, Math.round(delta / baselineMsRef.current) - 1),
              screen: screenRef.current,
              regions: [
                { id: "window", label: "应用窗口", x: 0, y: 0, width, height },
                ...Array.from(regionsRef.current.values()),
              ],
            });
          }
        }

        const rolling = rollingFramesRef.current;
        rolling.push(timestamp);
        while (rolling.length && rolling[0] < timestamp - 1000) rolling.shift();
        if (panelVisibleRef.current && timestamp - lastUiUpdateRef.current >= 500) {
          lastUiUpdateRef.current = timestamp;
          ignoreNextFrameRef.current = true;
          setLive({
            elapsedMs: timestamp - startedAtRef.current,
            estimatedFps: rolling.length,
            jankCount: totalJankRef.current,
            targetFps: calibrationRef.current.length >= 24 ? targetFpsRef.current : 0,
          });
        }
      }
    }
    frameRequestRef.current = requestAnimationFrame(sampleFrame);
  }, [height, width]);

  const startRecording = useCallback(() => {
    if (recordingRef.current) return;
    const now = performance.now();
    recordingRef.current = true;
    startedAtRef.current = now;
    lastFrameRef.current = undefined;
    lastUiUpdateRef.current = now;
    calibrationRef.current = [];
    durationsRef.current = [];
    rollingFramesRef.current = [];
    eventsRef.current = [];
    totalJankRef.current = 0;
    lastJankAtRef.current = Number.NEGATIVE_INFINITY;
    refreshSegmentsRef.current = [];
    baselineMsRef.current = 1000 / 60;
    targetFpsRef.current = 60;
    setLastResult(undefined);
    setExportMessage(undefined);
    setLive(initialLive);
    setIsRecording(true);
    panelVisibleRef.current = false;
    setPanelVisible(false);
    frameRequestRef.current = requestAnimationFrame(sampleFrame);
  }, [sampleFrame]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current || saving) return;
    recordingRef.current = false;
    if (frameRequestRef.current !== undefined) cancelAnimationFrame(frameRequestRef.current);
    frameRequestRef.current = undefined;
    setIsRecording(false);
    setSaving(true);
    const durationMs = Math.max(0, performance.now() - startedAtRef.current);
    const finalLive: LiveStats = {
      elapsedMs: durationMs,
      estimatedFps: rollingFramesRef.current.length,
      jankCount: totalJankRef.current,
      targetFps: targetFpsRef.current,
    };
    try {
      const result = await writePerformanceLog(
        finalLive,
        durationMs,
        durationsRef.current,
        eventsRef.current,
        refreshSegmentsRef.current,
      );
      setLastResult(result);
      setLive(finalLive);
      setExportMessage(undefined);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "日志生成失败，请重试。" );
    } finally {
      setSaving(false);
      panelVisibleRef.current = true;
      setPanelVisible(true);
    }
  }, [saving]);

  const exportLog = useCallback(async () => {
    if (!lastResult) return;
    setExportMessage(undefined);
    try {
      if (Platform.OS !== "android") {
        setExportMessage(`日志已保存在：${lastResult.uri}`);
        return;
      }
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permission.granted) {
        setExportMessage("未选择保存目录，日志仍保存在应用内部。" );
        return;
      }
      const content = await FileSystem.readAsStringAsync(lastResult.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const target = await FileSystem.StorageAccessFramework.createFileAsync(
        permission.directoryUri,
        lastResult.fileName,
        "text/plain",
      );
      await FileSystem.StorageAccessFramework.writeAsStringAsync(target, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      setExportMessage("日志已导出到所选目录。" );
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "暂时无法导出日志。" );
    }
  }, [lastResult]);

  useEffect(() => () => {
    recordingRef.current = false;
    if (frameRequestRef.current !== undefined) cancelAnimationFrame(frameRequestRef.current);
  }, []);

  const openPanel = useCallback(() => {
    const now = performance.now();
    panelVisibleRef.current = true;
    ignoreNextFrameRef.current = true;
    if (recordingRef.current) {
      setLive({
        elapsedMs: now - startedAtRef.current,
        estimatedFps: rollingFramesRef.current.length,
        jankCount: totalJankRef.current,
        targetFps: calibrationRef.current.length >= 24 ? targetFpsRef.current : 0,
      });
    }
    setPanelVisible(true);
  }, []);

  const closePanel = useCallback(() => {
    panelVisibleRef.current = false;
    setPanelVisible(false);
  }, []);

  const value = useMemo<PerformanceMonitorContextValue>(() => ({
    isRecording,
    openPanel,
    registerRegion,
    setActiveScreen,
    unregisterRegion,
  }), [isRecording, openPanel, registerRegion, setActiveScreen, unregisterRegion]);

  return (
    <PerformanceMonitorContext.Provider value={value}>
      <View style={styles.host}>{children}</View>
      {isRecording && !panelVisible ? (
        <Pressable
          accessibilityLabel="打开性能检测"
          onPress={openPanel}
          style={[styles.floating, { top: (Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 44) + 10 }]}
        >
          <View style={styles.recordDot} />
          <Text style={styles.floatingText}>REC</Text>
        </Pressable>
      ) : null}
      <IOSPopupModal onRequestClose={closePanel} visible={panelVisible}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Ionicons color="#F3DFC0" name="pulse-outline" size={27} />
          </View>
          <Text style={styles.eyebrow}>PERFORMANCE TRACE</Text>
          <Text style={styles.title}>性能检测</Text>
          {!isRecording && !saving && !lastResult ? (
            <>
              <Text style={styles.description}>
                开始后可照常使用书架、网页和阅读器。墨读会记录掉帧发生时的页面、可见组件区域与帧率，不会收集正文或网页内容。
              </Text>
              <View style={styles.note}>
                <Ionicons color="#597466" name="information-circle-outline" size={17} />
                <Text style={styles.noteText}>组件区域用于定位现场，不代表该组件一定是掉帧原因。</Text>
              </View>
              <Pressable onPress={startRecording} style={styles.primaryButton}>
                <Ionicons color="#FFF8EB" name="radio-button-on-outline" size={17} />
                <Text style={styles.primaryText}>开始录制</Text>
              </Pressable>
            </>
          ) : saving ? (
            <View style={styles.saving}>
              <ActivityIndicator color="#496455" size="large" />
              <Text style={styles.savingText}>正在整理性能日志…</Text>
            </View>
          ) : isRecording ? (
            <>
              <View style={styles.metrics}>
                <Metric label="实时帧率" value={live.estimatedFps ? `${live.estimatedFps}` : "校准中"} />
                <Metric label="屏幕刷新" value={live.targetFps ? `${live.targetFps} Hz` : "校准中"} />
                <Metric label="掉帧事件" value={`${live.jankCount}`} />
              </View>
              <Text style={styles.timer}>{formatDuration(live.elapsedMs)}</Text>
              <Text style={styles.screenText}>当前：{screenRef.current}</Text>
              <Pressable onPress={() => void stopRecording()} style={styles.stopButton}>
                <Ionicons color="#FFF8EB" name="stop" size={16} />
                <Text style={styles.primaryText}>结束并生成日志</Text>
              </Pressable>
            </>
          ) : lastResult ? (
            <>
              <View style={styles.metrics}>
                <Metric label="录制时长" value={formatDuration(lastResult.durationMs)} />
                <Metric label="目标刷新" value={`${lastResult.targetFps} Hz`} />
                <Metric label="掉帧事件" value={`${lastResult.jankCount}`} />
              </View>
              <Text numberOfLines={2} style={styles.fileName}>{lastResult.fileName}</Text>
              {exportMessage ? <Text style={styles.exportMessage}>{exportMessage}</Text> : null}
              <Pressable onPress={() => void exportLog()} style={styles.primaryButton}>
                <Ionicons color="#FFF8EB" name="document-text-outline" size={17} />
                <Text style={styles.primaryText}>导出日志</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setLastResult(undefined);
                  setExportMessage(undefined);
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>再录一次</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={closePanel} style={styles.closeButton}>
            <Ionicons color="#6F756F" name="close" size={18} />
          </Pressable>
        </View>
      </IOSPopupModal>
    </PerformanceMonitorContext.Provider>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text numberOfLines={1} style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function usePerformanceMonitor() {
  const context = useContext(PerformanceMonitorContext);
  if (!context) throw new Error("usePerformanceMonitor must be used inside PerformanceMonitorProvider");
  return context;
}

export function PerformanceRegion({
  active = true,
  id,
  label,
  onLayout,
  ...props
}: ViewProps & { active?: boolean; id: string; label: string }) {
  const { registerRegion, unregisterRegion } = usePerformanceMonitor();
  const ref = useRef<View>(null);
  const measure = useCallback((event?: LayoutChangeEvent) => {
    if (event) onLayout?.(event);
    if (!active) return;
    requestAnimationFrame(() => {
      ref.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        registerRegion({ id, label, x, y, width: measuredWidth, height: measuredHeight });
      });
    });
  }, [active, id, label, onLayout, registerRegion]);
  useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      measure();
      settleTimer = setTimeout(measure, 380);
    } else unregisterRegion(id);
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      unregisterRegion(id);
    };
  }, [active, id, measure, unregisterRegion]);
  return <View collapsable={false} onLayout={measure} ref={ref} {...props} />;
}

function nearestRefreshRate(measured: number) {
  const rates = [30, 50, 60, 72, 90, 120, 144];
  return rates.reduce((best, rate) =>
    Math.abs(rate - measured) < Math.abs(best - measured) ? rate : best,
  rates[0]);
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function formatDuration(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function writePerformanceLog(
  live: LiveStats,
  durationMs: number,
  durations: number[],
  events: JankEvent[],
  refreshSegments: RefreshSegment[],
): Promise<PerformanceLogResult> {
  const directory = `${FileSystem.documentDirectory}performance-logs/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `modu-performance-${stamp}.log`;
  const uri = `${directory}${fileName}`;
  const lines = [
    "Modu Performance Trace",
    `App version: ${CURRENT_APP_VERSION}`,
    `Platform: ${Platform.OS} ${String(Platform.Version)}`,
    `Recorded at: ${new Date().toISOString()}`,
    `Duration: ${(durationMs / 1000).toFixed(2)} s`,
    `Last stable frame cadence: ${live.targetFps} Hz`,
    `Cadence changes: ${refreshSegments.length ? refreshSegments.map((segment) => "+" + segment.atMs.toFixed(0) + "ms=" + segment.targetFps + "Hz").join(", ") : "none"}`,
    `Sampled frames: ${durations.length}`,
    `Jank events: ${live.jankCount}`,
    `Stored event samples: ${events.length}${live.jankCount > events.length ? " (latest events)" : ""}`,
    `Frame time p50/p90/p95/p99: ${percentile(durations, 50).toFixed(2)} / ${percentile(durations, 90).toFixed(2)} / ${percentile(durations, 95).toFixed(2)} / ${percentile(durations, 99).toFixed(2)} ms`,
    "",
    "Note: visible regions provide UI context at the time of a stall; they do not prove which component caused it.",
    "",
    "Events",
    events.length ? "------" : "No jank event was detected.",
  ];
  events.forEach((event, index) => {
    lines.push(
      `#${index + 1} +${event.atMs.toFixed(0)}ms | frame=${event.deltaMs.toFixed(2)}ms | estimated=${event.estimatedFps.toFixed(1)}fps | missed=${event.missedFrames} | screen=${event.screen}`,
    );
    event.regions.forEach((region) => {
      lines.push(`  region=${region.label} [x=${region.x.toFixed(0)}, y=${region.y.toFixed(0)}, w=${region.width.toFixed(0)}, h=${region.height.toFixed(0)}]`);
    });
  });
  await FileSystem.writeAsStringAsync(uri, lines.join("\n"), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return { ...live, durationMs, fileName, uri };
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  floating: {
    alignItems: "center",
    backgroundColor: "#253C31F2",
    borderColor: "#FFFFFF2E",
    borderRadius: 18,
    borderWidth: 1,
    elevation: 10,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
    position: "absolute",
    right: 14,
    shadowColor: "#17231D",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
  },
  recordDot: { backgroundColor: "#E97B6F", borderRadius: 5, height: 9, width: 9 },
  floatingText: { color: "#FFF8EB", fontSize: 10.5, fontVariant: ["tabular-nums"], fontWeight: "900" },
  floatingCount: { color: "#B9C9C0", fontSize: 9, fontVariant: ["tabular-nums"] },
  card: {
    alignItems: "center",
    backgroundColor: "#FCFAF5",
    borderRadius: 27,
    maxWidth: 470,
    padding: 24,
    width: "100%",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#EEEAE2",
    borderRadius: 13,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: 15,
    top: 15,
    width: 38,
  },
  icon: { alignItems: "center", backgroundColor: "#315D4B", borderRadius: 19, height: 58, justifyContent: "center", width: 58 },
  eyebrow: { color: "#789083", fontSize: 8, fontWeight: "900", letterSpacing: 1.8, marginTop: 13 },
  title: { color: "#343934", fontSize: 21, fontWeight: "900", marginTop: 5 },
  description: { color: "#7F817A", fontSize: 11, lineHeight: 19, marginTop: 13, textAlign: "center" },
  note: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#EEF2EE", borderRadius: 14, flexDirection: "row", gap: 8, marginTop: 14, padding: 11 },
  noteText: { color: "#748078", flex: 1, fontSize: 9.5, lineHeight: 15 },
  primaryButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#315D4B", borderRadius: 14, flexDirection: "row", gap: 8, height: 46, justifyContent: "center", marginTop: 17 },
  stopButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: "#865650", borderRadius: 14, flexDirection: "row", gap: 8, height: 46, justifyContent: "center", marginTop: 17 },
  primaryText: { color: "#FFF8EB", fontSize: 12, fontWeight: "900" },
  secondaryButton: { alignItems: "center", alignSelf: "stretch", height: 38, justifyContent: "center", marginTop: 3 },
  secondaryText: { color: "#727871", fontSize: 10.5, fontWeight: "800" },
  saving: { alignItems: "center", minHeight: 170, justifyContent: "center" },
  savingText: { color: "#7D827B", fontSize: 10.5, marginTop: 12 },
  metrics: { alignSelf: "stretch", flexDirection: "row", gap: 8, marginTop: 17 },
  metric: { alignItems: "center", backgroundColor: "#F0EEE7", borderRadius: 15, flex: 1, minWidth: 0, paddingHorizontal: 5, paddingVertical: 13 },
  metricValue: { color: "#385246", fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "900" },
  metricLabel: { color: "#97938A", fontSize: 8, marginTop: 4 },
  timer: { color: "#3C4C43", fontSize: 25, fontVariant: ["tabular-nums"], fontWeight: "800", marginTop: 17 },
  screenText: { color: "#8A8982", fontSize: 9.5, marginTop: 4 },
  fileName: { color: "#6F756F", fontSize: 9.5, marginTop: 14, textAlign: "center" },
  exportMessage: { color: "#597466", fontSize: 9.5, lineHeight: 15, marginTop: 9, textAlign: "center" },
});
