import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  useWindowDimensions,
  Platform,
  Share,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, GOLD, GOLD_GRADIENT } from "../../context/ThemeContext";
import AppAlert from "../../utils/AppAlert";
import { useMovie, useForYou } from "../../src/hooks/useMovies";
import { useIsDesktop, CONTENT_MAX_WIDTH } from "../../src/hooks/useIsDesktop";
import { fetchListIdsForMovie, fetchWatchProgress } from "../../src/lib/api";
import { formatMeta, formatRuntime } from "../../src/lib/format";
import { useDownloadsStore } from "../../src/stores/downloads";
import { usePremiumCheckout } from "../../src/hooks/usePremiumCheckout";
import { useDesktopPremiumLock } from "../../src/hooks/useDesktopPremiumLock";
import { isDesktopShell } from "../../src/lib/platform";
import ListSheet from "../../src/components/ListSheet";
import MovieRow from "../../src/components/MovieRow";
import PremiumSheet from "../../src/components/PremiumSheet";
import TrailerModal from "../../src/components/TrailerModal";

function backdropHeight(w) {
  if (w >= 900) return Math.min(Math.round(w * 0.32), 440);
  return Math.min(Math.round(w * 0.56), 380);
}

const RESUME_THRESHOLD_SECONDS = 10;
const END_MARGIN_SECONDS = 15;

export default function MovieDetail() {
  const { theme } = useTheme();
  const params = useLocalSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { data: movie, loading, error, reload } = useMovie(id);
  const forYou = useForYou(movie);
  const { width: windowW } = useWindowDimensions();
  const isDesktop = useIsDesktop();
  const backdropH = backdropHeight(windowW);

  const [resumeState, setResumeState] = useState({ id: null, position: 0 });
  const [playFocused, setPlayFocused] = useState(false);
  const [alert, setAlert] = useState({ visible: false, title: "", message: "", type: "info" });
  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [membership, setMembership] = useState({ id: null, ids: [] });

  // Same Paystack checkout flow as Profile/Player (rendered below).
  const notifyCheckout = (title, message, type = "info", accent = null) =>
    setAlert({ visible: true, title, message, type, accent });
  const checkout = usePremiumCheckout(notifyCheckout);

  // No stream URL is resolved here — the store does that only when the
  // user actually presses Download (each resolve logs playback_events).
  const dlEntry = useDownloadsStore((s) => (id ? s.entries[id] : undefined));
  const startDownload = useDownloadsStore((s) => s.startDownload);

  useEffect(() => {
    let cancelled = false;
    if (!id) return undefined;

    fetchWatchProgress(id)
      .then((progress) => {
        if (cancelled) return;
        let position = 0;
        if (progress && !progress.completed) {
          const { position_seconds, duration_seconds } = progress;
          const nearEnd = duration_seconds > 0 && position_seconds > duration_seconds - END_MARGIN_SECONDS;
          if (position_seconds > RESUME_THRESHOLD_SECONDS && !nearEnd) {
            position = position_seconds;
          }
        }
        setResumeState({ id, position });
      })
      .catch(() => {
        // Progress is a nice-to-have; playback still works without it.
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Stale positions are ignored while the new title (or its progress) loads.
  const position = resumeState.id === id ? resumeState.position : 0;

  useEffect(() => {
    let cancelled = false;
    if (!id) return undefined;

    fetchListIdsForMovie(id)
      .then((ids) => {
        if (!cancelled) setMembership({ id, ids });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [id]);

  const inListIds = membership.id === id ? membership.ids : [];

  // Desktop app: Play is premium-only there (the wall is the subscribe
  // pitch); every other platform keeps the free, ad-supported flow.
  const desktopLocked = useDesktopPremiumLock();

  const handlePlay = () => {
    if (desktopLocked) {
      checkout.openPremium();
      return;
    }
    router.push(`/player/${movie.id}`);
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate("/home");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <ActivityIndicator color={GOLD} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !movie) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={42} color={theme.placeholder} />
          <Text style={[styles.centerTitle, { color: theme.text }]}>
            {error ?? "Title not found"}
          </Text>
          <TouchableOpacity style={[styles.retryBtn, { borderColor: GOLD }]} onPress={reload}>
            <Text style={[styles.retryText, { color: GOLD }]}>Try Again</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.backFloating} onPress={goBack} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const canResume = position > 0;
  const meta = formatMeta(movie);

  const showDownload = Platform.OS !== "web" || isDesktopShell();
  const dlState = dlEntry?.state ?? null;
  const dlLabel =
    dlState === "downloading"
      ? `Downloading ${Math.round((dlEntry?.progress ?? 0) * 100)}%`
      : dlState === "encrypting"
        ? `Encrypting ${Math.round((dlEntry?.progress ?? 0) * 100)}%`
        : dlState === "ready"
          ? "Saved for offline"
          : dlState === "failed"
            ? "Retry download"
            : "Download";
  const dlIcon =
    dlState === "ready"
      ? "checkmark-circle"
      : dlState === "encrypting"
        ? "lock-closed"
        : dlState === "failed"
          ? "refresh"
          : "download-outline";

  const handleDownload = async () => {
    if (dlState && dlState !== "failed") {
      router.push("/downloads");
      return;
    }
    const result = await startDownload(movie);
    if (result.ok) return;
    if (result.reason === "premium-required") {
      checkout.openPremium();
    } else if (result.reason === "streaming-only") {
      setAlert({
        visible: true,
        title: "Not Available Offline",
        message: "This title streams only and cannot be saved for offline viewing.",
        type: "info",
      });
    } else if (result.reason === "offline") {
      setAlert({
        visible: true,
        title: "You are offline",
        message: "Connect to the internet and try again.",
        type: "info",
      });
    } else if (result.reason === "error") {
      setAlert({
        visible: true,
        title: "Download Failed",
        message: result.message || "Please try again.",
        type: "error",
      });
    }
    // busy / cancelled / unsupported: nothing to tell the user.
  };

  const handleShare = () => {
    const siteUrl = process.env.EXPO_PUBLIC_SITE_URL;
    const link = siteUrl
      ? `${siteUrl}/movie/${movie.id}`
      : `ruxxstream://movie/${movie.id}`;
    Share.share({
      message: `Watch "${movie.title}" on ruxx stream — ${link}`,
    }).catch(() => {
      // User dismissed the share sheet.
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <AppAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        theme={theme}
        onClose={() => setAlert((a) => ({ ...a, visible: false }))}
      />
      <PremiumSheet
        visible={checkout.premiumModal}
        firstTime={checkout.firstTime}
        upgrading={checkout.upgrading}
        onCheckout={checkout.handleUpgrade}
        onClose={checkout.closePremium}
      />
      <ListSheet
        visible={listSheetOpen}
        movieId={movie.id}
        onClose={() => setListSheetOpen(false)}
        onMembershipChange={(ids) => setMembership({ id: movie.id, ids })}
      />
      {trailerOpen && movie.trailer_url ? (
        <TrailerModal url={movie.trailer_url} onClose={() => setTrailerOpen(false)} />
      ) : null}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, isDesktop && styles.scrollWide]}>
        {/* ── Backdrop ── */}
        <View style={[styles.backdrop, { height: backdropH }]}>
          {movie.backdrop_url || movie.poster_url ? (
            <Image
              source={{ uri: movie.backdrop_url ?? movie.poster_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={250}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={styles.backdropFallback} />
          )}
          <LinearGradient
            colors={["rgba(10,10,10,0.35)", "rgba(10,10,10,0.6)", theme.background]}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        {/* ── Title block ── */}
        <View style={[styles.titleBlock, isDesktop && styles.titleBlockWide]}>
          <View style={styles.titleRow}>
            <View style={styles.posterWrap}>
              {movie.poster_url ? (
                <Image source={{ uri: movie.poster_url }} style={[styles.poster, isDesktop && styles.posterWide]} contentFit="cover" cachePolicy="memory-disk" transition={200} />
              ) : (
                <View style={[styles.poster, isDesktop && styles.posterWide, styles.posterFallback]}>
                  <Ionicons name="film-outline" size={28} color="rgba(232,184,74,0.6)" />
                </View>
              )}
            </View>
            <View style={styles.titleText}>
              <Text style={[styles.title, { color: theme.text }, isDesktop && styles.titleWide]} numberOfLines={3}>
                {movie.title}
              </Text>
              {meta ? <Text style={[styles.meta, { color: theme.subtitle }]}>{meta}</Text> : null}
            </View>
          </View>

          {(movie.genres?.length ?? 0) > 0 && (
            <View style={styles.genreRow}>
              {movie.genres.map((genre) => (
                <View key={genre.id} style={[styles.genreChip, { borderColor: "rgba(232,184,74,0.4)" }]}>
                  <Text style={[styles.genreText, { color: GOLD }]}>{genre.name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Play / Resume ── */}
          <TouchableOpacity
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={canResume ? `Resume ${movie.title}` : `Play ${movie.title}`}
            hasTVPreferredFocus
            onPress={handlePlay}
            onFocus={() => setPlayFocused(true)}
            onBlur={() => setPlayFocused(false)}
            style={[styles.playBtn, isDesktop && styles.actionWide, playFocused && styles.playFocused]}
            activeOpacity={0.88}
          >
            <LinearGradient colors={GOLD_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.playGrad}>
              <Ionicons name={canResume ? "play-skip-forward" : "play"} size={18} color="#111" />
              <Text style={styles.playText}>
                {desktopLocked
                  ? "Watch with Premium"
                  : canResume
                    ? `Resume ${formatRuntime(position)}`
                    : "Play"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {movie.trailer_url ? (
            <TouchableOpacity
              focusable
              accessible
              accessibilityRole="button"
              accessibilityLabel={`Watch trailer — ${movie.title}`}
              onPress={() => setTrailerOpen(true)}
              style={[styles.dlBtn, isDesktop && styles.actionWide]}
              activeOpacity={0.8}
            >
              <Ionicons name="film-outline" size={18} color={GOLD} />
              <Text style={[styles.dlBtnText, { color: theme.text }]}>Trailer</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── Download for offline (native only) ── */}
          {showDownload ? (
            <TouchableOpacity
              focusable
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${dlLabel} — ${movie.title}`}
              onPress={handleDownload}
              style={[styles.dlBtn, isDesktop && styles.actionWide, dlState === "ready" && styles.dlBtnReady]}
              activeOpacity={0.8}
            >
              <Ionicons name={dlIcon} size={18} color={GOLD} />
              <Text style={[styles.dlBtnText, { color: theme.text }]}>{dlLabel}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`My List — ${movie.title}`}
            onPress={() => setListSheetOpen(true)}
            style={[styles.dlBtn, isDesktop && styles.actionWide, inListIds.length > 0 && styles.dlBtnReady]}
            activeOpacity={0.8}
          >
            <Ionicons
              name={inListIds.length > 0 ? "bookmark" : "bookmark-outline"}
              size={18}
              color={GOLD}
            />
            <Text style={[styles.dlBtnText, { color: theme.text }]}>
              {inListIds.length > 0 ? "In My List" : "My List"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            focusable
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Share — ${movie.title}`}
            onPress={handleShare}
            style={[styles.dlBtn, isDesktop && styles.actionWide]}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social-outline" size={18} color={GOLD} />
            <Text style={[styles.dlBtnText, { color: theme.text }]}>Share</Text>
          </TouchableOpacity>

          {/* ── Description ── */}
          {movie.description ? (
            <>
              <Text style={[styles.sectionLabel, { color: theme.placeholder }]}>About</Text>
              <Text style={[styles.description, { color: theme.subtitle }]}>{movie.description}</Text>
            </>
          ) : null}

          <Text style={[styles.copyright, { color: theme.placeholder }]}>
            {movie.release_year ? `© ${movie.release_year} • ` : ""}Licensed for streaming on ruxx stream
          </Text>
        </View>

        {/* ── For You ── */}
        {forYou.items.length > 0 && (
          <View style={styles.forYouBlock}>
            <MovieRow
              key={forYou.batchKey}
              title="For You"
              movies={forYou.items}
              enterDelay={80}
              onPressMovie={(suggested) => router.push(`/movie/${suggested.id}`)}
            />
            {forYou.canSuggestMore && (
              <TouchableOpacity
                focusable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Suggest more titles"
                activeOpacity={0.85}
                onPress={forYou.suggestMore}
                style={styles.suggestBtn}
              >
                <Ionicons name="refresh" size={16} color={GOLD} />
                <Text style={styles.suggestText}>Suggest more</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Floating back ── */}
      <SafeAreaView style={styles.backFloatingWrap} pointerEvents="box-none" edges={["top"]}>
        <TouchableOpacity
          style={styles.backFloating}
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 40 },
  scrollWide: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 30,
  },
  centerTitle: { fontSize: 16.5, fontWeight: "800", textAlign: "center" },
  retryBtn: { marginTop: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  retryText: { fontSize: 14, fontWeight: "800" },

  backdrop: {},
  backdropFallback: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#141414" },

  titleBlock: { paddingHorizontal: 20, marginTop: -64, gap: 14 },
  titleBlockWide: { paddingHorizontal: 48, maxWidth: 780 },

  titleRow: { flexDirection: "row", gap: 14, alignItems: "flex-end" },
  posterWrap: {
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  poster: { width: 104, height: 156 },
  posterWide: { width: 148, height: 222 },
  posterFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#151515" },
  titleText: { flex: 1, gap: 5, paddingBottom: 4 },
  title: { fontSize: 24, fontWeight: "900", letterSpacing: -0.4, lineHeight: 29 },
  titleWide: { fontSize: 34, lineHeight: 40 },
  meta: { fontSize: 13, fontWeight: "700" },

  genreRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genreChip: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  genreText: { fontSize: 11.5, fontWeight: "700" },

  playBtn: { borderRadius: 14, overflow: "hidden", marginTop: 2 },
  actionWide: { maxWidth: 380, alignSelf: "flex-start" },
  playFocused: {
    shadowColor: GOLD,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 9,
  },
  playGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, height: 54 },
  playText: { color: "#111", fontSize: 16.5, fontWeight: "800" },

  dlBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.16)",
  },
  dlBtnReady: { borderColor: GOLD, backgroundColor: "rgba(232,184,74,0.08)" },
  dlBtnText: { fontSize: 15, fontWeight: "800" },

  sectionLabel: {
    fontSize: 11.5,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 6,
  },
  description: { fontSize: 14.5, lineHeight: 21.5 },

  copyright: { fontSize: 11, marginTop: 8 },

  forYouBlock: { marginTop: 6 },
  suggestBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 20,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(232,184,74,0.45)",
    backgroundColor: "rgba(232,184,74,0.06)",
  },
  suggestText: { color: GOLD, fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },

  backFloatingWrap: { position: "absolute", top: 0, left: 0 },
  backFloating: {
    marginLeft: 16,
    marginTop: 8,
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
});
