import assert from "node:assert/strict";
import test from "node:test";
import { expectedDrop, fmtPct } from "./dividend.js";

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
