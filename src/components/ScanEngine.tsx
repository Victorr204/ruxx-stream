// Mounts the transcription engine document and shuttles messages between it
// and the scan store. Web uses a hidden same-origin <iframe>; native uses a
// WebView pointed at the deployed PWA's /transcribe route.

import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import type {
  EngineMessage,
  HostMessage,
} from "../lib/transcribe/types";
import { useScanStore } from "../stores/scan";

const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

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
        source={{ uri: `${SITE_URL}/transcribe` }}
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
