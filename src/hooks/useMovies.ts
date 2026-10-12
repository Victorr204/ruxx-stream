import { useCallback, useEffect, useState } from "react";
import {
  fetchGenre,
  fetchHomeFeed,
  fetchListMovies,
  fetchListingMovies,
  fetchMovie,
  fetchRelatedCandidates,
  fetchUserList,
  NEW_LISTING_SEGMENT,
  searchMovies,
} from "../lib/api";
import { FOR_YOU_BATCH, forYouBatch, rankRelated } from "../lib/forYou";
import type { Genre, HomeFeed, Movie, UserList } from "../lib/types";

// Data hooks around api.ts. Loading is *derived* from state instead of set
// synchronously inside effects (react-hooks/set-state-in-effect): the fetch
// resolution is the only place that writes state, and `reload` bumps a run
// counter from the event handler.

function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

type FeedState = {
  run: number;
  data: HomeFeed | null;
  error: string | null;
  fetchedAt: number | null;
};

export type HomeFeedState = {
  data: HomeFeed | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  reload: () => void;
};

export function useHomeFeed(): HomeFeedState {
  const [state, setState] = useState<FeedState>({ run: -1, data: null, error: null, fetchedAt: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetchHomeFeed()
      .then((data) => {
        if (!cancelled) setState({ run: nonce, data, error: null, fetchedAt: Date.now() });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ run: nonce, data: null, error: toMessage(e), fetchedAt: Date.now() });
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    data: state.data,
    loading: state.run !== nonce,
    error: state.error,
    fetchedAt: state.fetchedAt,
    reload,
  };
}

type SearchState = {
  query: string;
  data: Movie[];
  error: string | null;
};

export type SearchStateResult = {
  data: Movie[];
  loading: boolean;
  error: string | null;
};

const SEARCH_DEBOUNCE_MS = 300;

export function useSearch(rawQuery: string): SearchStateResult {
  const query = rawQuery.trim();
  const [debounced, setDebounced] = useState(query);
  const [state, setState] = useState<SearchState>({ query: "", data: [], error: null });

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debounced) return undefined;
    let cancelled = false;

    searchMovies(debounced)
      .then((data) => {
        if (!cancelled) setState({ query: debounced, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ query: debounced, data: [], error: toMessage(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const hasQuery = debounced.length > 0;
  const settled = state.query === debounced;

  return {
    data: hasQuery && settled && !state.error ? state.data : [],
    loading: query.length > 0 && (!settled || query !== debounced),
    error: hasQuery && settled ? state.error : null,
  };
}

type MovieState = {
  id: string | null;
  run: number;
  data: Movie | null;
  error: string | null;
};

export type MovieStateResult = {
  data: Movie | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useMovie(id: string | undefined): MovieStateResult {
  const [state, setState] = useState<MovieState>({ id: null, run: -1, data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;

    fetchMovie(id)
      .then((data) => {
        if (cancelled) return;
        setState({
          id,
          run: nonce,
          data,
          error: data ? null : "Title not found",
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ id, run: nonce, data: null, error: toMessage(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const active = !!id && state.id === id;
  const loading = !!id && (state.id !== id || state.run !== nonce);

  return {
    data: active ? state.data : null,
    loading,
    error: loading ? null : active ? state.error : id ? null : "Title not found",
    reload,
  };
}

type ForYouState = {
  id: string | null;
  pool: Movie[];
  start: number;
};

export type ForYouResult = {
  /** The current batch of suggestions (empty while loading or on failure). */
  items: Movie[];
  loading: boolean;
  /** Swaps the batch for the next one in the pool. */
  suggestMore: () => void;
  /** Only makes sense when more than one batch exists. */
  canSuggestMore: boolean;
  /** Remount key — changes per movie *and* per batch. */
  batchKey: string;
};

/**
 * The detail page's For You shelf: related titles (shared genres) ranked
 * into a pool, handed out in fixed batches. `suggestMore` rotates the
 * pool so the previous batch is replaced rather than appended to. Failures
 * leave the shelf hidden — it is a nice-to-have, not the page's job.
 */
export function useForYou(movie: Movie | null): ForYouResult {
  const [state, setState] = useState<ForYouState>({ id: null, pool: [], start: 0 });
  const movieId = movie?.id ?? null;

  useEffect(() => {
    if (!movie || !movieId) return undefined;
    let cancelled = false;
    const genreIds = (movie.genres ?? []).map((genre) => genre.id);

    fetchRelatedCandidates(genreIds, movieId)
      .then((candidates) => {
        if (cancelled) return;
        setState({ id: movieId, pool: rankRelated(candidates, genreIds, movieId), start: 0 });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ id: movieId, pool: [], start: 0 });
      });

    return () => {
      cancelled = true;
    };
  }, [movie, movieId]);

  const active = !!movieId && state.id === movieId;
  const batch = forYouBatch(active ? state.pool : [], state.start);

  const suggestMore = useCallback(() => {
    setState((s) => {
      if (s.pool.length === 0) return s;
      return { ...s, start: forYouBatch(s.pool, s.start).nextStart };
    });
  }, []);

  return {
    items: batch.items,
    loading: !!movieId && !active,
    suggestMore,
    canSuggestMore: active && state.pool.length > FOR_YOU_BATCH,
    batchKey: `${state.id ?? ""}:${state.start}`,
  };
}

type GenrePageState = {
  genreId: string | null;
  run: number;
  genre: Genre | null;
  movies: Movie[];
  total: number;
  page: number;
  hasMore: boolean;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
};

export type GenrePageStateResult = {
  genre: Genre | null;
  movies: Movie[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  loadMore: () => void;
  reload: () => void;
};

export function useGenrePage(id: string | undefined): GenrePageStateResult {
  const [state, setState] = useState<GenrePageState>({
    genreId: null,
    run: -1,
    genre: null,
    movies: [],
    total: 0,
    page: 0,
    hasMore: false,
    error: null,
    loadingMore: false,
    moreError: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    const isNewListing = id === NEW_LISTING_SEGMENT;

    Promise.all([
      isNewListing ? Promise.resolve(null) : fetchGenre(id),
      fetchListingMovies(isNewListing ? null : id, 0),
    ])
      .then(([genre, firstPage]) => {
        if (cancelled) return;
        setState({
          genreId: id,
          run: nonce,
          genre,
          movies: firstPage.movies,
          total: firstPage.total,
          page: 0,
          hasMore: firstPage.hasMore,
          error: null,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          genreId: id,
          run: nonce,
          genre: null,
          movies: [],
          total: 0,
          page: 0,
          hasMore: false,
          error: toMessage(e),
          loadingMore: false,
          moreError: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (!state.genreId || state.loadingMore || !state.hasMore) return;
    const genreId = state.genreId;
    const nextPage = state.page + 1;
    const listingKey = genreId === NEW_LISTING_SEGMENT ? null : genreId;
    setState((s) => ({ ...s, loadingMore: true, moreError: null }));

    fetchListingMovies(listingKey, nextPage)
      .then((nextPageData) => {
        setState((s) => ({
          ...s,
          movies: [...s.movies, ...nextPageData.movies],
          total: nextPageData.total,
          page: nextPage,
          hasMore: nextPageData.hasMore,
          loadingMore: false,
        }));
      })
      .catch((e: unknown) => {
        setState((s) => ({ ...s, loadingMore: false, moreError: toMessage(e) }));
      });
  }, [state.genreId, state.page, state.hasMore, state.loadingMore]);

  const active = !!id && state.genreId === id;
  const loading = !!id && (state.genreId !== id || state.run !== nonce);

  return {
    genre: active ? state.genre : null,
    movies: active ? state.movies : [],
    total: active ? state.total : 0,
    hasMore: active ? state.hasMore : false,
    loading,
    error: loading ? null : active ? state.error : null,
    loadingMore: state.loadingMore,
    moreError: active ? state.moreError : null,
    loadMore,
    reload,
  };
}

type ListPageState = {
  listId: string | null;
  run: number;
  list: UserList | null;
  movies: Movie[];
  total: number;
  page: number;
  hasMore: boolean;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
};

export type ListPageStateResult = {
  list: UserList | null;
  movies: Movie[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  loadMore: () => void;
  reload: () => void;
};

export function useListPage(id: string | undefined): ListPageStateResult {
  const [state, setState] = useState<ListPageState>({
    listId: null,
    run: -1,
    list: null,
    movies: [],
    total: 0,
    page: 0,
    hasMore: false,
    error: null,
    loadingMore: false,
    moreError: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;

    Promise.all([fetchUserList(id), fetchListMovies(id, 0)])
      .then(([list, firstPage]) => {
        if (cancelled) return;
        setState({
          listId: id,
          run: nonce,
          list,
          movies: firstPage.movies,
          total: firstPage.total,
          page: 0,
          hasMore: firstPage.hasMore,
          error: null,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          listId: id,
          run: nonce,
          list: null,
          movies: [],
          total: 0,
          page: 0,
          hasMore: false,
          error: toMessage(e),
          loadingMore: false,
          moreError: null,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const loadMore = useCallback(() => {
    if (!state.listId || state.loadingMore || !state.hasMore) return;
    const listId = state.listId;
    const nextPage = state.page + 1;
    setState((s) => ({ ...s, loadingMore: true, moreError: null }));

    fetchListMovies(listId, nextPage)
      .then((nextPageData) => {
        setState((s) => ({
          ...s,
          movies: [...s.movies, ...nextPageData.movies],
          total: nextPageData.total,
          page: nextPage,
          hasMore: nextPageData.hasMore,
          loadingMore: false,
        }));
      })
      .catch((e: unknown) => {
        setState((s) => ({ ...s, loadingMore: false, moreError: toMessage(e) }));
      });
  }, [state.listId, state.page, state.hasMore, state.loadingMore]);

  const active = !!id && state.listId === id;
  const loading = !!id && (state.listId !== id || state.run !== nonce);
  const notFound = !loading && active && state.error === null && state.list === null;

  return {
    list: active ? state.list : null,
    movies: active && !notFound ? state.movies : [],
    total: active && !notFound ? state.total : 0,
    hasMore: active && !notFound ? state.hasMore : false,
    loading,
    error: loading ? null : notFound ? "List not found" : active ? state.error : null,
    loadingMore: state.loadingMore,
    moreError: active ? state.moreError : null,
    loadMore,
    reload,
  };
}
