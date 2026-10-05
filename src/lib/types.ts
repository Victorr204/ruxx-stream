export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: "user" | "admin";
  is_premium: boolean;
  created_at: string;
  updated_at: string;
};

export type Genre = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  created_at?: string;
};

export type Movie = {
  id: string;
  title: string;
  description: string | null;
  release_year: number | null;
  maturity_rating: string;
  runtime_seconds: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  trailer_url: string | null;
  is_featured: boolean;
  is_active: boolean;
  created_at: string;
  genres?: Genre[];
};

export type WatchProgress = {
  movie_id: string;
  user_id?: string;
  position_seconds: number;
  duration_seconds: number;
  completed: boolean;
  updated_at?: string;
};

export type ContinueItem = {
  movie: Movie;
  progress: WatchProgress;
};

export type HomeRow = {
  genre: Genre;
  movies: Movie[];
};

export type HomeFeed = {
  featured: Movie | null;
  continueWatching: ContinueItem[];
  rows: HomeRow[];
};
