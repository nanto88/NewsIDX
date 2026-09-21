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
