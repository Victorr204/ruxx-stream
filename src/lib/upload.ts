import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { File, UploadType } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { getSupabase } from "./supabase";
import {
  canCompressVideo,
  cancelCompression,
  compressVideo,
  formatBitrate,
  planCompression,
  probeVideo,
  type CompressionPlan,
  type VideoProbe,
} from "./compress";
import { formatBytes } from "./downloads";

// Admin video upload pipeline: pick a movie file, probe it, run the
// client-side compression plan (native only), ask the r2-upload-ticket edge
// function for a presigned PUT, stream the bytes to Backblaze B2 with
// progress, and hand the object key back so the movie row can reference it.

export type UploadedVideo = {
  key: string;
  name: string;
  originalBytes: number;
  outputBytes: number;
  compressed: boolean;
  durationSeconds: number;
  plan: CompressionPlan;
  compressionWarning?: string;
};

export type UploadStage = "probing" | "compressing" | "uploading";

export type UploadProgressEvent = {
  stage: UploadStage;
  fraction: number;
  label: string;
  bytesDone?: number;
  totalBytes?: number;
};

export type PickVideoOptions = {
  compress?: boolean;
  onProgress?: (event: UploadProgressEvent) => void;
  onProbed?: (durationSeconds: number) => void;
};

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

export function isUploadCancelled(error: unknown): boolean {
  if (error instanceof UploadCancelledError) return true;
  return error instanceof Error && (error.name === "AbortError" || error.name === "UploadCancelledError");
}

type ActiveJob = {
  cancelled: boolean;
  cancel?: () => void;
};

let activeJob: ActiveJob | null = null;

export function cancelActiveUpload(): void {
  const job = activeJob;
  if (!job) return;
  job.cancelled = true;
  try {
    job.cancel?.();
  } catch {
    // best effort — stage guard marks the run cancelled regardless
  }
}

// Canonical types/extensions — mirrors the r2-upload-ticket allow-list so a
// misreported picker mimeType falls back to the extension.
const EXT_CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  m3u8: "application/x-mpegURL",
};
const ALLOWED_TYPES = new Set(Object.values(EXT_CONTENT_TYPES));

const MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "application/x-mpegURL": "m3u8",
};

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  return cleaned || "upload.mp4";
}

function normalizeFile(
  name: string,
  mimeType?: string | null
): { name: string; contentType: string } | null {
  let safeName = sanitizeName(name);
  const ext = safeName.includes(".") ? (safeName.split(".").pop() ?? "").toLowerCase() : "";
  if (!ext) {
    const fallback = mimeType ? MIME_EXTENSIONS[mimeType] : undefined;
    if (fallback) safeName = `${safeName}.${fallback}`;
  }
  const finalExt = safeName.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXT_CONTENT_TYPES[finalExt];
  if (!byExt) return null;
  const contentType = mimeType && ALLOWED_TYPES.has(mimeType) ? mimeType : byExt;
  return { name: safeName, contentType };
}

function withExtension(name: string, extension: string): string {
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${base}.${extension}`;
}

function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

async function deleteQuietly(uri: string): Promise<void> {
  try {
    await FileSystemLegacy.deleteAsync(uri, { idempotent: true });
  } catch {
    // temp cleanup only
  }
}

async function fileSizeOf(uri: string): Promise<number> {
  try {
    const info = await FileSystemLegacy.getInfoAsync(uri);
    if (info.exists && "size" in info && typeof info.size === "number") return info.size;
  } catch {
    // fall through to the estimate
  }
  return 0;
}

async function requestTicket(
  filename: string,
  contentType: string
): Promise<{ uploadUrl: string; key: string }> {
  const { data, error } = await getSupabase().functions.invoke("r2-upload-ticket", {
    body: { filename, content_type: contentType },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(String(data.error));
  if (typeof data?.upload_url !== "string" || typeof data?.key !== "string") {
    throw new Error("Could not prepare the upload — try again.");
  }
  return { uploadUrl: data.upload_url, key: data.key };
}

type ProgressCallback = (fraction: number, bytesDone: number, totalBytes: number) => void;
type RegisterCancel = (cancel: () => void) => void;

async function putWithProgress(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
  webBody: Blob | null,
  onProgress: ProgressCallback,
  registerCancel: RegisterCancel
): Promise<void> {
  if (Platform.OS === "web") {
    await putWithXhr(uploadUrl, contentType, webBody, onProgress, registerCancel);
    return;
  }
  const task = new File(fileUri).createUploadTask(uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { "Content-Type": contentType },
    onProgress: ({ bytesSent, totalBytes }) => {
      onProgress(totalBytes > 0 ? bytesSent / totalBytes : 0, bytesSent, totalBytes);
    },
  });
  registerCancel(() => task.cancel());
  const result = await task.uploadAsync();
  if (result.status !== 200) throw new Error(`Upload failed (HTTP ${result.status}).`);
}

function putWithXhr(
  uploadUrl: string,
  contentType: string,
  body: Blob | null,
  onProgress: ProgressCallback,
  registerCancel: RegisterCancel
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!body) {
      reject(new Error("Could not read the selected file — try picking it again."));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total, event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Upload failed — check your connection (browser uploads also need a PUT CORS rule on the B2 bucket)."
        )
      );
    xhr.ontimeout = () => reject(new Error("Upload timed out — try again."));
    xhr.onabort = () => reject(new UploadCancelledError());
    registerCancel(() => xhr.abort());
    xhr.send(body);
  });
}

async function bodyForWeb(asset: ImagePicker.ImagePickerAsset): Promise<Blob | null> {
  if (asset.file) return asset.file;
  try {
    return await (await fetch(asset.uri)).blob();
  } catch {
    return null;
  }
}

/**
 * Opens the device video picker, applies the compression plan (native app
 * only), uploads to Backblaze B2 and resolves the stored object. Resolves
 * `"cancelled"` when the admin backs out.
 */
export async function pickAndUploadVideo(
  options: PickVideoOptions = {}
): Promise<UploadedVideo | "cancelled"> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Media library permission is required to choose a video.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    quality: 1,
  });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return "cancelled";

  const rawName =
    asset.fileName ?? asset.uri.split(/[?#]/)[0].split("/").pop() ?? "upload.mp4";
  const normalized = normalizeFile(rawName, asset.mimeType);
  if (!normalized) {
    throw new Error("Unsupported video format — use MP4, MOV, MKV or WebM.");
  }

  const job: ActiveJob = { cancelled: false };
  activeJob = job;
  let tempUri: string | null = null;

  const emit = (event: UploadProgressEvent) => {
    if (!job.cancelled) options.onProgress?.(event);
  };
  const throwIfCancelled = () => {
    if (job.cancelled) throw new UploadCancelledError();
  };

  try {
    emit({ stage: "probing", fraction: 0, label: "Reading video info…" });
    let probe: VideoProbe;
    try {
      probe = await probeVideo(asset.uri, {
        duration: asset.duration,
        sizeBytes: asset.fileSize,
      });
    } catch {
      probe = {
        durationSeconds: 0,
        width: 0,
        height: 0,
        sizeBytes: asset.fileSize ?? 0,
      };
    }
    if (probe.durationSeconds > 0) options.onProbed?.(probe.durationSeconds);
    throwIfCancelled();

    const originalBytes = probe.sizeBytes || asset.fileSize || 0;
    const plan = planCompression({
      sizeBytes: originalBytes,
      durationSeconds: probe.durationSeconds,
    });

    let sourceUri = asset.uri;
    let uploadName = normalized.name;
    let contentType = normalized.contentType;
    let compressed = false;
    let compressionWarning: string | undefined;

    const wantCompression =
      options.compress !== false && canCompressVideo && plan.action === "compress";

    if (wantCompression && plan.action === "compress") {
      let cancelId = "";
      job.cancel = () => {
        job.cancelled = true;
        if (cancelId) cancelCompression(cancelId);
      };
      emit({
        stage: "compressing",
        fraction: 0,
        label: `Compressing · ${formatBitrate(plan.videoBitrateBps)} · est. ${formatBytes(plan.estimatedBytes)}`,
      });
      try {
        const outputUri = await compressVideo(sourceUri, {
          videoBitrateBps: plan.videoBitrateBps,
          onCancellationId: (id) => {
            cancelId = id;
            if (job.cancelled) cancelCompression(id);
          },
          onProgress: (fraction) => {
            emit({
              stage: "compressing",
              fraction,
              label: `Compressing… ${percent(fraction)} · est. ${formatBytes(plan.estimatedBytes)}`,
            });
          },
        });
        if (outputUri !== sourceUri) tempUri = outputUri;
        throwIfCancelled();
        if (tempUri) {
          sourceUri = tempUri;
          compressed = true;
          uploadName = withExtension(uploadName, "mp4");
          contentType = "video/mp4";
        }
      } catch (error) {
        if (job.cancelled || isUploadCancelled(error)) throw new UploadCancelledError();
        compressionWarning = error instanceof Error ? error.message : "Compression failed.";
        compressed = false;
        sourceUri = asset.uri;
        uploadName = normalized.name;
        contentType = normalized.contentType;
      } finally {
        job.cancel = undefined;
      }
    }

    throwIfCancelled();

    emit({ stage: "uploading", fraction: 0, label: "Requesting upload ticket…" });
    const ticket = await requestTicket(uploadName, contentType);
    throwIfCancelled();

    let webBody: Blob | null = null;
    if (Platform.OS === "web") webBody = await bodyForWeb(asset);
    throwIfCancelled();

    emit({ stage: "uploading", fraction: 0, label: "Uploading… 0%" });
    let reportedBytes = 0;
    job.cancel = () => {
      job.cancelled = true;
    };
    try {
      await putWithProgress(
        ticket.uploadUrl,
        sourceUri,
        contentType,
        webBody,
        (fraction, bytesDone, totalBytes) => {
          reportedBytes = totalBytes > 0 ? totalBytes : bytesDone;
          emit({
            stage: "uploading",
            fraction,
            label: totalBytes
              ? `Uploading… ${percent(fraction)} · ${formatBytes(bytesDone)} / ${formatBytes(totalBytes)}`
              : `Uploading… ${percent(fraction)}`,
            bytesDone,
            totalBytes,
          });
        },
        (cancel) => {
          job.cancel = () => {
            job.cancelled = true;
            cancel();
          };
        }
      );
    } catch (error) {
      if (job.cancelled || isUploadCancelled(error)) throw new UploadCancelledError();
      throw error instanceof Error ? error : new Error("Upload failed.");
    }

    let outputBytes = originalBytes;
    if (tempUri) {
      const actual = await fileSizeOf(tempUri);
      outputBytes = actual || plan.estimatedBytes || reportedBytes || originalBytes;
      await deleteQuietly(tempUri);
      tempUri = null;
    }

    return {
      key: ticket.key,
      name: uploadName,
      originalBytes,
      outputBytes,
      compressed,
      durationSeconds: probe.durationSeconds,
      plan,
      compressionWarning,
    };
  } catch (error) {
    if (tempUri) await deleteQuietly(tempUri);
    throw error;
  } finally {
    if (activeJob === job) activeJob = null;
  }
}

// Poster/backdrop images go through Supabase Storage's public `artwork`
// bucket (admin RLS) instead of B2 — the app renders them as plain URLs.

const ARTWORK_EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64ToBytes(base64: string): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    lookup[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  const clean = base64.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    bytes[offset++] = (a << 2) | (b >> 4);
    if (offset < bytes.length) bytes[offset++] = ((b & 15) << 4) | (c >> 2);
    if (offset < bytes.length) bytes[offset++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

/**
 * Opens the image picker and uploads the poster/backdrop to the public
 * `artwork` bucket. Resolves `"cancelled"` when the admin backs out, the
 * public URL otherwise.
 */
export async function pickAndUploadArtwork(): Promise<string | "cancelled"> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Media library permission is required to choose an image.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  });
  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset) return "cancelled";

  const rawName = asset.fileName ?? asset.uri.split(/[?#]/)[0].split("/").pop() ?? "artwork.jpg";
  const rawExt = rawName.includes(".") ? (rawName.split(".").pop() ?? "").toLowerCase() : "";
  const ext = ARTWORK_EXTENSIONS[rawExt] ? rawExt : "jpg";
  const contentType = ARTWORK_EXTENSIONS[ext];

  const path = `movies/${Crypto.randomUUID()}.${ext}`;
  const sb = getSupabase();
  let body: ArrayBuffer | Uint8Array;
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    body = await blob.arrayBuffer();
  } else {
    const base64 = await FileSystemLegacy.readAsStringAsync(asset.uri, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
    body = base64ToBytes(base64);
  }

  const { error } = await sb.storage.from("artwork").upload(path, body, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`Artwork upload failed — ${error.message}`);
  const { data } = sb.storage.from("artwork").getPublicUrl(path);
  return data.publicUrl;
}
