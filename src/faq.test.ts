/**
 * The FAQ is the one place in this product that spends money per click, so
 * what is tested here is mostly what must NOT happen: no second call while
 * the rows are unchanged, and nothing generated at all without a key.
 *
 * MOCK_MODE is set before the import, because config reads the environment
 * once at module load -- the same reason the demo script sets it in the
 * npm script rather than in code.
 */
process.env.MOCK_MODE = "1";

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { askFaq, ensureFaq, fingerprint, questionHash, MAX_QUESTION } from "./faq.js";
import type { Item } from "./calendar.js";
import { connect, getFaq } from "./db.js";

const fresh = () => connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));

const news = (date: string, title: string, tags: string[]): Item => ({
  cls: "fact",
  kind: "news",
  symbol: "TLKM",
  date,
  title,
  tags,
  tagCounts: Object.fromEntries(tags.map((t) => [t, 1])),
});

const ROWS = [
  news("2026-09-10", "TLKM wins enterprise contract", ["Bullish", "Business Expansion"]),
  news("2026-09-08", "TLKM capex questioned", ["Bearish", "Capital & Funding"]),
];

test("the fingerprint moves when a row lands, and only then", () => {
  assert.equal(fingerprint(ROWS), fingerprint([...ROWS].reverse()), "order is not data");
  assert.notEqual(fingerprint(ROWS), fingerprint([...ROWS, news("2026-09-11", "c", [])]));
  assert.equal(fingerprint([]), "0@none");
});

test("a second press with the same rows costs nothing", async () => {
  const con = fresh();
  const first = await ensureFaq(con, "TLKM", ROWS);
  assert.ok(first.row, "the fixture path always produces one");
  assert.equal(first.row!.items.length, 5, "five questions, as asked");

  const again = await ensureFaq(con, "TLKM", ROWS);
  assert.equal(again.row!.generated_at, first.row!.generated_at, "the stored answer is returned, not a new one");

  // A new headline is the one thing that justifies generating again.
  const grown = [...ROWS, news("2026-09-11", "TLKM opens a data centre", ["Bullish"])];
  const third = await ensureFaq(con, "TLKM", grown, "2030-01-01T00:00:00.000Z");
  assert.equal(third.row!.generated_at, "2030-01-01T00:00:00.000Z", "new rows, new answer");
  assert.equal(getFaq(con, "TLKM")!.fingerprint, fingerprint(grown));
});

test("a regenerate is the only way to spend on rows already read", async () => {
  const con = fresh();
  const first = await ensureFaq(con, "TLKM", ROWS, "2026-01-01T00:00:00.000Z");
  const cached = await ensureFaq(con, "TLKM", ROWS, "2030-01-01T00:00:00.000Z");
  assert.equal(cached.row!.generated_at, first.row!.generated_at, "unchanged rows return the stored text");

  const forced = await ensureFaq(con, "TLKM", ROWS, "2030-01-01T00:00:00.000Z", true);
  assert.equal(forced.row!.generated_at, "2030-01-01T00:00:00.000Z", "force rewrites from the same rows");
});

test("the summary and every answer carry the rows they rest on", async () => {
  const out = await ensureFaq(fresh(), "TLKM", ROWS);
  assert.ok(out.row!.summary.length >= 3, "a summary, not just questions");
  for (const s of out.row!.summary) assert.ok(s.point.length > 0);
  // Sources are records we hold, never anything a model wrote.
  const cited = [...out.row!.summary.flatMap((s) => s.sources), ...out.row!.items.flatMap((q) => q.sources)];
  assert.ok(cited.length > 0, "something is cited");
  for (const c of cited) {
    assert.ok(ROWS.some((r) => r.title === c.title && r.date === c.date), `${c.title} is a row we hold`);
  }
});

test("a question is answered from the rows, and asking it again is free", async () => {
  const con = fresh();
  const a = await askFaq(con, "TLKM", ROWS, "What did the brokerages say?", "2026-01-01T00:00:00.000Z");
  assert.ok(a.row, "an answer comes back");
  assert.equal(a.row!.qhash, questionHash("what did the brokerages say?"), "case and spacing do not make a new question");

  const again = await askFaq(con, "TLKM", ROWS, "  WHAT DID THE   BROKERAGES SAY? ", "2030-01-01T00:00:00.000Z");
  assert.ok(again.row, "the same question resolves");
  assert.equal(again.row!.created_at, "2026-01-01T00:00:00.000Z", "the stored answer comes back, not a new call");

  // Guards: nothing to answer, and nothing that is not a question.
  assert.match((await askFaq(con, "TLKM", ROWS, "   ") as { error: string }).error, /ask a question/);
  const long = await askFaq(con, "TLKM", ROWS, "x".repeat(MAX_QUESTION + 1));
  assert.match((long as { error: string }).error, /keep it under/);
  assert.equal(long.row, null);
});

test("a company with nothing on record generates nothing", async () => {
  const out = await ensureFaq(fresh(), "NONE", []);
  assert.equal(out.row, null);
  assert.match((out as { error: string }).error, /no rows on record/);
});

test("the generated answers never forecast or advise", async () => {
  const out = await ensureFaq(fresh(), "TLKM", ROWS);
  const text = [
    ...out.row!.summary.map((s) => s.point),
    ...out.row!.items.map((q) => `${q.question} ${q.answer}`),
  ].join(" ").toLowerCase();
  for (const banned of ["should buy", "should sell", "will rise", "will fall", "price target"]) {
    assert.ok(!text.includes(banned), `"${banned}" must never appear in generated copy`);
  }
  // And it says whose labels the sentiment tags are.
  assert.match(text, /bullish tag|tagged bullish|provider/);
});
