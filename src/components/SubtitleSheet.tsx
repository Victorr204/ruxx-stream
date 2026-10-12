import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { GOLD, useTheme } from "../../context/ThemeContext";
import {
  detectSubtitleLanguage,
  fetchSubtitleLanguages,
  type SubtitleOption,
} from "../lib/api";
import {
  SUBTITLE_LANGUAGES,
  languageLabel,
  normalizeDetectedLanguage,
  pickTranslationSource,
} from "../lib/subtitles";
import { useScanStore } from "../stores/scan";

type Props = {
  visible: boolean;
  movieId: string;
  active: string | null;
  busy: boolean;
  error: string | null;
  scale?: number;
  offset?: number;
  onSelect: (code: string | null) => void;
  onScaleChange?: (scale: number) => void;
  onOffsetChange?: (offset: number) => void;
  onClose: () => void;
};

const SCALE_OPTIONS = [
  { label: "S", value: 0.85 },
  { label: "M", value: 1 },
  { label: "L", value: 1.25 },
  { label: "XL", value: 1.6 },
];

const OFFSET_STEP = 0.2;
const OFFSET_MIN = -3;
const OFFSET_MAX = 3;

type Detection = {
  forMovie: string;
  detected: string | null;
};

function formatEta(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

export default function SubtitleSheet({
  visible,
  movieId,
  active,
  busy,
  error,
  scale = 1,
  offset = 0,
  onSelect,
  onScaleChange,
  onOffsetChange,
  onClose,
}: Props) {
  const { theme } = useTheme();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<SubtitleOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const loading = visible && !!movieId && loadedFor !== movieId;

  const scanStatus = useScanStore((state) => state.status);
  const scanProgress = useScanStore((state) => state.progress);
  const scanError = useScanStore((state) => state.error);
  const scanSavedToken = useScanStore((state) => state.savedToken);
  const startScan = useScanStore((state) => state.start);
  const cancelScan = useScanStore((state) => state.cancel);
  const resetScan = useScanStore((state) => state.reset);

  // Clear stale results when the sheet shuts for good; an active scan keeps
  // running even if the viewer closes the sheet (the engine is independent).
  useEffect(() => {
    if (!visible && (scanStatus === "error" || scanStatus === "saved")) resetScan();
  }, [visible, scanStatus, resetScan]);

  useEffect(() => {
    if (!visible || !movieId) return undefined;
    let cancelled = false;
    fetchSubtitleLanguages(movieId)
      .then((rows) => {
        if (cancelled) return;
        setUploaded(rows);
        setLoadError(null);
        setLoadedFor(movieId);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load subtitles");
        setLoadedFor(movieId);
      });
    return () => {
      cancelled = true;
    };
    // scanSavedToken in the deps: a finished scan reloads the track list.
  }, [visible, movieId, scanSavedToken]);

  // The file every "generate in…" row starts from — English when it exists,
  // otherwise the first upload. Matches what the edge function will pick.
  const source = pickTranslationSource(uploaded, null);
  const detectionFor = detection?.forMovie === movieId ? detection : null;
  const detected = normalizeDetectedLanguage(source?.detected ?? detectionFor?.detected);
  const sourceLabel = languageLabel(detected ?? source?.language ?? "");
  const detecting =
    visible && loadedFor === movieId && !!source && !detected && !detectionFor;
  const detectionFailed = loadedFor === movieId && !!source && !detected && !!detectionFor;

  // Ask the server for the movie's language once per title (it caches the
  // answer, so every later viewer is instant). Rows that already carry a
  // detection never trigger a call.
  useEffect(() => {
    if (!visible || !movieId || loadedFor !== movieId || detectionFor) return undefined;
    const row = pickTranslationSource(uploaded, null);
    if (!row || row.detected) return undefined;
    let cancelled = false;
    detectSubtitleLanguage(movieId)
      .then((result) => {
        if (cancelled) return;
        setDetection({ forMovie: movieId, detected: result.detected });
        if (result.detected) {
          const found = result.detected;
          setUploaded((rows) =>
            rows.map((item) =>
              item.language === result.sourceLanguage ? { ...item, detected: found } : item
            )
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDetection({ forMovie: movieId, detected: null });
      });
    return () => {
      cancelled = true;
    };
  }, [visible, movieId, loadedFor, uploaded, detectionFor]);

  const translateOptions = SUBTITLE_LANGUAGES.filter(
    (language) => !uploaded.some((row) => row.language === language.code)
  );
  const pendingCode = busy ? requested : null;
  const pendingLabel = pendingCode ? languageLabel(pendingCode) : "";
  const busyText =
    pendingLabel && pendingLabel !== pendingCode
      ? `Generating ${pendingLabel} subtitles…`
      : "Preparing subtitles…";

  const handleSelect = (code: string | null) => {
    setRequested(code);
    onSelect(code);
  };

  const renderRow = (
    key: string,
    label: string,
    meta: string,
    code: string | null,
    kind: "off" | "uploaded" | "generated",
    pendingMeta?: string
  ) => {
    const selected = active === code;
    const generated = kind === "generated";
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.row,
          {
            borderColor: selected ? "rgba(232,184,74,0.45)" : theme.cardBorder,
            borderStyle: generated ? "dashed" : "solid",
          },
          selected && styles.rowActive,
          generated && !selected && styles.rowGenerated,
        ]}
        onPress={() => handleSelect(code)}
        disabled={busy}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${label} subtitles`}
      >
        <Ionicons
          name={selected ? "checkmark-circle" : "ellipse-outline"}
          size={21}
          color={selected ? GOLD : theme.placeholder}
        />
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.placeholder }]}>
            {pendingCode === code && pendingMeta ? pendingMeta : meta}
          </Text>
        </View>
        {kind === "uploaded" ? (
          <Ionicons name="cloud-outline" size={15} color={theme.placeholder} />
        ) : null}
        {generated ? (
          <Ionicons name="sparkles-outline" size={15} color={GOLD} />
        ) : null}
        {selected && busy ? <ActivityIndicator size="small" color={GOLD} /> : null}
      </TouchableOpacity>
    );
  };

  const renderSection = (icon: keyof typeof Ionicons.glyphMap, title: string, hint?: string) => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={13} color={GOLD} />
        <Text style={[styles.sectionLabel, { color: theme.placeholder }]}>{title}</Text>
      </View>
      {hint ? <Text style={[styles.sectionHint, { color: theme.placeholder }]}>{hint}</Text> : null}
    </View>
  );

  const renderDetection = () => {
    if (!source) return null;
    if (detecting) {
      return (
        <View style={[styles.detectCard, { borderColor: theme.cardBorder }]}>
          <ActivityIndicator size="small" color={GOLD} />
          <View style={styles.detectText}>
            <Text style={[styles.detectValue, { color: theme.text }]}>
              Detecting movie language…
            </Text>
            <Text style={[styles.detectHint, { color: theme.placeholder }]}>
              Reading the uploaded subtitle track
            </Text>
          </View>
        </View>
      );
    }
    if (detected) {
      return (
        <View style={[styles.detectCard, { borderColor: "rgba(232,184,74,0.35)" }]}>
          <Ionicons name="globe-outline" size={20} color={GOLD} />
          <View style={styles.detectText}>
            <Text style={[styles.detectLabel, { color: theme.placeholder }]}>
              Movie language
            </Text>
            <Text style={[styles.detectValue, { color: theme.text }]}>{sourceLabel}</Text>
            <Text style={[styles.detectHint, { color: theme.placeholder }]}>
              Auto-detected from the subtitles
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.detectCard, { borderColor: theme.cardBorder }]}>
        <Ionicons name="help-circle-outline" size={20} color={theme.placeholder} />
        <View style={styles.detectText}>
          <Text style={[styles.detectLabel, { color: theme.placeholder }]}>
            Movie language
          </Text>
          <Text style={[styles.detectValue, { color: theme.text }]}>{source.label}</Text>
          <Text style={[styles.detectHint, { color: theme.placeholder }]}>
            {detectionFailed
              ? "Auto-detection unavailable — using the uploaded file's label"
              : "From the uploaded subtitle file"}
          </Text>
        </View>
      </View>
    );
  };

  const scanActive =
    scanStatus === "starting" || scanStatus === "running" || scanStatus === "saving";

  const renderScan = () => {
    if (Platform.isTV) return null;
    const progressMessage = scanProgress && scanProgress.type === "progress" ? scanProgress : null;
    const percent = progressMessage ? progressMessage.percent : 0;
    const detail = progressMessage ? progressMessage.detail : "";
    const eta = progressMessage ? progressMessage.etaSeconds : null;
    return (
      <View style={[styles.scanCard, { borderColor: theme.cardBorder }]}>
        <View style={styles.scanHeader}>
          <Ionicons name="radio-outline" size={16} color={GOLD} />
          <Text style={[styles.scanTitle, { color: theme.text }]}>Audio scan</Text>
          {scanActive ? (
            <TouchableOpacity
              onPress={cancelScan}
              style={styles.scanCancel}
              accessibilityLabel="Cancel scan"
            >
              <Text style={[styles.scanCancelText, { color: theme.placeholder }]}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {scanStatus === "idle" ? (
          <>
            <Text style={[styles.scanHint, { color: theme.placeholder }]}>
              No upload needed — the app listens through the movie and writes
              subtitles from the dialogue.
            </Text>
            <TouchableOpacity
              onPress={() => startScan(movieId)}
              style={[styles.scanButton, { backgroundColor: GOLD }]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Scan audio for subtitles"
            >
              <Ionicons name="play" size={14} color="#14141a" />
              <Text style={styles.scanButtonText}>Scan audio for subtitles</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {scanActive ? (
          <View style={styles.scanProgressWrap}>
            <View style={[styles.scanTrack, { backgroundColor: theme.cardBorder }]}>
              <View
                style={[
                  styles.scanFill,
                  { width: `${Math.max(2, Math.min(100, percent))}%` },
                ]}
              />
            </View>
            <Text style={[styles.scanDetail, { color: theme.text }]}>
              {scanStatus === "saving" ? "Saving transcript…" : detail || "Working…"}
            </Text>
            <Text style={[styles.scanMeta, { color: theme.placeholder }]}>
              {scanStatus === "saving"
                ? "Storing the generated subtitle track"
                : `${percent}%${eta !== null && eta > 0 ? ` · about ${formatEta(eta)} left` : ""}`}
            </Text>
          </View>
        ) : null}

        {scanStatus === "saved" ? (
          <View style={styles.scanDone}>
            <Ionicons name="checkmark-circle-outline" size={17} color={GOLD} />
            <Text style={[styles.scanDetail, { color: theme.text }]}>
              Transcript saved — pick it from the tracks below
            </Text>
          </View>
        ) : null}

        {scanStatus === "error" ? (
          <View style={styles.scanErrorBox}>
            <Ionicons name="alert-circle-outline" size={17} color="#e5675f" />
            <Text style={[styles.scanDetail, { color: "#e5675f" }]}>
              {scanError ?? "Scan failed"}
            </Text>
            <TouchableOpacity
              onPress={() => startScan(movieId)}
              style={[styles.scanRetry]}
              activeOpacity={0.85}
            >
              <Text style={[styles.scanButtonText, { color: GOLD }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
          accessibilityLabel="Close"
        />
        <Animated.View
          entering={FadeInDown.duration(240)}
          style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
        >
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.headerTick} />
              <Text style={[styles.title, { color: theme.text }]}>Subtitles</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={theme.subtitle} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={GOLD} />
            </View>
          ) : (
            <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent}>
              {renderDetection()}

              {onScaleChange && onOffsetChange ? (
                <>
                  {renderSection("options-outline", "Appearance", "Size and timing on this device")}
                  <View style={styles.appearanceRow}>
                    <View style={styles.scaleChips}>
                      {SCALE_OPTIONS.map((option) => {
                        const selected = Math.abs(scale - option.value) < 0.01;
                        return (
                          <TouchableOpacity
                            key={option.label}
                            style={[
                              styles.scaleChip,
                              {
                                backgroundColor: selected ? GOLD : "rgba(255,255,255,0.06)",
                                borderColor: selected ? GOLD : theme.cardBorder,
                              },
                            ]}
                            onPress={() => onScaleChange(option.value)}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={`Subtitle size ${option.label}`}
                          >
                            <Text
                              style={[
                                styles.scaleChipText,
                                { color: selected ? "#14141a" : theme.subtitle, fontSize: 10 + option.value * 4 },
                              ]}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.offsetBox}>
                      <TouchableOpacity
                        style={[
                          styles.offsetBtn,
                          { borderColor: theme.cardBorder, opacity: offset <= OFFSET_MIN + 0.01 ? 0.35 : 1 },
                        ]}
                        disabled={offset <= OFFSET_MIN + 0.01}
                        onPress={() =>
                          onOffsetChange(Math.max(OFFSET_MIN, Math.round((offset - OFFSET_STEP) * 10) / 10))
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Subtitles later"
                      >
                        <Ionicons name="remove" size={15} color={theme.text} />
                      </TouchableOpacity>
                      <Text style={[styles.offsetValue, { color: theme.text }]}>
                        {offset > 0 ? "+" : ""}
                        {offset.toFixed(1)}s
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.offsetBtn,
                          { borderColor: theme.cardBorder, opacity: offset >= OFFSET_MAX - 0.01 ? 0.35 : 1 },
                        ]}
                        disabled={offset >= OFFSET_MAX - 0.01}
                        onPress={() =>
                          onOffsetChange(Math.min(OFFSET_MAX, Math.round((offset + OFFSET_STEP) * 10) / 10))
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Subtitles earlier"
                      >
                        <Ionicons name="add" size={15} color={theme.text} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : null}

              {renderScan()}

              {renderSection(
                "cloud-upload-outline",
                "Subtitle tracks",
                "Admin uploads and in-app audio scans both play here"
              )}
              {renderRow("off", "Off", "No subtitles", null, "off")}
              {uploaded.map((row) =>
                renderRow(
                  row.language,
                  row.label,
                  row.origin === "generated"
                    ? row.detected && row.detected !== row.language
                      ? `Audio scan · detected ${languageLabel(row.detected)}`
                      : "Audio scan"
                    : row.detected && row.detected !== row.language
                      ? `Admin upload · detected ${languageLabel(row.detected)}`
                      : "Admin upload",
                  row.language,
                  row.origin === "generated" ? "generated" : "uploaded"
                )
              )}

              {uploaded.length === 0 ? (
                <Text style={[styles.empty, { color: theme.placeholder }]}>
                  {loadError ??
                    "No subtitle track for this title yet — run an audio scan above, or wait for the admin's upload."}
                </Text>
              ) : null}

              {translateOptions.length > 0 && uploaded.length > 0 ? (
                <>
                  {renderSection(
                    "sparkles-outline",
                    "In-app generator",
                    `Nothing uploaded for these — made in the app from the ${sourceLabel} track`
                  )}
                  {translateOptions.map((language) =>
                    renderRow(
                      `t-${language.code}`,
                      language.label,
                      `In-app · generated from ${sourceLabel}`,
                      language.code,
                      "generated",
                      `Generating from ${sourceLabel}…`
                    )
                  )}
                </>
              ) : null}
            </ScrollView>
          )}

          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator size="small" color={GOLD} />
              <Text style={[styles.busyText, { color: theme.subtitle }]}>{busyText}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    gap: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: GOLD },
  title: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  loadingBox: { paddingVertical: 26, alignItems: "center" },
  rows: { maxHeight: 400 },
  rowsContent: { gap: 9 },
  detectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(232,184,74,0.06)",
  },
  detectText: { flex: 1, gap: 1 },
  detectLabel: {
    fontSize: 10.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  detectValue: { fontSize: 15, fontWeight: "800" },
  detectHint: { fontSize: 11, fontWeight: "600" },
  appearanceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  scaleChips: { flex: 1, flexDirection: "row", gap: 7 },
  scaleChip: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 10,
  },
  scaleChipText: { fontWeight: "900" },
  offsetBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  offsetBtn: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  offsetValue: { fontSize: 12.5, fontWeight: "800", minWidth: 44, textAlign: "center" },
  sectionBlock: { gap: 3, marginTop: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sectionHint: { fontSize: 11, fontWeight: "600", marginLeft: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowActive: { backgroundColor: "rgba(232,184,74,0.07)" },
  rowGenerated: { backgroundColor: "rgba(232,184,74,0.03)", borderStyle: "dashed" },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 14.5, fontWeight: "800" },
  rowMeta: { fontSize: 11, fontWeight: "600" },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 14 },
  busyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  busyText: { fontSize: 12.5, fontWeight: "700" },
  error: { color: "#FF6B6B", fontSize: 12.5, fontWeight: "600", textAlign: "center" },
  scanCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    backgroundColor: "rgba(124,92,255,0.06)",
  },
  scanHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  scanTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  scanCancel: { paddingHorizontal: 8, paddingVertical: 3 },
  scanCancelText: { fontSize: 11.5, fontWeight: "800" },
  scanHint: { fontSize: 12, fontWeight: "600", lineHeight: 17 },
  scanButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 11,
    paddingVertical: 11,
  },
  scanButtonText: { fontSize: 13, fontWeight: "800", color: "#14141a" },
  scanProgressWrap: { gap: 6 },
  scanTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  scanFill: { height: "100%", backgroundColor: GOLD, borderRadius: 3 },
  scanDetail: { fontSize: 12.5, fontWeight: "700" },
  scanMeta: { fontSize: 11, fontWeight: "600" },
  scanDone: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  scanErrorBox: { gap: 8, flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  scanRetry: {
    borderWidth: 1,
    borderColor: "rgba(232,184,74,0.5)",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
