// Pure offline-download rules: which sources can be saved, local file
// naming, byte formatting, and manifest healing after restarts. Kept
// dependency free so node:test covers it (src/lib/downloads.test.mjs) — the
// downloads store imports these instead of reimplementing the rules.

import type { Movie } from "./types";

export type DownloadState = "downloading" | "ready" | "failed";

/**
 * One saved (or saving) title. Carries a full movie snapshot so the
 * downloads list and offline playback never need the network.
 */
export type DownloadEntry = {
  movieId: string;
  movie: Movie;
  state: DownloadState;
  /** 0..1 while transferring, 1 once ready. */
  progress: number;
  bytesDone: number;
  /** -1 when the server sent no Content-Length. */
  totalBytes: number;
  fileSizeBytes: number;
  /** Lowercase extension decided from the source URL. */
  ext: string;
  /** file:// URI once ready, else null. */
  uri: string | null;
  error: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
};

/** Progressive files only — HLS/DASH playlists are text manifests, not video. */
const DOWNLOADABLE_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv"];

/** Pathname with query string and hash stripped (presigned URLs carry both). */
export function urlPathname(url: string): string {
  const withoutHash = url.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  return withoutQuery;
}

/** Lowercase extension of the URL's path, or null when there is none. */
export function mediaExtension(url: string): string | null {
  const pathname = urlPathname(url);
  const segment = pathname.slice(pathname.lastIndexOf("/") + 1);
  const lastDot = segment.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === segment.length - 1) return null;
  const ext = segment.slice(lastDot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : null;
}

/** True when the URL points at a single progressive video file. */
export function isDownloadableUrl(url: string): boolean {
  const ext = mediaExtension(url);
  return ext !== null && DOWNLOADABLE_EXTENSIONS.includes(ext);
}

/** Deterministic on-disk name: <movieId>.<ext>. */
export function offlineFileName(movieId: string, url: string): string {
  return `${movieId}.${mediaExtension(url) ?? "bin"}`;
}

/** Human byte size, base 1024 ("512 B", "1.5 KB", "14.2 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exponent;
  const rendered =
    exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rendered} ${units[exponent]}`;
}

/** Drop manifest entries whose backing file no longer exists on disk. */
export function reconcileManifest(
  entries: Record<string, DownloadEntry>,
  exists: (movieId: string) => boolean
): Record<string, DownloadEntry> {
  const next: Record<string, DownloadEntry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.movieId === id && exists(id)) next[id] = entry;
  }
  return next;
}

/**
 * After a cold start no transfer is running: anything still marked
 * "downloading" becomes "failed" so the UI offers retry instead of a
 * permanently stuck progress bar.
 */
export function resetInterrupted(
  entries: Record<string, DownloadEntry>
): Record<string, DownloadEntry> {
  const next: Record<string, DownloadEntry> = {};
  for (const [id, entry] of Object.entries(entries)) {
    next[id] =
      entry.state === "downloading"
        ? { ...entry, state: "failed", error: "Download interrupted" }
        : entry;
  }
  return next;
}
