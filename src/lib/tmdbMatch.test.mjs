import assert from "node:assert/strict";
import test from "node:test";

import { bestCandidate, guessTitleFromFilename, normalizeTitle, scoreCandidate } from "./tmdbMatch.ts";

const hit = (id, title, release_date, extra = {}) => ({
  id,
  title,
  release_date,
  poster_url: null,
  vote_average: null,
  ...extra,
});

test("dotted scene names lose every release tag", () => {
  const guess = guessTitleFromFilename("The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv");
  assert.equal(guess.title, "The Matrix");
  assert.equal(guess.year, 1999);
});

test("bracketed year and resolution are handled", () => {
  const guess = guessTitleFromFilename("Inception (2010) [1080p].mp4");
  assert.equal(guess.title, "Inception");
  assert.equal(guess.year, 2010);
});

test("underscores read as spaces", () => {
  const guess = guessTitleFromFilename("big_buck_bunny.mp4");
  assert.equal(guess.title, "big buck bunny");
  assert.equal(guess.year, null);
});

test("a title with no extension still parses", () => {
  const guess = guessTitleFromFilename("Sintel.2010.720p");
  assert.equal(guess.title, "Sintel");
  assert.equal(guess.year, 2010);
});

test("multi-word titles keep every word before the tags", () => {
  const guess = guessTitleFromFilename("The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.REMUX.mkv");
  assert.equal(guess.title, "The Lord of the Rings The Fellowship of the Ring");
  assert.equal(guess.year, 2001);
});

test("a year inside a longer token is still captured", () => {
  const guess = guessTitleFromFilename("Blade Runner 2049 (2017) 2160p.web-dl.mkv");
  assert.equal(guess.year, 2017);
  assert.equal(guess.title, "Blade Runner 2049");
});

test("resolutions and bitrates are never mistaken for years", () => {
  const guess = guessTitleFromFilename("Interstellar.1080.x265.10bit.mp4");
  assert.equal(guess.title, "Interstellar");
  assert.equal(guess.year, null);
});

test("a filename that is only tags yields an empty title rather than noise", () => {
  const guess = guessTitleFromFilename("1080p.mkv");
  assert.equal(guess.title, "");
  assert.equal(guess.year, null);
});

test("paths are reduced to their final segment", () => {
  const guess = guessTitleFromFilename("C:/downloads/Movies/Se7en.1995.720p.mkv");
  assert.equal(guess.title, "Se7en");
  assert.equal(guess.year, 1995);
});

test("normalizeTitle folds case, punctuation and ampersands", () => {
  assert.equal(normalizeTitle("The Matrix: Reloaded"), "the matrix reloaded");
  assert.equal(normalizeTitle("Fast & Furious"), "fast and furious");
  assert.equal(normalizeTitle("  WALL·E  "), "wall e");
});

test("exact title match outscores a contained one", () => {
  const guess = { title: "The Matrix", year: null };
  const exact = scoreCandidate(guess, hit(1, "The Matrix", "1999-03-30"));
  const contain = scoreCandidate(guess, hit(2, "The Matrix Reloaded", "2003-05-15"));
  assert.ok(exact > contain, `expected ${exact} > ${contain}`);
});

test("a matching year breaks a tie between same-named titles", () => {
  const guess = { title: "Dune", year: 2021 };
  const right = scoreCandidate(guess, hit(1, "Dune", "2021-10-22"));
  const wrong = scoreCandidate(guess, hit(2, "Dune", "1984-12-14"));
  assert.ok(right > wrong, `expected ${right} > ${wrong}`);
});

test("bestCandidate picks the strongest match", () => {
  const guess = guessTitleFromFilename("Inception.2010.1080p.mkv");
  const { best } = bestCandidate(guess, [
    hit(1, "Inception: The Cobol Job", "2010-12-07"),
    hit(2, "Inception", "2010-07-16"),
    hit(3, "Interstellar", "2014-11-05"),
  ]);
  assert.equal(best?.id, 2);
});

test("bestCandidate returns null when nothing is close enough", () => {
  const guess = { title: "Quantum Hedgehog Odyssey", year: null };
  const { best } = bestCandidate(guess, [
    hit(1, "The Matrix", "1999-03-30"),
    hit(2, "Frozen", "2013-11-27"),
  ]);
  assert.equal(best, null);
});

test("an empty guess never matches, however popular the candidate", () => {
  const { best } = bestCandidate({ title: "", year: null }, [hit(1, "The Matrix", "1999-03-30")]);
  assert.equal(best, null);
});

test("no candidates yields null", () => {
  const { best } = bestCandidate({ title: "Anything", year: 2020 }, []);
  assert.equal(best, null);
});
