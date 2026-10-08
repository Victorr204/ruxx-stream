import Constants, { ExecutionEnvironment } from "expo-constants";
import { PRESERVE_MAX_SIZE, type CompressOptions, type ProbeHints, type VideoProbe } from "./compressPlan";

export * from "./compressPlan";

export const canCompressVideo = true;

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type CompressorModule = {
  Video: {
    compress(
      uri: string,
      options: Record<string, unknown>,
      onProgress?: (progress: number) => void
    ): Promise<string>;
    cancelCompression(id: string): void;
  };
  getVideoMetaData(uri: string): Promise<{
    extension?: string;
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
  }>;
};

let cachedModule: CompressorModule | null | undefined;

function unlinkedMessage(): string {
  return "Video compression is unavailable — this build doesn't include react-native-compressor (Expo Go, or a dev build made before it was installed). Run npx expo run / EAS to enable it.";
}

function loadCompressor(): CompressorModule {
  if (inExpoGo) throw new Error(unlinkedMessage());
  if (cachedModule !== undefined) {
    if (cachedModule === null) throw new Error(unlinkedMessage());
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require("react-native-compressor") as CompressorModule;
  } catch {
    cachedModule = null;
  }
  if (!cachedModule) {
    cachedModule = null;
    throw new Error(unlinkedMessage());
  }
  return cachedModule;
}

export async function probeVideo(uri: string, hints: ProbeHints = {}): Promise<VideoProbe> {
  const sizeFromHint =
    typeof hints.sizeBytes === "number" && hints.sizeBytes > 0 ? hints.sizeBytes : 0;
  try {
    const meta = await loadCompressor().getVideoMetaData(uri);
    const duration = Number(meta.duration ?? 0);
    if (duration > 0) {
      return {
        durationSeconds: duration,
        width: Number(meta.width ?? 0),
        height: Number(meta.height ?? 0),
        sizeBytes: Number(meta.size ?? 0) || sizeFromHint,
      };
    }
  } catch {
    // fall back to picker metadata below
  }
  const durationHint =
    typeof hints.duration === "number" && hints.duration > 0 ? hints.duration : 0;
  return {
    durationSeconds: durationHint / 1000,
    width: 0,
    height: 0,
    sizeBytes: sizeFromHint,
  };
}

export async function compressVideo(uri: string, options: CompressOptions): Promise<string> {
  const { Video } = loadCompressor();
  const output = await Video.compress(
    uri,
    {
      compressionMethod: "manual",
      bitrate: options.videoBitrateBps,
      maxSize: PRESERVE_MAX_SIZE,
      progressDivider: 1,
      minimumFileSizeForCompress: 0,
      getCancellationId: (id: string) => options.onCancellationId?.(id),
    },
    (progress: number) => {
      if (!Number.isFinite(progress)) return;
      const fraction = progress > 1 ? progress / 100 : progress;
      options.onProgress?.(Math.min(1, Math.max(0, fraction)));
    }
  );
  if (typeof output !== "string" || !output) {
    throw new Error("Compression produced no output file.");
  }
  return output.startsWith("file://") ? output : `file://${output}`;
}

export function cancelCompression(id: string): void {
  try {
    loadCompressor().Video.cancelCompression(id);
  } catch {
    // already finished or unlinked
  }
}
