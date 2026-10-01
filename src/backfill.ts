/**
 * API responses -> rows in `event`. plan.md §6 and §8 step 3.
 *
 * Two cost shapes, and the split is the whole credit strategy:
 *
 *   Market-wide range calls  (filings, suspensions, news, report freshness)
 *     cover every listed company for one credit per 30-row page. This is what
 *     fills the past densely without paying per ticker.
 *
 *   Per-ticker calls  (corporate-actions, quarterly dates)
 *     are 1 credit each, cached forever, and only ever made for a symbol
 *     somebody actually asked about. Corporate actions do not change
 *     retroactively, so the second run is free.
 */
import type { Database } from "better-sqlite3";
import type { Client } from "./api.js";
import {
  BOARD_LIMIT,
  BOARD_MIN_MCAP,
  isIndex,
  MOVER_COUNT,
  MOVER_PERIODS,
  PAGE_CAP,
  PAGE_LIMIT,
} from "./config.js";
import {
  type EventRow,
  getCoverage,
  hasPrices,
  markCoverage,
  type MoverRow,
  type Span,
  touchTicker,
  tickerFetchedAt,
  upsertBoard,
  upsertEvents,
  upsertMovers,
  upsertPrices,
} from "./db.js";
import { shift, today as todayIso, year } from "./dates.js";

const bare = (s: string | undefined | null): string => String(s ?? "").toUpperCase().replace(/\.JK$/, "");
const isoDate = (ts: string | undefined | null): string => String(ts ?? "").slice(0, 10);

/**
 * Walk a paginated endpoint. Bounded by PAGE_CAP because every page is a
 * credit and an unbounded `has_next` loop is the entire budget.
 */
async function paged(
  client: Client,
  path: string,
  params: Record<string, unknown>,
  cap = PAGE_CAP
): Promise<{ rows: any[]; pages: number; truncated: boolean }> {
  const rows: any[] = [];
  let offset = 0;
  let pages = 0;
  for (; pages < cap; pages++) {
    const { body, error } = await client.tryGet(path, { ...params, limit: PAGE_LIMIT, offset }, 1);
    if (error || !body) break;
    const batch: any[] = body.results ?? [];
    rows.push(...batch);
    if (!body.pagination?.has_next) return { rows, pages: pages + 1, truncated: false };
    offset = Number(body.pagination.next_offset ?? offset + PAGE_LIMIT);
  }
  return { rows, pages, truncated: true };
}

/**
 * A dated range, newest slice first.
 *
 * The spec documents result ordering for `/v2/free-float/` and for nothing
 * else, so the order `/v2/filings/` pages in is UNVERIFIED. That matters the
 * moment a window is denser than the page cap: if the feed happens to page
 * oldest-first, a truncated 90-day sweep fills June and leaves this week
 * empty, and the agenda -- the whole product -- renders blank while the
 * database looks full.
 *
 * So: try the range in one call (1 credit, complete whenever the window is
 * sparse). If it reports another page, the window is dense, and we re-walk it
 * in slices from today backwards until the page budget runs out. Partial
 * coverage is then always "everything back to <date>", which is the only kind
 * of partial this product can render honestly.
 *
 * When a slice itself outruns the budget, it still counts every day it walked
 * past. The feeds page newest-first -- measured on every cached page of
 * news, filings and suspensions -- so a truncated slice that reached back to
 * day D holds D+1..sliceTo whole; only D may be partial. Claiming just
 * sliceTo (the old rule) marked four fetched days as missing, and the next
 * run bought them again. If a slice's rows are NOT newest-first, the order is
 * unknown and nothing in it is claimed.
 *
 * `coveredFrom` can come back AFTER `to` when not even the newest day
 * finished: nothing is complete, and the caller must not mark any of it.
 */
export async function pagedRange(
  client: Client,
  path: string,
  from: string,
  to: string,
  cap = PAGE_CAP,
  sliceDays = 15,
  dateOf: (row: any) => string = (r) => isoDate(r.timestamp)
): Promise<{ rows: any[]; coveredFrom: string; truncated: boolean }> {
  const first = await paged(client, path, { start: from, end: to }, 1);
  if (!first.truncated) return { rows: first.rows, coveredFrom: from, truncated: false };

  // The first day of [lo,hi] that a truncated, newest-first walk holds whole:
  // the day after the oldest it reached. hi + 1 means none.
  const walked = (got: any[], lo: string, hi: string): string => {
    const dates = got.map(dateOf).filter(Boolean);
    const newestFirst = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
    const oldest = dates.at(-1);
    if (!newestFirst || !oldest) return shift(hi, 1);
    const done = shift(oldest, 1);
    return done < lo ? lo : done;
  };

  const rows = [...first.rows];
  let budget = cap - 1;
  let sliceTo = to;
  // Until a slice finishes, what is held is what the first page walked.
  let coveredFrom = walked(first.rows, from, to);
  while (budget > 0 && sliceTo >= from) {
    const sliceFrom = shift(sliceTo, -(sliceDays - 1));
    const start = sliceFrom < from ? from : sliceFrom;
    const slice = await paged(client, path, { start, end: sliceTo }, budget);
    rows.push(...slice.rows);
    budget -= Math.max(1, slice.pages);
    if (slice.truncated) {
      // This slice alone outran the budget: keep the days it walked past. The
      // first page is re-read here, so the slice's own walk is the better
      // measure -- and when it finished nothing, that is the slice after an
      // earlier complete one (or, for the first slice, nothing at all).
      const done = walked(slice.rows, start, sliceTo);
      coveredFrom = done < coveredFrom || sliceTo === to ? done : coveredFrom;
      break;
    }
    coveredFrom = start;
    sliceTo = shift(start, -1);
    if (start === from) return { rows, coveredFrom: from, truncated: false };
  }
  return { rows, coveredFrom, truncated: coveredFrom > from };
}

// ---------------------------------------------------------------- incremental ranges

/**
 * Which slices of [from,to] are not already covered.
 *
 * Range endpoints carry their dates in the URL, so `api_cache` cannot help a
 * rolling window: yesterday bought `start=D-90&end=D`, today asks for
 * `start=D-89&end=D+1`, and every one of those 91 days is re-bought at full
 * price. Comparing against what the feed has actually been fetched for turns a
 * daily run into the two or three days that are genuinely new.
 *
 * Two deliberate choices:
 *
 *   - The covered end date is ALWAYS re-fetched rather than skipped. A feed is
 *     still filling on its own last day, so treating that day as final would
 *     leave a permanent hole in whatever was published after the run.
 *   - A requested window disjoint from what is covered is fetched whole. The
 *     alternative is to fetch the ends and claim the middle, which is how a
 *     gap becomes invisible.
 */
export function missingSpans(covered: Span | null, from: string, to: string): [string, string][] {
  if (to < from) return [];
  if (!covered) return [[from, to]];
  if (covered.to < shift(from, -1) || covered.from > shift(to, 1)) return [[from, to]];

  const spans: [string, string][] = [];
  if (from < covered.from) spans.push([from, shift(covered.from, -1)]);
  if (to >= covered.to) spans.push([covered.to, to]);
  return spans;
}

/**
 * One market-wide feed over [from,to], buying only the days it is missing.
 *
 * Returns the rows it actually fetched, which on a repeat run is none. That is
 * correct rather than lossy: the events those rows produced are already in the
 * database, and `upsertEvents` would only rewrite them identically.
 */
async function rangeFeed(
  con: Database,
  client: Client,
  feed: string,
  path: string,
  from: string,
  to: string,
  dateOf: (row: any) => string = (r) => isoDate(r.timestamp)
): Promise<{ rows: any[]; truncated: boolean; coveredFrom: string }> {
  const spans = missingSpans(getCoverage(con, feed), from, to);
  const rows: any[] = [];
  let truncated = false;
  let coveredFrom = from;

  for (const [a, b] of spans) {
    const r = await pagedRange(client, path, a, b, PAGE_CAP, 15, dateOf);
    rows.push(...r.rows);
    if (r.truncated) {
      truncated = true;
      if (r.coveredFrom > coveredFrom) coveredFrom = r.coveredFrom;
    }
    // Marked per span, not once at the end: a run stopped by the credit
    // ceiling mid-sweep must still keep what it paid for. A span in which not
    // even its newest day finished is marked as nothing.
    const done = r.truncated ? r.coveredFrom : a;
    if (done <= b) markCoverage(con, feed, done, b);
  }
  return { rows, truncated, coveredFrom };
}

// ---------------------------------------------------------------- market-wide facts

/** Insider filings, suspensions and news over [from,to]. Facts, every one with
 * its official record attached (plan.md §12.2). */
export async function backfillFacts(
  con: Database,
  client: Client,
  from: string,
  to: string
): Promise<{ written: number; truncated: string[]; coveredFrom: string }> {
  const events: EventRow[] = [];
  const truncated: string[] = [];
  let coveredFrom = from;

  const filings = await rangeFeed(con, client, "filings", "/v2/filings/", from, to);
  if (filings.truncated) {
    truncated.push(`filings (complete back to ${filings.coveredFrom})`);
    if (filings.coveredFrom > coveredFrom) coveredFrom = filings.coveredFrom;
  }
  // Several filings for one symbol on one day collapse into one chip with a
  // count -- aggregating before the insert is what keeps the upsert idempotent.
  const byKey = new Map<string, { n: number; row: any }>();
  for (const r of filings.rows) {
    const key = `${isoDate(r.timestamp)}|${bare(r.symbol)}`;
    const seen = byKey.get(key);
    if (seen) seen.n += 1;
    else byKey.set(key, { n: 1, row: r });
  }
  for (const [key, { n, row }] of byKey) {
    const [date, symbol] = key.split("|");
    if (!date || !symbol) continue;
    events.push({
      date,
      symbol,
      kind: "filing",
      class: "fact",
      title: n === 1 ? String(row.title ?? "Insider filing") : `${n} insider filings`,
      detail:
        n === 1
          ? [row.holder_name, row.transaction_type].filter(Boolean).join(" · ") || null
          : "multiple transactions on this date",
      source_url: row.source ?? null,
      extra: { n, transaction_type: row.transaction_type ?? null },
    });
  }

  const susp = await rangeFeed(con, client, "suspensions", "/v2/suspensions/", from, to, (r) =>
    isoDate(r.suspension_date)
  );
  if (susp.truncated) {
    truncated.push(`suspensions (complete back to ${susp.coveredFrom})`);
    if (susp.coveredFrom > coveredFrom) coveredFrom = susp.coveredFrom;
  }
  for (const r of susp.rows) {
    if (!r.suspension_date) continue;
    events.push({
      date: isoDate(r.suspension_date),
      symbol: bare(r.symbol),
      kind: "suspension",
      class: "fact",
      title: "Trading suspension",
      detail: r.reason ?? null,
      source_url: r.pdf_url ?? null,
      extra: null,
    });
  }

  const news = await rangeFeed(con, client, "news", "/v2/news/", from, to);
  if (news.truncated) {
    truncated.push(`news (complete back to ${news.coveredFrom})`);
    if (news.coveredFrom > coveredFrom) coveredFrom = news.coveredFrom;
  }
  // One row per story, not per day: the tags are what the page filters and
  // colours by, and a merged row would hand one headline another's tags.
  for (const r of news.rows) {
    // `symbols` is an array and is often empty -- market news with no ticker
    // lands under '' and shows on the calendar but never in a watchlist.
    const symbols: string[] = Array.isArray(r.symbols) && r.symbols.length ? r.symbols.map(bare) : [""];
    const tags: string[] = Array.isArray(r.tags) ? r.tags.map(String) : [];
    const title = String(r.title ?? "News");
    for (const s of symbols) {
      events.push({
        date: isoDate(r.timestamp),
        symbol: s,
        kind: "news",
        // The story's own identity within its day. The source URL when there
        // is one, the headline when there is not -- both stable across runs,
        // which is what keeps the upsert idempotent.
        key: String(r.source ?? title).slice(0, 200),
        class: "fact",
        title,
        // plan.md §12.3: news is context, never causation.
        detail: "published this day · context, not a cause",
        source_url: r.source ?? null,
        extra: { tags, tag_counts: Object.fromEntries(tags.map((t) => [t, 1])) },
      });
    }
  }

  upsertEvents(con, events);
  return { written: events.length, truncated, coveredFrom };
}

/**
 * Which companies have a newly available quarter. plan.md §3a.
 *
 * The feed carries the PERIOD (a quarter end), not the date anybody filed. So
 * the chip is dated by the period it belongs to and says so in as many words:
 * dating it by the day we happened to poll would put a three-month-old result
 * in tomorrow's agenda. `since` keeps the poll cheap -- a full sweep is ~32
 * pages, an incremental one is a page or two.
 */
export async function pollReports(
  con: Database,
  client: Client,
  since: string,
  seenOn: string = todayIso()
): Promise<{ written: number; truncated: boolean }> {
  // The expensive one: ~32 pages for the full ~950 companies. `since` goes in
  // the URL, so a date that moves with the clock misses the cache and re-buys
  // the whole sweep every run. Resume from where the feed was last read
  // instead, and the second run costs a page or two.
  const prior = getCoverage(con, "reports");
  const effectiveSince = prior && prior.to > since ? prior.to : since;
  const { rows, truncated } = await paged(client, "/v2/companies/quarterly-financial-dates/", {
    since: effectiveSince,
  });
  const events: EventRow[] = [];
  for (const r of rows) {
    const periodEnd = isoDate(r.date);
    const period = `${String(r.quarter ?? "").toUpperCase()} ${year(periodEnd)}`;
    events.push({
      date: periodEnd,
      symbol: bare(r.symbol),
      kind: "report",
      class: "fact",
      title: `${period} results available`,
      detail: `the feed carries the period (quarter end), not the date this was filed — first seen ${seenOn}`,
      source_url: null,
      extra: { period, period_end: periodEnd, seen_on: seenOn },
    });
  }
  upsertEvents(con, events);
  // A truncated sweep has not reached the far end, so it claims only the day
  // it resumed from -- the next run picks the rest up rather than skipping it.
  if (!truncated) markCoverage(con, "reports", effectiveSince, seenOn);
  // ~950 companies at 30 rows a credit: this feed is ~32 credits for a full
  // sweep, which is why backfill-run keeps it behind a flag.
  return { written: events.length, truncated };
}

// ---------------------------------------------------------------- per ticker

interface DividendEntry {
  ex_date?: string;
  payment_date?: string;
  dividend_amount?: number;
  dividend_yield?: number;
}

/** `upcoming_dividend`'s shape is the one thing the spec leaves as null in its
 * own example (probe Q13), so accept an object, a one-element array, or
 * nothing, and ignore it unless it carries a forward ex-date. */
function upcoming(raw: unknown): DividendEntry | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || typeof v !== "object") return null;
  const d = v as DividendEntry;
  return d.ex_date ? d : null;
}

/**
 * Everything one symbol costs: 1 credit, once, forever.
 *
 * `corporate-actions` gives the dated future (upcoming dividend, a scheduled
 * AGM) and the dated past (effective ex-dividends, splits, AGMs held). One
 * credit, cached forever.
 */
export async function fillTicker(
  con: Database,
  client: Client,
  symbol: string,
  today: string = todayIso()
): Promise<{ events: number; skipped: boolean }> {
  const sym = bare(symbol);
  const events: EventRow[] = [];

  const actions = await client.tryGet(`/v2/company/corporate-actions/${sym}/`, undefined, 1);
  if (actions.body) {
    const ca = actions.body.corporate_actions ?? {};
    const divs: DividendEntry[] = Array.isArray(ca.dividend) ? ca.dividend : [];
    const agms: any[] = Array.isArray(ca.agm) ? ca.agm : [];
    const splits: any[] = Array.isArray(ca.stock_split) ? ca.stock_split : [];

    for (const d of divs) {
      if (!d.ex_date) continue;
      events.push({
        date: isoDate(d.ex_date),
        symbol: sym,
        kind: "exdiv",
        class: d.ex_date > today ? "scheduled" : "fact",
        title: "Cash dividend · ex-date",
        detail: d.dividend_amount != null ? `IDR ${d.dividend_amount} per share` : null,
        source_url: `https://www.idx.co.id/en/listed-companies/corporate-actions/`,
        extra: { amount: d.dividend_amount ?? null, payment_date: d.payment_date ?? null },
      });
    }

    const up = upcoming(ca.upcoming_dividend);
    if (up && isoDate(up.ex_date) >= today) {
      events.push({
        date: isoDate(up.ex_date),
        symbol: sym,
        kind: "exdiv",
        class: "scheduled",
        title: "Cash dividend · ex-date",
        detail: up.dividend_amount != null ? `IDR ${up.dividend_amount} per share` : null,
        source_url: `https://www.idx.co.id/en/listed-companies/corporate-actions/`,
        extra: {
          amount: up.dividend_amount ?? null,
          payment_date: up.payment_date ?? null,
          upcoming: true,
        },
      });
    }

    for (const a of agms) {
      if (!a.agm_date) continue;
      events.push({
        date: isoDate(a.agm_date),
        symbol: sym,
        kind: "agm",
        class: a.agm_date > today ? "scheduled" : "fact",
        title: "General meeting",
        detail: [a.agm_time, a.agm_place].filter(Boolean).join(" · ") || null,
        source_url: `https://www.idx.co.id/en/listed-companies/corporate-actions/`,
        extra: { result: a.agm_result ?? null },
      });
    }

    for (const s of splits) {
      if (!s.date) continue;
      events.push({
        date: isoDate(s.date),
        symbol: sym,
        kind: "split",
        class: s.date > today ? "scheduled" : "fact",
        title: "Stock split",
        detail: s.split_ratio ? `ratio ${s.split_ratio}` : null,
        source_url: `https://www.idx.co.id/en/listed-companies/corporate-actions/`,
        extra: { split_ratio: s.split_ratio ?? null },
      });
    }

    touchTicker(con, sym, "actions_at", today);
  }

  upsertEvents(con, events);
  return { events: events.length, skipped: false };
}

/**
 * Daily closes for one symbol over one window. 1 credit, and the window is
 * capped at 90 days by the API -- measured, not assumed: a call with
 * start=2026-06-01&end=2026-06-30 returns June, so a historical month can be
 * priced rather than only the trailing 90 days.
 */
export async function fillPrices(
  con: Database,
  client: Client,
  symbol: string,
  from: string,
  to: string
): Promise<number> {
  const sym = bare(symbol);
  const span = Math.min(90, Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5)));
  const start = shift(to, -span);
  // An index has its own endpoint and calls its close `price`; a company is
  // /v2/daily/ and `close`. Stored under the same symbol either way.
  const path = isIndex(sym) ? `/v2/index-daily/${sym.toLowerCase()}/` : `/v2/daily/${sym}/`;
  const { body } = await client.tryGet(path, { start, end: to }, 1);
  const rows: any[] = Array.isArray(body?.results) ? body.results : Array.isArray(body) ? body : [];
  return upsertPrices(
    con,
    sym,
    rows.map((r) => ({ date: isoDate(r.date), close: r.close ?? r.price ?? null, volume: r.volume ?? null }))
  );
}

/**
 * A year of an index's closes, bought ONCE: four 90-day calls (the endpoint's
 * limit), 4 credits. Closes are kept forever and the daily fill extends them,
 * so the year-ago close is already held on every later day -- one dated call
 * a day for "a year ago" would be a new URL, and a new credit, every day.
 * Skipped when the far end is already held.
 */
export async function fillIndexYear(
  con: Database,
  client: Client,
  symbol: string,
  today: string = todayIso()
): Promise<number> {
  const from = shift(today, -372); // a week of slack for holidays around the anniversary
  const to = shift(today, -91); // the daily 90-day fill covers the rest
  if (hasPrices(con, symbol, from, shift(from, 14))) return 0;
  let n = 0;
  for (let s = from; s <= to; s = shift(s, 90)) {
    const e = shift(s, 89) < to ? shift(s, 89) : to;
    n += await fillPrices(con, client, symbol, s, e);
  }
  return n;
}

/** The last weekday before `today` -- the session whose close a run on
 * `today` should already hold. ponytail: weekends only; an IDX holiday means
 * one extra (cached, same-day) call, not a wrong number. */
export function lastSession(today: string): string {
  let d = shift(today, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = shift(d, -1);
  return d;
}

/**
 * One day's whole board, for 1 credit.
 *
 * This is the cheapest call in the project and it is worth saying why, because
 * the obvious way to price 200 companies is 200 calls to `/v2/daily/` -- 200
 * credits against a 275-credit lifetime ceiling, i.e. the feature is
 * unaffordable and gets cut. `/v2/companies/` answers the same question once:
 * `include_query_values` returns every field the `where` clause names, so
 * naming all four in the filter is what makes them come back.
 *
 * Hence the tautologies. `sector != ''` and `daily_close_change > -1` exclude
 * nothing -- a stock cannot fall 100% and keep a listing -- they are there to
 * put those fields in the response. Measured, not assumed: `>=` on a string
 * field is a TYPE_MISMATCH and `limit` above 200 is an INVALID_LIMIT, both of
 * which the API charges nothing for.
 */
export async function fillBoard(
  con: Database,
  client: Client,
  date: string = todayIso()
): Promise<number> {
  const { body } = await client.tryGet(
    "/v2/companies/",
    {
      where: `sector != '' and sub_sector != '' and market_cap >= ${BOARD_MIN_MCAP} and daily_close_change > -1`,
      order_by: "-market_cap",
      limit: BOARD_LIMIT,
      include_query_values: true,
    },
    1,
    true // a snapshot of today: the URL carries no date, so the cache cannot answer it
  );
  const rows: any[] = Array.isArray(body?.results) ? body.results : Array.isArray(body) ? body : [];
  return upsertBoard(
    con,
    rows.map((r) => {
      const q = r.query_values ?? {};
      return {
        date,
        symbol: bare(r.symbol),
        name: String(r.company_name ?? r.symbol ?? ""),
        sector: String(q.sector ?? ""),
        sub_sector: String(q.sub_sector ?? ""),
        market_cap: q.market_cap ?? null,
        close_change: q.daily_close_change ?? null,
      };
    })
  );
}

/**
 * Every period's biggest gainers and losers, for 1 credit.
 *
 * `periods` is comma-separated, measured -- one call returns a nested
 * {classification: {period: rows}} for every combination asked for. So five
 * periods cost what one does, and the only reason to ask for fewer would be a
 * UI that could not show them.
 *
 * `n_stock` caps at 10: asking for 20 returns 10, and the API does not say so
 * in an error. Hence MOVER_COUNT rather than a number typed at the call site.
 */
export async function fillMovers(
  con: Database,
  client: Client,
  date: string = todayIso()
): Promise<number> {
  const { body } = await client.tryGet(
    "/v2/companies/top-changes/",
    {
      classifications: "top_gainers,top_losers",
      periods: MOVER_PERIODS.join(","),
      n_stock: MOVER_COUNT,
    },
    1,
    true // same: "top changes" means as of now, and the URL never changes
  );
  const out: MoverRow[] = [];
  for (const [key, direction] of [
    ["top_gainers", "gainer"],
    ["top_losers", "loser"],
  ] as const) {
    const byPeriod = body?.[key] ?? {};
    for (const period of MOVER_PERIODS) {
      const rows: any[] = Array.isArray(byPeriod[period]) ? byPeriod[period] : [];
      rows.forEach((r, i) =>
        out.push({
          date,
          period,
          direction,
          // The API's own ordering is the ranking -- it sorted by the move, and
          // re-sorting here would be this product inventing a second one.
          rank: i + 1,
          symbol: bare(r.symbol),
          name: String(r.name ?? r.symbol ?? ""),
          price_change: r.price_change ?? null,
          last_close: r.last_close_price ?? null,
          close_date: isoDate(r.latest_close_date) || null,
        })
      );
    }
  }
  return upsertMovers(con, out);
}

/** Fill a symbol only if it has never been filled. Corporate actions do not
 * change retroactively, so this is what makes the second run free (plan.md §6
 * lever 3). */
export async function ensureTicker(
  con: Database,
  client: Client,
  symbol: string,
  today: string = todayIso()
): Promise<{ events: number; skipped: boolean }> {
  if (tickerFetchedAt(con, bare(symbol), "actions_at")) return { events: 0, skipped: true };
  return fillTicker(con, client, symbol, today);
}
