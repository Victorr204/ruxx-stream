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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { GOLD, GOLD_GRADIENT } from "../../context/ThemeContext";
import { useAuthStore } from "../../src/stores/auth";
import { useDownloadsStore } from "../../src/stores/downloads";
import { useAdsConfig } from "../../src/stores/adsConfig";
import { useMovie } from "../../src/hooks/useMovies";
import {
  fetchAdMarkers,
  fetchSubtitleCues,
  fetchWatchProgress,
  logAdEvent,
  logPlaybackEvent,
  resolveStreamUrl,
  saveWatchProgress,
} from "../../src/lib/api";
import { cueAt, languageLabel } from "../../src/lib/subtitles";
import { formatMeta } from "../../src/lib/format";
import { qualityLabel } from "../../src/lib/quality";
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
import { IDLE_QUALITY, PlayerEngine } from "../../src/components/PlayerEngine";
import QualitySheet from "../../src/components/QualitySheet";
import SubtitleSheet from "../../src/components/SubtitleSheet";
import ScanEngine from "../../src/components/ScanEngine";

// Playback screen: resolves a playable URL + resume point, runs ad breaks
// (AdMob interstitial natively, house overlay on web/TV/failure), schedules
// mid-rolls from admin markers/interval, and keeps watch_progress fresh so
// continue-watching works everywhere.
//
// phase is derived, never stored: loading -> preroll? -> playing -> ended,
// with error winning whenever a load/playback error exists.

const CONTROLS_HIDE_MS = 4500;
const SUBTITLE_PREF_KEY = "ruxx.subtitle.language";
const QUALITY_PREF_KEY = "ruxx.quality.height";

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

  const [subLang, setSubLang] = useState(null);
  const [subCues, setSubCues] = useState([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsPending, setSubsPending] = useState("");
  const [subsError, setSubsError] = useState(null);
  const [subtitleSheet, setSubtitleSheet] = useState(false);

  const [quality, setQuality] = useState(IDLE_QUALITY);
  const [qualitySheet, setQualitySheet] = useState(false);
  const qualityLevelsKeyRef = useRef("");
  const qualityAppliedRef = useRef("");
  const qualityPrefRef = useRef(null);
  const qualityPrefLoadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // Wipe the decrypted playback copy once this player goes away (or the
  // route switches titles) so plaintext never outlives the session.
  useEffect(() => {
    return () => {
      void useDownloadsStore.getState().releaseLocalPlayback(movieId);
    };
  }, [movieId]);

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

        const readyEntry = downloads.getEntry(movieId);
        if (readyEntry?.state === "ready" && readyEntry.uri) {
          // Local file wins: no sign-stream-url call (and it works offline).
          // Sealed entries are decrypted to a transient copy first.
          let localUri = null;
          try {
            localUri = await downloads.prepareLocalPlayback(movieId);
          } catch (decryptError) {
            if (!cancelled) {
              setLoadState({
                id: movieId,
                error: decryptError?.message || "Offline copy could not be opened.",
                stream: null,
                progress: null,
                markers: [],
              });
            }
            return;
          }
          if (cancelled) return;
          if (localUri) {
            const watch = await fetchWatchProgress(movieId).catch(() => null);
            if (cancelled) return;
            applyLoaded({ url: localUri, quality: "offline", source: "local" }, watch, []);
            return;
          }
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

  const applySubtitleLanguage = useCallback(
    async (code) => {
      if (!movieId) return false;
      if (!code) {
        setSubLang(null);
        setSubCues([]);
        setSubsError(null);
        setSubsPending("");
        AsyncStorage.removeItem(SUBTITLE_PREF_KEY).catch(() => undefined);
        return true;
      }
      setSubsLoading(true);
      setSubsPending(languageLabel(code));
      setSubsError(null);
      try {
        const cues = await fetchSubtitleCues(movieId, code);
        if (!mountedRef.current) return false;
        setSubCues(cues);
        setSubLang(code);
        AsyncStorage.setItem(SUBTITLE_PREF_KEY, code).catch(() => undefined);
        return true;
      } catch (e) {
        // Keep whatever is on screen (an admin upload, or the previous
        // language) — a failed generation must not blank the subtitles.
        if (!mountedRef.current) return false;
        setSubsError(e instanceof Error ? e.message : "Subtitles unavailable");
        return false;
      } finally {
        if (mountedRef.current) {
          setSubsPending("");
          setSubsLoading(false);
        }
      }
    },
    [movieId]
  );

  // Restore the viewer's last subtitle language whenever a title loads.
  useEffect(() => {
    if (!movieId) return undefined;
    let cancelled = false;
    AsyncStorage.getItem(SUBTITLE_PREF_KEY)
      .then((code) => {
        if (!cancelled && code) applySubtitleLanguage(code);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [movieId, applySubtitleLanguage]);

  const handleSubtitleSelect = useCallback(
    async (code) => {
      const ok = await applySubtitleLanguage(code);
      if (ok && mountedRef.current) setSubtitleSheet(false);
    },
    [applySubtitleLanguage]
  );

  const ensureStarted = useCallback(() => {
    if (hasStartedRef.current) return;
    if (phaseRef.current !== "playing" || !engineRef.current) return;
    hasStartedRef.current = true;
    engineRef.current.play();
  }, []);

  useEffect(() => {
    ensureStarted();
  }, [phase, ensureStarted]);

  // ---- Resolution picker -------------------------------------------------
  // The engine reports level lists + auto/current updates through onQuality;
  // the saved preference ("auto" | a concrete height) is applied once per
  // level set so every new source picks up the viewer's last choice.
  const handleQuality = useCallback((state) => {
    if (mountedRef.current) setQuality(state);
  }, []);

  const applyQualityPref = useCallback(() => {
    const handle = engineRef.current;
    if (!handle || !qualityPrefLoadedRef.current) return;
    const key = qualityLevelsKeyRef.current;
    if (!key || key === qualityAppliedRef.current) return;
    qualityAppliedRef.current = key;
    handle.setQuality(qualityPrefRef.current);
  }, []);

  const qualityLevelsKey = quality.levels.length
    ? quality.levels.map((level) => `${level.id}:${level.bitrate ?? 0}`).join("|")
    : "";

  useEffect(() => {
    qualityLevelsKeyRef.current = qualityLevelsKey;
  }, [qualityLevelsKey]);

  // A fresh engine or swapped-in playlist re-keys the list → re-apply.
  useEffect(() => {
    if (!qualityLevelsKey) {
      qualityAppliedRef.current = "";
      return;
    }
    applyQualityPref();
  }, [qualityLevelsKey, applyQualityPref]);

  // Restore the saved resolution preference once per session.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(QUALITY_PREF_KEY)
      .then((raw) => {
        if (cancelled) return;
        const parsed = raw && raw !== "auto" ? Number.parseInt(raw, 10) : null;
        qualityPrefRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        qualityPrefLoadedRef.current = true;
        applyQualityPref();
      })
      .catch(() => {
        qualityPrefLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [applyQualityPref]);

  const handleQualitySelect = useCallback((height) => {
    qualityPrefRef.current = height;
    // User's explicit choice wins over the pending pref for this level set.
    qualityAppliedRef.current = qualityLevelsKeyRef.current;
    AsyncStorage.setItem(QUALITY_PREF_KEY, height === null ? "auto" : String(height)).catch(
      () => undefined
    );
    engineRef.current?.setQuality(height);
    setQualitySheet(false);
  }, []);

  const handleEngineReady = useCallback(
    (handle) => {
      engineRef.current = handle;
      applyQualityPref();
      ensureStarted();
    },
    [ensureStarted, applyQualityPref]
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

      let status;
      try {
        status = unit && canUseNativeAds() ? await showNativeInterstitial(unit) : "unavailable";
      } catch (e) {
        console.warn("[ads] interstitial unavailable", e);
        status = "failed";
      }
      if (!mountedRef.current || adBreakRef.current !== placement) return;

      if (status === "completed" || status === "skipped") {
        finishAdBreak(status);
        return;
      }
      if (status !== "unavailable" && failOpen()) {
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
  const movieMeta = movie ? formatMeta(movie) : "";
  const qualitySelectable = quality.levels.length > 1;
  const qualityStatic = quality.levels.length === 1;
  const qualityPill =
    quality.auto || quality.currentHeight == null ? "Auto" : qualityLabel(quality.currentHeight);
  const watchedFraction = duration > 0 ? Math.min(1, position / duration) : 0;
  const activeCue = subCues.length > 0 ? cueAt(subCues, position) : null;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
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
          onQuality={handleQuality}
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
        <Animated.View
          entering={FadeIn.duration(170)}
          exiting={FadeOut.duration(200)}
          style={styles.controls}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={["rgba(0,0,0,0.8)", "rgba(0,0,0,0.35)", "transparent"]}
            style={styles.topScrim}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.85)"]}
            style={styles.bottomScrim}
            pointerEvents="none"
          />

          <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.glassBtn}
              onPress={goBack}
              accessibilityRole="button"
              accessibilityLabel="Leave player"
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={styles.topTitles}>
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
              {movieMeta ? (
                <Text numberOfLines={1} style={styles.topMeta}>
                  {movieMeta}
                </Text>
              ) : null}
            </View>
            {qualitySelectable ? (
              <TouchableOpacity
                style={[styles.qualityPill, !quality.auto && styles.qualityPillActive]}
                onPress={() => {
                  showControls();
                  setQualitySheet(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Quality: ${qualityPill}`}
              >
                <Text
                  style={[
                    styles.qualityPillText,
                    !quality.auto && styles.qualityPillTextActive,
                  ]}
                >
                  {qualityPill}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={!quality.auto ? GOLD : "rgba(255,255,255,0.8)"}
                />
              </TouchableOpacity>
            ) : qualityStatic ? (
              <View style={styles.qualityPill}>
                <Text style={styles.qualityPillText}>{qualityPill}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.glassBtn}
              onPress={() => {
                setSubsError(null);
                setSubtitleSheet(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Subtitle settings"
            >
              <Ionicons
                name={subLang ? "language" : "language-outline"}
                size={20}
                color={subLang ? GOLD : "#fff"}
              />
            </TouchableOpacity>
          </SafeAreaView>

          <View style={styles.centerRow} pointerEvents="box-none">
            <View style={styles.seekGroup}>
              <TouchableOpacity
                style={styles.seekBtn}
                onPress={() => seekBy(-10)}
                accessibilityRole="button"
                accessibilityLabel="Rewind 10 seconds"
              >
                <Ionicons name="play-back" size={21} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.seekLabel}>10</Text>
            </View>

            <TouchableOpacity
              onPress={togglePlay}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={playing ? "Pause" : "Play"}
            >
              <LinearGradient
                colors={GOLD_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.playBtn}
              >
                <Ionicons
                  name={playing ? "pause" : "play"}
                  size={30}
                  color="#0a0a0a"
                  style={playing ? undefined : styles.playIconNudge}
                />
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.seekGroup}>
              <TouchableOpacity
                style={styles.seekBtn}
                onPress={() => seekBy(10)}
                accessibilityRole="button"
                accessibilityLabel="Forward 10 seconds"
              >
                <Ionicons name="play-forward" size={21} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.seekLabel}>10</Text>
            </View>
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
              <LinearGradient
                colors={GOLD_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.trackPlayed, { width: `${watchedFraction * 100}%` }]}
              />
              <View style={[styles.trackThumb, { left: `${watchedFraction * 100}%` }]} />
            </Pressable>
            <Text style={[styles.time, styles.timeRight]}>{formatTime(duration)}</Text>
          </SafeAreaView>
        </Animated.View>
      ) : null}

      {/* Subtitles */}
      {activeCue && phase === "playing" && !adBreak ? (
        <View style={styles.subtitleLayer} pointerEvents="none">
          <Text style={styles.subtitleText}>{activeCue}</Text>
        </View>
      ) : null}

      {subsLoading && !showError ? (
        <View style={styles.subtitleLayer} pointerEvents="none">
          <View style={styles.subtitlePill}>
            <ActivityIndicator size="small" color={GOLD} />
            <Text style={styles.subtitlePillText}>
              {subsPending ? `Generating ${subsPending} subtitles…` : "Preparing subtitles…"}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Loading / waiting-for-ad */}
      {busy && !showError ? (
        <SafeAreaView style={styles.cardBackdrop}>
          <View style={styles.card}>
            <ActivityIndicator color={GOLD} size="large" />
            <Text style={styles.centerTitle}>
              {phase === "preroll" ? "Your break starts shortly…" : "Preparing your stream…"}
            </Text>
            <Text style={styles.centerSub}>{title}</Text>
          </View>
        </SafeAreaView>
      ) : null}

      {/* Ad break (house overlay path: web, TV, no unit, fail_open=false) */}
      {adBreak?.mode === "overlay" ? (
        <AdOverlay placement={adBreak.placement} onFinished={finishAdBreak} />
      ) : null}

      {/* Transcription engine host: hidden iframe / WebView, always mounted. */}
      <ScanEngine />

      <SubtitleSheet
        visible={subtitleSheet}
        movieId={movieId ?? ""}
        active={subLang}
        busy={subsLoading}
        error={subsError}
        onSelect={handleSubtitleSelect}
        onClose={() => setSubtitleSheet(false)}
      />

      <QualitySheet
        visible={qualitySheet}
        levels={quality.levels}
        auto={quality.auto}
        currentHeight={quality.currentHeight}
        onSelect={handleQualitySelect}
        onClose={() => setQualitySheet(false)}
      />

      {/* Finished */}
      {phase === "ended" && !adBreak && !showError ? (
        <SafeAreaView style={styles.cardBackdrop}>
          <View style={styles.card}>
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
          </View>
        </SafeAreaView>
      ) : null}

      {/* Error */}
      {showError ? (
        <SafeAreaView style={styles.cardBackdrop}>
          <View style={styles.card}>
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
  topScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 150 },
  bottomScrim: { position: "absolute", bottom: 0, left: 0, right: 0, height: 180 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 10,
  },
  glassBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitles: { flex: 1, gap: 1 },
  title: { color: "#fff", fontSize: 15.5, fontWeight: "800" },
  topMeta: { color: "rgba(255,255,255,0.58)", fontSize: 11, fontWeight: "700" },
  qualityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  qualityPillActive: {
    backgroundColor: "rgba(232,184,74,0.16)",
    borderColor: "rgba(232,184,74,0.55)",
  },
  qualityPillText: { color: "rgba(255,255,255,0.92)", fontSize: 12.5, fontWeight: "800" },
  qualityPillTextActive: { color: GOLD },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
  },
  seekGroup: { alignItems: "center", gap: 5 },
  seekBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  seekLabel: { color: "rgba(255,255,255,0.72)", fontSize: 10.5, fontWeight: "800" },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  playIconNudge: { marginLeft: 3 },
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  time: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700", minWidth: 46 },
  timeRight: { textAlign: "right" },
  track: { flex: 1, height: 30, justifyContent: "center" },
  trackBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  trackPlayed: {
    position: "absolute",
    left: 0,
    height: 4.5,
    borderRadius: 2.5,
  },
  trackThumb: {
    position: "absolute",
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: GOLD,
    marginLeft: -7.5,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  cardBackdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 30,
    paddingHorizontal: 24,
    borderRadius: 28,
    backgroundColor: "rgba(12,12,16,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  centerTitle: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  centerSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    maxWidth: 300,
  },
  subtitleLayer: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 96,
    zIndex: 8,
    alignItems: "center",
  },
  subtitleText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.68)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: "hidden",
    maxWidth: "94%",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  subtitlePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.68)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  subtitlePillText: { color: "#fff", fontSize: 12.5, fontWeight: "700" },
  doneBadge: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  doneRow: { flexDirection: "row", gap: 12, marginTop: 14, flexWrap: "wrap", justifyContent: "center" },
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
