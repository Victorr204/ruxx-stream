import { useCallback, useEffect, useState } from "react";
import { fetchHomeFeed, fetchMovie, searchMovies } from "../lib/api";
import type { HomeFeed, Movie } from "../lib/types";

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
};

export type HomeFeedState = {
  data: HomeFeed | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function useHomeFeed(): HomeFeedState {
  const [state, setState] = useState<FeedState>({ run: -1, data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetchHomeFeed()
      .then((data) => {
        if (!cancelled) setState({ run: nonce, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ run: nonce, data: null, error: toMessage(e) });
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

export function useSearch(rawQuery: string): SearchStateResult {
  const query = rawQuery.trim();
  const [state, setState] = useState<SearchState>({ query: "", data: [], error: null });

  useEffect(() => {
    if (!query) return undefined;
    let cancelled = false;

    searchMovies(query)
      .then((data) => {
        if (!cancelled) setState({ query, data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ query, data: [], error: toMessage(e) });
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const hasQuery = query.length > 0;
  const settled = state.query === query;

  return {
    data: hasQuery && settled && !state.error ? state.data : [],
    loading: hasQuery && !settled,
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
