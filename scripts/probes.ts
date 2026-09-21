/**
 * Probes. plan.md §7 — measure before building, and every probe is also a
 * cache prepayment: these are calls the product needs anyway, so the marginal
 * cost of measuring first is zero.
 *
 * Prints a markdown table to paste into the README. Needs SECTORS_API_KEY;
 * MOCK_MODE=1 exercises the script itself against fixtures.
 *
 *   npm run probes
 */
import { Client } from "../src/api.js";
import { apiKey, defaultWatchlist, INDEX_CANDIDATES, mockMode, runToday } from "../src/config.js";
import { connect, creditsSpent, endRun, startRun } from "../src/db.js";
import { shift } from "../src/dates.js";

type Quarter = "q1" | "q2" | "q3" | "q4";
interface ReportDate { date: string; quarter: Quarter }

if (!mockMode() && !apiKey()) {
  console.error(
    "SECTORS_API_KEY is unset (or still the .env.example placeholder). A live run without it\n" +
      "reads as an empty market rather than an error, so it stops here. Set it in .env, or use MOCK_MODE=1."
  );
  process.exit(1);
}

const con = connect();
const client = new Client(con, creditsSpent(con));
const runId = startRun(con, "probes");
const today = runToday();
const answers: [string, string][] = [];

function parseQuarterly(body: any): ReportDate[] {
  const out: ReportDate[] = [];
  for (const pairs of Object.values(body ?? {})) {
    if (!Array.isArray(pairs)) continue;
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const q = String(p[1]).toLowerCase();
      if (["q1", "q2", "q3", "q4"].includes(q)) out.push({ date: String(p[0]).slice(0, 10), quarter: q as Quarter });
    }
  }
  return out;
}

try {
  // ---- Q11: how much report history does the quarterly feed carry?
  const probeSymbol = defaultWatchlist()[0] ?? "BBCA";
  const qd = await client.tryGet(`/v2/company/get_quarterly_financial_dates/${probeSymbol}/`, undefined, 1);
  if (qd.body) {
    const rows = parseQuarterly(qd.body);
    const years = new Set(rows.map((r) => r.date.slice(0, 4)));
    answers.push([
      "Q11 — years of report history",
      `${years.size} year(s), ${rows.length} rows for ${probeSymbol} (${[...years].sort().join(", ")})`,
    ]);
  } else {
    answers.push(["Q11 — report dates", `failed: ${qd.error}`]);
  }

  // ---- Q13: does upcoming_dividend carry a forward ex-date, for anyone?
  const horizon = shift(today, 90);
  const withUpcoming: string[] = [];
  const dated: string[] = [];
  for (const s of defaultWatchlist()) {
    const r = await client.tryGet(`/v2/company/corporate-actions/${s}/`, undefined, 1);
    const up = r.body?.corporate_actions?.upcoming_dividend;
    const entry = Array.isArray(up) ? up[0] : up;
    if (entry && typeof entry === "object") {
      withUpcoming.push(s);
      const ex = String((entry as any).ex_date ?? "").slice(0, 10);
      if (ex && ex >= today && ex <= horizon) dated.push(`${s} ${ex}`);
    }
  }
  answers.push([
    "Q13 — upcoming_dividend populated?",
    withUpcoming.length
      ? `${withUpcoming.length}/${defaultWatchlist().length} names carry it; forward ex-dates inside 90 days: ${dated.length ? dated.join(", ") : "none"}`
      : "no name in the seed carries upcoming_dividend — the scheduled class needs a different seed, or it is empty in this window",
  ]);

  // ---- Q9: one day of rows, extrapolated. A 1-day probe is 1/90th the price
  // of finding out the expensive way.
  const f = await client.tryGet("/v2/filings/", { start: shift(today, -1), end: shift(today, -1), limit: 30 }, 1);
  const s = await client.tryGet("/v2/suspensions/", { start: shift(today, -30), end: today, limit: 30 }, 1);
  const fTotal = f.body?.pagination?.total_count ?? null;
  answers.push([
    "Q9 — filings volume",
    fTotal == null
      ? `failed: ${f.error}`
      : `${fTotal} rows for one day → ~${Math.ceil((fTotal * 90) / 30)} credits for a 90-day market-wide backfill at 30 rows/credit`,
  ]);
  answers.push([
    "Q9 — suspensions volume",
    s.body?.pagination?.total_count == null
      ? `failed: ${s.error}`
      : `${s.body.pagination.total_count} rows in the last 30 days → ${Math.ceil(s.body.pagination.total_count / 30)} credit(s) per month`,
  ]);

  // ---- Q16: is the composite reachable at all, and under which ticker?
  //
  // Sectors v2 documents no index endpoint. Rather than hard-coding a guess
  // and shipping a calendar tinted from a symbol nobody confirmed, try the
  // candidates and report what came back. A 400 costs nothing, so the whole
  // sweep is at most one credit per symbol that actually exists.
  const idxFrom = shift(today, -10);
  const found: string[] = [];
  for (const cand of INDEX_CANDIDATES) {
    const r = await client.tryGet(`/v2/daily/${cand}/`, { start: idxFrom, end: today }, 1);
    const rows: any[] = Array.isArray(r.body?.results) ? r.body.results : Array.isArray(r.body) ? r.body : [];
    if (rows.length) found.push(`${cand} (${rows.length} rows, last close ${rows.at(-1)?.close ?? "?"})`);
  }
  answers.push([
    "Q16 — index symbol for the market-wide price strip",
    found.length
      ? `${found.join("; ")} → set INDEX_SYMBOL to one of these`
      : `none of ${INDEX_CANDIDATES.join(", ")} returned rows — leave INDEX_SYMBOL unset and the calendar stays uncoloured market-wide`,
  ]);

  // ---- Q12: the IDX tag vocabulary, cached and committed either way.
  const tags = await client.tryGet("/v2/tags/", undefined, 1);
  answers.push([
    "Q12 — IDX tag vocabulary",
    tags.body ? JSON.stringify(tags.body).slice(0, 300) : `failed: ${tags.error}`,
  ]);
} finally {
  console.log(`\n| # | Question | Answer |\n|---|---|---|`);
  for (const [q, a] of answers) console.log(`| | ${q} | ${a.replace(/\|/g, "\\|")} |`);
  const bySource = client.calls.reduce<Record<string, number>>((acc, c) => {
    acc[c.source] = (acc[c.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\n${client.spent} credits spent over ${client.calls.length} calls (${Object.entries(bySource)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")})${mockMode() ? " — MOCK_MODE fixtures, not measurements" : ""}.`
  );
  // The probes are a real spend; without a ledger row the lifetime ceiling
  // under-counts by exactly this much on every later run.
  endRun(con, runId, client.spent, client.calls.filter((c) => c.source === "cache").length);
}
