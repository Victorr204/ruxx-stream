export const TARGET_OUTPUT_BYTES = 150 * 1024 * 1024;
export const AUDIO_BITRATE_BPS = 128_000;
export const MIN_VIDEO_BITRATE_BPS = 700_000;
export const TARGET_UTILISATION = 0.98;
export const MIN_SAVINGS_RATIO = 0.9;
export const PRESERVE_MAX_SIZE = 7680;

export type SkipReason = "unknown-length" | "already-small" | "not-worth-it";

export type CompressionPlan =
  | { action: "skip"; reason: SkipReason; estimatedBytes: number }
  | {
      action: "compress";
      videoBitrateBps: number;
      estimatedBytes: number;
      floorApplied: boolean;
    };

export type CompressionInput = {
  sizeBytes: number;
  durationSeconds: number;
};

export type VideoProbe = {
  durationSeconds: number;
  width: number;
  height: number;
  sizeBytes: number;
};

export type ProbeHints = {
  duration?: number | null;
  sizeBytes?: number | null;
};

export type CompressOptions = {
  videoBitrateBps: number;
  onProgress?: (fraction: number) => void;
  onCancellationId?: (id: string) => void;
};

export function planCompression(input: CompressionInput): CompressionPlan {
  const { sizeBytes, durationSeconds } = input;
  const size = Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;

  if (!size || !duration) {
    return { action: "skip", reason: "unknown-length", estimatedBytes: size };
  }
  if (size <= TARGET_OUTPUT_BYTES) {
    return { action: "skip", reason: "already-small", estimatedBytes: size };
  }

  const rawVideoBps =
    (TARGET_OUTPUT_BYTES * TARGET_UTILISATION * 8) / duration - AUDIO_BITRATE_BPS;
  const videoBitrateBps = Math.max(Math.round(rawVideoBps), MIN_VIDEO_BITRATE_BPS);
  const floorApplied = rawVideoBps < MIN_VIDEO_BITRATE_BPS;
  const estimatedBytes = Math.round(((videoBitrateBps + AUDIO_BITRATE_BPS) * duration) / 8);

  if (estimatedBytes >= size * MIN_SAVINGS_RATIO) {
    return { action: "skip", reason: "not-worth-it", estimatedBytes };
  }

  return { action: "compress", videoBitrateBps, estimatedBytes, floorApplied };
}

export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  if (bps >= 1_000_000) {
    const mbps = Math.round((bps / 1_000_000) * 10) / 10;
    return `${mbps} Mbps`;
  }
  return `${Math.round(bps / 1000)} kbps`;
}

export function skipReasonLabel(reason: SkipReason): string {
  switch (reason) {
    case "unknown-length":
      return "duration unknown";
    case "already-small":
      return "already under the 150MB target";
    case "not-worth-it":
      return "quality floor would not shrink it";
  }
}
