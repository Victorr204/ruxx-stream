import { create } from "zustand";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { Directory, DownloadTask, File, Paths } from "expo-file-system";
import { grantDownload, resolveStreamUrl, revokeDownload } from "../lib/api";
import {
  isDownloadableUrl,
  mediaExtension,
  reconcileManifest,
  resetInterrupted,
  type DownloadEntry,
} from "../lib/downloads";
import type { Movie } from "../lib/types";
import { useAuthStore } from "./auth";

// Offline downloads: entitlement lives in download_grants (RLS re-checks
// premium server-side), transfer state lives in a local manifest, and the
// video itself sits in the app sandbox under ruxx-downloads/. The manifest is
// the UI's source of truth — grants are never read back for display, so a
// grant without a file (crash between insert and transfer) is harmless.
//
// Web is unsupported: entry points gate on Platform.OS and the actions below
// no-op / report "unsupported".

const MANIFEST_KEY = "ruxx.downloads.v1";
const DIR_NAME = "ruxx-downloads";
const PROGRESS_THROTTLE_MS = 250;

export type StartDownloadResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unsupported"
        | "premium-required"
        | "streaming-only"
        | "offline"
        | "error"
        | "busy"
        | "cancelled";
      message?: string;
    };

type DownloadsState = {
  entries: Record<string, DownloadEntry>;
  initialized: boolean;
  initialize: () => Promise<void>;
  startDownload: (movie: Movie) => Promise<StartDownloadResult>;
  cancelDownload: (movieId: string) => Promise<void>;
  removeDownload: (movieId: string) => Promise<void>;
  getLocalUri: (movieId: string) => string | null;
  getEntry: (movieId: string) => DownloadEntry | undefined;
};

/** In-flight transfers; not reactive state (progress flows through patch()). */
const activeTasks = new Map<string, DownloadTask>();
/** Set when the user cancels/removes while a startDownload is between awaits. */
const cancelRequests = new Set<string>();
/** Serialises manifest writes so concurrent patches never clobber each other. */
let persistChain: Promise<void> = Promise.resolve();

function persist(entries: Record<string, DownloadEntry>): void {
  persistChain = persistChain
    .then(() => AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(entries)))
    .catch((e) => console.warn("[downloads] manifest save failed", e));
}

function downloadsDirectory(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

function downloadsFile(movieId: string, ext: string): File {
  return new File(Paths.document, DIR_NAME, `${movieId}.${ext}`);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (e) {
    console.warn("[downloads] file delete failed", e);
  }
}

function friendlyError(error: unknown): string {
  const raw = String((error as Error)?.message ?? error);
  if (/network|fetch|internet|timed?\s*out/i.test(raw)) return "Network error";
  if (/401|403|forbidden|row-level security/i.test(raw)) return "Not allowed";
  return raw.length > 140 ? `${raw.slice(0, 137)}…` : raw || "Download failed";
}

export const useDownloadsStore = create<DownloadsState>((set, get) => {
  const patch = (movieId: string, changes: Partial<DownloadEntry>) => {
    const current = get().entries[movieId];
    if (!current) return;
    const entries = {
      ...get().entries,
      [movieId]: { ...current, ...changes, updatedAt: new Date().toISOString() },
    };
    set({ entries });
    persist(entries);
  };

  return {
    entries: {},
    initialized: false,

    initialize: async () => {
      if (get().initialized) return;
      if (Platform.OS === "web") {
        set({ initialized: true });
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(MANIFEST_KEY);
        let entries: Record<string, DownloadEntry> = {};
        if (raw) entries = JSON.parse(raw) as Record<string, DownloadEntry>;

        entries = reconcileManifest(entries, (id) => {
          const entry = entries[id];
          if (!entry) return false;
          if (entry.state !== "ready") return true; // retryable, no file required
          try {
            return downloadsFile(id, entry.ext).exists && !!entry.uri;
          } catch {
            return false;
          }
        });
        entries = resetInterrupted(entries);

        set({ entries, initialized: true });
        persist(entries);
      } catch (e) {
        console.warn("[downloads] manifest load failed", e);
        set({ entries: {}, initialized: true });
      }
    },

    startDownload: async (movie) => {
      if (Platform.OS === "web") return { ok: false, reason: "unsupported" };

      cancelRequests.delete(movie.id);
      const existing = get().entries[movie.id];
      if (existing?.state === "downloading" || activeTasks.has(movie.id)) {
        return { ok: false, reason: "busy" };
      }
      if (existing?.state === "ready" && existing.uri) return { ok: true };

      const profile = useAuthStore.getState().profile;
      if (!profile?.is_premium) return { ok: false, reason: "premium-required" };

      const net = await NetInfo.fetch();
      if (net.isConnected === false) return { ok: false, reason: "offline" };

      // Entitlement first: the insert policy re-validates premium server-side.
      try {
        await grantDownload(movie.id);
      } catch (e) {
        const message = friendlyError(e);
        if (/not allowed|premium|row-level security/i.test(message)) {
          return { ok: false, reason: "premium-required", message };
        }
        return { ok: false, reason: "error", message };
      }
      if (cancelRequests.has(movie.id)) {
        cancelRequests.delete(movie.id);
        void revokeDownload(movie.id);
        return { ok: false, reason: "cancelled" };
      }

      const source = await resolveStreamUrl(movie.id).catch(() => null);
      if (cancelRequests.has(movie.id)) {
        cancelRequests.delete(movie.id);
        void revokeDownload(movie.id);
        return { ok: false, reason: "cancelled" };
      }
      if (!source) {
        void revokeDownload(movie.id);
        return { ok: false, reason: "error", message: "Could not resolve a source URL." };
      }
      if (!isDownloadableUrl(source.url)) {
        void revokeDownload(movie.id);
        return { ok: false, reason: "streaming-only" };
      }

      const ext = mediaExtension(source.url) ?? "bin";
      set({
        entries: {
          ...get().entries,
          [movie.id]: {
            movieId: movie.id,
            movie,
            state: "downloading",
            progress: 0,
            bytesDone: 0,
            totalBytes: -1,
            fileSizeBytes: 0,
            ext,
            uri: null,
            error: null,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      persist(get().entries);

      try {
        downloadsDirectory().create({ idempotent: true });
        const target = downloadsFile(movie.id, ext);
        // DownloadTask has no idempotent option — clear leftovers ourselves.
        deleteQuietly(target);

        const task = new DownloadTask(source.url, target, {
          onProgress: (progress) => {
            const now = Date.now();
            const entry = get().entries[movie.id];
            if (!entry) return;
            if (now - Date.parse(entry.updatedAt) < PROGRESS_THROTTLE_MS) return;
            patch(movie.id, {
              bytesDone: progress.bytesWritten,
              totalBytes: progress.totalBytes,
              progress:
                progress.totalBytes > 0
                  ? Math.min(1, progress.bytesWritten / progress.totalBytes)
                  : 0,
            });
          },
        });
        activeTasks.set(movie.id, task);

        const result = await task.downloadAsync();
        activeTasks.delete(movie.id);

        if (!result) throw new Error("Download did not complete");
        if (!get().entries[movie.id]) {
          // Cancelled while finishing — the earlier delete may have raced
          // the native write, so clear whatever landed on disk.
          deleteQuietly(result);
          void revokeDownload(movie.id);
          return { ok: false, reason: "cancelled" };
        }

        patch(movie.id, {
          state: "ready",
          progress: 1,
          bytesDone: result.size,
          totalBytes: result.size,
          fileSizeBytes: result.size,
          uri: result.uri,
          error: null,
        });
        return { ok: true };
      } catch (e) {
        activeTasks.delete(movie.id);
        const current = get().entries[movie.id];
        if (!current) {
          // removeDownload/cancelDownload already tore the entry down; the
          // native transfer may have written past their delete — retry once.
          deleteQuietly(downloadsFile(movie.id, ext));
          return { ok: false, reason: "cancelled" };
        }
        // Android streams straight into the destination — clear partial files.
        deleteQuietly(downloadsFile(movie.id, current.ext));
        patch(movie.id, { state: "failed", error: friendlyError(e) });
        void revokeDownload(movie.id);
        return { ok: false, reason: "error", message: friendlyError(e) };
      }
    },

    cancelDownload: async (movieId) => {
      cancelRequests.add(movieId);
      const entry = get().entries[movieId];

      const task = activeTasks.get(movieId);
      if (task) {
        activeTasks.delete(movieId);
        try {
          task.cancel();
        } catch (e) {
          console.warn("[downloads] cancel failed", e);
        }
      }
      if (entry && entry.state === "downloading") {
        deleteQuietly(downloadsFile(movieId, entry.ext));
        const entries = { ...get().entries };
        delete entries[movieId];
        set({ entries });
        persist(entries);
        void revokeDownload(movieId);
      }
    },

    removeDownload: async (movieId) => {
      cancelRequests.add(movieId);
      const entry = get().entries[movieId];

      const task = activeTasks.get(movieId);
      if (task) {
        activeTasks.delete(movieId);
        try {
          task.cancel();
        } catch (e) {
          console.warn("[downloads] cancel failed", e);
        }
      }
      if (entry) deleteQuietly(downloadsFile(movieId, entry.ext));

      const entries = { ...get().entries };
      delete entries[movieId];
      set({ entries });
      persist(entries);
      void revokeDownload(movieId);
    },

    getLocalUri: (movieId) => {
      const entry = get().entries[movieId];
      return entry?.state === "ready" ? entry.uri : null;
    },

    getEntry: (movieId) => get().entries[movieId],
  };
});
