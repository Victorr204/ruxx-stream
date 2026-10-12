import { Platform } from "react-native";

// Desktop-shell detection. The Windows/macOS app (desktop/) wraps this same
// web bundle in Electron and injects `window.ruxxDesktop` through its preload
// script (contextBridge). Regular browsers, mobile and TV never see that
// global, so isDesktopShell() stays false everywhere the app already runs.
//
// The desktop app is a premium-only, ad-free surface: adsConfig disables
// every placement in the shell, and the player/movie screens gate Play and
// Download behind Premium (admins bypass — see useDesktopPremiumLock).

export type DesktopProgress = {
  movieId: string;
  bytesDone: number;
  /** -1 when the server sent no Content-Length. */
  totalBytes: number;
};

export type DesktopStartResult =
  | {
      ok: true;
      /** base64(wrapNonce || GCM-sealed file key) under the device key. */
      cipherKey: string;
      /** base64 8-byte nonce prefix for the record nonces. */
      cipherNonce: string;
      /** Sealed (.enc) file size on disk. */
      cipherBytes: number;
      /** Plain size of the source video. */
      plainBytes: number;
    }
  | { ok: false; code: "cancelled" | "http" | "error"; message?: string };

/** API the Electron preload exposes for offline downloads (main-process IO). */
export type DesktopDownloadsApi = {
  /** Stream `url` to disk and seal it (AES-256-GCM record format). */
  start: (movieId: string, url: string) => Promise<DesktopStartResult>;
  /** Abort an in-flight transfer/seal for this title. */
  cancel: (movieId: string) => void;
  /** Delete the sealed file (and any transient playback copy). */
  remove: (movieId: string) => Promise<void>;
  /** Which of these ids have a sealed file on disk. */
  listExists: (movieIds: string[]) => Promise<string[]>;
  /**
   * Decrypt to a transient copy; resolves to an app:// URL for <video>.
   * The cipher material comes straight from the renderer's manifest.
   */
  preparePlayback: (
    movieId: string,
    ext: string,
    cipher: { key: string; nonce: string; plainBytes: number }
  ) => Promise<string | null>;
  /** Wipe the transient decrypted copy. */
  releasePlayback: (movieId: string) => Promise<void>;
  /** Subscribe to transfer progress; returns an unsubscribe function. */
  onProgress: (listener: (progress: DesktopProgress) => void) => () => void;
};

export type DesktopBridge = {
  platform: "desktop";
  /** App version from the desktop build. */
  version: string;
  os: "windows" | "macos" | "other";
  downloads: DesktopDownloadsApi;
};

type DesktopWindow = Window & { ruxxDesktop?: DesktopBridge };

/** The Electron preload bridge, or null on every non-desktop surface. */
export function desktopBridge(): DesktopBridge | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const bridge = (window as DesktopWindow).ruxxDesktop;
  return bridge?.platform === "desktop" ? bridge : null;
}

/** True inside the installed Windows/macOS app. */
export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

/**
 * True when the premium-only desktop app must block this account from
 * playback: signed out, or signed in without an active premium window.
 * Admins bypass the gate (role is re-checked server-side too). Always
 * false off the desktop shell, where free streaming with ads is the model.
 */
export function desktopPremiumLocked(
  profile: { is_premium?: boolean; role?: "user" | "admin" } | null | undefined
): boolean {
  if (!isDesktopShell()) return false;
  if (profile?.role === "admin") return false;
  return !profile?.is_premium;
}
