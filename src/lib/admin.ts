import { getSupabase } from "./supabase";

// Admin console data layer. Every query runs as the signed-in user, so RLS
// is the real gate: the client-side admin guard in app/admin/index.jsx is
// only UX. The init migration (plus 20261006110000_admin_grants_policy.sql)
// grants admins write access to every table touched here.

export type AdminMovie = {
  id: string;
  title: string;
  description: string | null;
  release_year: number | null;
  maturity_rating: string;
  runtime_seconds: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  stream_url: string | null;
  r2_key_free: string | null;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
  genre_ids: string[];
  premium_r2_key: string | null;
  premium_stream_url: string | null;
};

export type AdminMovieInput = Omit<
  AdminMovie,
  "id" | "created_at" | "genre_ids" | "premium_r2_key" | "premium_stream_url"
> & {
  genre_ids: string[];
  premium_r2_key: string | null;
  premium_stream_url: string | null;
};

export type AdminAdSettings = {
  pre_roll_enabled: boolean;
  mid_roll_enabled: boolean;
  banner_enabled: boolean;
  mid_roll_interval_seconds: number;
  fail_open: boolean;
};

export type AdminAdUnit = {
  placement: string;
  android_unit_id: string | null;
  ios_unit_id: string | null;
  web_unit_id: string | null;
  tv_unit_id: string | null;
  enabled: boolean;
};

export type GrantRecord = {
  user_id: string;
  movie_id: string;
  granted_at: string;
  expires_at: string | null;
  profile_name: string | null;
  movie_title: string | null;
};

export type ProfileSummary = {
  id: string;
  display_name: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  created_at: string;
};

export type MovieTitle = { id: string; title: string };

type MovieSourceRelation = { r2_key: string | null; stream_url: string | null } | null;

type AdminMovieRow = Omit<AdminMovie, "genre_ids" | "premium_r2_key" | "premium_stream_url"> & {
  movie_genres: { genre_id: string }[] | null;
  premium_movie_sources: MovieSourceRelation;
};

function message(error: { message: string } | null): string {
  return error?.message ?? "Unexpected error";
}

const ADMIN_MOVIE_COLS = [
  "id",
  "title",
  "description",
  "release_year",
  "maturity_rating",
  "runtime_seconds",
  "poster_url",
  "backdrop_url",
  "trailer_url",
  "stream_url",
  "r2_key_free",
  "is_active",
  "is_featured",
  "created_at",
  "movie_genres(genre_id)",
  "premium_movie_sources(r2_key, stream_url)",
].join(", ");

function toAdminMovie(row: AdminMovieRow): AdminMovie {
  const { movie_genres, premium_movie_sources, ...movie } = row;
  return {
    ...movie,
    genre_ids: (movie_genres ?? []).map((link) => link.genre_id),
    premium_r2_key: premium_movie_sources?.r2_key ?? null,
    premium_stream_url: premium_movie_sources?.stream_url ?? null,
  };
}

function movieRow(input: AdminMovieInput): Record<string, unknown> {
  return {
    title: input.title.trim(),
    description: input.description,
    release_year: input.release_year,
    maturity_rating: input.maturity_rating,
    runtime_seconds: input.runtime_seconds,
    poster_url: input.poster_url,
    backdrop_url: input.backdrop_url,
    trailer_url: input.trailer_url,
    stream_url: input.stream_url,
    r2_key_free: input.r2_key_free,
    is_active: input.is_active,
    is_featured: input.is_featured,
  };
}

/** Every movie (active or not), newest first — admins bypass movies_read_active. */
export async function fetchAdminMovies(): Promise<AdminMovie[]> {
  const { data, error } = await getSupabase()
    .from("movies")
    .select(ADMIN_MOVIE_COLS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(message(error));
  return ((data ?? []) as unknown as AdminMovieRow[]).map(toAdminMovie);
}

/** Insert (returns the new id) or update a movie, syncing genres + premium source. */
export async function saveAdminMovie(id: string | null, input: AdminMovieInput): Promise<string> {
  const sb = getSupabase();
  const row = movieRow(input);
  let movieId = id;

  if (id) {
    const { error } = await sb.from("movies").update(row).eq("id", id);
    if (error) throw new Error(message(error));
  } else {
    const { data: authData } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("movies")
      .insert({ ...row, created_by: authData.user?.id ?? null })
      .select("id")
      .single();
    if (error || !data) throw new Error(message(error));
    movieId = (data as { id: string }).id;
  }
  if (!movieId) throw new Error("Movie id missing after save");

  const { error: unlinkError } = await sb.from("movie_genres").delete().eq("movie_id", movieId);
  if (unlinkError) throw new Error(message(unlinkError));
  if (input.genre_ids.length > 0) {
    const links = input.genre_ids.map((genreId) => ({ movie_id: movieId, genre_id: genreId }));
    const { error: linkError } = await sb.from("movie_genres").insert(links);
    if (linkError) throw new Error(message(linkError));
  }

  if (input.premium_r2_key || input.premium_stream_url) {
    const { error: premiumError } = await sb
      .from("premium_movie_sources")
      .upsert(
        {
          movie_id: movieId,
          r2_key: input.premium_r2_key,
          stream_url: input.premium_stream_url,
        },
        { onConflict: "movie_id" }
      );
    if (premiumError) throw new Error(message(premiumError));
  } else {
    const { error: premiumError } = await sb
      .from("premium_movie_sources")
      .delete()
      .eq("movie_id", movieId);
    if (premiumError) throw new Error(message(premiumError));
  }

  return movieId;
}

export async function setMovieFlags(
  id: string,
  patch: { is_active?: boolean; is_featured?: boolean }
): Promise<void> {
  const { error } = await getSupabase().from("movies").update(patch).eq("id", id);
  if (error) throw new Error(message(error));
}

type MovieAssetRow = {
  r2_key_free: string | null;
  poster_url: string | null;
  backdrop_url: string | null;
  premium_movie_sources: { r2_key: string | null } | null;
};

function artworkObjectPath(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/artwork/";
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function purgeMovieAssets(row: MovieAssetRow | null): Promise<string | null> {
  if (!row) return null;
  const sb = getSupabase();
  let failed = 0;

  const keys = [
    ...new Set(
      [row.r2_key_free, row.premium_movie_sources?.r2_key].filter(
        (key): key is string => !!key && key.startsWith("videos/")
      )
    ),
  ];
  for (const key of keys) {
    try {
      const { data, error } = await sb.functions.invoke("r2-delete", { body: { key } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      if (data?.ok !== true) throw new Error("storage refused the delete");
    } catch (e) {
      failed += 1;
      console.warn(`[admin] video object cleanup failed for ${key}`, e);
    }
  }

  const paths = [
    ...new Set(
      [row.poster_url, row.backdrop_url].map(artworkObjectPath).filter((p): p is string => !!p)
    ),
  ];
  if (paths.length > 0) {
    try {
      const { error } = await sb.storage.from("artwork").remove(paths);
      if (error) throw new Error(error.message);
    } catch (e) {
      failed += 1;
      console.warn("[admin] artwork cleanup failed", e);
    }
  }

  if (failed === 0) return null;
  const noun = failed === 1 ? "object" : "objects";
  return `Storage cleanup failed for ${failed} ${noun} — see the console for details.`;
}

/**
 * Hard delete: row first (cascades genres, markers, grants, premium source),
 * then best-effort storage cleanup — the B2 video objects via the r2-delete
 * edge function and the poster/backdrop from the artwork bucket. Returns a
 * warning string when storage cleanup partially failed, null otherwise.
 */
export async function deleteAdminMovie(id: string): Promise<string | null> {
  const sb = getSupabase();
  const { data: row, error: fetchError } = await sb
    .from("movies")
    .select("r2_key_free, poster_url, backdrop_url, premium_movie_sources(r2_key)")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) throw new Error(message(fetchError));

  const { error } = await sb.from("movies").delete().eq("id", id);
  if (error) throw new Error(message(error));

  return purgeMovieAssets((row as MovieAssetRow | null) ?? null);
}

export async function fetchAdSettings(): Promise<AdminAdSettings | null> {
  const { data, error } = await getSupabase()
    .from("ad_settings")
    .select(
      "pre_roll_enabled, mid_roll_enabled, banner_enabled, mid_roll_interval_seconds, fail_open"
    )
    .maybeSingle();
  if (error) throw new Error(message(error));
  return (data as AdminAdSettings | null) ?? null;
}

/** Upsert the singleton row (seeded with id = true). */
export async function saveAdSettings(settings: AdminAdSettings): Promise<void> {
  const { error } = await getSupabase()
    .from("ad_settings")
    .upsert({ id: true, ...settings }, { onConflict: "id" });
  if (error) throw new Error(message(error));
}

export async function fetchAdUnits(): Promise<AdminAdUnit[]> {
  const { data, error } = await getSupabase()
    .from("ad_units")
    .select("placement, android_unit_id, ios_unit_id, web_unit_id, tv_unit_id, enabled")
    .order("placement", { ascending: true });
  if (error) throw new Error(message(error));
  return (data ?? []) as AdminAdUnit[];
}

export async function saveAdUnit(unit: AdminAdUnit): Promise<void> {
  const { error } = await getSupabase()
    .from("ad_units")
    .upsert(unit, { onConflict: "placement" });
  if (error) throw new Error(message(error));
}

type GrantRow = {
  user_id: string;
  movie_id: string;
  granted_at: string;
  expires_at: string | null;
  profiles: { display_name: string | null } | null;
  movies: { title: string } | null;
};

export async function fetchGrants(): Promise<GrantRecord[]> {
  const { data, error } = await getSupabase()
    .from("download_grants")
    .select("user_id, movie_id, granted_at, expires_at, profiles(display_name), movies(title)")
    .order("granted_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(message(error));
  return ((data ?? []) as unknown as GrantRow[]).map((row) => ({
    user_id: row.user_id,
    movie_id: row.movie_id,
    granted_at: row.granted_at,
    expires_at: row.expires_at,
    profile_name: row.profiles?.display_name ?? null,
    movie_title: row.movies?.title ?? null,
  }));
}

/** Every profile (admin can read them all) — used to pick a grant target. */
export async function fetchProfileSummaries(): Promise<ProfileSummary[]> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, display_name, role, is_premium, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(message(error));
  return (data ?? []) as unknown as ProfileSummary[];
}

/** Lightweight id/title list for pickers (includes inactive titles). */
export async function fetchMovieTitles(): Promise<MovieTitle[]> {
  const { data, error } = await getSupabase()
    .from("movies")
    .select("id, title")
    .order("title", { ascending: true })
    .limit(500);
  if (error) throw new Error(message(error));
  return (data ?? []) as MovieTitle[];
}

export async function grantDownloadToUser(userId: string, movieId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("download_grants")
    .upsert({ user_id: userId, movie_id: movieId }, { onConflict: "user_id,movie_id" });
  if (error) throw new Error(message(error));
}

export async function revokeDownloadFromUser(userId: string, movieId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("download_grants")
    .delete()
    .eq("user_id", userId)
    .eq("movie_id", movieId);
  if (error) throw new Error(message(error));
}

export type AdminSubtitle = {
  id: string;
  movie_id: string;
  language: string;
  label: string;
  created_at: string;
};

/** Subtitle files uploaded for one movie (metadata only). */
export async function fetchAdminSubtitles(movieId: string): Promise<AdminSubtitle[]> {
  const { data, error } = await getSupabase()
    .from("movie_subtitles")
    .select("id, movie_id, language, label, created_at")
    .eq("movie_id", movieId)
    .order("language", { ascending: true });
  if (error) throw new Error(message(error));
  return (data ?? []) as AdminSubtitle[];
}

/** Adds (or replaces) the subtitle file for one movie + language. */
export async function saveAdminSubtitle(input: {
  movie_id: string;
  language: string;
  label: string;
  source: string;
}): Promise<void> {
  const { error } = await getSupabase()
    .from("movie_subtitles")
    .upsert(input, { onConflict: "movie_id,language" });
  if (error) throw new Error(message(error));
}

export async function deleteAdminSubtitle(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from("movie_subtitles")
    .delete()
    .eq("id", id);
  if (error) throw new Error(message(error));
}
