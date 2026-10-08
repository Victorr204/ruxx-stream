import type { Movie } from "./types";

// The "For You" shelf on the movie detail page. Candidates come from the
// catalog (titles sharing at least one genre with the clicked movie), get
// ranked by how many of its genres they share, and the pool is shown in
// fixed-size batches — the Suggest more button rotates to the next batch,
// replacing what was on screen.

/** How many related titles are fetched and ranked at most. */
export const FOR_YOU_FETCH_LIMIT = 60;
/** How many ranked titles the pool keeps (several batches' worth). */
export const FOR_YOU_POOL = 48;
/** Titles shown per batch. */
export const FOR_YOU_BATCH = 6;

export type RelatedCandidate = Movie & { genre_ids: string[] };

/**
 * Ranks candidate titles by shared-genre overlap with the clicked movie,
 * excludes the clicked title itself, and caps the pool. When the clicked
 * movie has no genres (or every candidate scores zero), the candidates are
 * kept as-is — the newest-first order from the catalog becomes a "more like
 * the latest titles" fallback instead of an empty shelf.
 */
export function rankRelated(
  candidates: RelatedCandidate[],
  genreIds: string[],
  currentId: string,
  poolSize: number = FOR_YOU_POOL
): Movie[] {
  const wanted = new Set(genreIds);

  const scored = candidates
    .filter((candidate) => candidate.id !== currentId)
    .map((candidate) => {
      const score = candidate.genre_ids.reduce(
        (hits, id) => hits + (wanted.has(id) ? 1 : 0),
        0
      );
      return { candidate, score };
    })
    .filter(({ score }) => wanted.size === 0 || score > 0);

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.candidate.created_at !== b.candidate.created_at) {
      return a.candidate.created_at < b.candidate.created_at ? 1 : -1;
    }
    return a.candidate.title.localeCompare(b.candidate.title);
  });

  return scored.slice(0, poolSize).map(({ candidate }) => {
    const { genre_ids: _genreIds, ...movie } = candidate;
    return movie;
  });
}

export type ForYouBatch = {
  items: Movie[];
  /** Where the *next* batch starts — feed it back into the next call. */
  nextStart: number;
};

/**
 * The batch at `start` of the pool, wrapping around the end so a small
 * catalog still fills the shelf. Batches never repeat an entry inside
 * themselves (size is capped at the pool length).
 */
export function forYouBatch(
  pool: Movie[],
  start: number,
  size: number = FOR_YOU_BATCH
): ForYouBatch {
  if (pool.length === 0 || size <= 0) return { items: [], nextStart: 0 };
  const offset = ((start % pool.length) + pool.length) % pool.length;
  const count = Math.min(size, pool.length);
  const items: Movie[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push(pool[(offset + i) % pool.length]);
  }
  return { items, nextStart: (offset + count) % pool.length };
}
