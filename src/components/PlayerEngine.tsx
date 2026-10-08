import { useCallback, useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  matchLevel,
  parseMasterLevels,
  qualityLabel,
  sortLevelsDesc,
  type QualityLevel,
  type QualityState,
} from "../lib/quality";

// Playback engine behind the player screen. Native renders expo-video
// (ExoPlayer/AVPlayer handle HLS); web renders a <video> with hls.js. Both
// expose the same imperative handle through onReady, so the screen talks to
// one API: play/pause/seek/setQuality/getters. Quality levels are reported
// through onQuality; switching goes through handle.setQuality.

export type PlayerHandle = {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  /** Pick a resolution; null returns to Auto (engine chooses freely). */
  setQuality: (height: number | null) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
};

export type PlayerEngineProps = {
  url: string;
  /** Where to seek once media is ready (resume point). */
  startPosition?: number;
  onReady: (handle: PlayerHandle) => void;
  /** Polled about twice a second while the engine exists. */
  onProgress?: (position: number, duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  /** Level list plus auto/current updates while a source exposes choices. */
  onQuality?: (state: QualityState) => void;
};

export const IDLE_QUALITY: QualityState = { levels: [], auto: true, currentHeight: null };

const PROGRESS_INTERVAL_MS = 500;

function isHlsUrl(url: string): boolean {
  return url.includes(".m3u8");
}

type TrackLike = {
  size?: { width?: number | null; height?: number | null } | null;
  url?: string | null;
  averageBitrate?: number | null;
  peakBitrate?: number | null;
  bitrate?: number | null;
};

/** expo-video's availableVideoTracks → selectable levels (highest first). */
function tracksToLevels(tracks: TrackLike[]): QualityLevel[] {
  const byHeight = new Map<number, QualityLevel>();
  for (const track of tracks) {
    const height = Math.round(track.size?.height ?? 0);
    if (!height) continue;
    const raw = track.averageBitrate ?? track.peakBitrate ?? track.bitrate ?? null;
    const level: QualityLevel = {
      id: String(height),
      height,
      width: track.size?.width ?? null,
      bitrate: raw && raw > 0 ? raw : null,
      label: qualityLabel(height),
      url: track.url ?? null,
    };
    const previous = byHeight.get(height);
    if (!previous || (level.bitrate ?? 0) > (previous.bitrate ?? 0)) {
      byHeight.set(height, level);
    }
  }
  return sortLevelsDesc([...byHeight.values()]);
}

function NativeEngine({
  url,
  startPosition = 0,
  onReady,
  onProgress,
  onPlayingChange,
  onEnded,
  onError,
  onQuality,
}: PlayerEngineProps) {
  const player = useVideoPlayer(url, (p) => {
    try {
      p.timeUpdateEventInterval = 0.5;
    } catch {
      // property unsupported on this platform — polling below still works
    }
  });

  // Imperative writes (seeks) go through a ref: react-hooks/immutability
  // forbids mutating hook results directly, refs are the escape hatch.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });

  const callbacks = useRef({ onReady, onProgress, onPlayingChange, onEnded, onError, onQuality });
  useEffect(() => {
    callbacks.current = { onReady, onProgress, onPlayingChange, onEnded, onError, onQuality };
  });

  const qualityRef = useRef<QualityState>(IDLE_QUALITY);
  const manualHeightRef = useRef<number | null>(null);
  const masterUrlRef = useRef(url);
  const activeUrlRef = useRef(url);
  const restoreRef = useRef<{ at: number; play: boolean } | null>(null);
  const revertingRef = useRef(false);

  const emitQuality = useCallback((patch: Partial<QualityState>) => {
    qualityRef.current = { ...qualityRef.current, ...patch };
    callbacks.current.onQuality?.(qualityRef.current);
  }, []);

  // Source swap via replaceAsync: remember where playback was so the new
  // playlist resumes in place (and a failed swap can revert to it).
  const switchSource = useCallback((next: string) => {
    const p = playerRef.current;
    const at = Number.isFinite(p.currentTime) ? p.currentTime : 0;
    if (!restoreRef.current) restoreRef.current = { at, play: !!p.playing };
    activeUrlRef.current = next;
    p.replaceAsync(next).catch((e) => console.warn("[player] source switch failed", e));
  }, []);

  // A new URL means a brand-new player instance (useVideoPlayer keys on the
  // source) — reset the quality model and try to parse the master playlist.
  useEffect(() => {
    masterUrlRef.current = url;
    activeUrlRef.current = url;
    manualHeightRef.current = null;
    restoreRef.current = null;
    revertingRef.current = false;
    qualityRef.current = IDLE_QUALITY;
    callbacks.current.onQuality?.(IDLE_QUALITY);

    if (!isHlsUrl(url)) return undefined;
    let stale = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (stale || qualityRef.current.levels.length > 0) return;
        const levels = parseMasterLevels(text, url);
        if (levels.length > 0) emitQuality({ levels });
      })
      .catch(() => {
        // CORS or not a master playlist — sourceLoad tracks below still fill in.
      });
    return () => {
      stale = true;
    };
  }, [url, emitQuality]);

  useEffect(() => {
    const subscriptions: { remove: () => void }[] = [];
    let seekApplied = startPosition <= 0;

    const applySeek = () => {
      const restore = restoreRef.current;
      if (restore) {
        restoreRef.current = null;
        try {
          playerRef.current.currentTime = restore.at;
        } catch {
          // not ready yet
        }
        if (restore.play) {
          try {
            playerRef.current.play();
          } catch {
            // autoplay policy
          }
        }
        seekApplied = true;
        return;
      }
      if (seekApplied) return;
      try {
        playerRef.current.currentTime = startPosition;
        seekApplied = true;
      } catch {
        // not ready yet; retried on the next status change
      }
    };

    const syncLevels = (tracks?: TrackLike[] | null) => {
      if (qualityRef.current.levels.length > 0) return;
      const source = tracks ?? playerRef.current.availableVideoTracks ?? [];
      const levels = tracksToLevels(source);
      if (levels.length > 0) emitQuality({ levels });
    };

    subscriptions.push(
      player.addListener("statusChange", (payload: { status?: string; error?: { message?: string } }) => {
        if (payload?.status === "readyToPlay") {
          revertingRef.current = false;
          applySeek();
          syncLevels();
        }
        if (payload?.status === "error") {
          const message = payload?.error?.message ?? "Playback failed";
          if (revertingRef.current) {
            revertingRef.current = false;
            callbacks.current.onError?.(message);
            return;
          }
          if (manualHeightRef.current !== null && activeUrlRef.current !== masterUrlRef.current) {
            // The manual switch blew up — one-shot revert to the master.
            manualHeightRef.current = null;
            revertingRef.current = true;
            emitQuality({ auto: true });
            switchSource(masterUrlRef.current);
            return;
          }
          callbacks.current.onError?.(message);
        }
      })
    );
    subscriptions.push(
      player.addListener("sourceLoad", (payload: { availableVideoTracks?: TrackLike[] | null }) => {
        syncLevels(payload.availableVideoTracks);
      })
    );
    subscriptions.push(
      player.addListener(
        "videoTrackChange",
        (payload: { videoTrack?: { size?: { width?: number; height?: number } | null } | null }) => {
          const height = payload?.videoTrack?.size?.height ?? null;
          if (height && height !== qualityRef.current.currentHeight) {
            emitQuality({ currentHeight: height });
          }
        }
      )
    );
    subscriptions.push(
      player.addListener("playingChange", (payload: { isPlaying?: boolean }) => {
        callbacks.current.onPlayingChange?.(!!payload?.isPlaying);
      })
    );
    subscriptions.push(
      player.addListener("playToEnd", () => {
        callbacks.current.onEnded?.();
      })
    );

    const poll = setInterval(() => {
      const position = Number.isFinite(player.currentTime) ? player.currentTime : 0;
      const rawDuration = player.duration;
      const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
      callbacks.current.onProgress?.(position, duration);
    }, PROGRESS_INTERVAL_MS);

    callbacks.current.onReady({
      play: () => {
        try {
          player.play();
        } catch (e) {
          console.warn("[player] play failed", e);
        }
      },
      pause: () => {
        try {
          player.pause();
        } catch (e) {
          console.warn("[player] pause failed", e);
        }
      },
      seek: (seconds: number) => {
        try {
          playerRef.current.currentTime = Math.max(0, seconds);
        } catch (e) {
          console.warn("[player] seek failed", e);
        }
      },
      setQuality: (height: number | null) => {
        if (height === null) {
          if (qualityRef.current.auto && activeUrlRef.current === masterUrlRef.current) return;
          manualHeightRef.current = null;
          emitQuality({ auto: true });
          if (activeUrlRef.current !== masterUrlRef.current) switchSource(masterUrlRef.current);
          return;
        }
        const target = matchLevel(qualityRef.current.levels, height);
        if (!target) return;
        manualHeightRef.current = target.height;
        emitQuality({ auto: false, currentHeight: target.height });
        if (target.url && activeUrlRef.current !== target.url) switchSource(target.url);
      },
      getCurrentTime: () => (Number.isFinite(player.currentTime) ? player.currentTime : 0),
      getDuration: () =>
        Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0,
      isPlaying: () => !!player.playing,
    });

    applySeek();

    return () => {
      clearInterval(poll);
      for (const subscription of subscriptions) {
        try {
          subscription.remove();
        } catch {
          // already detached
        }
      }
    };
  }, [player, startPosition, emitQuality, switchSource]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
      startsPictureInPictureAutomatically={false}
    />
  );
}

function WebEngine({
  url,
  startPosition = 0,
  onReady,
  onProgress,
  onPlayingChange,
  onEnded,
  onError,
  onQuality,
}: PlayerEngineProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekPendingRef = useRef(startPosition > 0);
  const lastEmitRef = useRef(0);
  const callbacks = useRef({ onReady, onProgress, onPlayingChange, onEnded, onError, onQuality });
  useEffect(() => {
    callbacks.current = { onReady, onProgress, onPlayingChange, onEnded, onError, onQuality };
  });

  const qualityRef = useRef<QualityState>(IDLE_QUALITY);
  const manualHeightRef = useRef<number | null>(null);
  const masterUrlRef = useRef(url);
  const activeUrlRef = useRef(url);
  const restoreRef = useRef<{ at: number; play: boolean } | null>(null);

  const emitQuality = useCallback((patch: Partial<QualityState>) => {
    qualityRef.current = { ...qualityRef.current, ...patch };
    callbacks.current.onQuality?.(qualityRef.current);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Fresh URL → fresh quality model.
    masterUrlRef.current = url;
    activeUrlRef.current = url;
    manualHeightRef.current = null;
    restoreRef.current = null;
    qualityRef.current = IDLE_QUALITY;
    callbacks.current.onQuality?.(IDLE_QUALITY);

    let hls: import("hls.js").default | null = null;

    const applyPendingSeek = () => {
      const restore = restoreRef.current;
      if (restore) {
        restoreRef.current = null;
        try {
          video.currentTime = restore.at;
        } catch {
          // metadata not ready; retried on later events
        }
        if (restore.play) video.play().catch(() => {});
        seekPendingRef.current = false;
        return;
      }
      if (!seekPendingRef.current) return;
      try {
        video.currentTime = startPosition;
        seekPendingRef.current = false;
      } catch {
        // metadata not ready; retried on later events
      }
    };

    const handleLoadedMetadata = () => {
      applyPendingSeek();
      if (qualityRef.current.levels.length > 0 || video.videoHeight <= 0) return;
      // Single-file source: one intrinsic level (the button stays hidden).
      emitQuality({
        levels: [
          {
            id: "source",
            height: video.videoHeight,
            width: video.videoWidth || null,
            bitrate: null,
            label: qualityLabel(video.videoHeight),
            url: null,
          },
        ],
        currentHeight: video.videoHeight,
      });
    };

    const handleTimeUpdate = () => {
      applyPendingSeek();
      const now = Date.now();
      if (now - lastEmitRef.current < PROGRESS_INTERVAL_MS) return;
      lastEmitRef.current = now;
      callbacks.current.onProgress?.(video.currentTime || 0, video.duration || 0);
    };
    const handlePlay = () => callbacks.current.onPlayingChange?.(true);
    const handlePause = () => callbacks.current.onPlayingChange?.(false);
    const handleEnded = () => callbacks.current.onEnded?.();
    const handleError = () =>
      callbacks.current.onError?.(
        (video.error as { message?: string } | null)?.message ?? "Playback failed"
      );

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);

    const replaceWebSource = (next: string) => {
      const at = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      if (!restoreRef.current) restoreRef.current = { at, play: !video.paused && !video.ended };
      activeUrlRef.current = next;
      video.src = next;
      video.load();
    };

    // Plain MP4/progressive: native element handles it. HLS: Safari plays
    // m3u8 natively, everyone else needs hls.js.
    const canPlayHlsNatively = !!video.canPlayType("application/vnd.apple.mpegurl");
    if (isHlsUrl(url) && !canPlayHlsNatively) {
      let hlsModule: typeof import("hls.js") | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        hlsModule = require("hls.js");
      } catch {
        hlsModule = null;
      }
      const HlsCtor = hlsModule?.default;
      if (HlsCtor && HlsCtor.isSupported()) {
        const hlsInstance = new HlsCtor();
        hls = hlsInstance;
        hlsInstance.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
          const levels = sortLevelsDesc(
            data.levels.map((level, index) => ({
              id: `hls-${index}`,
              height: level.height || null,
              width: null,
              bitrate: level.bitrate || null,
              label: qualityLabel(level.height || null),
              url: null,
            }))
          );
          emitQuality({ levels, auto: hlsInstance.autoLevelEnabled, currentHeight: null });
        });
        hlsInstance.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => {
          const level = hlsInstance.levels?.[data.level];
          emitQuality({
            auto: hlsInstance.autoLevelEnabled,
            currentHeight: level?.height ?? null,
          });
        });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(video);
      } else {
        callbacks.current.onError?.("HLS is not supported in this browser");
      }
    } else {
      video.src = url;
      if (isHlsUrl(url)) {
        // Safari plays HLS natively — parse the master ourselves for levels.
        fetch(url)
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
          .then((text) => {
            if (masterUrlRef.current !== url || qualityRef.current.levels.length > 0) return;
            const levels = parseMasterLevels(text, url);
            if (levels.length > 0) emitQuality({ levels });
          })
          .catch(() => {
            // CORS — the media element still plays without master access.
          });
      }
    }

    callbacks.current.onReady({
      play: () => {
        video.play().catch((e) => console.warn("[player] play failed", e));
      },
      pause: () => {
        video.pause();
      },
      seek: (seconds: number) => {
        try {
          video.currentTime = Math.max(0, seconds);
          seekPendingRef.current = false;
        } catch (e) {
          console.warn("[player] seek failed", e);
        }
      },
      setQuality: (height: number | null) => {
        if (hls) {
          if (height === null) {
            manualHeightRef.current = null;
            hls.currentLevel = -1;
            emitQuality({ auto: true });
            return;
          }
          const target = matchLevel(qualityRef.current.levels, height);
          if (!target) return;
          const index = Number.parseInt(target.id.slice(4), 10);
          if (Number.isNaN(index)) return;
          manualHeightRef.current = target.height;
          hls.currentLevel = index;
          emitQuality({ auto: false, currentHeight: target.height });
          return;
        }

        // Source-replaced switching (Safari HLS, progressive files).
        if (height === null) {
          if (qualityRef.current.auto && activeUrlRef.current === masterUrlRef.current) return;
          manualHeightRef.current = null;
          emitQuality({ auto: true });
          if (activeUrlRef.current !== masterUrlRef.current) replaceWebSource(masterUrlRef.current);
          return;
        }
        const target = matchLevel(qualityRef.current.levels, height);
        if (!target?.url) return;
        manualHeightRef.current = target.height;
        emitQuality({ auto: false, currentHeight: target.height });
        if (activeUrlRef.current !== target.url) replaceWebSource(target.url);
      },
      getCurrentTime: () => video.currentTime || 0,
      getDuration: () => (Number.isFinite(video.duration) ? video.duration : 0),
      isPlaying: () => !video.paused && !video.ended,
    });

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, startPosition, emitQuality]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
        }}
      />
    </View>
  );
}

export const PlayerEngine = Platform.OS === "web" ? WebEngine : NativeEngine;
