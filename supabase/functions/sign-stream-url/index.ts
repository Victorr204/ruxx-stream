import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";
import { presignGetObject, storageConfigFromEnv } from "../_shared/storage.ts";

// Mints a short-lived playback URL for one movie.
//
// Security model: the function builds a Supabase client from the caller's own
// Authorization header, so every query below runs under Row Level Security as
// that user. The premium rendition row (premium_movie_sources) is therefore
// invisible to free accounts, and only active titles resolve at all.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STREAM_TTL_SECONDS = 21600; // 6 hours

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    let movieId: string | null = null;
    try {
      const body = await req.json();
      movieId = typeof body?.movie_id === "string" ? body.movie_id : null;
    } catch {
      movieId = null;
    }
    if (!movieId) return json({ error: "movie_id is required" }, 400);
    // Reject non-UUIDs up front: PostgREST would otherwise fail the column
    // cast with a 500.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(movieId)) {
      return json({ error: "movie_id must be a uuid" }, 400);
    }

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);

    // stream_url is column-revoked from PostgREST roles (it is a raw,
    // permanent URL), so it is deliberately absent here — the legacy
    // fallback below reads it with the service role instead.
    const { data: movie, error: movieError } = await db
      .from("movies")
      .select("id, title, r2_key_free")
      .eq("id", movieId)
      .eq("is_active", true)
      .maybeSingle();
    if (movieError) return json({ error: movieError.message }, 500);
    if (!movie) return json({ error: "Movie not found" }, 404);

    // RLS reveals this row only when profiles.is_premium = true.
    const { data: premium } = await db
      .from("premium_movie_sources")
      .select("r2_key, stream_url")
      .eq("movie_id", movieId)
      .maybeSingle();

    let url: string | null = null;
    let quality: "free" | "premium" = "free";

    if (premium) {
      quality = "premium";
      if (premium.r2_key) {
        url = await presignGetObject(storageConfigFromEnv(), premium.r2_key, STREAM_TTL_SECONDS);
      } else {
        url = premium.stream_url;
      }
    }

    if (!url) {
      if (movie.r2_key_free) {
        url = await presignGetObject(storageConfigFromEnv(), movie.r2_key_free, STREAM_TTL_SECONDS);
      } else {
        // Demo/legacy rows still carry a raw URL, but the column is revoked
        // from anon/authenticated — only the service role may read it, and
        // the is_active gate mirrors the RLS the caller passed above.
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: legacy } = await admin
          .from("movies")
          .select("stream_url")
          .eq("id", movieId)
          .eq("is_active", true)
          .maybeSingle();
        url = (legacy as { stream_url: string | null } | null)?.stream_url ?? null;
      }
    }

    if (!url) return json({ error: "No playable source for this title" }, 404);

    // NOTE: this function used to insert an `event: "play"` row on every
    // mint, which double-counted with the player's own play logging and let
    // anyone inflate Trending by re-resolving URLs. Plays are logged by the
    // player (app/player/[id].jsx) and every playback_events insert is now
    // rate-limited by a database trigger.

    return json({ movie_id: movieId, url, quality, expires_in: STREAM_TTL_SECONDS });
  } catch (e) {
    console.error("[sign-stream-url]", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
