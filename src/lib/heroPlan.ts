export type HeroSlotLabel = "featured" | "new" | "trending";

export type HeroSlot<T> = {
  movie: T;
  label: HeroSlotLabel;
};

export const HERO_LIMIT = 3;

export function planHero<T extends { id: string }>(
  featured: T | null,
  newest: T[],
  trending: T[],
  limit = HERO_LIMIT
): HeroSlot<T>[] {
  const slots: HeroSlot<T>[] = [];
  const seen = new Set<string>();

  const take = (movie: T | null | undefined, label: HeroSlotLabel) => {
    if (!movie || seen.has(movie.id) || slots.length >= limit) return;
    seen.add(movie.id);
    slots.push({ movie, label });
  };

  take(featured, "featured");

  let cursor = 0;
  while (slots.length < limit - 1) {
    const next = newest[cursor++];
    if (!next) break;
    take(next, "new");
  }

  for (const movie of trending) {
    if (slots.length >= limit) break;
    take(movie, "trending");
  }

  while (slots.length < limit) {
    const next = newest[cursor++];
    if (!next) break;
    take(next, "new");
  }

  return slots;
}
