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
