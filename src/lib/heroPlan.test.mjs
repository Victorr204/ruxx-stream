import assert from "node:assert/strict";
import test from "node:test";

import { planHero } from "./heroPlan.ts";

const m = (id) => ({ id });

test("featured opens the carousel and new titles fill the remaining two slots", () => {
  const slots = planHero(m("f"), [m("a"), m("b"), m("c")], []);
  assert.deepEqual(
    slots.map((s) => [s.movie.id, s.label]),
    [
      ["f", "featured"],
      ["a", "new"],
      ["b", "new"],
    ]
  );
});

test("trending takes the last slot after the newest uploads", () => {
  const slots = planHero(null, [m("a"), m("b"), m("c")], [m("t1"), m("t2")]);
  assert.deepEqual(
    slots.map((s) => [s.movie.id, s.label]),
    [
      ["a", "new"],
      ["b", "new"],
      ["t1", "trending"],
    ]
  );
});

test("trending duplicates are skipped in favour of the next newest upload", () => {
  const slots = planHero(null, [m("a"), m("b"), m("c"), m("d")], [m("b")]);
  assert.deepEqual(
    slots.map((s) => [s.movie.id, s.label]),
    [
      ["a", "new"],
      ["b", "new"],
      ["c", "new"],
    ]
  );
});

test("an empty trending list back-fills with newest so three slides still show", () => {
  const slots = planHero(null, [m("a"), m("b"), m("c"), m("d")], []);
  assert.equal(slots.length, 3);
  assert.deepEqual(
    slots.map((s) => s.label),
    ["new", "new", "new"]
  );
});

test("the featured title also present in newest is never shown twice", () => {
  const slots = planHero(m("a"), [m("a"), m("b"), m("c"), m("d")], []);
  const ids = slots.map((s) => s.movie.id);
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(new Set(ids).size, ids.length);
});

test("fewer titles than the limit returns one slide per title", () => {
  const slots = planHero(null, [m("only")], []);
  assert.deepEqual(
    slots.map((s) => s.movie.id),
    ["only"]
  );
});

test("nothing in the catalog returns no slides", () => {
  assert.deepEqual(planHero(null, [], []), []);
});
