import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { cuesToSrt, languageLabel, parseSubtitles } from "../../../src/lib/subtitles.ts";

// Stores a transcript the in-app generator produced from a movie's own
// audio (the Whisper engine ran on the viewer's device — no audio ever
// touches this function, only the finished cues).
//
// Security model: a signed-in session is required (verified against the
// caller's Authorization header, same as translate-subtitles). The body
// is size-capped and round-tripped through the SRT parser so garbage
// never lands in movie_subtitles. Writes use the service role because
// RLS keeps this table admin-writable only; an admin upload for the same
// language always wins — the row is never replaced while its origin is
// 'upload'.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_CUES = 20_000;
const MAX_TOTAL_CHARS = 400_000;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

type Cue = { s: number; e: number; t: string };

function validCues(value: unknown): value is Cue[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CUES) return false;
  let chars = 0;
  for (const cue of value) {
    if (!cue || typeof cue !== "object") return false;
    const { s, e, t } = cue as Record<string, unknown>;
    if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return false;
    if (typeof e !== "number" || !Number.isFinite(e) || e <= s) return false;
    if (typeof t !== "string" || !t.trim()) return false;
    chars += t.length;
  }
  return chars <= MAX_TOTAL_CHARS;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    let movieId: string | null = null;
    let language: string | null = null;
    let detected: string | null = null;
    let cues: unknown = null;
    try {
      const body = await req.json();
      movieId = typeof body?.movie_id === "string" ? body.movie_id : null;
      language = typeof body?.language === "string" ? body.language : null;
      detected = typeof body?.detected === "string" ? body.detected : null;
      cues = body?.cues;
    } catch {
      movieId = null;
    }
    if (!movieId) return json({ error: "movie_id is required" }, 400);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(movieId)) {
      return json({ error: "movie_id must be a uuid" }, 400);
    }
    if (!language || !LANGUAGE_TAG.test(language)) {
      return json({ error: "language must be a language tag" }, 400);
    }
    if (!validCues(cues)) {
      return json({ error: "cues must be a non-empty, size-capped cue array" }, 400);
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);
    const caller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);
    const userId = userData.user.id;

    // Saving parses + stores up to 400k chars; cap it so one account can't
    // flood the shared subtitle table.
    const { data: allowed } = await caller.rpc("hit_rate_limit", {
      p_key: `transcript:${userId}`,
      p_max: 10,
      p_window_seconds: 3600,
    });
    if (allowed === false) return json({ error: "Too many saves — try again later" }, 429);

    const { data: callerProfile } = await caller
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const isAdmin = (callerProfile as { role?: string } | null)?.role === "admin";

    // Serialize once and prove the parser reads it back — a cue shape the
    // player can't render must never be stored.
    const source = cuesToSrt(cues as Cue[]);
    if (parseSubtitles(source).length === 0) {
      return json({ error: "cues could not be serialized to a readable subtitle file" }, 422);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: movie, error: movieError } = await db
      .from("movies")
      .select("id")
      .eq("id", movieId)
      .eq("is_active", true)
      .maybeSingle();
    if (movieError) return json({ error: movieError.message }, 500);
    if (!movie) return json({ error: "Movie not found" }, 404);

    const detectedLanguage = detected || language;
    const label = `${languageLabel(language)} (audio scan)`;

    const { data: existing, error: existingError } = await db
      .from("movie_subtitles")
      .select("id, origin, created_by")
      .eq("movie_id", movieId)
      .eq("language", language)
      .maybeSingle();
    if (existingError) return json({ error: existingError.message }, 500);

    if (existing) {
      const row = existing as { id: string; origin: string; created_by: string | null };
      if (row.origin !== "generated") {
        return json({ error: "An uploaded subtitle file already exists for this language" }, 409);
      }
      // Generated rows belong to whoever produced them: a second account
      // must not be able to replace another viewer's transcript (admins
      // may — they moderate the shared table).
      if (!isAdmin && row.created_by && row.created_by !== userId) {
        return json({ error: "Another account generated subtitles for this language" }, 409);
      }
      // Filtered on origin so a racing admin upload can't be clobbered, and
      // on ownership so a racing second generator can't either.
      let updateQuery = db
        .from("movie_subtitles")
        .update({ source, label, detected_language: detectedLanguage })
        .eq("id", row.id)
        .eq("origin", "generated");
      if (!isAdmin) {
        updateQuery = updateQuery.or(`created_by.is.null,created_by.eq.${userId}`);
      }
      const { error: updateError } = await updateQuery;
      if (updateError) return json({ error: updateError.message }, 500);
      return json({ ok: true, movie_id: movieId, language, cues: (cues as Cue[]).length });
    }

    const { error: insertError } = await db.from("movie_subtitles").insert({
      movie_id: movieId,
      language,
      label,
      source,
      origin: "generated",
      detected_language: detectedLanguage,
      created_by: userId,
    });
    if (insertError) {
      // Unique violation → an upload landed between our check and insert.
      if (insertError.code === "23505") {
        return json({ error: "An uploaded subtitle file already exists for this language" }, 409);
      }
      return json({ error: insertError.message }, 500);
    }

    return json({ ok: true, movie_id: movieId, language, cues: (cues as Cue[]).length });
  } catch (e) {
    console.error("[save-transcript]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
