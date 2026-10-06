import { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

// Playback engine behind the player screen. Native renders expo-video
// (ExoPlayer/AVPlayer handle HLS); web renders a <video> with hls.js. Both
// expose the same imperative handle through onReady, so the screen talks to
// one API: play/pause/seek/getters.

export type PlayerHandle = {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
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
};

const PROGRESS_INTERVAL_MS = 500;

function NativeEngine({
  url,
  startPosition = 0,
  onReady,
  onProgress,
  onPlayingChange,
  onEnded,
  onError,
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

  const callbacks = useRef({ onReady, onProgress, onPlayingChange, onEnded, onError });
  useEffect(() => {
    callbacks.current = { onReady, onProgress, onPlayingChange, onEnded, onError };
  });

  useEffect(() => {
    const subscriptions: { remove: () => void }[] = [];
    let seekApplied = startPosition <= 0;

    const applySeek = () => {
      if (seekApplied) return;
      try {
        playerRef.current.currentTime = startPosition;
        seekApplied = true;
      } catch {
        // not ready yet; retried on the next status change
      }
    };

    subscriptions.push(
      player.addListener("statusChange", (payload: { status?: string; error?: unknown }) => {
        if (payload?.status === "readyToPlay") applySeek();
        if (payload?.status === "error") {
          const message =
            (payload.error as { message?: string } | undefined)?.message ?? "Playback failed";
          callbacks.current.onError?.(message);
        }
      })
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
  }, [player, startPosition]);

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

function isHlsUrl(url: string): boolean {
  return url.includes(".m3u8");
}

function WebEngine({
  url,
  startPosition = 0,
  onReady,
  onProgress,
  onPlayingChange,
  onEnded,
  onError,
}: PlayerEngineProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekPendingRef = useRef(startPosition > 0);
  const lastEmitRef = useRef(0);
  const callbacks = useRef({ onReady, onProgress, onPlayingChange, onEnded, onError });
  useEffect(() => {
    callbacks.current = { onReady, onProgress, onPlayingChange, onEnded, onError };
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: import("hls.js").default | null = null;

    const applyPendingSeek = () => {
      if (!seekPendingRef.current) return;
      try {
        video.currentTime = startPosition;
        seekPendingRef.current = false;
      } catch {
        // metadata not ready; retried on later events
      }
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
    video.addEventListener("loadedmetadata", applyPendingSeek);

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
        hls = new HlsCtor();
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        callbacks.current.onError?.("HLS is not supported in this browser");
      }
    } else {
      video.src = url;
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
      video.removeEventListener("loadedmetadata", applyPendingSeek);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [url, startPosition]);

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
