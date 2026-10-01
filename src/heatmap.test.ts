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
import { board, indexReturns, movers, type Rect, squarify } from "./heatmap.js";
import { connect, type EventRow, type MoverRow, upsertBoard, upsertEvents, upsertMovers, upsertPrices } from "./db.js";
import { BACKFILL_DAYS, MOVER_NOTES } from "./config.js";
import { shift } from "./dates.js";

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

// ---------------------------------------------------------------- the movers

const mover = (over: Partial<MoverRow> = {}): MoverRow => ({
  date: "2026-09-11", period: "7d", direction: "gainer", rank: 1,
  symbol: "SOHO", name: "PT Soho Global Health Tbk", price_change: 0.24,
  last_close: 1505, close_date: "2026-09-11", ...over,
});

test("the API's ranking is printed, not a second one computed here", () => {
  const con = fresh();
  // Deliberately inserted out of rank order and with a bigger move at rank 2:
  // if anything re-sorted by price_change this would come back the other way.
  upsertMovers(con, [
    mover({ rank: 2, symbol: "MDIA", price_change: 0.99 }),
    mover({ rank: 1, symbol: "SOHO", price_change: 0.24 }),
  ]);
  const m = movers(con, "2026-09-11", "7d")!;
  assert.deepEqual(m.gainers.map((g) => g.symbol), ["SOHO", "MDIA"]);
});

test("each period is its own ladder, and switching never leaves the database", () => {
  const con = fresh();
  upsertMovers(con, [
    mover({ period: "1d", symbol: "AAAA" }),
    mover({ period: "365d", symbol: "ZZZZ" }),
  ]);
  assert.deepEqual(movers(con, "2026-09-11", "1d")!.gainers.map((g) => g.symbol), ["AAAA"]);
  assert.deepEqual(movers(con, "2026-09-11", "365d")!.gainers.map((g) => g.symbol), ["ZZZZ"]);
  // A period we hold nothing for is null, not an empty ladder pretending to be one.
  assert.equal(movers(con, "2026-09-11", "14d"), null);
});

test("the news window is the period, anchored on the move's own last close", () => {
  const con = fresh();
  // The API dated this move to the 9th, two days before we asked. Reading to
  // today instead would attach the 10th's and 11th's headlines to a move that
  // had already finished.
  upsertMovers(con, [mover({ period: "7d", close_date: "2026-09-09" })]);
  const m = movers(con, "2026-09-11", "7d")!;
  assert.equal(m.newsTo, "2026-09-09");
  assert.equal(m.newsFrom, "2026-09-03", "seven days back from the last close");
  assert.equal(m.clamped, false);

  // A one-day period still reads three days, because IDX does not trade at
  // weekends and a Monday move carries Friday's news.
  upsertMovers(con, [mover({ period: "1d", close_date: "2026-09-09" })]);
  assert.equal(movers(con, "2026-09-11", "1d")!.newsFrom, "2026-09-07");
});

test("a year-long period reads only as far back as the record goes, and says so", () => {
  const con = fresh();
  upsertMovers(con, [mover({ period: "365d", close_date: "2026-09-11" })]);
  const m = movers(con, "2026-09-11", "365d")!;
  assert.equal(m.clamped, true, "a year is wider than the news backfill");
  assert.equal(m.newsFrom, shift("2026-09-11", -(BACKFILL_DAYS - 1)));
  // And the shorter periods are not clamped, so the flag means something.
  upsertMovers(con, [mover({ period: "30d" })]);
  assert.equal(movers(con, "2026-09-11", "30d")!.clamped, false);
});

test("a mover carries what was on its record, capped and newest first", () => {
  const con = fresh();
  upsertMovers(con, [mover({ period: "7d", symbol: "BBCA" }), mover({ rank: 2, symbol: "BBRI" })]);
  upsertEvents(con, [
    story("BBCA", { date: "2026-09-08", title: "older", source_url: "https://x.invalid/1", key: "1" }),
    story("BBCA", { date: "2026-09-10", title: "newer", source_url: "https://x.invalid/2", key: "2" }),
    story("BBCA", { date: "2026-09-11", title: "newest", source_url: "https://x.invalid/3", key: "3" }),
    story("BBCA", { date: "2026-09-11", title: "fourth", source_url: "https://x.invalid/4", key: "4" }),
    // A suspension outranks a headline on the same day: the exchange's own
    // record beats the coverage of it.
    story("BBCA", { date: "2026-09-11", kind: "suspension", title: "halted",
                    source_url: "https://x.invalid/5", key: "5" }),
  ]);
  const m = movers(con, "2026-09-11", "7d")!;
  const [bbca, bbri] = m.gainers;
  assert.equal(bbca.notes.length, MOVER_NOTES, "capped at three");
  assert.equal(bbca.notes[0].title, "halted", "official record first on a shared date");
  assert.equal(bbca.notes.at(-1)!.date, "2026-09-11", "all three from the newest day");
  // BBRI has nothing, and that is reported rather than filled in.
  assert.equal(bbri.notes.length, 0);
  assert.equal(m.withNotes, 1);
});

test("the topic filter narrows a mover's headlines but never its ranking", () => {
  const con = fresh();
  upsertMovers(con, [mover({ period: "7d", symbol: "BBCA" })]);
  upsertEvents(con, [
    story("BBCA", { title: "a", source_url: "https://x.invalid/1", key: "1",
                    extra: { tags: ["Dividend"] } }),
    story("BBCA", { title: "b", source_url: "https://x.invalid/2", key: "2",
                    extra: { tags: ["Rights Issue"] } }),
  ]);
  const all = movers(con, "2026-09-11", "7d")!;
  assert.equal(all.gainers[0].notes.length, 2);
  const only = movers(con, "2026-09-11", "7d", "Dividend")!;
  assert.equal(only.gainers[0].notes.length, 1);
  // Which companies moved, and by how much, is not a matter of topic.
  assert.deepEqual(only.gainers.map((g) => g.symbol), all.gainers.map((g) => g.symbol));
  assert.equal(only.gainers[0].change, all.gainers[0].change);
});

test("a weekend visitor gets the last movers we hold, not an empty list", () => {
  const con = fresh();
  upsertMovers(con, [mover()]);
  assert.equal(movers(con, "2026-09-13", "7d")!.date, "2026-09-11");
  assert.equal(movers(con, "2026-09-10", "7d"), null, "and never a ladder from the future");
});

test("picking a sector draws only it, boxed by industry, and keeps every option on offer", () => {
  const con = fresh();
  upsertBoard(con, [
    { date: "2026-09-11", symbol: "BBCA", name: "BCA", sector: "Financials", sub_sector: "Banks", market_cap: 775e12, close_change: 0.01 },
    { date: "2026-09-11", symbol: "ADMF", name: "Adira", sector: "Financials", sub_sector: "Financing Service", market_cap: 10e12, close_change: -0.02 },
    { date: "2026-09-11", symbol: "TLKM", name: "Telkom", sector: "Infrastructures", sub_sector: "Telecommunication", market_cap: 300e12, close_change: 0 },
  ]);
  const all = board(con, "2026-09-11")!;
  assert.equal(all.sector, "");
  assert.deepEqual(all.sectors.map((s) => s.sector), ["Financials", "Infrastructures"]);

  const fin = board(con, "2026-09-11", "", "financials")!;
  assert.equal(fin.sector, "Financials", "matched case-insensitively, stored as the board spells it");
  assert.deepEqual(fin.sectors.map((s) => s.sector).sort(), ["Banks", "Financing Service"], "industries are the boxes");
  assert.equal(fin.drawn, 2);
  assert.deepEqual(fin.choices.map((c) => c.sector), ["Financials", "Infrastructures"], "the picker still offers every sector");

  // A sector that is not on the board is no filter at all, not an empty board.
  assert.equal(board(con, "2026-09-11", "", "<script>")!.drawn, 3);
});

test("an index's day, week, month and year come from held closes, and a gap is a dash", () => {
  const con = fresh();
  upsertPrices(con, "IHSG", [
    { date: "2025-09-29", close: 7000, volume: null },
    { date: "2026-08-28", close: 7400, volume: null }, // the month base: 29 Aug is a Saturday
    { date: "2026-09-22", close: 7500, volume: null },
    { date: "2026-09-28", close: 7600, volume: null },
    { date: "2026-09-29", close: 7700, volume: null },
  ]);
  const r = indexReturns(con, "IHSG", "IHSG · whole exchange", "2026-09-30")!;
  assert.equal(r.date, "2026-09-29");
  assert.equal(r.close, 7700);
  assert.ok(Math.abs(r.d! - (7700 / 7600 - 1)) < 1e-12, "1D is against the previous session");
  assert.ok(Math.abs(r.w! - (7700 / 7500 - 1)) < 1e-12, "1W is the close on or before a week back");
  assert.ok(Math.abs(r.m! - (7700 / 7400 - 1)) < 1e-12, "1M falls back over a weekend");
  assert.ok(Math.abs(r.y! - 0.1) < 1e-12, "1Y is a calendar year");

  // Nothing near a year back: a dash, not a return from whatever is oldest.
  const con2 = fresh();
  upsertPrices(con2, "LQ45", [
    { date: "2026-06-01", close: 900, volume: null },
    { date: "2026-09-29", close: 950, volume: null },
  ]);
  assert.equal(indexReturns(con2, "LQ45", "LQ45", "2026-09-30")!.y, null);
  assert.equal(indexReturns(fresh(), "IHSG", "IHSG", "2026-09-30"), null, "and no closes is no strip");
});
