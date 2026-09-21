/**
 * The live run. plan.md §6: market-wide ranges first, then a bounded
 * per-ticker fill for the watchlist, then stop. Safe to run daily -- the
 * per-ticker calls are cached forever, and the range calls ask only for the
 * days `coverage` says are missing, plus the last covered day -- a feed is
 * still filling on its own final day, so that one is never taken as final.
 *
 *   npm run backfill              # 90-day facts + watchlist fill
 *   npm run backfill -- --poll    # the cheap daily shape: facts since yesterday
 */
import { Client } from "../src/api.js";
import { backfillFacts, ensureTicker, fillBoard, fillPrices, fillTicker, pollReports } from "../src/backfill.js";
import { apiKey, BACKFILL_DAYS, defaultWatchlist, indexSymbol, mockMode, runToday } from "../src/config.js";
import { connect, creditsSpent, endRun, hasPrices, startRun } from "../src/db.js";
import { shift } from "../src/dates.js";

if (!mockMode() && !apiKey()) {
  console.error(
    "SECTORS_API_KEY is unset (or still the .env.example placeholder). A live run without it\n" +
      "reads as an empty market rather than an error, so it stops here. Set it in .env, or use MOCK_MODE=1."
  );
  process.exit(1);
}

const poll = process.argv.includes("--poll");
// ~950 companies at 30 rows a credit: a full report sweep is ~32 credits, for
// chips that can only say which PERIOD is available (the feed carries no
// filing date). Worth it once, not on every run -- so it is opt-in.
const wantReports = process.argv.includes("--reports");
// Re-fit every watched symbol from the cached responses. Costs nothing (every
// call is a cache hit) and is how a change to predict.ts reaches the database
// without re-buying a single response.
const refit = process.argv.includes("--refit");
const con = connect();
const spentBefore = creditsSpent(con);
const client = new Client(con, spentBefore);
const today = runToday();
const from = shift(today, poll ? -3 : -BACKFILL_DAYS);
const id = startRun(con, poll ? "daily poll" : "backfill");

console.log(
  `newsidx ${poll ? "poll" : "backfill"} ${from} → ${today} · ${spentBefore} credits spent to date · ${mockMode() ? "MOCK_MODE" : "live"}`
);

try {
  const facts = await backfillFacts(con, client, from, today);
  const reports = wantReports
    ? await pollReports(con, client, shift(today, poll ? -95 : -370), today)
    : { written: 0, truncated: false };
  let filled = 0;
  for (const s of defaultWatchlist()) {
    const r = refit ? await fillTicker(con, client, s, today) : await ensureTicker(con, client, s, today);
    if (!r.skipped) filled += 1;
  }
  // One credit per name buys 90 days of closes for the calendar's price strip.
  // Budgeted here rather than on a page view, so browsing can never spend.
  let priced = 0;
  // The index first when one is configured: it is the subject of the price
  // strip on the default, unfiltered calendar, so it is the one series every
  // visitor sees. One credit, same 90 days, same permanent cache.
  for (const s of [indexSymbol(), ...defaultWatchlist()].filter(Boolean) as string[]) {
    if (hasPrices(con, s, shift(today, -7), today)) continue;
    priced += (await fillPrices(con, client, s, shift(today, -90), today)) > 0 ? 1 : 0;
  }

  // The board: one credit for the 200 largest names, sized and coloured. It is
  // keyed by today, so running the backfill twice in a day writes the same row
  // twice rather than paying twice -- the cache sees the identical URL.
  const drawn = await fillBoard(con, client, today);

  endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);
  console.log(
    `  ${facts.written} fact chips · ${reports.written} report facts · ${filled} tickers filled · ${priced} priced · ${drawn} on the board · ${client.spent} credits this run`
  );
  if (facts.truncated.length) {
    console.log(`  page cap reached: ${facts.truncated.join(", ")}`);
    console.log(`  facts are complete from ${facts.coveredFrom} forward — raise PAGE_CAP or run again to reach further back`);
  }
  if (reports.truncated) {
    console.log(`  the report feed was cut off by the page cap — it is ~32 credits for the full ~950 companies`);
  }
  if (!wantReports) console.log(`  report facts skipped (pass --reports; ~32 credits for the full universe)`);
} catch (e) {
  endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  console.error(`  stopped after ${client.spent} credits: ${(e as Error).message}`);
  process.exitCode = 1;
}
