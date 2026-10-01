import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connect, creditsSpent, endRun, eventsInRange, getFaq, startRun, upsertEvents } from "./db.js";

const fresh = () => connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));

test("re-running a backfill is idempotent, which is what makes it free", () => {
  const con = fresh();
  const row = {
    date: "2026-09-23",
    symbol: "TLKM",
    kind: "exdiv",
    class: "scheduled" as const,
    title: "Cash dividend · ex-date",
    extra: { amount: 168 },
  };
  upsertEvents(con, [row]);
  upsertEvents(con, [{ ...row, title: "Cash dividend · ex-date", detail: "IDR 168 per share" }]);
  const rows = eventsInRange(con, "2026-09-01", "2026-09-30", ["TLKM"]);
  assert.equal(rows.length, 1, "one chip, not two");
  assert.equal(rows[0].detail, "IDR 168 per share", "the later write wins");
  assert.equal(rows[0].extra?.amount, 168);
});

test("two headlines for one company on one day stay two rows", () => {
  const con = fresh();
  const row = { date: "2026-09-11", symbol: "ICBP", kind: "news", class: "fact" as const };
  upsertEvents(con, [
    { ...row, key: "https://news.invalid/a", title: "wheat costs up", extra: { tags: ["Bearish"] } },
    { ...row, key: "https://news.invalid/b", title: "margin beat", extra: { tags: ["Bullish"] } },
  ]);
  upsertEvents(con, [{ ...row, key: "https://news.invalid/a", title: "wheat costs up", extra: { tags: ["Bearish"] } }]);
  const rows = eventsInRange(con, "2026-09-01", "2026-09-30", ["ICBP"]);
  assert.equal(rows.length, 2, "one row per story, and a re-run still upserts");
  assert.deepEqual(rows.map((r) => r.extra?.tags).flat().sort(), ["Bearish", "Bullish"]);
});

test("a watchlist query never leaks other symbols", () => {
  const con = fresh();
  upsertEvents(con, [
    { date: "2026-09-23", symbol: "TLKM", kind: "exdiv", class: "scheduled", title: "a" },
    { date: "2026-09-23", symbol: "UNVR", kind: "exdiv", class: "scheduled", title: "b" },
  ]);
  const rows = eventsInRange(con, "2026-09-01", "2026-09-30", ["TLKM"]);
  assert.deepEqual(rows.map((r) => r.symbol), ["TLKM"]);
});

test("a FAQ written by an older version still renders", () => {
  const con = fresh();
  // Exactly what an earlier release stored: no per-answer sources, no summary
  // column. These rows cost money, so they are kept and normalised, never
  // dropped -- and the page must not 500 on one.
  con
    .prepare(`INSERT INTO faq(symbol,generated_at,model,fingerprint,items) VALUES (?,?,?,?,?)`)
    .run("BBCA", "2026-09-11T10:00:00.000Z", "claude-opus-5", "9@2026-09-11",
      JSON.stringify([{ question: "Has BCA announced a dividend?", answer: "Yes, on 9 September 2026." }]));

  const row = getFaq(con, "BBCA")!;
  assert.deepEqual(row.summary, [], "no summary yet, but an array rather than null");
  assert.deepEqual(row.items[0].sources, [], "an uncited answer has no sources, not undefined");
  assert.equal(row.items[0].question, "Has BCA announced a dividend?");
});

test("credits are a lifetime total across runs, not a per-process one", () => {
  const con = fresh();
  const a = startRun(con, "one");
  endRun(con, a, 12, 0);
  const b = startRun(con, "two");
  endRun(con, b, 7, 3);
  assert.equal(creditsSpent(con), 19);
});

test("the response cache lives in the database and survives a reconnect", async () => {
  const { makeCache } = await import("./cache.js");
  const dir = mkdtempSync(path.join(tmpdir(), "fw-"));
  const dbPath = path.join(dir, "t.db");
  const url = "https://api.sectors.app/v2/filings/?start=2026-09-01";

  const first = makeCache(connect(dbPath));
  assert.equal(first.get(url), undefined, "a cold cache is a miss");
  first.set(url, { results: [{ symbol: "BBCA.JK" }] });

  // A new process, a new connection: the paid-for response is still there.
  const con = connect(dbPath);
  assert.deepEqual(makeCache(con).get(url), { results: [{ symbol: "BBCA.JK" }] });
  const { cacheSize } = await import("./db.js");
  assert.equal(cacheSize(con).entries, 1);
});

test("a snapshot endpoint asks the API every time; a dated one is answered by the cache", async () => {
  const { Client } = await import("./api.js");
  const { makeCache } = await import("./cache.js");
  const con = fresh();
  const saved = { key: process.env.SECTORS_API_KEY, mock: process.env.MOCK_MODE, fetch: globalThis.fetch };
  process.env.SECTORS_API_KEY = "test-placeholder-not-a-key";
  delete process.env.MOCK_MODE;
  let hits = 0;
  globalThis.fetch = (async () => {
    hits++;
    return new Response(JSON.stringify({ as_of: "today" }), { status: 200 });
  }) as typeof fetch;
  try {
    // Yesterday's answer, under a URL that carries no date.
    makeCache(con).set("https://api.sectors.app/v2/companies/top-changes/?n_stock=5", { as_of: "yesterday" });
    const client = new Client(con);
    assert.deepEqual(await client.get("/v2/companies/top-changes/", { n_stock: 5 }, 1), { as_of: "yesterday" });
    assert.equal(hits, 0, "without fresh the cache answers");
    assert.deepEqual(await client.get("/v2/companies/top-changes/", { n_stock: 5 }, 1, true), { as_of: "today" });
    assert.equal(hits, 1, "fresh goes to the API");
    assert.deepEqual(
      makeCache(con).get("https://api.sectors.app/v2/companies/top-changes/?n_stock=5"),
      { as_of: "today" },
      "and the new answer replaces the old one"
    );
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.SECTORS_API_KEY; else process.env.SECTORS_API_KEY = saved.key;
    if (saved.mock !== undefined) process.env.MOCK_MODE = saved.mock;
  }
});

test("a day's board is replaced by a new fetch, never merged, and never wiped by an empty one", async () => {
  const { upsertBoard, boardOn } = await import("./db.js");
  const con = fresh();
  const tile = (symbol: string, close_change: number) => ({
    date: "2026-09-30", symbol, name: symbol, sector: "Financials", sub_sector: "Banks",
    market_cap: 1e12, close_change,
  });
  upsertBoard(con, [tile("BBCA", 0.01), tile("KPIG", -0.02)]);
  upsertBoard(con, [tile("BBCA", 0.03)]);
  assert.deepEqual(boardOn(con, "2026-09-30").map((r) => [r.symbol, r.close_change]), [["BBCA", 0.03]],
    "a name that left the snapshot leaves the board");
  upsertBoard(con, []);
  assert.equal(boardOn(con, "2026-09-30").length, 1, "and a failed call keeps what we had");
});
