import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { GOLD } from "../../context/ThemeContext";
import { useAuthStore } from "../../src/stores/auth";
import { useDownloadsStore } from "../../src/stores/downloads";
import { useAdsConfig } from "../../src/stores/adsConfig";
import { useMovie } from "../../src/hooks/useMovies";
import {
  fetchAdMarkers,
  fetchWatchProgress,
  logAdEvent,
  logPlaybackEvent,
  resolveStreamUrl,
  saveWatchProgress,
} from "../../src/lib/api";
import {
  RESUME_THRESHOLD_SECONDS,
  buildCuePoints,
  dueCuePoint,
  initialResumePosition,
  isCompleted,
  shouldAutosave,
} from "../../src/lib/playback";
import { canUseNativeAds, showNativeInterstitial } from "../../src/lib/ads";
import { AdOverlay } from "../../src/components/AdOverlay";
import { PlayerEngine } from "../../src/components/PlayerEngine";

// Playback screen: resolves a playable URL + resume point, runs ad breaks
// (AdMob interstitial natively, house overlay on web/TV/failure), schedules
// mid-rolls from admin markers/interval, and keeps watch_progress fresh so
// continue-watching works everywhere.
//
// phase is derived, never stored: loading -> preroll? -> playing -> ended,
// with error winning whenever a load/playback error exists.

const CONTROLS_HIDE_MS = 4500;

const EMPTY_LOAD = {
  id: null,
  error: null,
  stream: null,
  progress: null,
  markers: [],
};

const NO_MARKERS = [];

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export default function Player() {
  const params = useLocalSearchParams();
  const movieId = Array.isArray(params.id) ? params.id[0] : params.id;
  const profile = useAuthStore((s) => s.profile);

  const adsLoaded = useAdsConfig((s) => s.loaded);
  const loadAds = useAdsConfig((s) => s.load);
  const isEnabled = useAdsConfig((s) => s.isEnabled);
  const unitFor = useAdsConfig((s) => s.unitFor);
  const intervalSeconds = useAdsConfig((s) => s.intervalSeconds);
  const failOpen = useAdsConfig((s) => s.failOpen);

  const {
    data: movieData,
    loading: movieLoading,
    error: movieError,
    reload: reloadMovie,
  } = useMovie(movieId);

  // Downloaded copy (if any) wins over the network: local playback never
  // signs a stream URL, so offline plays cost zero playback_events rows.
  const dlEntry = useDownloadsStore((s) => (movieId ? s.entries[movieId] : undefined));

  // One id-keyed load record: switching titles or retrying invalidates it
  // without any synchronous state resets inside effects.
  const [loadState, setLoadState] = useState(EMPTY_LOAD);
  const [loadNonce, setLoadNonce] = useState(0);

  const [playback, setPlayback] = useState("idle"); // idle | ended
  const [prerollDone, setPrerollDone] = useState(false);
  const [adBreak, setAdBreak] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [trackWidth, setTrackWidth] = useState(1);

  const engineRef = useRef(null);
  const adBreakRef = useRef(null);
  const phaseRef = useRef("loading");
  const cuePointsRef = useRef([]);
  const consumedRef = useRef(0);
  const lastSavedRef = useRef(0);
  const latestRef = useRef({ position: 0, duration: 0 });
  const hasStartedRef = useRef(false);
  const playLoggedRef = useRef(false);
  const completedRef = useRef(false);
  const mountedRef = useRef(true);
  const controlsTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  // Resolve URL + resume point + ad markers for the current title.
  useEffect(() => {
    if (!movieId) return undefined;
    let cancelled = false;

    const applyLoaded = (stream, watch, markerList) => {
      setLoadState({
        id: movieId,
        error: null,
        stream,
        progress: watch,
        markers: markerList,
      });
      setPlayback("idle");
      setPrerollDone(false);
      hasStartedRef.current = false;
      playLoggedRef.current = false;
      completedRef.current = false;
    };

    (async () => {
      try {
        const downloads = useDownloadsStore.getState();
        await downloads.initialize();
        if (cancelled) return;

        const localUri = downloads.getLocalUri(movieId);
        if (localUri) {
          const watch = await fetchWatchProgress(movieId).catch(() => null);
          if (cancelled) return;
          applyLoaded({ url: localUri, quality: "offline", source: "local" }, watch, []);
          return;
        }

        const [streamResult, watch, adMarkers] = await Promise.all([
          resolveStreamUrl(movieId),
          fetchWatchProgress(movieId).catch(() => null),
          fetchAdMarkers(movieId),
        ]);
        if (cancelled) return;
        if (!streamResult) {
          setLoadState({
            id: movieId,
            error: "This title isn't available for streaming right now.",
            stream: null,
            progress: null,
            markers: [],
          });
          return;
        }
        applyLoaded(streamResult, watch, adMarkers);
      } catch (e) {
        if (cancelled) return;
        // Offline (and no local file): say so instead of a raw fetch error.
        let message = e?.message || "Could not start playback.";
        try {
          const net = await NetInfo.fetch();
          if (net?.isConnected === false) {
            message =
              "You're offline. Connect to the internet to stream this title, or download it first.";
          }
        } catch {
          // NetInfo unavailable — keep the original message.
        }
        setLoadState({
          id: movieId,
          error: message,
          stream: null,
          progress: null,
          markers: [],
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [movieId, loadNonce]);

  const loadedForCurrent = loadState.id === movieId;
  const stream = loadedForCurrent ? loadState.stream : null;
  const localPlayback = stream?.source === "local";
  const dataError = loadedForCurrent ? loadState.error : null;
  const progressRow = loadedForCurrent ? loadState.progress : null;
  const markers = loadedForCurrent ? loadState.markers : NO_MARKERS;
  const dataLoading = !loadedForCurrent;

  // Offline movie fetch fails too — fall back to the manifest snapshot.
  const movie = movieData ?? dlEntry?.movie ?? null;
  const premium = !!profile?.is_premium;
  const resumePosition = useMemo(() => initialResumePosition(progressRow), [progressRow]);

  const cuePoints = useMemo(() => {
    if (localPlayback || premium || !adsLoaded || !isEnabled("mid_roll")) return [];
    return buildCuePoints({
      manualSeconds: markers,
      runtimeSeconds: movie?.runtime_seconds ?? null,
      intervalSeconds: intervalSeconds(),
      midRollEnabled: true,
    });
  }, [localPlayback, premium, adsLoaded, isEnabled, intervalSeconds, markers, movie]);

  useEffect(() => {
    cuePointsRef.current = cuePoints;
  }, [cuePoints]);

  // Freeze resume-derived refs once this stream is the active one (the
  // engine may start reporting positions in the same tick).
  useEffect(() => {
    if (!stream) return;
    consumedRef.current = resumePosition;
    lastSavedRef.current = resumePosition;
    latestRef.current = { position: resumePosition, duration: 0 };
  }, [stream, resumePosition]);

  // Downloaded copies never play ads (no ad inventory offline by design).
  const needsPreRoll = !!stream && !localPlayback && !premium && adsLoaded && isEnabled("pre_roll");
  // A failed movie fetch is survivable when the manifest snapshot exists.
  const showError = !!dataError || (!!movieError && !movie);
  const errorMessage = dataError || movieError || "Playback failed.";
  const contentReady =
    !!stream && !!movie && !dataLoading && !movieLoading && (localPlayback || !!adsLoaded);

  const phase = showError
    ? "error"
    : !contentReady
      ? "loading"
      : needsPreRoll && !prerollDone
        ? "preroll"
        : playback === "ended"
          ? "ended"
          : "playing";

  useEffect(() => {
    phaseRef.current = phase;
  });

  const showControls = useCallback(() => {
    if (!mountedRef.current) return;
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  const toggleControls = useCallback(() => {
    setControlsVisible((visible) => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (visible) return false;
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
      return true;
    });
  }, []);

  const ensureStarted = useCallback(() => {
    if (hasStartedRef.current) return;
    if (phaseRef.current !== "playing" || !engineRef.current) return;
    hasStartedRef.current = true;
    engineRef.current.play();
  }, []);

  useEffect(() => {
    ensureStarted();
  }, [phase, ensureStarted]);

  const handleEngineReady = useCallback(
    (handle) => {
      engineRef.current = handle;
      ensureStarted();
    },
    [ensureStarted]
  );

  const finishAdBreak = useCallback(
    (status) => {
      const placement = adBreakRef.current;
      adBreakRef.current = null;
      if (mountedRef.current) setAdBreak(null);
      if (placement) void logAdEvent({ movieId, placement, status });

      if (phaseRef.current === "preroll") {
        setPrerollDone(true); // derived phase flips to "playing" and starts content
      } else if (phaseRef.current === "playing") {
        engineRef.current?.play();
        showControls();
      }
    },
    [movieId, showControls]
  );

  const startAdBreak = useCallback(
    async (placement, cue) => {
      if (adBreakRef.current) return;
      if (phaseRef.current !== "playing" && phaseRef.current !== "preroll") return;
      adBreakRef.current = placement;

      if (placement === "mid_roll") {
        engineRef.current?.pause();
        if (typeof cue === "number") engineRef.current?.seek(cue);
      }
      void logAdEvent({ movieId, placement, status: "impression" });

      const unit = unitFor(placement);
      // Yield before any setState: effects (preroll) may call this
      // synchronously, which react-hooks/set-state-in-effect forbids.
      await Promise.resolve();
      if (!mountedRef.current || adBreakRef.current !== placement) return;
      setAdBreak({ placement, mode: "native" });

      const status =
        unit && canUseNativeAds() ? await showNativeInterstitial(unit) : "unavailable";
      if (!mountedRef.current || adBreakRef.current !== placement) return;

      if (status === "completed" || status === "skipped") {
        finishAdBreak(status);
        return;
      }
      if (failOpen()) {
        finishAdBreak("failed");
        return;
      }
      setAdBreak({ placement, mode: "overlay" });
    },
    [movieId, unitFor, failOpen, finishAdBreak]
  );

  // Armed pre-roll as soon as we enter that phase. The kick is deferred a
  // tick so the ad flow's setState never runs synchronously inside an effect.
  useEffect(() => {
    if (phase !== "preroll") return undefined;
    const kick = setTimeout(() => {
      void startAdBreak("pre_roll");
    }, 0);
    return () => clearTimeout(kick);
  }, [phase, startAdBreak]);

  const handleProgress = useCallback(
    (nextPosition, nextDuration) => {
      latestRef.current = { position: nextPosition, duration: nextDuration };
      if (!mountedRef.current) return;
      setPosition(nextPosition);
      if (nextDuration > 0) setDuration(nextDuration);

      if (phaseRef.current !== "playing" || adBreakRef.current) return;

      if (!playLoggedRef.current && nextPosition > 0) {
        playLoggedRef.current = true;
        void logPlaybackEvent({
          movieId,
          event: nextPosition > RESUME_THRESHOLD_SECONDS + 5 ? "resume" : "play",
          positionSeconds: nextPosition,
        });
      }

      if (!completedRef.current && isCompleted(nextPosition, nextDuration)) {
        completedRef.current = true;
        void saveWatchProgress({
          movieId,
          positionSeconds: nextPosition,
          durationSeconds: nextDuration,
          completed: true,
        });
        void logPlaybackEvent({
          movieId,
          event: "complete",
          positionSeconds: nextPosition,
        });
        engineRef.current?.pause();
        setPlayback("ended");
        return;
      }

      if (shouldAutosave(lastSavedRef.current, nextPosition)) {
        lastSavedRef.current = nextPosition;
        void saveWatchProgress({
          movieId,
          positionSeconds: nextPosition,
          durationSeconds: nextDuration,
          completed: false,
        });
      }

      const cue = dueCuePoint(cuePointsRef.current, nextPosition, consumedRef.current);
      if (cue !== null) {
        consumedRef.current = cue;
        void startAdBreak("mid_roll", cue);
      }
    },
    [movieId, startAdBreak]
  );

  const handleEnded = useCallback(() => {
    if (phaseRef.current === "ended") return;
    const { position: endPosition, duration: endDuration } = latestRef.current;
    engineRef.current?.pause();
    if (!mountedRef.current) return;
    setPlayback("ended");
    if (!completedRef.current) {
      completedRef.current = true;
      void saveWatchProgress({
        movieId,
        positionSeconds: endPosition,
        durationSeconds: endDuration || endPosition,
        completed: true,
      });
      void logPlaybackEvent({ movieId, event: "complete", positionSeconds: endPosition });
    }
  }, [movieId]);

  const handleEngineError = useCallback((message) => {
    if (adBreakRef.current) return;
    setLoadState({
      id: movieId,
      error: message || "Playback failed.",
      stream: null,
      progress: null,
      markers: [],
    });
  }, [movieId]);

  // Final resume point if the player is torn down mid-play.
  useEffect(() => {
    return () => {
      const { position: finalPosition, duration: finalDuration } = latestRef.current;
      if (finalPosition > 10 && !completedRef.current) {
        void saveWatchProgress({
          movieId,
          positionSeconds: finalPosition,
          durationSeconds: finalDuration,
          completed: false,
        });
      }
    };
  }, [movieId]);

  const togglePlay = useCallback(() => {
    const handle = engineRef.current;
    if (!handle || adBreakRef.current) return;

    if (phaseRef.current === "ended") {
      completedRef.current = false;
      playLoggedRef.current = false;
      lastSavedRef.current = 0;
      consumedRef.current = 0;
      handle.seek(0);
      setPosition(0);
      setPlayback("idle");
      handle.play();
      showControls();
      return;
    }
    if (phaseRef.current !== "playing") return;
    if (handle.isPlaying()) {
      handle.pause();
    } else {
      handle.play();
    }
    showControls();
  }, [showControls]);

  const seekTo = useCallback(
    (target) => {
      const handle = engineRef.current;
      if (!handle || adBreakRef.current || phaseRef.current !== "playing") return;
      const bounded = Math.max(0, target);
      handle.seek(bounded);
      // Scrubbing past an unplayed marker consumes it — no ad ambush on seek.
      if (bounded > consumedRef.current) consumedRef.current = bounded;
      showControls();
    },
    [showControls]
  );

  const seekBy = useCallback(
    (delta) => {
      const handle = engineRef.current;
      if (!handle) return;
      const target = handle.getCurrentTime() + delta;
      const cap = latestRef.current.duration || target;
      seekTo(Math.min(target, cap));
    },
    [seekTo]
  );

  const seekToFraction = useCallback(
    (fraction) => {
      const total = latestRef.current.duration;
      if (!total) return;
      seekTo(Math.max(0, Math.min(1, fraction)) * total);
    },
    [seekTo]
  );

  const goBack = useCallback(() => {
    try {
      router.back();
    } catch (_e) {
      router.navigate("/home");
    }
  }, []);

  const retry = useCallback(() => {
    reloadMovie();
    setLoadState(EMPTY_LOAD);
    setLoadNonce((n) => n + 1);
  }, [reloadMovie]);

  const busy = phase === "loading" || phase === "preroll";
  const title = movie?.title ?? "Now playing";
  const watchedFraction = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.root}>
      {stream && movie && !showError ? (
        <PlayerEngine
          url={stream.url}
          startPosition={resumePosition}
          onReady={handleEngineReady}
          onProgress={handleProgress}
          onPlayingChange={(isPlaying) => {
            if (mountedRef.current) setPlaying(isPlaying);
          }}
          onEnded={handleEnded}
          onError={handleEngineError}
        />
      ) : null}

      {/* Tap layer: toggles controls while content plays (never during ads). */}
      {!adBreak && phase === "playing" ? (
        <TouchableOpacity
          style={styles.tapLayer}
          activeOpacity={1}
          onPress={toggleControls}
          accessibilityRole="button"
          accessibilityLabel="Toggle player controls"
        />
      ) : null}

      {/* Controls */}
      {controlsVisible && !adBreak && phase === "playing" ? (
        <View style={styles.controls} pointerEvents="box-none">
          <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Leave player"
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={styles.iconBtnSpacer} />
          </SafeAreaView>

          <View style={styles.centerRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => seekBy(-10)}
              accessibilityRole="button"
              accessibilityLabel="Rewind 10 seconds"
            >
              <Ionicons name="play-back" size={24} color="#fff" />
              <Text style={styles.seekLabel}>10</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playBtn}
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel={playing ? "Pause" : "Play"}
            >
              <Ionicons name={playing ? "pause" : "play"} size={30} color="#0a0a0a" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => seekBy(10)}
              accessibilityRole="button"
              accessibilityLabel="Forward 10 seconds"
            >
              <Ionicons name="play-forward" size={24} color="#fff" />
              <Text style={styles.seekLabel}>10</Text>
            </TouchableOpacity>
          </View>

          <SafeAreaView edges={["bottom"]} style={styles.bottomBar} pointerEvents="box-none">
            <Text style={styles.time}>{formatTime(position)}</Text>
            <Pressable
              style={styles.track}
              onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width || 1)}
              onPress={(e) => seekToFraction(e.nativeEvent.locationX / trackWidth)}
              accessibilityRole="button"
              accessibilityLabel={`Seek. ${formatTime(position)} of ${formatTime(duration)}`}
            >
              <View style={styles.trackBg} />
              <View style={[styles.trackPlayed, { width: `${watchedFraction * 100}%` }]} />
              <View style={[styles.trackThumb, { left: `${watchedFraction * 100}%` }]} />
            </Pressable>
            <Text style={styles.time}>{formatTime(duration)}</Text>
          </SafeAreaView>
        </View>
      ) : null}

      {/* Loading / waiting-for-ad */}
      {busy && !showError ? (
        <SafeAreaView style={styles.centerCard}>
          <ActivityIndicator color={GOLD} size="large" />
          <Text style={styles.centerTitle}>
            {phase === "preroll" ? "Your break starts shortly…" : "Preparing your stream…"}
          </Text>
          <Text style={styles.centerSub}>{title}</Text>
        </SafeAreaView>
      ) : null}

      {/* Ad break (house overlay path: web, TV, no unit, fail_open=false) */}
      {adBreak?.mode === "overlay" ? (
        <AdOverlay placement={adBreak.placement} onFinished={finishAdBreak} />
      ) : null}

      {/* Finished */}
      {phase === "ended" && !adBreak && !showError ? (
        <SafeAreaView style={styles.centerCard}>
          <View style={styles.doneBadge}>
            <Ionicons name="checkmark" size={30} color="#0a0a0a" />
          </View>
          <Text style={styles.centerTitle}>Thanks for watching</Text>
          <Text style={styles.centerSub}>{title}</Text>
          <View style={styles.doneRow}>
            <TouchableOpacity
              style={styles.donePrimary}
              onPress={togglePlay}
              accessibilityRole="button"
              accessibilityLabel="Watch again"
            >
              <Ionicons name="refresh" size={17} color="#0a0a0a" />
              <Text style={styles.donePrimaryText}>Watch again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneGhost}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Back to browse"
            >
              <Text style={styles.doneGhostText}>Done</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Error */}
      {showError ? (
        <SafeAreaView style={styles.centerCard}>
          <Ionicons name="alert-circle-outline" size={38} color="#ff6b6b" />
          <Text style={styles.centerTitle}>Can&apos;t play this title</Text>
          <Text style={styles.centerSub}>{errorMessage}</Text>
          <View style={styles.doneRow}>
            <TouchableOpacity
              style={styles.donePrimary}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="Retry playback"
            >
              <Ionicons name="refresh" size={17} color="#0a0a0a" />
              <Text style={styles.donePrimaryText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneGhost}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Back to browse"
            >
              <Text style={styles.doneGhostText}>Back</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  tapLayer: { ...StyleSheet.absoluteFill, zIndex: 1 },
  controls: { ...StyleSheet.absoluteFill, zIndex: 10, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnSpacer: { width: 40 },
  title: { flex: 1, color: "#fff", fontSize: 15.5, fontWeight: "800" },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 30,
  },
  seekBtn: { alignItems: "center", gap: 2 },
  seekLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10.5, fontWeight: "800" },
  playBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 4,
  },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  time: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700", minWidth: 46 },
  track: { flex: 1, height: 26, justifyContent: "center" },
  trackBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  trackPlayed: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: GOLD,
  },
  trackThumb: {
    position: "absolute",
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: GOLD,
    marginLeft: -6.5,
  },
  centerCard: {
    ...StyleSheet.absoluteFill,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 30,
    backgroundColor: "#000",
  },
  centerTitle: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  centerSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 320,
  },
  doneBadge: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  doneRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  donePrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: GOLD,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
  },
  donePrimaryText: { color: "#0a0a0a", fontSize: 14.5, fontWeight: "800" },
  doneGhost: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  doneGhostText: { color: "#fff", fontSize: 14.5, fontWeight: "700" },
});
