import assert from "node:assert/strict";
import test from "node:test";

import { forYouBatch, rankRelated } from "./forYou.ts";

const movie = (id, extra = {}) => ({
  id,
  title: `Title ${id}`,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});
const candidate = (id, genre_ids, extra = {}) => movie(id, { genre_ids, ...extra });

test("the clicked movie is excluded and shared genres rank highest", () => {
  const pool = rankRelated(
    [
      candidate("self", ["g1"]),
      candidate("both", ["g1", "g2"]),
      candidate("one", ["g1"]),
      candidate("other", ["g9"]),
    ],
    ["g1", "g2"],
    "self"
  );
  assert.deepEqual(
    pool.map((m) => m.id),
    ["both", "one"]
  );
});

test("scores with equal overlap fall back to newest first", () => {
  const pool = rankRelated(
    [
      candidate("old", ["g1"], { created_at: "2024-01-01T00:00:00Z" }),
      candidate("new", ["g1"], { created_at: "2026-01-01T00:00:00Z" }),
      candidate("mid", ["g1"], { created_at: "2025-01-01T00:00:00Z" }),
    ],
    ["g1"],
    "self"
  );
  assert.deepEqual(
    pool.map((m) => m.id),
    ["new", "mid", "old"]
  );
});

test("a movie without genres keeps candidates as a newest-first fallback", () => {
  const pool = rankRelated(
    [
      candidate("a", ["g1"], { created_at: "2024-01-01T00:00:00Z" }),
      candidate("b", [], { created_at: "2026-01-01T00:00:00Z" }),
    ],
    [],
    "self"
  );
  assert.deepEqual(
    pool.map((m) => m.id),
    ["b", "a"]
  );
});

test("zero-overlap candidates are dropped when there are genres to match", () => {
  const pool = rankRelated(
    [candidate("miss", ["g9"]), candidate("hit", ["g1"])],
    ["g1"],
    "self"
  );
  assert.deepEqual(
    pool.map((m) => m.id),
    ["hit"]
  );
});

test("the pool is capped", () => {
  const many = Array.from({ length: 10 }, (_, i) => candidate(`m${i}`, ["g1"]));
  assert.equal(rankRelated(many, ["g1"], "self", 4).length, 4);
});

test("genre_ids are stripped from the returned pool", () => {
  const [only] = rankRelated([candidate("a", ["g1"])], ["g1"], "self");
  assert.equal("genre_ids" in only, false);
});

test("batches are fixed-size, unique and advance through the pool", () => {
  const pool = Array.from({ length: 8 }, (_, i) => movie(`m${i}`));
  const first = forYouBatch(pool, 0);
  assert.deepEqual(
    first.items.map((m) => m.id),
    ["m0", "m1", "m2", "m3", "m4", "m5"]
  );
  assert.equal(first.nextStart, 6);

  const second = forYouBatch(pool, first.nextStart);
  assert.deepEqual(
    second.items.map((m) => m.id),
    ["m6", "m7", "m0", "m1", "m2", "m3"]
  );
  assert.equal(second.nextStart, 4);
});

test("a pool smaller than the batch never repeats inside one batch", () => {
  const pool = [movie("a"), movie("b")];
  const { items, nextStart } = forYouBatch(pool, 0);
  assert.deepEqual(
    items.map((m) => m.id),
    ["a", "b"]
  );
  assert.equal(nextStart, 0);
});

test("an empty pool yields an empty batch", () => {
  const { items, nextStart } = forYouBatch([], 3);
  assert.deepEqual(items, []);
  assert.equal(nextStart, 0);
});
