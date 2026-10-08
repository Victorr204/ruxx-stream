import type { ProbeHints, VideoProbe, CompressOptions } from "./compressPlan";

export * from "./compressPlan";

export const canCompressVideo = false;

function readMetadata(uri: string): Promise<VideoProbe> {
  return new Promise((resolve) => {
    const zero: VideoProbe = { durationSeconds: 0, width: 0, height: 0, sizeBytes: 0 };
    if (typeof document === "undefined") {
      resolve(zero);
      return;
    }
    const element = document.createElement("video");
    let settled = false;
    const finish = (probe: VideoProbe) => {
      if (settled) return;
      settled = true;
      element.removeAttribute("src");
      resolve(probe);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      finish({
        durationSeconds: Number.isFinite(element.duration) ? element.duration : 0,
        width: element.videoWidth,
        height: element.videoHeight,
        sizeBytes: 0,
      });
    };
    element.onerror = () => finish(zero);
    element.src = uri;
  });
}

export async function probeVideo(uri: string, hints: ProbeHints = {}): Promise<VideoProbe> {
  const probe = await readMetadata(uri);
  const sizeFromHint =
    typeof hints.sizeBytes === "number" && hints.sizeBytes > 0 ? hints.sizeBytes : 0;
  const durationFromHint =
    typeof hints.duration === "number" && Number.isFinite(hints.duration) && hints.duration > 0
      ? hints.duration
      : 0;
  return {
    ...probe,
    sizeBytes: probe.sizeBytes || sizeFromHint,
    durationSeconds: probe.durationSeconds || durationFromHint,
  };
}

export async function compressVideo(_uri: string, _options: CompressOptions): Promise<string> {
  throw new Error(
    "Compression runs in the native app only — the browser uploads the original file."
  );
}

export function cancelCompression(_id: string): void {}
