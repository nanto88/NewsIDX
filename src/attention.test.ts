import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { toItem } from "./calendar.js";
import { nearestEvent, needsAttention, qualifies, threadsOf } from "./attention.js";
import { type EventRow, connect, eventsInRange, upsertEvents, upsertPrices } from "./db.js";

const TODAY = "2026-09-18";

const news = (date: string, symbol: string, title: string, host: string, tags: string[] = []): EventRow => ({
  date,
  symbol,
  kind: "news",
  key: `${host}/${title}`,
  class: "fact",
  title,
  source_url: `https://${host}/x`,
  extra: { tags, tag_counts: Object.fromEntries(tags.map((t) => [t, 1])) },
});

function db(rows: EventRow[] = []) {
  const con = connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-att-")), "t.db"));
  if (rows.length) upsertEvents(con, rows);
  return con;
}
const items = (con: ReturnType<typeof db>, from = "2026-01-01", to = "2026-12-31") =>
  eventsInRange(con, from, to).map(toItem);

// ---------------------------------------------------------------- threading

// One story, three sources, the way a wire story actually reads -- the second
// and third rewrite the first rather than sharing two words with it. Plus one
// unrelated ANTM story, which must not be swept in with them.
const PICKUP = [
  news("2026-09-15", "ANTM", "ANTM cuts output guidance on lower ore grade", "kontan.invalid", ["Bearish"]),
  news("2026-09-16", "ANTM", "Antam trims output guidance after ore grade slips", "bisnis.invalid", ["Bearish"]),
  news("2026-09-16", "ANTM", "ANTM output guidance cut on lower ore grade sends shares to a three-month low", "cnbc.invalid", ["Bearish"]),
  news("2026-09-16", "ANTM", "ANTM names a new head of exploration", "investor.invalid", []),
];

test("sources running one story collapse into one thread, and an unrelated story stays its own", () => {
  const t = threadsOf(items(db(PICKUP)));
  assert.equal(t.length, 2);
  const [big, small] = t.sort((a, b) => b.members.length - a.members.length);
  assert.equal(big.members.length, 3);
  assert.equal(big.sources, 3);
  assert.equal(small.members.length, 1, "the exploration story is not the guidance story");
  assert.ok(big.shared.includes("guidance"), big.shared.join(","));
});

test("the lead is the earliest wording, not the loudest", () => {
  const t = threadsOf(items(db(PICKUP))).find((x) => x.members.length === 3)!;
  assert.equal(t.lead.date, "2026-09-15");
  assert.equal(t.from, "2026-09-15");
  assert.equal(t.to, "2026-09-16");
});

test("grouping does not depend on the order the rows arrived in", () => {
  // Single-link, not seed-matching: the third headline reaches the first only
  // through the second, and a greedy pass would leave it behind.
  const chain = [
    news("2026-09-10", "TLKM", "TLKM data-centre capex questioned by brokerages", "a.invalid"),
    news("2026-09-11", "TLKM", "Brokerages question TLKM data-centre capex plan", "b.invalid"),
    news("2026-09-11", "TLKM", "TLKM defends the data-centre capex plan", "c.invalid"),
  ];
  const forward = threadsOf(items(db(chain)));
  const reverse = threadsOf(items(db(chain)).reverse());
  assert.equal(forward.length, 1);
  assert.deepEqual(
    forward.map((t) => t.members.length),
    reverse.map((t) => t.members.length)
  );
});

test("a recurring theme months apart is not one story being picked up", () => {
  const t = threadsOf(
    items(
      db([
        news("2026-07-05", "ASII", "ASII vehicle sales slip for a second month", "a.invalid"),
        news("2026-09-05", "ASII", "ASII vehicle sales slip for a second month", "b.invalid"),
      ])
    )
  );
  assert.equal(t.length, 2, "identical wording, sixty days apart, is two occurrences");
});

test("sentiment is counted per headline, so a split story reports both sides", () => {
  const t = threadsOf(
    items(
      db([
        news("2026-09-08", "BMRI", "BMRI rights issue to fund the digital build-out", "a.invalid", ["Bullish"]),
        news("2026-09-09", "BMRI", "BMRI rights issue for the digital build-out priced low", "b.invalid", ["Bearish"]),
      ])
    )
  )[0];
  assert.equal(t.members.length, 2);
  assert.equal(t.positive, 1);
  assert.equal(t.negative, 1);
  assert.equal(t.split, true);
});

test("one story naming four banks is one row, not four", () => {
  // The backfill writes a row per symbol, which is right for each bank's own
  // timeline and wrong for a ranked list. Found by running against live data,
  // where the same restructuring headline filled the top four places.
  const title = "PT PP signs a debt restructuring agreement with four state-owned banks";
  const con = db(
    ["BBNI", "BBRI", "BMRI", "BRIS"].flatMap((sym) => [
      news("2026-09-11", sym, title, "kontan.invalid", ["Bullish"]),
      news("2026-09-11", sym, title, "bisnis.invalid", ["Bearish"]),
    ])
  );
  const t = threadsOf(items(con));
  assert.equal(t.length, 1, "one feed entry is one story");
  assert.deepEqual(t[0].symbols, ["BBNI", "BBRI", "BMRI", "BRIS"]);
  assert.equal(t[0].sources, 2, "two sources, not eight");

  // And it stays one row through the ranking, holding every name it mentions.
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY, watchlist: ["BMRI"] });
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].held, true, "one of the four is in the watchlist");
  assert.equal(a.rows[0].move, null, "four names, so no single close belongs beside it");
});

// ---------------------------------------------------------------- near a date

test("the nearest published date wins", () => {
  const con = db([
    ...PICKUP,
    { date: "2026-09-22", symbol: "ANTM", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
    { date: "2026-10-30", symbol: "ANTM", kind: "agm", class: "scheduled", title: "General meeting" },
  ]);
  const near = nearestEvent(con, "ANTM", "2026-09-16")!;
  assert.equal(near.kind, "exdiv");
  assert.equal(near.days, 6);
});

test("nothing inside the window means no flag", () => {
  const con = db([
    ...PICKUP,
    { date: "2026-11-30", symbol: "ANTM", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
  ]);
  assert.equal(nearestEvent(con, "ANTM", "2026-09-16"), null);
  assert.equal(nearestEvent(con, "", "2026-09-16"), null, "market-wide news has no issuer");
});

// ---------------------------------------------------------------- the ranking

test("the floor keeps out a lone story on a name with no date near it", () => {
  const con = db([
    news("2026-09-16", "UNVR", "UNVR distribution overhaul enters a second phase", "a.invalid"),
    ...PICKUP,
  ]);
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY, watchlist: [] });
  assert.equal(a.considered, 3, "three stories in range");
  assert.ok(
    !a.rows.some((r) => r.thread.symbols.includes("UNVR")),
    "one source, no date near it — it is on /month with everything else"
  );
  assert.ok(a.rows.some((r) => r.thread.symbols.includes("ANTM") && r.thread.sources === 3));
});

test("a single-source story does clear the floor when it lands on a date", () => {
  const con = db([
    news("2026-09-16", "PGAS", "PGAS board sets the dividend timetable", "a.invalid"),
    { date: "2026-09-21", symbol: "PGAS", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
  ]);
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY, watchlist: ["PGAS"] });
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].near?.days, 5);
});

test("pickup is measured against the name's own rate, and refused without a baseline", () => {
  const baseline = [
    news("2026-07-02", "ANTM", "ANTM quarterly nickel volumes hold", "a.invalid"),
    news("2026-07-20", "ANTM", "ANTM signs a smelter offtake agreement", "b.invalid"),
    news("2026-08-11", "ANTM", "ANTM gold sales rise through July", "c.invalid"),
  ];
  const con = db([...baseline, ...PICKUP]);
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY, watchlist: [] });
  const guidance = a.rows.find((r) => r.thread.sources === 3)!;
  assert.equal(guidance.usual, 1, "three past stories, one source each");
  assert.equal(guidance.lift, 3);
  assert.ok(guidance.parts.pickup > 0);

  // The same story with no history behind it quotes no rate at all.
  const bare = needsAttention(db(PICKUP), { from: "2026-09-01", to: TODAY, today: TODAY });
  const noBase = bare.rows.find((r) => r.thread.sources === 3)!;
  assert.equal(noBase.usual, null);
  assert.equal(noBase.lift, null);
  assert.equal(noBase.parts.pickup, 0, "no baseline is no number, not a flattering default");
});

test("the price beside a story is the name's own close on the busiest day", () => {
  const con = db(PICKUP);
  upsertPrices(con, "ANTM", [
    { date: "2026-09-15", close: 1000 },
    { date: "2026-09-16", close: 950 },
  ]);
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY });
  const guidance = a.rows.find((r) => r.thread.sources === 3)!;
  assert.equal(guidance.moveOn, "2026-09-16", "two headlines that day, one the day before");
  assert.ok(Math.abs(guidance.move! + 0.05) < 1e-9, String(guidance.move));
});

test("the score is the sum of the weighted parts it prints, and nothing else", () => {
  const con = db([
    ...PICKUP,
    { date: "2026-09-20", symbol: "ANTM", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
  ]);
  const a = needsAttention(con, { from: "2026-09-01", to: TODAY, today: TODAY, watchlist: ["ANTM"] });
  for (const r of a.rows) {
    const sum = Object.entries(r.parts).reduce((acc, [k, v]) => {
      const w: Record<string, number> = { pickup: 3, speed: 2, event: 3, split: 1.5, move: 1.5, held: 2, fresh: 1.5 };
      return acc + w[k] * v;
    }, 0);
    assert.ok(Math.abs(sum - r.score) < 1e-9, `${r.thread.symbols}: ${sum} vs ${r.score}`);
    assert.ok(qualifies(r));
  }
  assert.ok(a.rows[0].score >= a.rows.at(-1)!.score, "ranked, highest first");
});

test("an empty or inverted range returns nothing rather than throwing", () => {
  const con = db(PICKUP);
  assert.deepEqual(needsAttention(con, { from: "2026-10-01", to: "2026-09-01", today: TODAY }).rows, []);
  assert.equal(needsAttention(con, { from: "2026-01-01", to: "2026-01-31", today: TODAY }).considered, 0);
});
