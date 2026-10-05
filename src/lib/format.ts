/** "1h 40m" / "44m" — null-safe for titles with missing runtimes. */
export function formatRuntime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Meta line shared by hero and detail: "2024 • PG-13 • 1h 40m". */
export function formatMeta(
  movie: { release_year?: number | null; maturity_rating?: string | null; runtime_seconds?: number | null },
  separator = " • "
): string {
  return [
    movie.release_year ? String(movie.release_year) : "",
    movie.maturity_rating || "",
    formatRuntime(movie.runtime_seconds),
  ]
    .filter(Boolean)
    .join(separator);
}
