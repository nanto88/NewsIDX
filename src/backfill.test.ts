/**
 * The incremental range logic. A wrong answer here is expensive in one
 * direction and silently wrong in the other: too eager and every daily run
 * re-buys 90 days, too clever and a day is skipped forever.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { missingSpans } from "./backfill.js";
import { connect, getCoverage, markCoverage } from "./db.js";

test("a feed never fetched is fetched whole", () => {
  assert.deepEqual(missingSpans(null, "2026-06-01", "2026-08-30"), [["2026-06-01", "2026-08-30"]]);
});

test("a day further forward buys only the new days", () => {
  // Yesterday bought [06-01, 08-30]. Today wants [06-02, 08-31].
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-06-02", "2026-08-31");
  assert.deepEqual(spans, [["2026-08-30", "2026-08-31"]]);
});

test("the covered end date is re-fetched, because a feed is still filling on its last day", () => {
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-06-01", "2026-08-30");
  assert.deepEqual(spans, [["2026-08-30", "2026-08-30"]]);
});

test("a window already covered with room to spare costs nothing", () => {
  assert.deepEqual(missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-07-01", "2026-08-01"), []);
});

test("reaching further back buys the back gap and nothing already held", () => {
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-05-01", "2026-08-01");
  assert.deepEqual(spans, [["2026-05-01", "2026-05-31"]]);
});

test("reaching further back AND forward buys both ends, not the middle", () => {
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-05-01", "2026-09-05");
  assert.deepEqual(spans, [
    ["2026-05-01", "2026-05-31"],
    ["2026-08-30", "2026-09-05"],
  ]);
});

test("a window disjoint from what is covered is fetched whole rather than bridged", () => {
  // Bridging would claim February to May without ever fetching it.
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-01-01", "2026-02-01");
  assert.deepEqual(spans, [["2026-01-01", "2026-02-01"]]);
});

test("an adjacent window is treated as contiguous, not disjoint", () => {
  const spans = missingSpans({ from: "2026-06-01", to: "2026-08-30" }, "2026-05-01", "2026-05-31");
  assert.deepEqual(spans, [["2026-05-01", "2026-05-31"]]);
});

test("an inverted range asks for nothing", () => {
  assert.deepEqual(missingSpans(null, "2026-08-30", "2026-06-01"), []);
});

test("coverage widens when spans touch and replaces when they do not", () => {
  const con = connect(":memory:");

  assert.equal(getCoverage(con, "news"), null);

  markCoverage(con, "news", "2026-06-01", "2026-08-30");
  assert.deepEqual(getCoverage(con, "news"), { from: "2026-06-01", to: "2026-08-30" });

  // Overlapping: widen.
  markCoverage(con, "news", "2026-08-30", "2026-09-05");
  assert.deepEqual(getCoverage(con, "news"), { from: "2026-06-01", to: "2026-09-05" });

  // Adjacent by one day: still widen.
  markCoverage(con, "news", "2026-05-01", "2026-05-31");
  assert.deepEqual(getCoverage(con, "news"), { from: "2026-05-01", to: "2026-09-05" });

  // Disjoint: replace, because one span cannot describe two with a hole.
  markCoverage(con, "news", "2026-01-01", "2026-02-01");
  assert.deepEqual(getCoverage(con, "news"), { from: "2026-01-01", to: "2026-02-01" });

  // Feeds are tracked separately.
  assert.equal(getCoverage(con, "filings"), null);
  con.close();
});

test("a second identical run asks for one day, not the whole window", () => {
  // The regression this whole mechanism exists to prevent.
  const con = connect(":memory:");
  const from = "2026-06-01";
  const to = "2026-08-30";

  const first = missingSpans(getCoverage(con, "filings"), from, to);
  assert.deepEqual(first, [[from, to]]);
  for (const [a, b] of first) markCoverage(con, "filings", a, b);

  const second = missingSpans(getCoverage(con, "filings"), from, to);
  assert.equal(second.length, 1);
  assert.deepEqual(second, [[to, to]]);
  con.close();
});

test("an index is priced from the index endpoint, a company from the daily one", async () => {
  const { fillPrices } = await import("./backfill.js");
  const { connect } = await import("./db.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const con = connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));
  const seen: string[] = [];
  const client = {
    tryGet: async (p: string) => {
      seen.push(p);
      return p.startsWith("/v2/index-daily/")
        ? { body: [{ index_code: "IHSG", date: "2026-09-29", price: 7123.4 }], error: null }
        : { body: { results: [{ date: "2026-09-29", close: 9000, volume: 1 }] }, error: null };
    },
  } as any;
  assert.equal(await fillPrices(con, client, "IHSG", "2026-09-01", "2026-09-29"), 1);
  assert.equal(await fillPrices(con, client, "BBCA", "2026-09-01", "2026-09-29"), 1);
  assert.deepEqual(seen, ["/v2/index-daily/ihsg/", "/v2/daily/BBCA/"]);
  const close = con.prepare("SELECT close FROM price WHERE symbol='IHSG'").get() as any;
  assert.equal(close.close, 7123.4, "and the index's `price` is stored as its close");
});

test("a year of an index is bought once, in 90-day calls, and never again", async () => {
  const { fillIndexYear, lastSession } = await import("./backfill.js");
  const { connect } = await import("./db.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const con = connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));
  const calls: any[] = [];
  const client = {
    tryGet: async (p: string, q: any) => {
      calls.push([p, q.start, q.end]);
      return { body: [{ date: q.start, price: 7000 }, { date: q.end, price: 7100 }], error: null };
    },
  } as any;
  await fillIndexYear(con, client, "IHSG", "2026-09-30");
  assert.equal(calls.length, 4, "four calls of at most 90 days cover the year");
  assert.ok(calls.every(([p]) => p === "/v2/index-daily/ihsg/"));
  assert.ok(calls.every(([, s, e]) => (Date.parse(e) - Date.parse(s)) / 864e5 <= 90));
  await fillIndexYear(con, client, "IHSG", "2026-09-30");
  assert.equal(calls.length, 4, "the second run buys nothing");
  // The session a run should hold: Friday on a Monday, the day before otherwise.
  assert.equal(lastSession("2026-09-28"), "2026-09-25");
  assert.equal(lastSession("2026-09-30"), "2026-09-29");
});

test("a sweep cut short by the page cap claims every day it walked past, and only those", async () => {
  const { pagedRange } = await import("./backfill.js");
  const { PAGE_LIMIT } = await import("./config.js");
  const { shift } = await import("./dates.js");
  // Twelve stories a day, 16-30 Sep, served newest-first the way the real
  // feeds page (measured on every cached news, filings and suspensions page).
  const all: { timestamp: string }[] = [];
  for (let d = "2026-09-30"; d >= "2026-09-16"; d = shift(d, -1))
    for (let i = 0; i < 12; i++) all.push({ timestamp: `${d}T0${i % 10}:00:00` });
  const client = (order: "desc" | "asc") => ({
    tryGet: async (_p: string, q: any) => {
      const inRange = all.filter((r) => r.timestamp.slice(0, 10) >= q.start && r.timestamp.slice(0, 10) <= q.end);
      if (order === "asc") inRange.reverse();
      const page = inRange.slice(q.offset, q.offset + q.limit);
      return { body: { results: page, pagination: { has_next: q.offset + q.limit < inRange.length } }, error: null };
    },
  }) as any;

  // Four pages: one for the whole range, three for the 16-30 slice.
  const r = await pagedRange(client("desc"), "/v2/news/", "2026-07-02", "2026-09-30", 4);
  assert.equal(r.truncated, true);
  const walked = r.rows.slice(PAGE_LIMIT); // the slice's own rows
  const oldest = walked.at(-1).timestamp.slice(0, 10);
  assert.equal(r.coveredFrom, shift(oldest, 1), "everything after the oldest day reached is whole");
  assert.ok(r.coveredFrom < "2026-09-30", "which is more than the newest day alone -- the bug");
  assert.ok(r.coveredFrom > oldest, "and the day it stopped inside is not claimed");

  // Pages in an order we have not measured: claim nothing rather than guess.
  const unknown = await pagedRange(client("asc"), "/v2/news/", "2026-07-02", "2026-09-30", 4);
  assert.ok(unknown.coveredFrom > "2026-09-30", "nothing in the range is marked complete");

  // One day denser than the whole budget: not even that day is complete, and
  // the caller is told so (coveredFrom after `to`) rather than handed a guess.
  const dense = {
    tryGet: async (_p: string, q: any) => ({
      body: {
        results: Array.from({ length: q.limit }, () => ({ timestamp: "2026-09-30T09:00:00" })),
        pagination: { has_next: true },
      },
      error: null,
    }),
  } as any;
  const one = await pagedRange(dense, "/v2/news/", "2026-09-30", "2026-09-30", 1);
  assert.equal(one.truncated, true);
  assert.ok(one.coveredFrom > "2026-09-30", "a day the budget ran out inside is not marked");
});
