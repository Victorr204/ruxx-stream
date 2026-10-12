import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTheme, GOLD } from "../../context/ThemeContext";
import AppAlert from "../../utils/AppAlert";
import { useDownloadsStore } from "../../src/stores/downloads";
import { formatBytes } from "../../src/lib/downloads";
import { formatRuntime } from "../../src/lib/format";
import { useIsDesktop, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import { isDesktopShell } from "../../src/lib/platform";

export default function Downloads() {
  const { theme } = useTheme();
  const entries = useDownloadsStore((s) => s.entries);
  const initialize = useDownloadsStore((s) => s.initialize);
  const cancelDownload = useDownloadsStore((s) => s.cancelDownload);
  const removeDownload = useDownloadsStore((s) => s.removeDownload);
  const startDownload = useDownloadsStore((s) => s.startDownload);
  const isDesktop = useIsDesktop();

  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });
  const [pendingRemove, setPendingRemove] = useState(null);

  useEffect(() => {
    // Root layout normally warms this; call again for idempotency.
    initialize().catch((e) => console.warn("[downloads] init failed", e));
  }, [initialize]);

  const showAlert = (title, message, type = "info") => setAlert({ visible: true, title, message, type });

  const list = useMemo(
    () => Object.values(entries).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries]
  );

  const totalBytes = list.reduce((sum, e) => sum + (e.fileSizeBytes || 0), 0);
  // Browser tab only: the desktop app downloads like the mobile apps do.
  const isWeb = Platform.OS === "web" && !isDesktopShell();

  const handlePlay = (entry) => router.push(`/player/${entry.movieId}`);

  const handleRetry = async (entry) => {
    const result = await startDownload(entry.movie);
    if (!result.ok) {
      if (result.reason === "premium-required") {
        showAlert("Premium Plan Required", "Offline downloads are available to premium members.", "info");
      } else if (result.reason === "streaming-only") {
        showAlert("Not Available Offline", "This title streams only and cannot be saved for offline viewing.", "info");
      } else if (result.reason === "offline") {
        showAlert("You are offline", "Connect to the internet and try again.", "info");
      } else if (result.reason !== "cancelled" && result.reason !== "busy") {
        showAlert("Download Failed", result.message || "Please try again.", "error");
      }
    }
  };

  const handleRemove = async (entry) => {
    if (pendingRemove !== entry.movieId) {
      setPendingRemove(entry.movieId);
      return;
    }
    setPendingRemove(null);
    await removeDownload(entry.movieId);
  };

  const renderStatus = (entry) => {
    if (entry.state === "downloading" || entry.state === "encrypting") {
      const pct = Math.round(entry.progress * 100);
      const sizeText =
        entry.state === "encrypting"
          ? `Encrypting… ${pct}%`
          : entry.totalBytes > 0
            ? `${pct}% · ${formatBytes(entry.bytesDone)} / ${formatBytes(entry.totalBytes)}`
            : `${formatBytes(entry.bytesDone)} · starting…`;
      return (
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.max(2, Math.round(entry.progress * 100))}%`,
                  backgroundColor: entry.state !== "encrypting" && entry.totalBytes < 0 ? theme.subtitle : GOLD,
                },
              ]}
            />
          </View>
          <Text style={[styles.statusText, { color: theme.subtitle }]} numberOfLines={1}>
            {sizeText}
          </Text>
        </View>
      );
    }

    if (entry.state === "failed") {
      return (
        <Text style={[styles.statusText, { color: "#ef4444" }]} numberOfLines={2}>
          {entry.error || "Download failed"}
        </Text>
      );
    }

    return (
      <Text style={[styles.statusText, { color: theme.subtitle }]}>
        {formatBytes(entry.fileSizeBytes)} · Ready to watch offline
      </Text>
    );
  };

  const renderActions = (entry) => {
    if (entry.state === "downloading" || entry.state === "encrypting") {
      return (
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => cancelDownload(entry.movieId)}
          accessibilityRole="button"
          accessibilityLabel={`Cancel download of ${entry.movie.title}`}
        >
          <Ionicons name="close" size={20} color={theme.subtitle} />
        </TouchableOpacity>
      );
    }

    if (entry.state === "failed") {
      return (
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => handleRetry(entry)}
          accessibilityRole="button"
          accessibilityLabel={`Retry download of ${entry.movie.title}`}
        >
          <Ionicons name="refresh" size={18} color={GOLD} />
        </TouchableOpacity>
      );
    }

    const isPending = pendingRemove === entry.movieId;
    return (
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={styles.playBtn}
          onPress={() => handlePlay(entry)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Watch ${entry.movie.title} offline`}
        >
          <Ionicons name="play" size={15} color="#111" />
          <Text style={styles.playBtnText}>Play</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => handleRemove(entry)}
          accessibilityRole="button"
          accessibilityLabel={isPending ? `Confirm remove of ${entry.movie.title}` : `Remove download of ${entry.movie.title}`}
        >
          <Ionicons name={isPending ? "checkmark" : "trash-outline"} size={18} color={isPending ? "#ef4444" : theme.subtitle} />
        </TouchableOpacity>
        {isPending ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setPendingRemove(null)}
            accessibilityRole="button"
            accessibilityLabel="Keep download"
          >
            <Ionicons name="close" size={18} color={theme.subtitle} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />

      <ScrollView contentContainerStyle={[styles.scroll, isDesktop && styles.scrollWide]} showsVerticalScrollIndicator={false}>
        <Animated.Text entering={FadeInDown.duration(400)} style={[styles.header, { color: theme.text }, isDesktop && styles.headerWide]}>
          Downloads
        </Animated.Text>

        {list.length > 0 ? (
          <>
            <Text style={[styles.summary, { color: theme.subtitle }]}>
              {list.length} {list.length === 1 ? "title" : "titles"} · {formatBytes(totalBytes)} on this device
            </Text>

            <View style={styles.list}>
              {list.map((entry, index) => (
                <Animated.View
                  key={entry.movieId}
                  entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(400)}
                  style={[styles.card, { backgroundColor: theme.card }]}
                >
                  <View style={styles.cardRow}>
                    <View style={[styles.poster, { backgroundColor: "#151515" }]}>
                      {entry.movie.poster_url ? (
                        <Image source={{ uri: entry.movie.poster_url }} style={styles.posterImg} resizeMode="cover" />
                      ) : (
                        <Ionicons name="film-outline" size={22} color={theme.placeholder} />
                      )}
                    </View>

                    <View style={styles.meta}>
                      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                        {entry.movie.title}
                      </Text>
                      <Text style={[styles.subtitleRow, { color: theme.placeholder }]} numberOfLines={1}>
                        {[entry.movie.release_year, formatRuntime(entry.movie.runtime_seconds)].filter(Boolean).join(" · ")}
                      </Text>
                      {renderStatus(entry)}
                    </View>

                    {renderActions(entry)}
                  </View>
                </Animated.View>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <Ionicons name={isWeb ? "phone-portrait-outline" : "download-outline"} size={44} color={theme.placeholder} />
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {isWeb ? "Available on mobile" : "Nothing saved yet"}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.subtitle }]}>
              {isWeb
                ? "Offline downloads are available in the ruxx stream mobile app."
                : "Open any movie and tap Download to save it for offline viewing."}
            </Text>
            {!isWeb && !list.length ? (
              <TouchableOpacity style={styles.browseBtn} onPress={() => router.push("/home")} activeOpacity={0.85}>
                <Ionicons name="compass-outline" size={16} color="#111" />
                <Text style={styles.browseBtnText}>Browse movies</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40, gap: 12 },
  scrollWide: { padding: 32, maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center", width: "100%" },
  header: { fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },
  headerWide: { fontSize: 32 },
  summary: { fontSize: 13, marginTop: -4 },

  list: { gap: 12 },
  card: { borderRadius: 22, padding: 14 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },

  poster: {
    width: 58,
    height: 84,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  posterImg: { width: "100%", height: "100%" },

  meta: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: "800" },
  subtitleRow: { fontSize: 12 },
  statusText: { fontSize: 12 },

  progressWrap: { gap: 6, marginTop: 2 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },

  actionsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GOLD,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
  },
  playBtnText: { fontSize: 13, fontWeight: "800", color: "#111" },

  center: { alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 90, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "800", marginTop: 8 },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  browseBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: GOLD,
    paddingHorizontal: 18,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    marginTop: 12,
  },
  browseBtnText: { fontSize: 14, fontWeight: "800", color: "#111" },
});
