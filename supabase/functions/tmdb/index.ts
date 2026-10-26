import { createClient } from "npm:@supabase/supabase-js@2";
import { json, preflight } from "../_shared/cors.ts";

// Admin-only TMDb proxy.
//
// The API key lives in a function secret and never reaches the app bundle:
// every EXPO_PUBLIC_* value is compiled into the public JS, so a shared TMDb
// key shipped to every visitor is just a key you get to watch get rate-limited
// (or revoked) by someone else.
//
// The caller's own JWT is used to build the Supabase client, so the admin
// check runs under Row Level Security exactly like the other functions here —
// profiles.role is read with the caller's own permissions.
//
//   POST { action: "search",  query: "the matrix" }  -> compact search hits
//   POST { action: "details", id: 603 }              -> everything the editor fills
//
// Responses are trimmed on purpose: the editor only needs the fields it can
// actually store (see AdminMovieInput in src/lib/admin.ts).
//
// TMDb requires attribution from any product using its data — the client adds
// the required line to the import panel and the legal screen.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const TMDB_API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";

const TMDB_API = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const SEARCH_PAGE_SIZE = 10;

type TmdbSearchRow = {
  id: number;
  title: string;
  release_date?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  vote_average?: number | null;
};

type TmdbVideo = {
  key: string;
  site?: string;
  type?: string;
  official?: boolean;
};

type TmdbDetails = {
  id: number;
  title: string;
  overview?: string | null;
  release_date?: string | null;
  runtime?: number | null;
  genres?: { id: number; name: string }[];
  poster_path?: string | null;
  backdrop_path?: string | null;
  videos?: { results?: TmdbVideo[] };
  release_dates?: {
    results?: { iso_3166_1?: string; release_dates?: { certification?: string }[] }[];
  };
};

type TmdbEnvelope<T> = T & { status_message?: string };

async function tmdb<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${TMDB_API}${path}`);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url);
  const body = (await res.json()) as TmdbEnvelope<T>;
  if (!res.ok) throw new Error(body?.status_message ?? `TMDb responded ${res.status}`);
  return body as T;
}

function imageUrl(path: string | null | undefined, size: string): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

/** US certification if TMDb has one, otherwise whatever the first region has. */
function certificationOf(details: TmdbDetails): string | null {
  const regions = details.release_dates?.results ?? [];
  const us = regions.find((region) => region.iso_3166_1 === "US") ?? regions[0];
  const dated = (us?.release_dates ?? []).find((entry) => (entry.certification ?? "").trim());
  return dated?.certification?.trim() || null;
}

/** A YouTube trailer: official beats unofficial, trailers beat everything. */
function trailerOf(details: TmdbDetails): string | null {
  const videos = (details.videos?.results ?? []).filter((video) => video.site === "YouTube" && video.key);
  const trailer = videos.find((video) => video.type === "Trailer" && video.official);
  const anyTrailer = videos.find((video) => video.type === "Trailer");
  const fallback = videos[0];
  const chosen = trailer ?? anyTrailer ?? fallback;
  return chosen ? `https://www.youtube.com/watch?v=${chosen.key}` : null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (!TMDB_API_KEY) return json({ configured: false });

    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing Authorization header" }, 401);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Invalid session" }, 401);

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 500);
    if (profile?.role !== "admin") return json({ error: "Admin access required" }, 403);

    let body: { action?: string; query?: string; id?: number } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (body.action === "search") {
      const query = (body.query ?? "").trim();
      if (!query) return json({ results: [] });

      const data = await tmdb<{ results?: TmdbSearchRow[] }>("/search/movie", {
        query: query.slice(0, 200),
        include_adult: "false",
        page: "1",
      });

      const results = (data.results ?? []).slice(0, SEARCH_PAGE_SIZE).map((row) => ({
        id: row.id,
        title: row.title,
        release_date: row.release_date ?? null,
        overview: row.overview ?? null,
        poster_url: imageUrl(row.poster_path, "w342"),
        vote_average:
          typeof row.vote_average === "number" && row.vote_average > 0
            ? Math.round(row.vote_average * 10) / 10
            : null,
      }));
      return json({ results });
    }

    if (body.action === "details") {
      const id = Number(body.id);
      if (!Number.isFinite(id) || id <= 0) return json({ error: "A TMDb id is required" }, 400);

      const details = await tmdb<TmdbDetails>(`/movie/${id}`, {
        append_to_response: "videos,release_dates",
        include_video_language: "en,null",
      });

      const year = details.release_date ? Number(details.release_date.slice(0, 4)) : Number.NaN;

      return json({
        tmdb_id: details.id,
        title: details.title,
        description: details.overview ?? null,
        release_year: Number.isFinite(year) && year > 0 ? year : null,
        runtime_seconds:
          typeof details.runtime === "number" && details.runtime > 0 ? details.runtime * 60 : null,
        maturity_rating: certificationOf(details) ?? "NR",
        poster_url: imageUrl(details.poster_path, "w780"),
        backdrop_url: imageUrl(details.backdrop_path, "original"),
        trailer_url: trailerOf(details),
        genre_names: (details.genres ?? []).map((genre) => genre.name).filter(Boolean),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "TMDb request failed" }, 502);
  }
});
