// Mounts the transcription engine document and shuttles messages between it
// and the scan store. Web uses a hidden same-origin <iframe>; native uses a
// WebView pointed at the deployed PWA's /transcribe route.

import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import "react-native-url-polyfill/auto";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";
import type {
  EngineMessage,
  HostMessage,
} from "../lib/transcribe/types";
import { useScanStore } from "../stores/scan";

const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";

// EXPO_PUBLIC_SITE_URL is a dev origin (http://localhost:8081) — correct in a
// browser and on the iOS simulator, but on a phone "localhost" is the phone
// itself, so the WebView fails with net::ERR_CONNECTION_REFUSED. Rewrite
// loopback origins to the host Metro reports it is reachable on (LAN IP of
// this machine on a device, 10.0.2.2 from the Android emulator).
function resolveNativeOrigin(): string {
  if (!SITE_URL) {
    console.warn("[scan] EXPO_PUBLIC_SITE_URL is not set; the transcription engine cannot start");
    return "";
  }
  let origin: URL;
  try {
    origin = new URL(SITE_URL);
  } catch {
    console.warn("[scan] EXPO_PUBLIC_SITE_URL is not a URL:", SITE_URL);
    return "";
  }
  if (!isLoopback(origin.hostname)) return origin.origin;

  // Metro's own address for this session: the machine's LAN IP on a device,
  // 10.0.2.2 / 127.0.0.1 from the Android emulator. A loopback address from
  // there is still the phone, so on Android always fall back to the
  // emulator's alias for the host machine (the iOS simulator is already
  // on the host, so it keeps the configured localhost).
  const [metroHost, metroPort] = (Constants.expoConfig?.hostUri ?? "").split(":");
  const host = metroHost && !isLoopback(metroHost)
    ? metroHost
    : Platform.OS === "android"
      ? "10.0.2.2"
      : "";
  if (!host) return origin.origin;
  origin.hostname = host;
  if (metroPort) origin.port = metroPort;
  return origin.origin;
}

const NATIVE_ORIGIN = Platform.OS === "web" ? "" : resolveNativeOrigin();

function parseEngineMessage(raw: unknown): EngineMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as EngineMessage;
    return value && typeof value === "object" && "type" in value ? value : null;
  } catch {
    return null;
  }
}

export default function ScanEngine() {
  const status = useScanStore((s) => s.status);
  const movieId = useScanStore((s) => s.movieId);
  const url = useScanStore((s) => s.url);
  const handleMessage = useScanStore((s) => s.handleMessage);
  const [engineReady, setEngineReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const viewRef = useRef<WebView | null>(null);
  const previousStatus = useRef(status);

  const post = (message: HostMessage): void => {
    if (Platform.OS === "web") {
      frameRef.current?.contentWindow?.postMessage(message, "*");
    } else {
      viewRef.current?.postMessage(JSON.stringify(message));
    }
  };

  // Incoming messages (both platforms funnel into handleMessage).
  useEffect(() => {
    if (Platform.OS === "web") {
      const onWindowMessage = (event: MessageEvent): void => {
        if (event.source !== frameRef.current?.contentWindow) return;
        const message = parseEngineMessage(event.data);
        if (!message) return;
        if (message.type === "ready") setEngineReady(true);
        handleMessage(message);
      };
      window.addEventListener("message", onWindowMessage);
      return () => window.removeEventListener("message", onWindowMessage);
    }
    return undefined;
  }, [handleMessage]);

  const onNativeMessage = (event: { nativeEvent?: { data?: string } }): void => {
    const message = parseEngineMessage(event.nativeEvent?.data);
    if (!message) return;
    if (message.type === "ready") setEngineReady(true);
    handleMessage(message);
  };

  // Start when the engine is listening and the media URL is resolved.
  useEffect(() => {
    if (status !== "starting" || !engineReady || !movieId || !url) return;
    post({ type: "start", movie_id: movieId, url });
  }, [status, engineReady, movieId, url]);

  // Cancel as soon as the store leaves an active state. The engine document
  // stays alive (its listener survives), so `engineReady` never resets here.
  useEffect(() => {
    const wasActive = ["starting", "running", "saving"].includes(previousStatus.current);
    const isActive = ["starting", "running", "saving"].includes(status);
    if (wasActive && !isActive && previousStatus.current !== "saved") {
      post({ type: "cancel" });
    }
    previousStatus.current = status;
  }, [status]);

  if (Platform.isTV) return null;
  if (Platform.OS !== "web" && !NATIVE_ORIGIN) return null;
  if (status === "idle" && !engineReady) {
    // Nothing running: keep web warm with the hidden frame, skip native mount.
    if (Platform.OS !== "web") return null;
  }

  if (Platform.OS === "web") {
    if (typeof document === "undefined") return null;
    return (
      <iframe
        ref={frameRef}
        src={`${window.location.origin}/transcribe`}
        title="Subtitle scanner"
        style={styles.frame}
        aria-hidden="true"
        tabIndex={-1}
      />
    );
  }

  return (
    <View style={styles.native} pointerEvents="none">
      <WebView
        ref={viewRef}
        source={{ uri: `${NATIVE_ORIGIN}/transcribe` }}
        onMessage={onNativeMessage}
        originWhitelist={["*"]}
        style={styles.webview}
        containerStyle={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: "fixed",
    left: -2000,
    top: 0,
    width: 320,
    height: 180,
    border: "none",
    opacity: 0.01,
  } as never,
  native: {
    position: "absolute",
    left: -4000,
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  webview: {
    width: 1,
    height: 1,
  },
});
