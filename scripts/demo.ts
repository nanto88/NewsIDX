/**
 * The no-key demo path. plan.md §8 step 4 and §10.
 *
 * Builds a complete database from fixtures -- same pipeline, same SQL, same
 * renderers as a live run -- so a judge without an API key sees the product
 * work rather than a screenshot of it. Every number it produces is fabricated
 * and every page it serves says so.
 */
import { rmSync } from "node:fs";
import { Client } from "../src/api.js";
import { backfillFacts, fillBoard, fillIndexYear, fillMovers, fillPrices, fillTicker, pollReports } from "../src/backfill.js";
import { BACKFILL_DAYS, DATA_DIR, defaultWatchlist, indexChoices, mockMode, runToday } from "../src/config.js";
import { connect, creditsSpent, endRun, startRun } from "../src/db.js";
import { shift } from "../src/dates.js";

if (!mockMode()) {
  console.error("demo.ts is the fixture path: run it with MOCK_MODE=1 (npm run demo does).");
  process.exit(1);
}

// A demo that inherits yesterday's rows is a demo that lies about what one run
// produces.
rmSync(DATA_DIR, { recursive: true, force: true });

const con = connect();
const client = new Client(con, creditsSpent(con));
const today = runToday();
const from = shift(today, -BACKFILL_DAYS);
const watchlist = defaultWatchlist();
const id = startRun(con, "fixture demo");

try {
  const facts = await backfillFacts(con, client, from, today);
  const reports = (await pollReports(con, client, shift(today, -120), today)).written;
  let perTicker = 0;
  for (const s of watchlist) perTicker += (await fillTicker(con, client, s, today)).events;
  // The index leads: it is the series the default, unfiltered calendar shows.
  for (const s of [...new Set([...indexChoices().map((c) => c.symbol), ...watchlist])])
    await fillPrices(con, client, s, shift(today, -90), today);
  for (const c of indexChoices()) await fillIndexYear(con, client, c.symbol, today);
  // The board: one call, and the only market-wide picture in the product.
  const drawn = await fillBoard(con, client, today);
  // The movers: one call, every period.
  const moved = await fillMovers(con, client, today);

  endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);

  console.log(`
newsidx — fixture run for ${today}
  window           ${from} → ${today}
  market facts     ${facts.written} chips${facts.truncated.length ? ` (page cap hit: ${facts.truncated.join(", ")})` : ""}
  report facts     ${reports}
  per-ticker       ${perTicker} chips across ${watchlist.length} names
  board            ${drawn} companies, one call
  movers           ${moved} rows across every period, one call
  credits          ${client.spent} (${client.calls.length} calls, all fixtures)

Now serve it:  npm run demo:serve   ->  http://localhost:3000
`);
} catch (e) {
  endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  throw e;
}
