// Web-only transcription engine page. It is loaded in a hidden iframe (or a
// native WebView pointed at the deployed origin) and does no rendering work
// for the app itself: the host posts `start`, this page runs the scan and
// streams `progress` / `done` / `error` messages back.

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { runScan } from "../src/lib/transcribe/engine";
import type { EngineMessage, HostMessage } from "../src/lib/transcribe/types";

export default function TranscribePage() {
  const [status, setStatus] = useState("Waiting for a scan…");
  const [percent, setPercent] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const post = (message: EngineMessage): void => {
    const native = (
      window as unknown as {
        ReactNativeWebView?: { postMessage: (value: string) => void };
      }
    ).ReactNativeWebView;
    if (native) {
      native.postMessage(JSON.stringify(message));
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, "*");
    }
    if (message.type === "progress") {
      setPercent(message.percent);
      setStatus(message.detail);
    } else if (message.type === "error") {
      setStatus(message.message);
    } else if (message.type === "done") {
      setStatus("Done");
      setPercent(100);
    }
  };

  useEffect(() => {
    const handle = (event: Event): void => {
      const raw =
        (event as MessageEvent).data ??
        (event as unknown as { nativeEvent?: { data?: string } }).nativeEvent?.data;
      if (!raw) return;
      let message: HostMessage & { movie_id?: string; url?: string };
      try {
        message = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return;
      }
      if (message.type === "cancel") {
        controllerRef.current?.abort();
        return;
      }
      if (message.type !== "start" || !message.movie_id || !message.url) return;
      if (runningRef.current) {
        controllerRef.current?.abort();
      }
      runningRef.current = true;
      const controller = new AbortController();
      controllerRef.current = controller;
      runScan({
        movieId: message.movie_id,
        mediaUrl: message.url,
        emit: post,
        signal: controller.signal,
      }).finally(() => {
        runningRef.current = false;
      });
    };
    window.addEventListener("message", handle);
    document.addEventListener("message", handle);
    // Tell the host we exist and are listening before it can post `start`.
    queueMicrotask(() => post({ type: "ready" }));
    return () => {
      window.removeEventListener("message", handle);
      document.removeEventListener("message", handle);
      controllerRef.current?.abort();
    };
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>ruxx audio scan</Text>
      <Text style={styles.status}>{status}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0b0b0f",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    color: "#8b8b96",
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  status: {
    color: "#f2f2f5",
    fontSize: 15,
    textAlign: "center",
  },
  track: {
    width: "100%",
    maxWidth: 360,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#23232b",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#7c5cff",
  },
});
