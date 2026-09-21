/**
 * The derived layer is the one part of this product that makes a claim the
 * API did not, so it is the part that has to be falsifiable. These tests are
 * mostly about the refusals: any fit can draw a window, and what makes this
 * one defensible is the cases where it declines to.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { expectedDrop, fitAnnualRhythm, fmtPct, hitRateLabel, seasons } from "./predict.js";

// ------------------------------------------------------------ seasons

test("two payments a year are two rhythms, not one wide one", () => {
  const s = seasons([
    "2023-03-14", "2024-03-12", "2025-03-15",
    "2023-11-20", "2024-11-18", "2025-11-22",
  ]);
  assert.equal(s.length, 2);
  const months = s.map((season) => new Set(season.map((d) => d.slice(5, 7))));
  assert.ok(months.some((m) => m.has("03")) && months.some((m) => m.has("11")));
  // Fitting them together would put the centre in July and refuse everything.
  const merged = fitAnnualRhythm(
    ["2023-03-14", "2023-11-20", "2024-03-12", "2024-11-18", "2025-03-15"],
    "2026-01-01"
  );
  assert.equal(merged.ok, false);
});

test("a December/January rhythm is one season, not two", () => {
  const s = seasons(["2023-12-28", "2024-01-03", "2025-12-30"]);
  assert.equal(s.length, 1, "the year boundary is not a break in the rhythm");
});

// ------------------------------------------------------------ the fit

test("a steady annual date fits a window, and the real date lands inside it", () => {
  // BBRI's fixture history: late November, five years running.
  const hist = ["2021-11-25", "2022-11-29", "2023-11-27", "2024-11-28", "2025-11-26"];
  const r = fitAnnualRhythm(hist, "2026-09-11");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.fit.from < r.fit.to, "a window is a range");
  assert.ok(r.fit.from.startsWith("2026-11"), `expected November, got ${r.fit.from}`);
  assert.equal(r.fit.trials, 3, "three occurrences were testable out of sample");
  assert.equal(r.fit.hits, 3);
  assert.match(hitRateLabel(r.fit), /right 3 of the last 3/);
});

test("too few occurrences is refused, with the count in the reason", () => {
  const r = fitAnnualRhythm(["2024-06-12", "2025-06-25"], "2026-09-11");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /2 past occurrences/);
});

test("dates that scatter are refused rather than widened", () => {
  // ASII's fixture history swings across October and November.
  const r = fitAnnualRhythm(["2022-10-31", "2023-11-20", "2024-10-08", "2025-11-27"], "2026-09-11");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /scattered/);
});

test("a fit refuted by its own history is refused", () => {
  // A date marching a week later every year. The spread stays inside the
  // scatter limit, so nothing else catches it -- but every walk-forward
  // prediction lands behind the real date, which is what refutes it.
  const r = fitAnnualRhythm(
    ["2021-06-01", "2022-06-07", "2023-06-13", "2024-06-19", "2025-06-25"],
    "2026-01-01"
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /outside the window/);
});

test("the window never closes before today", () => {
  const hist = ["2021-11-25", "2022-11-29", "2023-11-27", "2024-11-28"];
  for (const today of ["2026-01-05", "2026-09-11", "2026-12-20"]) {
    const r = fitAnnualRhythm(hist, today);
    assert.equal(r.ok, true, `no fit at ${today}`);
    if (r.ok) assert.ok(r.fit.to >= today, `${r.fit.to} is behind ${today}`);
  }
});

test("a window is always at least four days wide, and never a fortnight", () => {
  // Three identical days of the year: MAD is 0, and a zero-width window is a
  // date wearing a range's clothes.
  const r = fitAnnualRhythm(["2023-06-05", "2024-06-05", "2025-06-05"], "2026-01-01");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const days = (Date.parse(r.fit.to) - Date.parse(r.fit.from)) / 864e5;
  assert.ok(days >= 4 && days <= 14, `window spans ${days} days`);
});

test("future dates are never fitted from — the issuer already dated those", () => {
  const withFuture = ["2023-06-08", "2024-06-06", "2025-06-05", "2026-12-31"];
  const a = fitAnnualRhythm(withFuture, "2026-09-11");
  const b = fitAnnualRhythm(withFuture.slice(0, 3), "2026-09-11");
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------ the drop

test("the drop is the dividend leaving the price, and nothing else", () => {
  const d = expectedDrop(168, 3900);
  assert.ok(d);
  assert.equal(d.close, 3900);
  assert.equal(fmtPct(d.pct), "−4.3%");
  assert.match(d.basis, /close/);
});

test("no close means no drop — a percentage with no denominator is not a claim", () => {
  assert.equal(expectedDrop(168, null), null);
  assert.equal(expectedDrop(168, 0), null);
  assert.equal(expectedDrop(null, 3900), null);
});

test("a half-day centre is not rounded into a hit", () => {
  // BBCA's fixture history. Predicting 2024 from 2022+2023 gives a centre of
  // day 338.5 and a half-width of 2; the real date lands 2.5 days out, which
  // is a miss. Rounding the centre first would make it exactly 2.0 -- and
  // would round in the flattering direction about half the time.
  const r = fitAnnualRhythm(["2022-12-05", "2023-12-04", "2024-12-06", "2025-12-03"], "2026-09-11");
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fit.trials, 2);
  assert.equal(r.fit.hits, 1, "2.5 days outside a ±2 day window is not a hit");
});
