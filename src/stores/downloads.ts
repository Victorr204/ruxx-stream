import { create } from "zustand";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  Directory,
  DownloadTask,
  File,
  FileMode,
  Paths,
  type FileHandle,
} from "expo-file-system";
import { grantDownload, resolveStreamUrl, revokeDownload } from "../lib/api";
import {
  aadFor,
  base64ToBytes,
  bytesToBase64,
  openFile,
  sealFile,
  unwrapFileKey,
  wrapFileKey,
  FILE_KEY_SIZE,
  FILE_NONCE_PREFIX_SIZE,
  WRAP_NONCE_SIZE,
} from "../lib/crypto";
import {
  isDownloadableUrl,
  mediaExtension,
  reconcileManifest,
  resetInterrupted,
  type CipherInfo,
  type DownloadEntry,
} from "../lib/downloads";
import type { Movie } from "../lib/types";
import { notifyDownloadReady } from "../lib/notifications";
import { useAuthStore } from "./auth";

// Offline downloads: entitlement lives in download_grants (RLS re-checks
// premium server-side), transfer state lives in a local manifest, and the
// video sits in the app sandbox under ruxx-downloads/ sealed with
// AES-256-GCM (src/lib/crypto.ts). The per-file key is wrapped with a
// device master key held in expo-secure-store, so the sandbox contents are
// useless without the keystore. Playback decrypts to a transient copy that
// is wiped when the player unmounts (expo-video cannot stream ciphertext).
//
// Web is unsupported: entry points gate on Platform.OS and the actions below
// no-op / report "unsupported".

const MANIFEST_KEY = "ruxx.downloads.v1";
const DIR_NAME = "ruxx-downloads";
const MASTER_KEY_ALIAS = "ruxx.stream.filekey.v1";
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
  /** Decrypt an entry's sealed file for playback; null when not ready. */
  prepareLocalPlayback: (movieId: string) => Promise<string | null>;
  /** Wipe the decrypted playback copy once the player goes away. */
  releaseLocalPlayback: (movieId: string) => Promise<void>;
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

function encryptedFile(movieId: string): File {
  return new File(Paths.document, DIR_NAME, `${movieId}.enc`);
}

function playbackFile(movieId: string, ext: string): File {
  return new File(Paths.document, DIR_NAME, `${movieId}.play.${ext}`);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch (e) {
    console.warn("[downloads] file delete failed", e);
  }
}

function deleteEntryFiles(movieId: string, entry: DownloadEntry | undefined): void {
  if (!entry) return;
  deleteQuietly(downloadsFile(movieId, entry.ext));
  deleteQuietly(encryptedFile(movieId));
  deleteQuietly(playbackFile(movieId, entry.ext));
}

function friendlyError(error: unknown): string {
  const raw = String((error as Error)?.message ?? error);
  if (/network|fetch|internet|timed?\s*out/i.test(raw)) return "Network error";
  if (/401|403|forbidden|row-level security/i.test(raw)) return "Not allowed";
  if ((error as Error)?.name === "AbortError") return "Cancelled";
  return raw.length > 140 ? `${raw.slice(0, 137)}…` : raw || "Download failed";
}

/** Device master key: random, sealed in the OS keystore (SecureStore). */
async function getOrCreateMasterKey(): Promise<Uint8Array> {
  const packed = await SecureStore.getItemAsync(MASTER_KEY_ALIAS);
  if (packed) return base64ToBytes(packed);
  const key = Crypto.getRandomBytes(FILE_KEY_SIZE);
  await SecureStore.setItemAsync(MASTER_KEY_ALIAS, bytesToBase64(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

type RecordTransfer = {
  mode: "seal" | "open";
  src: File;
  dst: File;
  plainBytes: number;
  /** Required for "open": the sealed file's size. */
  cipherBytes?: number;
  fileKey: Uint8Array;
  noncePrefix: Uint8Array;
  movieId: string;
  onProgress?: (fraction: number) => void;
};

/** Stream records between two files via chunked FileHandles. */
async function transferRecords(args: RecordTransfer): Promise<void> {
  const { mode, src, dst, plainBytes, fileKey, noncePrefix, movieId } = args;
  const cipherBytes = args.cipherBytes ?? 0;
  if (mode === "open" && !(cipherBytes > 0)) throw new Error("Offline file is missing");

  deleteQuietly(dst);
  dst.create({ intermediates: true });

  const srcHandle: FileHandle = src.open(FileMode.ReadOnly);
  const dstHandle: FileHandle = dst.open(FileMode.WriteOnly);
  try {
    const source = { read: (length: number) => srcHandle.readBytes(length) };
    const sink = { write: (chunk: Uint8Array) => dstHandle.writeBytes(chunk) };
    const shared = {
      source,
      sink,
      plainBytes,
      fileKey,
      noncePrefix,
      aad: aadFor(movieId),
      onProgress: args.onProgress,
      shouldAbort: () => cancelRequests.has(movieId),
    };
    if (mode === "seal") {
      await sealFile(shared);
    } else {
      await openFile({ ...shared, cipherBytes });
    }
  } finally {
    srcHandle.close();
    dstHandle.close();
  }
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

  /** Seal a completed plaintext download into its .enc file. */
  const sealEntry = async (movieId: string, ext: string): Promise<StartDownloadResult> => {
    const plain = downloadsFile(movieId, ext);
    const enc = encryptedFile(movieId);
    try {
      if (!plain.exists) throw new Error("Downloaded file is missing");
      const plainBytes = plain.size;
      if (!(plainBytes > 0)) throw new Error("Downloaded file is empty");

      downloadsDirectory().create({ idempotent: true });
      const masterKey = await getOrCreateMasterKey();
      const fileKey = Crypto.getRandomBytes(FILE_KEY_SIZE);
      const noncePrefix = Crypto.getRandomBytes(FILE_NONCE_PREFIX_SIZE);
      const cipher: CipherInfo = {
        key: wrapFileKey(masterKey, fileKey, Crypto.getRandomBytes(WRAP_NONCE_SIZE)),
        nonce: bytesToBase64(noncePrefix),
      };

      await transferRecords({
        mode: "seal",
        src: plain,
        dst: enc,
        plainBytes,
        fileKey,
        noncePrefix,
        movieId,
        onProgress: (fraction) => {
          const entry = get().entries[movieId];
          if (!entry) return;
          const now = Date.now();
          if (now - Date.parse(entry.updatedAt) < PROGRESS_THROTTLE_MS) return;
          patch(movieId, { progress: fraction });
        },
      });

      if (!get().entries[movieId] || cancelRequests.has(movieId)) {
        deleteQuietly(enc);
        return { ok: false, reason: "cancelled" };
      }

      deleteQuietly(plain); // plaintext is gone the moment the seal succeeds
      const readyEntry = get().entries[movieId];
      patch(movieId, {
        state: "ready",
        progress: 1,
        bytesDone: plainBytes,
        totalBytes: plainBytes,
        fileSizeBytes: plainBytes,
        uri: enc.uri,
        encrypted: true,
        cipher,
        plainUri: null,
        error: null,
      });
      void notifyDownloadReady(readyEntry?.movie?.title ?? "Your download");
      return { ok: true };
    } catch (e) {
      deleteQuietly(enc);
      const current = get().entries[movieId];
      if (!current) {
        // Cancelled/removed mid-seal — plaintext (if any) was cleaned up too.
        return { ok: false, reason: "cancelled" };
      }
      // Keep the plaintext: a retry re-seals without re-downloading.
      patch(movieId, { state: "failed", error: friendlyError(e) });
      void revokeDownload(movieId);
      return { ok: false, reason: "error", message: friendlyError(e) };
    }
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
            return !!entry.uri && new File(entry.uri).exists;
          } catch {
            return false;
          }
        });
        entries = resetInterrupted(entries);

        // Cold start: no player is alive, so any decrypted copy is a stray.
        for (const [id, entry] of Object.entries(entries)) {
          if (!entry.plainUri) continue;
          deleteQuietly(playbackFile(id, entry.ext));
          entries = { ...entries, [id]: { ...entry, plainUri: null } };
        }

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
      if (existing?.state === "downloading" || existing?.state === "encrypting") {
        return { ok: false, reason: "busy" };
      }
      if (activeTasks.has(movie.id)) return { ok: false, reason: "busy" };
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

      // A failed seal keeps completed plaintext (bytesDone === totalBytes):
      // re-seal it instead of spending the user's bandwidth again.
      const current = get().entries[movie.id];
      const reusable =
        current &&
        current.state === "failed" &&
        !current.cipher &&
        current.totalBytes > 0 &&
        current.bytesDone === current.totalBytes &&
        downloadsFile(movie.id, current.ext).exists;
      if (reusable && current) {
        patch(movie.id, { state: "encrypting", progress: 0, error: null });
        return sealEntry(movie.id, current.ext);
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
            encrypted: false,
            plainUri: null,
          },
        },
      });
      persist(get().entries);

      try {
        downloadsDirectory().create({ idempotent: true });
        const target = downloadsFile(movie.id, ext);
        // DownloadTask has no idempotent option — clear leftovers ourselves.
        deleteQuietly(target);
        deleteQuietly(encryptedFile(movie.id));

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
          state: "encrypting",
          progress: 0,
          bytesDone: result.size,
          totalBytes: result.size,
          fileSizeBytes: result.size,
          uri: null,
          error: null,
        });
        return sealEntry(movie.id, ext);
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
        deleteQuietly(encryptedFile(movie.id));
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
      if (entry && (entry.state === "downloading" || entry.state === "encrypting")) {
        deleteEntryFiles(movieId, entry);
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
      deleteEntryFiles(movieId, entry);

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

    prepareLocalPlayback: async (movieId) => {
      if (Platform.OS === "web") return null;
      const entry = get().entries[movieId];
      if (!entry || entry.state !== "ready" || !entry.uri) return null;
      if (!entry.cipher) return entry.uri; // legacy pre-encryption entry

      const play = playbackFile(movieId, entry.ext);
      if (entry.plainUri && play.exists) return play.uri;

      const source = new File(entry.uri);
      if (!source.exists) throw new Error("Offline file is missing");

      const masterKey = await getOrCreateMasterKey();
      const fileKey = unwrapFileKey(masterKey, entry.cipher.key);
      const noncePrefix = base64ToBytes(entry.cipher.nonce);

      downloadsDirectory().create({ idempotent: true });
      await transferRecords({
        mode: "open",
        src: source,
        dst: play,
        plainBytes: entry.fileSizeBytes,
        cipherBytes: source.size,
        fileKey,
        noncePrefix,
        movieId,
      });

      if (!get().entries[movieId]) {
        deleteQuietly(play);
        return null;
      }
      patch(movieId, { plainUri: play.uri });
      return play.uri;
    },

    releaseLocalPlayback: async (movieId) => {
      const entry = get().entries[movieId];
      if (!entry?.plainUri) return;
      deleteQuietly(playbackFile(movieId, entry.ext));
      if (get().entries[movieId]) patch(movieId, { plainUri: null });
    },
  };
});
