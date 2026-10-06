import { Platform } from "react-native";
import { getSupabase } from "./supabase";
import type { ContinueItem, Genre, HomeFeed, HomeRow, Movie, WatchProgress } from "./types";

// All catalog reads go through here. Every query runs as the signed-in user,
// so Row Level Security decides what is visible (active titles for members,
// premium renditions only for premium accounts — enforced later at playback
// by the sign-stream-url edge function).

const MOVIE_COLS = [
  "id",
  "title",
  "description",
  "release_year",
  "maturity_rating",
  "runtime_seconds",
  "poster_url",
  "backdrop_url",
  "trailer_url",
  "is_featured",
  "is_active",
  "created_at",
].join(", ");

export type MovieRowRecord = Movie & { movie_genres?: { genre_id: string }[] };

function toMovie(row: MovieRowRecord): Movie {
  const { movie_genres: _links, ...movie } = row;
  return movie;
}

function message(error: { message: string } | null): string {
  return error?.message ?? "Unexpected error";
}

/** Featured title for the hero, falling back to the newest active title. */
export async function fetchFeatured(): Promise<Movie | null> {
  const sb = getSupabase();

  const { data: featured, error: featuredError } = await sb
    .from("movies")
    .select(MOVIE_COLS)
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (featuredError) throw new Error(message(featuredError));
  if (featured) return featured as unknown as Movie;

  const { data: newest, error: newestError } = await sb
    .from("movies")
    .select(MOVIE_COLS)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newestError) throw new Error(message(newestError));
  return (newest as unknown as Movie) ?? null;
}

/** Genres in curated order (only ones the app will show rows for). */
export async function fetchGenres(): Promise<Genre[]> {
  const { data, error } = await getSupabase()
    .from("genres")
    .select("id, name, slug, sort_order, created_at")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(message(error));
  return (data ?? []) as Genre[];
}

/** Active titles bucketed by genre (newest first, capped per row). */
export async function fetchGenreRows(limitPerRow = 12): Promise<HomeRow[]> {
  const sb = getSupabase();

  const [genres, moviesResult] = await Promise.all([
    fetchGenres(),
    sb
      .from("movies")
      .select(`${MOVIE_COLS}, movie_genres(genre_id)`)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);
  if (moviesResult.error) throw new Error(message(moviesResult.error));

  const rows = new Map<string, HomeRow>();
  for (const genre of genres) rows.set(genre.id, { genre, movies: [] });

  for (const raw of (moviesResult.data ?? []) as unknown as MovieRowRecord[]) {
    const movie = toMovie(raw);
    for (const link of raw.movie_genres ?? []) {
      const row = rows.get(link.genre_id);
      if (row && row.movies.length < limitPerRow) row.movies.push(movie);
    }
  }

  return [...rows.values()].filter((row) => row.movies.length > 0);
}

/** In-progress titles for the continue-watching shelf (own rows via RLS). */
export async function fetchContinueWatching(limit = 12): Promise<ContinueItem[]> {
  const { data, error } = await getSupabase()
    .from("watch_progress")
    .select(
      `movie_id, position_seconds, duration_seconds, completed, updated_at,
       movies!inner(${MOVIE_COLS})`
    )
    .eq("completed", false)
    .gt("position_seconds", 5)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(message(error));

  return ((data ?? []) as unknown[]).flatMap((raw) => {
    const row = raw as {
      movie_id: string;
      position_seconds: number;
      duration_seconds: number;
      completed: boolean;
      updated_at: string;
      movies: MovieRowRecord;
    };
    if (!row.movies) return [];
    return [
      {
        movie: toMovie(row.movies),
        progress: {
          movie_id: row.movie_id,
          position_seconds: row.position_seconds,
          duration_seconds: row.duration_seconds,
          completed: row.completed,
          updated_at: row.updated_at,
        },
      },
    ];
  });
}

/** Everything the home screen needs in three queries. */
export async function fetchHomeFeed(): Promise<HomeFeed> {
  const [featured, continueWatching, rows] = await Promise.all([
    fetchFeatured(),
    fetchContinueWatching(),
    fetchGenreRows(),
  ]);
  return { featured, continueWatching, rows };
}

/** Title search (case-insensitive substring match, active titles only). */
export async function searchMovies(query: string): Promise<Movie[]> {
  const q = query.trim();
  if (!q) return [];

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await getSupabase()
    .from("movies")
    .select(MOVIE_COLS)
    .eq("is_active", true)
    .ilike("title", `%${escaped}%`)
    .order("title", { ascending: true })
    .limit(50);

  if (error) throw new Error(message(error));
  return (data ?? []) as unknown as Movie[];
}

/** One movie with its genres attached (for the detail screen). */
export async function fetchMovie(id: string): Promise<Movie | null> {
  const { data, error } = await getSupabase()
    .from("movies")
    .select(`${MOVIE_COLS}, movie_genres(genre_id, genres(id, name, slug, sort_order))`)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(message(error));
  if (!data) return null;

  const row = data as unknown as {
    movie_genres?: { genres: Genre | null }[];
  } & Movie;

  const genres = (row.movie_genres ?? [])
    .map((link) => link.genres)
    .filter((g): g is Genre => !!g);

  const { movie_genres: _links, ...movie } = row as Movie & { movie_genres?: unknown };
  return { ...movie, genres };
}

/** Resume position for one movie (0 when never watched). */
export async function fetchWatchProgress(movieId: string): Promise<WatchProgress | null> {
  const { data, error } = await getSupabase()
    .from("watch_progress")
    .select("movie_id, position_seconds, duration_seconds, completed, updated_at")
    .eq("movie_id", movieId)
    .maybeSingle();

  if (error) throw new Error(message(error));
  return (data as WatchProgress) ?? null;
}

export type StreamSource = {
  url: string;
  quality: string;
  source: "presigned" | "direct" | "local";
};

/**
 * Playable URL for a movie. Prefers the sign-stream-url edge function (HLS
 * renditions + signed CDN URLs); falls back to the raw public stream_url so
 * local dev without deployed functions still plays. Returns null when the
 * title has no directly playable source (e.g. R2-only without the function).
 */
export async function resolveStreamUrl(movieId: string): Promise<StreamSource | null> {
  const sb = getSupabase();

  try {
    const { data, error } = await sb.functions.invoke("sign-stream-url", {
      body: { movie_id: movieId },
    });
    if (!error && data && typeof data.url === "string" && data.url) {
      return {
        url: data.url,
        quality: typeof data.quality === "string" ? data.quality : "free",
        source: "presigned",
      };
    }
  } catch (e) {
    console.warn("[playback] sign-stream-url unavailable, trying direct", e);
  }

  const { data, error } = await sb
    .from("movies")
    .select("stream_url")
    .eq("id", movieId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(message(error));

  const url = (data as { stream_url?: string | null } | null)?.stream_url;
  return url ? { url, quality: "free", source: "direct" } : null;
}

/** Manual mid-roll cue points for a title (empty when none are placed). */
export async function fetchAdMarkers(movieId: string): Promise<number[]> {
  try {
    const { data, error } = await getSupabase()
      .from("ad_markers")
      .select("at_seconds")
      .eq("movie_id", movieId)
      .eq("kind", "mid_roll")
      .order("at_seconds", { ascending: true });
    if (error) throw new Error(message(error));
    return (data ?? []).map((row) => (row as { at_seconds: number }).at_seconds);
  } catch (e) {
    console.warn("[playback] ad markers unavailable", e);
    return [];
  }
}

/**
 * Upsert the resume point for the signed-in user. Fire-and-forget friendly:
 * failures log a warning instead of surfacing to the player.
 */
export async function saveWatchProgress(input: {
  movieId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed?: boolean;
}): Promise<void> {
  const sb = getSupabase();
  try {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const { error } = await sb.from("watch_progress").upsert(
      {
        user_id: userId,
        movie_id: input.movieId,
        position_seconds: Math.max(0, Math.floor(input.positionSeconds)),
        duration_seconds: Math.max(0, Math.floor(input.durationSeconds)),
        completed: input.completed ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,movie_id" }
    );
    if (error) throw new Error(message(error));
  } catch (e) {
    console.warn("[playback] progress save failed", e);
  }
}

/** Analytics: one row per play/resume/complete (never blocks playback). */
export async function logPlaybackEvent(input: {
  movieId: string;
  event: "play" | "resume" | "complete";
  positionSeconds: number;
}): Promise<void> {
  const sb = getSupabase();
  try {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const { error } = await sb.from("playback_events").insert({
      user_id: userId,
      movie_id: input.movieId,
      event: input.event,
      position_seconds: Math.max(0, Math.floor(input.positionSeconds)),
    });
    if (error) throw new Error(message(error));
  } catch (e) {
    console.warn("[playback] event log failed", e);
  }
}

/** Analytics: ad impression/completion/skip/failure per break. */
export async function logAdEvent(input: {
  movieId?: string | null;
  placement: string;
  status: "impression" | "completed" | "skipped" | "failed";
}): Promise<void> {
  const sb = getSupabase();
  try {
    const { data: auth } = await sb.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const { error } = await sb.from("ad_events").insert({
      user_id: userId,
      movie_id: input.movieId ?? null,
      placement: input.placement,
      status: input.status,
    });
    if (error) throw new Error(message(error));
  } catch (e) {
    console.warn("[playback] ad event log failed", e);
  }
}

/**
 * Record the offline-download entitlement before a transfer starts. The
 * `download_grants_insert_premium` RLS policy re-checks premium server-side,
 * so a forged client cannot save titles without a premium row. Conflicts are
 * ignored (no UPDATE is attempted — the table has no update policy).
 */
export async function grantDownload(movieId: string): Promise<void> {
  const sb = getSupabase();
  const { data: auth } = await sb.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Sign in to download titles");

  const { error } = await sb
    .from("download_grants")
    .upsert(
      { user_id: userId, movie_id: movieId },
      { onConflict: "user_id,movie_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(message(error));
}

/** Drop the entitlement when a download is removed, cancelled or fails. */
export async function revokeDownload(movieId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from("download_grants")
      .delete()
      .eq("movie_id", movieId);
    if (error) throw new Error(message(error));
  } catch (e) {
    console.warn("[downloads] grant revoke failed", e);
  }
}

/**
 * Where Stripe sends the browser back after checkout. Native deep-links
 * into the app; web returns to the current origin (both land on Profile).
 */
export function checkoutRedirectUrl(): string {
  if (Platform.OS !== "web") return "ruxxstream://profile";
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/profile`;
  }
  return `${process.env.EXPO_PUBLIC_SITE_URL ?? ""}/profile`;
}

export type CheckoutResult =
  | { url: string }
  | { url: null; reason: "not-configured" | "already-premium" | "error"; message?: string };

/**
 * Ask the checkout edge function to create a Stripe Checkout session.
 * Falls back to `not-configured` while Stripe secrets are unset, so the
 * app keeps its "Premium is coming soon" state on fresh installs.
 */
export async function startCheckout(): Promise<CheckoutResult> {
  const sb = getSupabase();
  try {
    const { data, error } = await sb.functions.invoke("checkout", {
      body: { redirect_url: checkoutRedirectUrl() },
    });
    if (error) return { url: null, reason: "error", message: error.message };
    if (data?.configured === false) return { url: null, reason: "not-configured" };
    if (data?.error === "already_premium") return { url: null, reason: "already-premium" };
    if (typeof data?.url === "string" && data.url) return { url: data.url };
    return {
      url: null,
      reason: "error",
      message:
        typeof data?.error === "string" && data.error
          ? data.error
          : "Could not start checkout right now.",
    };
  } catch (e) {
    return {
      url: null,
      reason: "error",
      message: e instanceof Error ? e.message : "Could not start checkout right now.",
    };
  }
}
