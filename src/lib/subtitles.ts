export type SubtitleCue = {
  s: number;
  e: number;
  t: string;
};

export type SubtitleLanguage = {
  code: string;
  label: string;
};

export const SUBTITLE_LANGUAGES: SubtitleLanguage[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "yo", label: "Yoruba" },
  { code: "ig", label: "Igbo" },
  { code: "ha", label: "Hausa" },
  { code: "sw", label: "Swahili" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "ru", label: "Russian" },
  { code: "tr", label: "Turkish" },
  { code: "nl", label: "Dutch" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
];

export function languageLabel(code: string): string {
  return SUBTITLE_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

export function isSupportedLanguage(code: string): boolean {
  return SUBTITLE_LANGUAGES.some((language) => language.code === code);
}

/** Codes the auto-detector hands back that name a language we list under a
 *  different code. Keys are matched on the full tag first, then the primary
 *  subtag (`zh`, `pt`, …). */
const DETECTED_ALIASES: Record<string, string> = {
  zh: "zh-CN",
  "zh-Hans": "zh-CN",
  "zh-HK": "zh-CN",
  "zh-MO": "zh-CN",
  pt: "pt",
  "pt-PT": "pt",
  "pt-BR": "pt",
};

/** Turns a raw auto-detect tag (`ko`, `zh-TW`, `und`, …) into a code we can
 *  label, or null when the detector had nothing useful to say. */
export function normalizeDetectedLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed || trimmed === "auto" || trimmed === "und") return null;
  const primary = trimmed.split("-")[0] ?? "";
  return DETECTED_ALIASES[trimmed] ?? DETECTED_ALIASES[primary] ?? trimmed;
}

/** Which uploaded file a translation should be generated from: an exact hit
 *  for the requested language when one exists, otherwise the English track,
 *  otherwise the first upload. */
export function pickTranslationSource<T extends { language: string }>(
  rows: T[],
  target: string | null | undefined
): T | null {
  if (rows.length === 0) return null;
  if (target) {
    const exact = rows.find((row) => row.language === target);
    if (exact) return exact;
  }
  return rows.find((row) => row.language === "en") ?? rows[0];
}

/**
 * A few hundred characters of cue text for the auto-detector: long enough
 * for a confident answer, short enough for a single request. Line breaks
 * collapse to spaces so one cue never splits across the sample.
 */
export function detectionSample(cues: SubtitleCue[], maxChars = 1200): string {
  const parts: string[] = [];
  let size = 0;
  for (const cue of cues) {
    const text = cue.t.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const separator = parts.length > 0 ? 1 : 0;
    const budget = maxChars - size - separator;
    if (budget <= 0) break;
    const chunk = text.length > budget ? text.slice(0, budget) : text;
    parts.push(chunk);
    size += separator + chunk.length;
    if (size >= maxChars) break;
  }
  return parts.join(" ");
}

// ───────────────────────────────────────────────── local language detection
// Written as pure code (no network) so the first answer for a title costs
// nothing and the remote detector is only consulted when this one isn't
// confident. Scripts are unambiguous, so they short-circuit; Latin-script
// languages are told apart by how often their function words show up.

const SCRIPTS: { pattern: RegExp; code: string | null }[] = [
  { pattern: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, code: "ko" }, // Hangul
  { pattern: /[\u3040-\u30FF\u31F0-\u31FF]/g, code: "ja" }, // Kana
  { pattern: /[\u3400-\u4DBF\u4E00-\u9FFF]/g, code: "zh-CN" }, // Han
  { pattern: /[\u0900-\u097F]/g, code: "hi" }, // Devanagari
  { pattern: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, code: "ar" }, // Arabic
  { pattern: /[\u0400-\u04FF]/g, code: "ru" }, // Cyrillic
  { pattern: /[A-Za-z\u00C0-\u024F]/g, code: null }, // Latin
];

/** Function words per Latin-script language we can label. Kept on purpose:
 *  a missing or wrong word only costs a vote — the remote detector decides
 *  when the counts aren't decisive. */
const LATIN_STOPWORDS: Record<string, string[]> = {
  en: "the and to of you that it in is for on with was as be have this not are but they at from her she we do if so no my me what up all out who get like just one time them then than too very when come his had".split(
    " "
  ),
  fr: "le la les de des une et est que qui ne pas je tu il elle nous vous ils pour dans ce cette avec sur plus mais ou suis sont du au aux mon ton son ces chez tout".split(
    " "
  ),
  es: "el la los las de que y en un una es por con no se del lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también".split(
    " "
  ),
  pt: "o a os as de que e do da em um uma para com não se na no por mais dos das como mas ao ele ela foi ser você quando muito".split(
    " "
  ),
  de: "der die das und ist nicht ein eine zu den von mit auf für im dem sich aber auch noch wie schon wenn habe wird bei nach vor dieser".split(
    " "
  ),
  it: "il lo la gli le di che e un una per non sono con si più questo quella quando molto bene anche dove sarebbe".split(
    " "
  ),
  nl: "de het een en van is dat niet ik in te op hij je ze maar met dan om ook wat zo wel al uit weer goed".split(
    " "
  ),
  tr: "bir bu ve için ile ben sen o ama çok gibi daha ki ne mi var yok değil her şu en diye sonra önce kadar".split(
    " "
  ),
  yo: "ti ko si fun wa ki lati nigba ra mo je eyin awon inu lori pada jẹ ma ilé ọkọ ọmọ di fi mu ri sọ a o".split(
    " "
  ),
  ha: "da na ne ke ya ta don a mai wani wannan kuma ko idan daga su ni in cikin akan wanda gare".split(
    " "
  ),
  sw: "na ya wa kwa hiyo hii hilo katika kwenye ni ili lakini sana hivi zaidi kila baada nini hapa pale sasa bado hata wao sisi hayo ambayo ali".split(
    " "
  ),
};

const LATIN_SCRIPT_SHARE = 0.6;
const MIN_SCRIPT_LETTERS = 12;
const MIN_KANA_LETTERS = 5;
const MIN_STOPWORD_HITS = 4;
const WINNER_MARGIN = 1.3;

const KANA = /[\u3040-\u30FF\u31F0-\u31FF]/g;

/** Tokens and stopwords are compared in the same shape: lowercased and
 *  stripped of combining marks (`için` → `icin`, `ọkọ` → `oko`). */
const plainLatin = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036F]/g, "");

const LATIN_STOPWORD_BAGS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(LATIN_STOPWORDS).map(([code, words]) => [
    code,
    new Set(words.map((word) => plainLatin(word))),
  ])
);

/** Local, network-free guess at which language a subtitle sample is written
 *  in: null when the script has no language we can label, or when the
 *  Latin-script counts aren't clearly won — callers then fall back to the
 *  remote detector (and finally to the file's declared label). */
export function detectLanguageLocally(sample: string): string | null {
  if (!sample) return null;

  // Kana is Japanese however much Kanji sits next to it, so it decides
  // before the plain script tally (Han alone would call it Chinese).
  if ((sample.match(KANA) ?? []).length >= MIN_KANA_LETTERS) return "ja";

  const counts = SCRIPTS.map(({ pattern, code }) => ({
    code,
    hits: (sample.match(pattern) ?? []).length,
  }));
  const letters = counts.reduce((total, entry) => total + entry.hits, 0);
  if (letters < MIN_SCRIPT_LETTERS) return null;
  const dominant = counts.reduce((best, entry) => (entry.hits > best.hits ? entry : best));
  if (dominant.hits / letters < LATIN_SCRIPT_SHARE) return null;
  if (dominant.code) return dominant.code;

  const tokens = plainLatin(sample).split(/[^a-z]+/).filter(Boolean);

  const scored = Object.entries(LATIN_STOPWORD_BAGS)
    .map(([code, bag]) => ({
      code,
      hits: tokens.reduce((n, token) => n + (bag.has(token) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.hits - a.hits);

  const winner = scored[0];
  const runnerUp = scored[1];
  if (!winner || winner.hits < MIN_STOPWORD_HITS) return null;
  if (runnerUp && winner.hits < runnerUp.hits * WINNER_MARGIN + 1) return null;
  return winner.code;
}

function parseTimestamp(raw: string): number | null {
  const match = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!match) return null;
  const fraction = (match[4] ?? "").padEnd(3, "0");
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(fraction) / 1000
  );
}

/** Parses SRT and WebVTT text into time-ordered cues. Tolerant of BOM,
 *  CRLF, missing cue numbers and inline markup tags. */
export function parseSubtitles(text: string): SubtitleCue[] {
  const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = cleaned.split("\n");
  const cues: SubtitleCue[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.includes("-->")) {
      index += 1;
      continue;
    }

    const parts = line.split("-->");
    const start = parseTimestamp(parts[0] ?? "");
    const endToken = (parts[1] ?? "").trim().split(/\s+/)[0] ?? "";
    const end = parseTimestamp(endToken);
    index += 1;

    const body: string[] = [];
    while (index < lines.length && lines[index].trim() !== "" && !lines[index].includes("-->")) {
      body.push(lines[index]);
      index += 1;
    }

    if (start === null || end === null || end <= start) continue;
    const cueText = body.join("\n").replace(/<[^>]+>/g, "").trim();
    if (!cueText) continue;
    cues.push({ s: start, e: end, t: cueText });
  }

  return cues.sort((a, b) => a.s - b.s);
}

/** Text of the cue active at `seconds`, or null. The latest-started cue
 *  wins when ranges overlap (matches how players paint subtitles). */
export function cueAt(cues: SubtitleCue[], seconds: number): string | null {
  if (cues.length === 0) return null;
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].s <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found === -1) return null;
  // Walk back for overlapping cues: a long cue that started earlier may
  // still be active when a newer (already ended) cue was found.
  for (let i = found; i >= 0; i -= 1) {
    if (seconds < cues[i].e) return cues[i].t;
  }
  return null;
}

/** One line per cue with internal line breaks flattened, ready for the
 *  translation endpoint (which preserves "\n" as a line separator). */
export function flattenCueTexts(cues: SubtitleCue[]): string[] {
  return cues.map((cue) => cue.t.replace(/\n/g, " / "));
}

/** Greedy batches of lines whose joined length stays within maxChars. */
export function batchLines(lines: string[], maxChars = 3500): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (current.length > 0 && size + cost > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ────────────────────────────────────────── cues → SRT (generator output)

function srtTimestamp(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/** Serializes cues as an SRT file — the inverse of parseSubtitles(), used
 *  to store generated transcripts in the same `source` column admin
 *  uploads use (so playback and the parser treat both identically). */
export function cuesToSrt(cues: SubtitleCue[]): string {
  return (
    cues
      .map((cue, index) => {
        const start = srtTimestamp(cue.s);
        // Round-trip guard: parseSubtitles() drops cues whose end doesn't
        // move past their start, so never emit one at sub-millisecond width.
        const end = srtTimestamp(Math.max(cue.e, cue.s + 0.001));
        return `${index + 1}\n${start} --> ${end}\n${cue.t.trim()}`;
      })
      .join("\n\n") + "\n"
  );
}

// ───────────────────────────────── whisper chunks → cues (audio scanning)

export type WhisperChunk = {
  s: number;
  /** Null on the final chunk of a stream — resolved from the next chunk
   *  or the movie's duration when building cues. */
  e: number | null;
  t: string;
};

/** Greedy sentence-aware split so no cue outstays a comfortable read. */
function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxChars) {
      parts.push(text.slice(start).trim());
      break;
    }
    let cut = -1;
    for (const marker of [". ", "! ", "? ", "; ", ": ", ", ", " "]) {
      const index = text.lastIndexOf(marker, start + maxChars);
      if (index > start) {
        cut = index + marker.length;
        break;
      }
    }
    if (cut <= start) cut = start + maxChars;
    parts.push(text.slice(start, cut).trim());
    start = cut;
  }
  return parts.filter((part) => part.length > 0);
}

/**
 * Turns a speech engine's timestamped chunks into readable subtitle cues.
 *
 * Whisper (running on the viewer's device) hands back long segments whose
 * timestamps can overlap at chunk seams and whose last end can be open;
 * this makes them monotonic, caps how much text/time a single cue asks
 * the viewer to read, and splits oversized segments proportionally so
 * timing stays honest.
 */
export function whisperChunksToCues(
  chunks: WhisperChunk[],
  options: { maxChars?: number; maxSeconds?: number; duration?: number } = {}
): SubtitleCue[] {
  const maxChars = options.maxChars ?? 90;
  const maxSeconds = options.maxSeconds ?? 7;
  const cues: SubtitleCue[] = [];
  let floor = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const text = (chunk.t ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    let start = Math.max(chunk.s, floor);
    if (!Number.isFinite(start) || start < 0) start = floor;

    let end = chunk.e;
    if (end === null || !Number.isFinite(end) || end <= chunk.s) {
      const next = chunks[index + 1];
      if (next && next.s > chunk.s) end = next.s;
      else if (options.duration && options.duration > chunk.s) end = options.duration;
      else end = chunk.s + 8;
    }
    if (end <= start) end = start + 0.5;

    const duration = end - start;
    let parts = splitLongText(text, maxChars);
    if (duration > maxSeconds) {
      // A phrase held (or slowly spoken) across a long span gets chopped
      // until every part's share of the span fits the time budget — by
      // words when characters alone can't cut it.
      for (let pass = 0; pass < 6; pass += 1) {
        const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
        const next: string[] = [];
        let changed = false;
        for (const part of parts) {
          const share = (part.length / totalChars) * duration;
          const words = part.split(/\s+/);
          if (share > maxSeconds && words.length >= 2) {
            const count = Math.min(words.length, Math.ceil(share / maxSeconds));
            const per = Math.ceil(words.length / count);
            for (let i = 0; i < words.length; i += per) {
              next.push(words.slice(i, i + per).join(" "));
            }
            changed = true;
          } else {
            next.push(part);
          }
        }
        parts = next;
        if (!changed) break;
      }
    }

    const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
    let cursor = start;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      const share = part.length / totalChars;
      const partEnd =
        partIndex === parts.length - 1
          ? end
          : Math.min(end, Math.max(cursor + 0.4, cursor + duration * share));
      if (partEnd > cursor) cues.push({ s: cursor, e: partEnd, t: part });
      cursor = partEnd;
    }
    floor = Math.max(floor, cursor);
  }

  return cues;
}
