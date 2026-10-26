import { getSupabase } from "./supabase";
import type { Genre } from "./types";

// TMDb lookup for the admin catalog import.
//
// Everything goes through the `tmdb` Edge Function, which holds the API key
// and re-checks the caller's admin role — nothing here talks to TMDb directly.
// The catalog itself stays in Supabase: this only fills the editor's form, so
// an admin still reviews and saves every title.

/** Required by TMDb's API terms for any product that uses its data. */
export const TMDB_ATTRIBUTION =
  "This product uses the TMDb API but is not endorsed or certified by TMDb.";

export type TmdbSearchHit = {
  id: number;
  title: string;
  release_date: string | null;
  overview: string | null;
  poster_url: string | null;
  vote_average: number | null;
};

/** Everything the editor can fill from one TMDb title. */
export type TmdbImport = {
  tmdb_id: number;
  title: string;
  description: string | null;
  release_year: number | null;
  runtime_seconds: number | null;
  maturity_rating: string;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  genre_names: string[];
};

/** Pull the useful message out of a failed Edge Function call, if there is one. */
async function functionErrorDetail(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response })?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    const body = (await context.json()) as { error?: string; configured?: boolean };
    if (body?.configured === false) {
      return "TMDb isn't configured yet — set the TMDB_API_KEY secret on the tmdb function (either a v3 API key or a v4 read access token) and redeploy it.";
    }
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

/** Top hits for a title search. Empty query returns an empty list. */
export async function searchTmdbTitles(query: string): Promise<TmdbSearchHit[]> {
  const term = query.trim();
  if (!term) return [];

  const { data, error } = await getSupabase().functions.invoke("tmdb", {
    body: { action: "search", query: term },
  });
  if (error) {
    const detail = await functionErrorDetail(error);
    throw new Error(detail ?? "TMDb search failed — try again in a moment.");
  }
  return (data as { results?: TmdbSearchHit[] } | null)?.results ?? [];
}

/** Full record for one TMDb title, ready to drop into the editor's form. */
export async function fetchTmdbImport(tmdbId: number): Promise<TmdbImport> {
  const { data, error } = await getSupabase().functions.invoke("tmdb", {
    body: { action: "details", id: tmdbId },
  });
  if (error) {
    const detail = await functionErrorDetail(error);
    throw new Error(detail ?? "TMDb lookup failed — try again in a moment.");
  }
  if (!data || typeof data !== "object") throw new Error("TMDb returned nothing for that title.");
  return data as TmdbImport;
}

/**
 * Map TMDb genre names onto the genres that actually exist in this catalog.
 * Genres are admin-created, so a TMDb name with no counterpart is dropped
 * rather than silently inventing rows — the import panel reports the count.
 */
export function matchGenresByName(names: string[], genres: Genre[]): { ids: string[]; matched: number } {
  const byName = new Map(genres.map((genre) => [genre.name.trim().toLowerCase(), genre.id]));
  const ids: string[] = [];

  for (const name of names) {
    const id = byName.get(name.trim().toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { ids, matched: ids.length };
}
