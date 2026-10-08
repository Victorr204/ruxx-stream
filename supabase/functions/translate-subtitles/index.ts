import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import {
  batchLines,
  detectLanguageLocally,
  detectionSample,
  flattenCueTexts,
  isSupportedLanguage,
  normalizeDetectedLanguage,
  parseSubtitles,
  pickTranslationSource,
} from "../../../src/lib/subtitles.ts";

// Two jobs, one endpoint:
//
//   translate — turns a movie's source subtitle file into the language the
//               viewer picked, caching the result per (subtitle, language)
//               so each pair costs one translation for the lifetime of the
//               source file.
//   detect    — auto-detects which language that source file is written in
//               (the movie's own language, in the usual case) and stores the
//               answer on the row so the player can show it up front.
//
// Security model: translation needs a signed-in session (verified against
// the caller's own Authorization header). Detection only reads subtitle
// rows that are public under RLS, so it works for guests too — and it only
// ever sends text that already lives in our database. Reads/writes below
// use the service role: the cache table is client-read-only, and nobody can
// write translations or detections by hand.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const MAX_SOURCE_CHARS = 400_000;
const BATCH_CHARS = 3500;
const BATCH_CONCURRENCY = 2;

type Cue = { s: number; e: number; t: string };

type SubtitleRow = {
  id: string;
  language: string;
  label: string;
  source: string;
  // Optional: present only after the detection migration has run. A missing
  // column must never take the whole endpoint down, so it's read defensively.
  detected_language?: string | null;
  created_at: string;
};

/** Persists a fresh detection onto its row (no-op when one already won a
 *  race). Passed in so this module never has to name the client type. */
type DetectionWriter = (subtitleId: string, detected: string) => Promise<void>;

async function translateChunk(text: string, target: string): Promise<string | null> {
  const url =
    `${TRANSLATE_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}` +
    `&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const segments = Array.isArray(data) ? (data[0] as unknown) : null;
    if (!Array.isArray(segments)) return null;
    return segments
      .map((segment) => (Array.isArray(segment) ? String(segment[0] ?? "") : ""))
      .join("");
  } catch {
    return null;
  }
}

/** Asks the translator which language a sample of text is written in.
 *  `sl=auto` answers in slot 2 of the response (slot 1 on older payloads). */
async function detectLanguage(sample: string): Promise<string | null> {
  if (!sample) return null;
  const url =
    `${TRANSLATE_URL}?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(sample)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return null;
    const primary = data[2];
    if (typeof primary === "string" && primary) return primary;
    const alternate = data[1];
    if (Array.isArray(alternate) && typeof alternate[0] === "string" && alternate[0]) {
      return alternate[0];
    }
    return null;
  } catch {
    return null;
  }
}

/** Detected language for one source file: the stored answer when we have
 *  one, otherwise a fresh detection that gets written back. The local
 *  (script/stopword) detector answers for free and most of the time; the
 *  translator's own auto-detect only runs when that one isn't confident. */
async function resolveDetection(row: SubtitleRow, write: DetectionWriter): Promise<string | null> {
  const cached = normalizeDetectedLanguage(row.detected_language);
  if (cached) return cached;
  const sample = detectionSample(parseSubtitles(row.source));
  const detected =
    normalizeDetectedLanguage(detectLanguageLocally(sample)) ??
    normalizeDetectedLanguage(await detectLanguage(sample));
  if (detected) await write(row.id, detected);
  return detected;
}

async function translateLines(lines: string[], target: string): Promise<string[]> {
  const joined = lines.join("\n");
  const translated = await translateChunk(joined, target);
  if (translated !== null) {
    const parts = translated.split("\n");
    if (parts.length === lines.length) {
      return parts.map((part, index) => part || lines[index]);
    }
  }
  // Line count mismatch (translator merged/split newlines) → one line at a
  // time; keep the original text for any line that still fails.
  const out: string[] = [];
  for (const line of lines) {
    const one = await translateChunk(line, target);
    out.push(one !== null && one.trim() ? one : line);
  }
  return out;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    let movieId: string | null = null;
    let language: string | null = null;
    let action: string | null = null;
    try {
      const body = await req.json();
      movieId = typeof body?.movie_id === "string" ? body.movie_id : null;
      language = typeof body?.language === "string" ? body.language : null;
      action = typeof body?.action === "string" ? body.action : null;
    } catch {
      movieId = null;
    }
    if (!movieId) return json({ error: "movie_id is required" }, 400);

    // No language (or an explicit detect action) → detection only.
    const detectOnly = action === "detect" || !language;

    if (!detectOnly) {
      if (!isSupportedLanguage(language as string)) {
        return json({ error: "Unsupported language" }, 400);
      }
      const authorization = req.headers.get("Authorization");
      if (!authorization) return json({ error: "Missing Authorization header" }, 401);
      const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userError } = await caller.auth.getUser();
      if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // The detection column only exists once its migration has run; a title
    // must stay fully playable (and its admin uploads fully listed) either
    // way, so the query drops to the columns we know are there.
    const WITH_DETECTION =
      "id, language, label, source, detected_language, created_at, movies!inner(is_active)";
    const WITHOUT_DETECTION = "id, language, label, source, created_at, movies!inner(is_active)";
    let canStoreDetection = true;
    const loadSubtitles = (columns: string) =>
      db
        .from("movie_subtitles")
        .select(columns)
        .eq("movie_id", movieId)
        .eq("movies.is_active", true)
        .order("created_at", { ascending: true });

    let { data: rows, error: rowsError } = await loadSubtitles(WITH_DETECTION);
    if (rowsError && rowsError.message.includes("detected_language")) {
      canStoreDetection = false;
      ({ data: rows, error: rowsError } = await loadSubtitles(WITHOUT_DETECTION));
    }
    if (rowsError) return json({ error: rowsError.message }, 500);

    const writeDetection: DetectionWriter = async (subtitleId, detected) => {
      if (!canStoreDetection) return;
      const { error } = await db
        .from("movie_subtitles")
        .update({ detected_language: detected })
        .eq("id", subtitleId)
        .is("detected_language", null);
      if (error) console.warn("[translate-subtitles] detection write failed", error.message);
    };

    // The select string is built at runtime, so the client can't infer the
    // row shape — it's asserted against the type above.
    const subtitles = (rows ?? []) as unknown as SubtitleRow[];
    if (subtitles.length === 0) {
      if (detectOnly) return json({ available: false, source_language: null, detected: null });
      return json({ error: "No subtitles available for this title" }, 404);
    }

    if (detectOnly) {
      const source = pickTranslationSource(subtitles, null);
      if (!source) return json({ available: false, source_language: null, detected: null });
      const detected = await resolveDetection(source, writeDetection);
      return json({ available: true, source_language: source.language, detected });
    }

    const exact = subtitles.find((row) => row.language === language);
    if (exact) {
      const cues = parseSubtitles(exact.source);
      if (cues.length === 0) return json({ error: "Subtitle file has no cues" }, 422);
      // Already the file the viewer asked for — no translation, and no
      // reason to spend a detection call; the sheet asks for that itself.
      return json({
        cues,
        source_language: exact.language,
        detected: normalizeDetectedLanguage(exact.detected_language),
        cached: false,
      });
    }

    const source = pickTranslationSource(subtitles, null);
    if (!source) return json({ error: "No subtitles available for this title" }, 404);
    const detected = await resolveDetection(source, writeDetection);
    if (source.source.length > MAX_SOURCE_CHARS) {
      return json({ error: "Subtitle file is too large to translate" }, 413);
    }

    const { data: cachedRow, error: cacheError } = await db
      .from("movie_subtitle_translations")
      .select("cues")
      .eq("subtitle_id", source.id)
      .eq("language", language)
      .maybeSingle();
    if (cacheError) return json({ error: cacheError.message }, 500);
    if (cachedRow && Array.isArray(cachedRow.cues) && cachedRow.cues.length > 0) {
      return json({
        cues: cachedRow.cues,
        source_language: source.language,
        detected,
        cached: true,
      });
    }

    const sourceCues = parseSubtitles(source.source);
    if (sourceCues.length === 0) return json({ error: "Subtitle file has no cues" }, 422);

    const lines = flattenCueTexts(sourceCues);
    const batches = batchLines(lines, BATCH_CHARS);
    const translatedBatches = await mapLimit(batches, BATCH_CONCURRENCY, (batch) =>
      translateLines(batch, language as string)
    );
    const translatedLines = translatedBatches.flat();

    const cues: Cue[] = sourceCues.map((cue, index) => ({
      s: cue.s,
      e: cue.e,
      t: translatedLines[index] ?? cue.t,
    }));

    const { error: storeError } = await db.from("movie_subtitle_translations").upsert(
      { subtitle_id: source.id, language, cues },
      { onConflict: "subtitle_id,language" }
    );
    if (storeError) {
      console.warn("[translate-subtitles] cache write failed", storeError.message);
    }

    return json({ cues, source_language: source.language, detected, cached: false });
  } catch (e) {
    console.error("[translate-subtitles]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
