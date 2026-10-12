import { Platform } from "react-native";
import { getSupabase } from "./supabase";
import { planHero } from "./heroPlan";
import { parseSubtitles, type SubtitleCue } from "./subtitles";
import { FOR_YOU_FETCH_LIMIT, type RelatedCandidate } from "./forYou";
import type {
  ContinueItem,
  Genre,
  HeroItem,
  HomeFeed,
  HomeRow,
  Movie,
  PopularGenre,
  UserList,
  WatchProgress,
} from "./types";

// All catalog reads go through here. Every query runs as the signed-in user,
// so Row Level Security decides what is visible (active titles for members,
// premium renditions only for premium accounts — enforced later at playback
// by the sign-stream-url edge function).

const HERO_SIZE = 3;
const NEW_RELEASES_SIZE = 6;
const HOME_ROW_SIZE = 3;
const CATEGORY_PAGE_SIZE = 30;
const TRENDING_SHELF_SIZE = 8;
const POPULAR_GENRE_SIZE = 8;
const POPULAR_GENRE_MAX_MOVIES = 1000;

export const NEW_LISTING_SEGMENT = "new";
export const USER_LIST_FREE_LIMIT = 5;
export const USER_LIST_PREMIUM_LIMIT = 15;

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

const HERO_MOVIE_COLS = `${MOVIE_COLS}, movie_genres(genre_id, genres(id, name, slug, sort_order))`;

function toMovieWithGenres(raw: unknown): Movie {
  const row = raw as { movie_genres?: { genres: Genre | null }[] | null };
  const movie = toMovie(raw as MovieRowRecord);
  const genres = (row.movie_genres ?? [])
    .map((link) => link.genres)
    .filter((g): g is Genre => !!g);
  return { ...movie, genres };
}

/** The admin-featured title for the hero (null when none is set). */
export async function fetchFeatured(): Promise<Movie | null> {
  const { data, error } = await getSupabase()
    .from("movies")
    .select(HERO_MOVIE_COLS)
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(message(error));
  return data ? toMovieWithGenres(data) : null;
}

export async function fetchNewestMovies(limit: number): Promise<Movie[]> {
  const { data, error } = await getSupabase()
    .from("movies")
    .select(HERO_MOVIE_COLS)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(message(error));
  return (data ?? []).map(toMovieWithGenres);
}

let trendingRpcMissingLogged = false;

export async function fetchTrendingMovies(limit: number): Promise<Movie[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("trending_movie_ids", { p_limit: limit });
    if (error) throw new Error(message(error));
    const ids = ((data ?? []) as { movie_id: string }[]).map((row) => row.movie_id);
    if (ids.length === 0) return [];

    const { data: rows, error: rowsError } = await sb
      .from("movies")
      .select(HERO_MOVIE_COLS)
      .eq("is_active", true)
      .in("id", ids);
    if (rowsError) throw new Error(message(rowsError));

    const byId = new Map(((rows ?? []) as unknown[]).map((raw) => {
      const movie = toMovieWithGenres(raw);
      return [movie.id, movie] as const;
    }));
    const ordered: Movie[] = [];
    for (const id of ids) {
      const movie = byId.get(id);
      if (movie) ordered.push(movie);
    }
    return ordered;
  } catch (e) {
    if (e instanceof Error && e.message.includes("trending_movie_ids")) {
      if (!trendingRpcMissingLogged) {
        trendingRpcMissingLogged = true;
        console.log(
          "[home] trending_movie_ids RPC not applied — run supabase/migrations/20261008140000_home_lists_subtitles.sql (the Trending hero slide waits for it)"
        );
      }
    } else {
      console.warn("[home] trending hero slot unavailable", e);
    }
    return [];
  }
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

/** Everything the home screen needs: hero slots, shelves, genre shortcuts. */
export async function fetchHomeFeed(): Promise<HomeFeed> {
  const [featured, newest, trending, continueWatching, popularGenres, rows] = await Promise.all([
    fetchFeatured(),
    fetchNewestMovies(NEW_RELEASES_SIZE + HERO_SIZE),
    fetchTrendingMovies(TRENDING_SHELF_SIZE),
    fetchContinueWatching(),
    fetchPopularGenres(),
    fetchGenreRows(HOME_ROW_SIZE),
  ]);

  const hero: HeroItem[] = planHero(featured, newest, trending);
  return {
    hero,
    newReleases: newest.slice(0, NEW_RELEASES_SIZE),
    trending,
    continueWatching,
    popularGenres,
    rows,
  };
}

/** Genres with the most active titles — popularity chips on home. */
export async function fetchPopularGenres(limit = POPULAR_GENRE_SIZE): Promise<PopularGenre[]> {
  const sb = getSupabase();
  const [genres, moviesResult] = await Promise.all([
    fetchGenres(),
    sb
      .from("movies")
      .select("movie_genres(genre_id)")
      .eq("is_active", true)
      .limit(POPULAR_GENRE_MAX_MOVIES),
  ]);
  if (moviesResult.error) throw new Error(message(moviesResult.error));

  const counts = new Map<string, number>();
  for (const raw of (moviesResult.data ?? []) as unknown[]) {
    const links = (raw as { movie_genres?: { genre_id: string }[] | null }).movie_genres ?? [];
    for (const link of links) {
      counts.set(link.genre_id, (counts.get(link.genre_id) ?? 0) + 1);
    }
  }

  return genres
    .map((genre) => ({ genre, count: counts.get(genre.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.genre.sort_order - b.genre.sort_order)
    .slice(0, limit);
}

export async function fetchGenre(id: string): Promise<Genre | null> {
  const { data, error } = await getSupabase()
    .from("genres")
    .select("id, name, slug, sort_order, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(message(error));
  return (data as Genre) ?? null;
}

export type GenrePage = {
  movies: Movie[];
  total: number;
  hasMore: boolean;
};

export async function fetchListingMovies(
  genreId: string | null,
  page: number,
  pageSize = CATEGORY_PAGE_SIZE
): Promise<GenrePage> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  if (!genreId) {
    const { data, error, count } = await getSupabase()
      .from("movies")
      .select(MOVIE_COLS, { count: "exact" })
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(message(error));
    const rows = (data ?? []) as unknown as MovieRowRecord[];
    return {
      movies: rows.map(toMovie),
      total: count ?? 0,
      hasMore: rows.length === pageSize,
    };
  }

  const { data, error, count } = await getSupabase()
    .from("movies")
    .select(`${MOVIE_COLS}, movie_genres!inner(genre_id)`, { count: "exact" })
    .eq("is_active", true)
    .eq("movie_genres.genre_id", genreId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(message(error));

  const rows = (data ?? []) as unknown as MovieRowRecord[];
  return {
    movies: rows.map(toMovie),
    total: count ?? 0,
    hasMore: rows.length === pageSize,
  };
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

/**
 * Active titles to suggest on the detail page's For You shelf: everything
 * sharing at least one genre with `genreIds`, newest first, minus the
 * clicked title. Without genres to match, the newest active titles come
 * back as the fallback pool (ranked — not filtered — by forYou.ts).
 */
export async function fetchRelatedCandidates(
  genreIds: string[],
  excludeId: string,
  limit = FOR_YOU_FETCH_LIMIT
): Promise<RelatedCandidate[]> {
  let query = getSupabase()
    .from("movies")
    .select(`${MOVIE_COLS}, movie_genres!inner(genre_id)`)
    .eq("is_active", true)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (genreIds.length > 0) {
    query = query.in("movie_genres.genre_id", genreIds);
  }

  const { data, error } = await query;
  if (error) throw new Error(message(error));

  return ((data ?? []) as unknown as MovieRowRecord[]).map((row) => {
    const { movie_genres, ...movie } = row;
    return { ...movie, genre_ids: (movie_genres ?? []).map((link) => link.genre_id) };
  });
}

export type SubtitleOption = {
  language: string;
  label: string;
  /** Language the file was detected as actually being written in (null
   *  until the edge function has looked at it once). */
  detected: string | null;
  /** "upload" for admin files, "generated" for in-app audio scans. */
  origin: "upload" | "generated";
};

type SubtitleRow = {
  language: string;
  label: string;
  detected_language?: string | null;
  origin?: string | null;
};

/** Languages an admin has uploaded a source subtitle file for, plus any
 *  transcripts the in-app scanner produced. The optional columns are
 *  defensive: on a database missing them the sheet falls back to a plain
 *  query rather than going dark on the subtitles that actually exist. */
export async function fetchSubtitleLanguages(movieId: string): Promise<SubtitleOption[]> {
  const sb = getSupabase();
  type Mode = "full" | "no-origin" | "plain";
  const read = async (
    mode: Mode
  ): Promise<{ rows: SubtitleRow[]; error: string | null }> => {
    const columns =
      mode === "full"
        ? "language, label, detected_language, origin"
        : mode === "no-origin"
          ? "language, label, detected_language"
          : "language, label";
    const res = await sb
      .from("movie_subtitles")
      .select(columns)
      .eq("movie_id", movieId)
      .order("language", { ascending: true });
    return {
      rows: (res.data as SubtitleRow[] | null) ?? [],
      error: res.error ? res.error.message : null,
    };
  };

  let { rows, error } = await read("full");
  if (error && error.includes("origin")) {
    ({ rows, error } = await read("no-origin"));
    if (error && error.includes("detected_language")) {
      ({ rows, error } = await read("plain"));
    }
  } else if (error && error.includes("detected_language")) {
    ({ rows, error } = await read("plain"));
  }
  if (error) throw new Error(error);

  return rows.map((row) => ({
    language: row.language,
    label: row.label,
    detected: row.detected_language ?? null,
    origin: row.origin === "generated" ? "generated" : "upload",
  }));
}

export type SubtitleDetection = {
  /** False when the title has no uploaded subtitle file to read. */
  available: boolean;
  /** Declared language of the file the generator translates from. */
  sourceLanguage: string | null;
  /** What the auto-detector thinks that file is written in. */
  detected: string | null;
};

/**
 * Auto-detects the language of a movie's source subtitle track (its
 * movie language, in the usual case) so the sheet can show it before the
 * viewer picks a language to generate. Guests may call this — only
 * translation needs a session. Detection is stored server-side, so the
 * first viewer to open a title pays for it and everyone after is instant.
 */
export async function detectSubtitleLanguage(movieId: string): Promise<SubtitleDetection> {
  const { data, error } = await getSupabase().functions.invoke("translate-subtitles", {
    body: { movie_id: movieId, action: "detect" },
  });
  if (error) throw new Error(error.message || "Could not detect the movie language");
  return {
    available: Boolean(data?.available),
    sourceLanguage: typeof data?.source_language === "string" ? data.source_language : null,
    detected: typeof data?.detected === "string" ? data.detected : null,
  };
}

/**
 * Cues for one movie in one language. Prefers an uploaded source file;
 * otherwise asks the translate-subtitles edge function (cached server-side).
 */
export async function fetchSubtitleCues(movieId: string, language: string): Promise<SubtitleCue[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("movie_subtitles")
    .select("source")
    .eq("movie_id", movieId)
    .eq("language", language)
    .maybeSingle();
  if (error) throw new Error(message(error));

  if (data) {
    const cues = parseSubtitles((data as { source: string }).source);
    if (cues.length > 0) return cues;
  }

  const { data: translated, error: fnError } = await sb.functions.invoke("translate-subtitles", {
    body: { movie_id: movieId, language },
  });
  if (fnError) {
    throw new Error(fnError.message || "Subtitles are unavailable for that language.");
  }
  const cues = Array.isArray(translated?.cues) ? (translated.cues as SubtitleCue[]) : [];
  if (cues.length === 0) {
    throw new Error("Subtitles are unavailable for that language.");
  }
  return cues;
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
 * Playable URL for a movie. Only the sign-stream-url edge function mints
 * them (HLS renditions + signed CDN URLs): `stream_url` is column-revoked
 * from client roles, so there is no raw fallback — a failed invoke means
 * the title isn't playable right now and the caller should surface that.
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
    console.warn("[playback] sign-stream-url failed", e);
  }

  return null;
}

/**
 * Byte-range-capable URL for the in-app audio scanner. Same signing path as
 * playback, but it throws when nothing is playable (the scanner cannot fall
 * back to "sort of works").
 */
export async function resolveScanUrl(movieId: string): Promise<string> {
  const sb = getSupabase();
  try {
    const { data, error } = await sb.functions.invoke("sign-stream-url", {
      body: { movie_id: movieId, purpose: "scan" },
    });
    if (!error && data && typeof data.url === "string" && data.url) return data.url;
  } catch (e) {
    console.warn("[scan] sign-stream-url failed", e);
  }
  throw new Error("This movie has no streamable source to scan");
}

/** Stores an engine-produced transcript (origin "generated") server-side. */
export async function saveGeneratedTranscript(input: {
  movieId: string;
  language: string;
  detected?: string | null;
  cues: { s: number; e: number; t: string }[];
}): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.functions.invoke("save-transcript", {
    body: {
      movie_id: input.movieId,
      language: input.language,
      detected: input.detected ?? input.language,
      cues: input.cues,
    },
  });
  if (error) {
    let detail = error.message || "could not save the transcript";
    const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (context?.json) {
      try {
        const payload = await context.json();
        if (payload?.error) detail = payload.error;
      } catch {
        // keep the generic message
      }
    }
    if (detail.includes("already exists")) {
      throw new Error("An uploaded subtitle file already exists for this language");
    }
    throw new Error(detail);
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
 * Where Paystack sends the browser back after checkout. Native deep-links
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
  | { url: string; reference?: string }
  | { url: null; reason: "not-configured" | "already-premium" | "error"; message?: string };

export type CheckoutMode = "subscription" | "transfer";

/**
 * Ask the checkout edge function to initialize a Paystack transaction.
 * `subscription` opens the recurring card checkout (plan-bound), `transfer`
 * opens a one-time Pay-with-Transfer charge that grants a 30-day window.
 * Falls back to `not-configured` while Paystack secrets are unset, so the
 * app keeps its "Premium is coming soon" state on fresh installs.
 */
export async function startCheckout(mode: CheckoutMode = "subscription"): Promise<CheckoutResult> {
  const sb = getSupabase();
  try {
    const { data, error } = await sb.functions.invoke("checkout", {
      body: { redirect_url: checkoutRedirectUrl(), mode },
    });
    if (error) return { url: null, reason: "error", message: error.message };
    if (data?.configured === false) return { url: null, reason: "not-configured" };
    if (data?.error === "already_premium") return { url: null, reason: "already-premium" };
    if (typeof data?.url === "string" && data.url) {
      return {
        url: data.url,
        reference: typeof data?.reference === "string" ? data.reference : undefined,
      };
    }
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

export type CheckoutVerification = { premium: boolean; status: string; message?: string };

/**
 * Confirm a Paystack reference after the browser returns. The edge function
 * verifies the transaction server-to-server and grants premium instantly;
 * the webhook remains the source of truth for renewals and cancellations.
 */
export async function verifyCheckout(reference: string): Promise<CheckoutVerification> {
  try {
    const { data, error } = await getSupabase().functions.invoke("paystack-verify", {
      body: { reference },
    });
    if (error) return { premium: false, status: "error", message: error.message };
    return {
      premium: data?.premium === true,
      status: typeof data?.status === "string" ? data.status : "unknown",
    };
  } catch (e) {
    return {
      premium: false,
      status: "error",
      message: e instanceof Error ? e.message : undefined,
    };
  }
}

const USER_LIST_COLS = "id, name, created_at, user_list_items(count)";

function toUserList(raw: unknown): UserList {
  const row = raw as {
    id: string;
    name: string;
    created_at: string;
    user_list_items?: { count: number }[] | null;
  };
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    movie_count: row.user_list_items?.[0]?.count ?? 0,
  };
}

export function listLimitFor(isPremium: boolean | null | undefined): number {
  return isPremium ? USER_LIST_PREMIUM_LIMIT : USER_LIST_FREE_LIMIT;
}

export function isListLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("list limit reached");
}

export async function fetchUserLists(): Promise<UserList[]> {
  const { data, error } = await getSupabase()
    .from("user_lists")
    .select(USER_LIST_COLS)
    .order("created_at", { ascending: true });
  if (error) throw new Error(message(error));
  return ((data ?? []) as unknown[]).map(toUserList);
}

export async function fetchUserList(id: string): Promise<UserList | null> {
  const { data, error } = await getSupabase()
    .from("user_lists")
    .select(USER_LIST_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(message(error));
  return data ? toUserList(data) : null;
}

export async function createUserList(name: string): Promise<UserList> {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) throw new Error("List name required");
  const { data, error } = await getSupabase()
    .from("user_lists")
    .insert({ name: trimmed })
    .select("id, name, created_at")
    .single();
  if (error) throw new Error(message(error));
  return { ...(data as Omit<UserList, "movie_count">), movie_count: 0 };
}

export async function deleteUserList(id: string): Promise<void> {
  const { error } = await getSupabase().from("user_lists").delete().eq("id", id);
  if (error) throw new Error(message(error));
}

export async function fetchListMovies(
  listId: string,
  page = 0,
  pageSize = CATEGORY_PAGE_SIZE
): Promise<GenrePage> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await getSupabase()
    .from("user_list_items")
    .select(`movie_id, movies!inner(${MOVIE_COLS})`, { count: "exact" })
    .eq("list_id", listId)
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(message(error));

  const movies: Movie[] = [];
  for (const raw of (data ?? []) as unknown[]) {
    const row = raw as { movies?: MovieRowRecord | null };
    if (row.movies) movies.push(toMovie(row.movies));
  }
  return { movies, total: count ?? 0, hasMore: movies.length === pageSize };
}

/** Which of the signed-in user's lists already hold this movie. */
export async function fetchListIdsForMovie(movieId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("user_list_items")
    .select("list_id")
    .eq("movie_id", movieId);
  if (error) throw new Error(message(error));
  return ((data ?? []) as { list_id: string }[]).map((row) => row.list_id);
}

export async function addMovieToList(listId: string, movieId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("user_list_items")
    .insert({ list_id: listId, movie_id: movieId });
  if (error && error.code !== "23505") throw new Error(message(error));
}

export async function removeMovieFromList(listId: string, movieId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("user_list_items")
    .delete()
    .eq("list_id", listId)
    .eq("movie_id", movieId);
  if (error) throw new Error(message(error));
}
