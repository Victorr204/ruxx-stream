// Host-side state machine for the in-app subtitle scanner. The engine runs
// in a separate document (iframe / WebView) — ScanEngine pipes its messages
// in here, and SubtitleSheet renders whatever this store says.

import { create } from "zustand";
import { Platform } from "react-native";
import { resolveScanUrl, saveGeneratedTranscript } from "../lib/api";
import {
  detectLanguageLocally,
  normalizeDetectedLanguage,
} from "../lib/subtitles";
import type { EngineMessage } from "../lib/transcribe/types";
import { useAuthStore } from "./auth";

export type ScanStatus =
  | "idle"
  | "starting"
  | "running"
  | "saving"
  | "saved"
  | "error";

type ScanState = {
  status: ScanStatus;
  movieId: string | null;
  /** Presigned media URL, present while a start message should be posted. */
  url: string | null;
  progress: EngineMessage | null;
  error: string | null;
  /** Bumped after every successful save so the sheet reloads its rows. */
  savedToken: number;
  start: (movieId: string) => Promise<void>;
  handleMessage: (message: EngineMessage) => void;
  cancel: () => void;
  reset: () => void;
};

const messageText = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

export const useScanStore = create<ScanState>((set, get) => ({
  status: "idle",
  movieId: null,
  url: null,
  progress: null,
  error: null,
  savedToken: 0,

  start: async (movieId) => {
    if (Platform.isTV) return;
    if (get().status === "starting" || get().status === "running") return;
    if (!useAuthStore.getState().session) {
      set({
        status: "error",
        movieId,
        error: "Sign in to scan this movie",
        progress: null,
      });
      return;
    }
    set({ status: "starting", movieId, url: null, error: null, progress: null });
    try {
      const url = await resolveScanUrl(movieId);
      // A cancel during resolution leaves status idle; don't resurrect it.
      if (get().status !== "starting") return;
      set({ url });
    } catch (error) {
      if (get().status !== "starting") return;
      set({ status: "error", error: messageText(error) });
    }
  },

  handleMessage: (message) => {
    const state = get();
    if (message.type === "ready") return;
    if (message.type === "progress") {
      if (state.status !== "starting" && state.status !== "running") return;
      set({ status: "running", progress: message });
      return;
    }
    if (message.type === "error") {
      if (message.message === "cancelled") {
        if (state.status === "starting" || state.status === "running" || state.status === "saving") {
          set({ status: "idle", progress: null, url: null });
        }
        return;
      }
      set({ status: "error", error: message.message, progress: null, url: null });
      return;
    }
    if (message.type !== "done") return;
    if (!state.movieId) {
      set({ status: "error", error: "Scan finished out of sync" });
      return;
    }
    set({ status: "saving", progress: null });
    void (async () => {
      const movieId = state.movieId!;
      let language = message.language;
      if (!language) {
        language = normalizeDetectedLanguage(detectLanguageLocally(message.sample)) ?? "";
      }
      if (!language) {
        set({
          status: "error",
          error: "Speech found, but its language could not be identified",
        });
        return;
      }
      try {
        await saveGeneratedTranscript({
          movieId,
          language,
          detected: message.language || language,
          cues: message.cues,
        });
        if (get().movieId !== movieId) return;
        set((current) => ({
          status: "saved",
          url: null,
          error: null,
          progress: null,
          savedToken: current.savedToken + 1,
        }));
      } catch (error) {
        if (get().movieId !== movieId) return;
        set({ status: "error", error: messageText(error), url: null, progress: null });
      }
    })();
  },

  cancel: () => {
    const status = get().status;
    if (status === "idle" || status === "saved") return;
    set({ status: "idle", url: null, progress: null, error: null });
  },

  reset: () => {
    set({ status: "idle", movieId: null, url: null, progress: null, error: null });
  },
}));
