/**
 * The treemap is the one piece of this feature that can be silently, visibly
 * wrong: a layout bug does not throw, it draws overlapping rectangles that
 * still look plausible at a glance. So the properties are asserted rather than
 * eyeballed -- every tile inside the box, no two overlapping, areas in
 * proportion to the values that produced them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { board, type Rect, squarify } from "./heatmap.js";
import { connect, type EventRow, upsertBoard, upsertEvents } from "./db.js";

const UNIT: Rect = { x: 0, y: 0, w: 100, h: 100 };
const area = (r: Rect) => r.w * r.h;
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The market caps from one real board's largest sector, descending. */
const CAPS = [775, 500, 402, 138, 75, 44, 31, 28, 19, 17, 12, 9, 8, 8, 7];

test("every tile stays inside the rectangle it was given", () => {
  for (const r of squarify(CAPS, UNIT)) {
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9, `origin outside: ${JSON.stringify(r)}`);
    assert.ok(r.x + r.w <= 100 + 1e-9, `overflows right: ${JSON.stringify(r)}`);
    assert.ok(r.y + r.h <= 100 + 1e-9, `overflows bottom: ${JSON.stringify(r)}`);
  }
});

test("no two tiles overlap, and together they fill the box", () => {
  const out = squarify(CAPS, UNIT);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      assert.ok(overlap(out[i], out[j]) < 1e-6, `${i} overlaps ${j}`);
    }
  }
  const filled = out.reduce((a, r) => a + area(r), 0);
  assert.ok(Math.abs(filled - 100 * 100) < 1e-6, `filled ${filled}, expected 10000`);
});

test("area is proportional to value -- the whole point of the picture", () => {
  const out = squarify(CAPS, UNIT);
  const total = CAPS.reduce((a, b) => a + b, 0);
  out.forEach((r, i) => {
    const expected = (CAPS[i] / total) * 100 * 100;
    assert.ok(Math.abs(area(r) - expected) < 1e-6, `tile ${i}: ${area(r)} vs ${expected}`);
  });
  // A tile twice the cap is twice the ink. Stated separately because this is
  // the claim a reader makes when they compare two tiles by eye.
  assert.ok(Math.abs(area(out[0]) / area(out[2]) - CAPS[0] / CAPS[2]) < 1e-9);
});

test("tiles are squarish -- the reason this is not slice-and-dice", () => {
  // Slice-and-dice on this input gives the smallest name an aspect ratio over
  // 100. Squarified keeps every tile hoverable and readable.
  const worst = Math.max(...squarify(CAPS, UNIT).map((r) => Math.max(r.w / r.h, r.h / r.w)));
  assert.ok(worst < 8, `worst aspect ratio ${worst.toFixed(1)}`);
});

test("degenerate inputs produce no tiles rather than NaN geometry", () => {
  for (const out of [
    squarify([], UNIT),
    squarify([0, 0], UNIT),
    squarify([1, 2], { x: 0, y: 0, w: 0, h: 50 }),
  ]) {
    for (const r of out) {
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.w), `NaN geometry: ${JSON.stringify(r)}`);
      assert.equal(area(r), 0);
    }
  }
});

test("a single value takes the whole box", () => {
  const [only] = squarify([42], UNIT);
  assert.deepEqual(only, { x: 0, y: 0, w: 100, h: 100 });
});

// ---------------------------------------------------------------- the tally

const fresh = () => connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-hm-")), "t.db"));

/** Two companies on one board, so a story can name both. */
function seed(con: ReturnType<typeof fresh>) {
  upsertBoard(con, [
    { date: "2026-09-11", symbol: "BBCA", name: "Bank Central Asia", sector: "Financials",
      sub_sector: "Banks", market_cap: 775e12, close_change: 0.004 },
    { date: "2026-09-11", symbol: "BBRI", name: "Bank Rakyat Indonesia", sector: "Financials",
      sub_sector: "Banks", market_cap: 500e12, close_change: -0.052 },
  ]);
  return con;
}

const story = (symbol: string, over: Partial<EventRow> = {}): EventRow => ({
  date: "2026-09-11", symbol, kind: "news", key: String(over.source_url ?? over.title ?? ""),
  class: "fact", title: "A thing happened", source_url: "https://x.invalid/1",
  extra: { tags: ["Bullish", "Dividend"] }, ...over,
});

test("one story naming two companies is counted once, not twice", () => {
  // The backfill writes a row per (story, symbol). Counted per row, a press
  // release naming twelve tickers would decide what the whole market was
  // "tagged" -- so the tally deduplicates on the story's own identity.
  const con = seed(fresh());
  upsertEvents(con, [story("BBCA"), story("BBRI")]);
  const b = board(con, "2026-09-11")!;
  assert.equal(b.stories, 1, "one story");
  assert.equal(b.positive, 1);
  assert.deepEqual(b.topics, [{ tag: "Dividend", n: 1 }]);
  // But it still shows on BOTH tiles: the dedup is for counting, not display.
  const tiles = b.sectors.flatMap((s) => s.tiles);
  assert.equal(tiles.filter((t) => t.notes.length === 1).length, 2);
  assert.equal(b.withNotes, 2);
});

test("tone counts Sectors' own tags and nothing inferred from the text", () => {
  const con = seed(fresh());
  upsertEvents(con, [
    story("BBCA"),
    story("BBRI", { title: "Bad news", source_url: "https://x.invalid/2", key: "2",
                    extra: { tags: ["Bearish", "Dividend"] } }),
    // No tone tag at all: neither positive nor negative, and not forced to one.
    story("BBRI", { title: "Plain news", source_url: "https://x.invalid/3", key: "3",
                    extra: { tags: ["Rights Issue"] } }),
    // A collapse in the share price is not a Bearish tag, and is not counted.
    story("BBCA", { title: "Shares crash, disaster, plunge", source_url: "https://x.invalid/4",
                    key: "4", extra: { tags: ["Analyst Ratings"] } }),
  ]);
  const b = board(con, "2026-09-11")!;
  assert.equal(b.stories, 4);
  assert.equal(b.positive, 1);
  assert.equal(b.negative, 1);
  // Bullish/Bearish are tone and never appear as topics.
  assert.deepEqual(b.topics.map((t) => t.tag), ["Dividend", "Analyst Ratings", "Rights Issue"]);
  assert.equal(b.topics[0].n, 2);
});

test("topics are capped at three and break ties the same way every render", () => {
  const con = seed(fresh());
  upsertEvents(con, [1, 2, 3, 4].map((i) =>
    story("BBCA", { title: `s${i}`, source_url: `https://x.invalid/${i}`, key: String(i),
                    extra: { tags: ["Zeta", "Alpha", "Beta", "Delta"] } })));
  const b = board(con, "2026-09-11")!;
  assert.equal(b.topics.length, 3);
  // All four tags tie at 4, so the order is alphabetical rather than whatever
  // the Map happened to insert -- a bar that reshuffles on reload reads as
  // new information.
  assert.deepEqual(b.topics.map((t) => t.tag), ["Alpha", "Beta", "Delta"]);
});

test("a board with no stories reports zero rather than dividing by it", () => {
  const b = board(seed(fresh()), "2026-09-11")!;
  assert.equal(b.stories, 0);
  assert.equal(b.positive, 0);
  assert.equal(b.negative, 0);
  assert.deepEqual(b.topics, []);
  assert.equal(b.withNotes, 0);
  assert.equal(b.drawn, 2);
});

test("a weekend visitor gets the last board we hold, not an empty page", () => {
  const con = seed(fresh());
  // Asked for the Sunday; the board was fetched on the Friday.
  const b = board(con, "2026-09-13")!;
  assert.equal(b.date, "2026-09-11");
  assert.equal(board(con, "2026-09-10"), null, "and never a board from the future");
});
