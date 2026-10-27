// Turning an uploaded filename into a TMDb search, and that search into a
// single best guess.
//
// This is the whole point of the "upload and forget" catalog flow: the admin
// picks a video file, and everything a human used to type — title, year,
// synopsis, artwork, genres, rating — is derived here and from TMDb. The
// helpers are deliberately pure so the guessing can be tested against the
// messy filenames real libraries actually contain.

/** A TMDb search hit, as narrowed by the search action. */
export type TmdbCandidate = {
  id: number;
  title: string;
  release_date: string | null;
  poster_url?: string | null;
  vote_average?: number | null;
};

export type TitleGuess = {
  /** Best-effort human title, ready to show and to search with. */
  title: string;
  /** Year parsed out of the filename, if one was present. */
  year: number | null;
};

/**
 * Tokens that mean "the title already ended". Real release names put the
 * title first and then a run of technical tags, so the first hit on any of
 * these is a reliable cut point — everything after it is scene metadata.
 */
const RELEASE_TAGS = new Set([
  "2160p", "1440p", "1080p", "1080i", "720p", "576p", "480p", "360p", "4k", "8k", "uhd", "hd", "sd",
  "bluray", "blu-ray", "bdrip", "brrip", "bdremux", "remux", "hddvd",
  "webrip", "web-dl", "webdl", "web", "hdtv", "dvdrip", "dvd", "dvrrip", "camrip", "cam", "hdcam", "teleync", "telesync", "ts",
  "x264", "x265", "h264", "h265", "hevc", "avc", "av1", "xvid", "divx", "vp9",
  "aac", "ac3", "eac3", "dts", "dts-hd", "truehd", "atmos", "flac", "mp3",
  "10bit", "8bit", "hdr", "hdr10", "hdr10plus", "dv", "dolby", "vision", "sdr",
  "proper", "repack", "extended", "unrated", "uncut", "theatrical", "directors", "criterion",
  "multi", "dual", "sub", "subs", "subbed", "dub", "dubbed", "eng", "audio",
]);

/** Extensions the picker may hand us; stripped before anything else. */
const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|webm|m4v|m3u8|avi|flv|ts|mpg|mpeg|3gp)$/i;

/** A year standing alone in parentheses — `Title (2010) …`. Unambiguous. */
const PAREN_YEAR = /^\(\s*(?:19|20)\d{2}\s*\)$/;

/** A year standing alone as a whole token — `Title.2010.1080p`. */
const BARE_YEAR = /^(?:19|20)\d{2}$/;

/** True when a token is scene/technical noise rather than part of a title. */
function isReleaseTag(token: string): boolean {
  const raw = token.toLowerCase();
  const clean = raw.replace(/[^a-z0-9-]/g, "");
  if (!clean) return true;
  if (RELEASE_TAGS.has(clean)) return true;
  // 5.1 / 7.1 channel layouts — tested before cleaning, which would
  // otherwise strip the decimal and leave an unrecognisable "51".
  if (/^\d\.\d$/.test(raw)) return true;
  // Bare resolutions like "1080" and "720" end the title, but a plausible
  // year ("1999") must not: years are consumed as the year instead, and
  // treating them as tags would truncate "Blade Runner 2049".
  if (/^\d{3,4}$/.test(clean) && !BARE_YEAR.test(clean)) return true;
  if (/^\d{3,4}x\d{3,4}$/.test(clean)) return true;
  return false;
}

/**
 * Pull a 4-digit year out of a token without inventing one. Bounded to the
 * range films plausibly span so a resolution like "1080" or a bitrate never
 * reads as a year.
 */
function yearFromToken(token: string): number | null {
  const match = token.match(/(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1890 && year <= 2100 ? year : null;
}

/**
 * Guess a title and year from an uploaded filename.
 *
 * Handles the shapes that show up in real libraries: dotted scene names
 * (`The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv`), bracketed releases
 * (`Inception (2010) [1080p].mp4`), and plain names (`big_buck_bunny.mp4`).
 * A parenthesised year is trusted over a bare one so titles that end in a
 * four-digit number survive, and the words stop at the first release tag.
 */
export function guessTitleFromFilename(filename: string): TitleGuess {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const stem = base.replace(VIDEO_EXTENSIONS, "").trim();

  // Underscores and dots are both word separators in release names.
  const tokens = stem
    .replace(/[_.,]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Pass 1 — a parenthesised year is unambiguous, so it is claimed first.
  // That is what keeps a title merely ending in four digits intact: in
  // "Blade Runner 2049 (2017)" the real year is 2017, so 2049 stays text.
  let year: number | null = null;
  for (const token of tokens) {
    if (PAREN_YEAR.test(token)) {
      year = yearFromToken(token);
      break;
    }
  }

  // Pass 2 — otherwise the release name's own year wins: the last bare year
  // before the first technical tag, which is where names put it
  // (`Title.2010.1080p`) and which also handles `2012.2009.1080p`.
  let bareIndex = -1;
  if (year === null) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (isReleaseTag(tokens[i])) break;
      if (BARE_YEAR.test(tokens[i])) bareIndex = i;
    }
    if (bareIndex >= 0) year = yearFromToken(tokens[bareIndex]);
  }

  // Pass 3 — the words up to the first release tag, minus whichever token
  // was consumed as the year. Nothing surviving (a filename that is only
  // tags, e.g. "1080p.mkv") yields an empty title on purpose: searching
  // TMDb for noise would confidently bind the wrong film, and a wrong
  // auto-match is worse than none.
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (i === bareIndex) continue;
    if (PAREN_YEAR.test(token)) continue;
    if (isReleaseTag(token)) break;
    kept.push(token);
  }

  return { title: kept.join(" ").replace(/\s+/g, " ").trim(), year };
}

/** Lowercased, punctuation-free form used for comparisons. */
export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Year a candidate was released, or null when TMDb doesn't know. */
function candidateYear(candidate: TmdbCandidate): number | null {
  const year = Number((candidate.release_date ?? "").slice(0, 4));
  return Number.isFinite(year) && year >= 1890 && year <= 2100 ? year : null;
}

/**
 * Score one candidate against the guess, higher is better.
 *
 * An exact normalized title match is worth the most, a contained match less,
 * and a shared year adds a bonus — enough to prefer the right film when two
 * share a name, without ever overriding a title that clearly doesn't match.
 */
export function scoreCandidate(guess: TitleGuess, candidate: TmdbCandidate): number {
  const wanted = normalizeTitle(guess.title);
  const got = normalizeTitle(candidate.title);
  if (!wanted || !got) return 0;

  let score = 0;
  if (got === wanted) score += 100;
  else if (got.includes(wanted) || wanted.includes(got)) score += 55;

  // Reward shared words so "The Matrix Reloaded" still ranks above
  // "Matrix: Resurrections" for the guess "The Matrix Reloaded".
  const wantedWords = new Set(wanted.split(" "));
  const gotWords = got.split(" ");
  const shared = gotWords.filter((word) => wantedWords.has(word)).length;
  score += shared * 8;

  if (guess.year !== null && candidateYear(candidate) === guess.year) score += 30;

  return score;
}

export type MatchResult = {
  best: TmdbCandidate | null;
  score: number;
};

/**
 * Pick the single best candidate for a guess, or null when nothing scores
 * above the floor. The floor exists so a filename like "Sample.Clip.2020"
 * doesn't get confidently bound to an unrelated popular film — a wrong
 * auto-match is worse than no match, because it ships bad metadata live.
 */
export function bestCandidate(guess: TitleGuess, candidates: TmdbCandidate[]): MatchResult {
  let best: TmdbCandidate | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = scoreCandidate(guess, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  // Require at least a token of agreement — an empty-title guess must never match.
  if (!guess.title.trim() || bestScore < 20) return { best: null, score: bestScore };
  return { best, score: bestScore };
}
