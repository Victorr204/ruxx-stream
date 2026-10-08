// Resolution helpers behind the player's quality menu: parsing HLS master
// playlists into selectable levels, labelling them for humans, and matching
// the viewer's saved preference against what a source actually offers.

export type QualityLevel = {
  /** Stable within one manifest — the level's height for URL-switched
   *  sources, or a source-specific key (index) for index-switched ones. */
  id: string;
  height: number | null;
  width: number | null;
  bitrate: number | null;
  label: string;
  /** Media-playlist URL for sources that switch by replacing the source
   *  (native / Safari HLS). Null when switching happens by index (hls.js). */
  url: string | null;
};

export type QualityState = {
  /** Highest → lowest. Empty while the source exposes no levels. */
  levels: QualityLevel[];
  /** True while the engine picks the level itself (Auto). */
  auto: boolean;
  /** Height currently on screen (null until the engine knows). */
  currentHeight: number | null;
};

/** "1080p", "4K", or "Source" when the height is unknown (single file). */
export function qualityLabel(height: number | null): string {
  if (!height || height <= 0) return "Source";
  if (height >= 4000) return "8K";
  if (height >= 2000) return "4K";
  return `${Math.round(height)}p`;
}

/** Human bitrate for level sub-labels ("4.5 Mbps"). */
export function bitRateLabel(bps: number | null): string | null {
  if (!bps || bps <= 0) return null;
  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(1).replace(/\.0$/, "")} Mbps`;
  }
  return `${Math.round(bps / 1000)} kbps`;
}

/** Highest resolution first (bitrate breaks ties) — the sheet's order. */
export function sortLevelsDesc(levels: QualityLevel[]): QualityLevel[] {
  return [...levels].sort((a, b) => {
    const ah = a.height ?? -1;
    const bh = b.height ?? -1;
    if (ah !== bh) return bh - ah;
    const ab = a.bitrate ?? -1;
    const bb = b.bitrate ?? -1;
    if (ab !== bb) return bb - ab;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Resolves a variant URI from a master playlist against the master's own
 * URL, carrying a signed query string over when the child lives on the same
 * origin (CDN policies that sign the path family accept it; per-object
 * signatures ignore it and fail either way).
 */
export function resolveVariantUrl(masterUrl: string, uri: string): string {
  const master = new URL(masterUrl);
  const resolved = new URL(uri, master);
  if (resolved.origin === master.origin && !resolved.search && master.search) {
    resolved.search = master.search;
  }
  return resolved.toString();
}

const STREAM_INF = /^#EXT-X-STREAM-INF:(.*)$/;

/**
 * Parses an HLS master playlist into quality levels (highest → lowest).
 * I-frame-only and audio-only variants (no RESOLUTION) are dropped, and
 * duplicate heights keep the highest-bitrate variant.
 */
export function parseMasterLevels(masterText: string, masterUrl: string): QualityLevel[] {
  const lines = masterText.split(/\r?\n/);
  const byHeight = new Map<number, QualityLevel>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = STREAM_INF.exec(lines[i].trim());
    if (!match) continue;

    const attrs = match[1];
    if (/I-FRAME-ONLY/i.test(attrs)) continue;
    const resolution = /RESOLUTION=(\d+)x(\d+)/i.exec(attrs);
    if (!resolution) continue; // audio-only rendition — not a picture quality

    // The variant's URI is the next non-empty, non-comment line.
    let uri = "";
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j].trim();
      if (!line) continue;
      if (line.startsWith("#")) break;
      uri = line;
      i = j;
      break;
    }
    if (!uri) continue;

    const average = /AVERAGE-BANDWIDTH=(\d+)/i.exec(attrs);
    const peak = /BANDWIDTH=(\d+)/i.exec(attrs);
    const width = Number.parseInt(resolution[1], 10);
    const height = Number.parseInt(resolution[2], 10);
    if (!height) continue;

    const level: QualityLevel = {
      id: String(height),
      height,
      width,
      bitrate: average ? Number(average[1]) : peak ? Number(peak[1]) : null,
      label: qualityLabel(height),
      url: resolveVariantUrl(masterUrl, uri),
    };

    const previous = byHeight.get(height);
    if (!previous || (level.bitrate ?? 0) > (previous.bitrate ?? 0)) {
      byHeight.set(height, level);
    }
  }

  return sortLevelsDesc([...byHeight.values()]);
}

/**
 * Maps a saved height preference onto a real level: exact height first,
 * otherwise the best level at or below it (never spend data on an upscale),
 * otherwise the smallest available level.
 */
export function matchLevel(
  levels: QualityLevel[],
  preferredHeight: number | null
): QualityLevel | null {
  if (levels.length === 0) return null;
  const sorted = sortLevelsDesc(levels);
  if (preferredHeight === null || preferredHeight <= 0) return sorted[0];

  const exact = sorted.find((level) => level.height === preferredHeight);
  if (exact) return exact;

  const atOrBelow = sorted.filter((level) => (level.height ?? 0) <= preferredHeight);
  if (atOrBelow.length > 0) return atOrBelow[0];
  return sorted[sorted.length - 1];
}
