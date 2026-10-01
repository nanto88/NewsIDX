/**
 * SQLite schema and the queries built on it. plan.md §5.
 *
 * One write path, and every view is one indexed query on `date`.
 * Schema style follows ../sentry_fin/server/src/db.ts: plain SQL in one
 * string, prepared statements at the call site, no ORM and no migrations
 * beyond `IF NOT EXISTS`.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "./config.js";
import { shift } from "./dates.js";

export type EventClass = "fact" | "scheduled";

const SCHEMA = `
-- One row per chip. plan.md §5: append-with-upsert so re-running a backfill is
-- idempotent and free.
--
-- The key column separates rows that share a date, a symbol and a kind: one company can
-- carry four headlines in a day, and each is its own story with its own tags.
-- Collapsing them would make one headline wear another's tag, which is the one
-- thing a page that colours headlines by tag cannot do. Everything else keeps
-- the empty key and so keeps one row per day, as before.
CREATE TABLE IF NOT EXISTS event(
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,          -- '' means market-wide (news with no ticker)
  kind TEXT NOT NULL,            -- filing | suspension | report | news | exdiv | agm | split
  key TEXT NOT NULL DEFAULT '',  -- '' for anything with one row a day
  class TEXT NOT NULL,           -- fact | scheduled
  title TEXT NOT NULL,
  detail TEXT,
  source_url TEXT,
  extra TEXT,                    -- JSON: what a chip renders (news tags)
  PRIMARY KEY (date, symbol, kind, key));
CREATE INDEX IF NOT EXISTS event_date ON event(date);
CREATE INDEX IF NOT EXISTS event_symbol ON event(symbol, date);

-- The watched universe and when each source was last fetched, so a demand-
-- driven fill knows what it already has (plan.md §6 lever 3).
CREATE TABLE IF NOT EXISTS ticker(
  symbol TEXT PRIMARY KEY,
  actions_at TEXT);

-- Daily closes, for the price strip on a ticker-filtered calendar. One row
-- per trading day; IDX does not trade weekends, so gaps are information.
CREATE TABLE IF NOT EXISTS price(
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  close REAL,
  volume REAL,
  PRIMARY KEY (symbol, date));

-- One day's board: every company the heatmap draws, with the two numbers that
-- draw it. Both arrive from a single /v2/companies/ call, so a row here costs
-- 1/200th of a credit -- the reason a market-wide heatmap is affordable at all
-- when the per-ticker alternative is a credit a name.
--
-- close_change is the API's daily_close_change as it stood when we asked,
-- which is the last CLOSED session's move. The date column is therefore the day
-- we fetched, not necessarily the day the move happened -- ask on a Sunday
-- and you get Friday's. The page says "as of" and never "on".
CREATE TABLE IF NOT EXISTS board(
  date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  sub_sector TEXT NOT NULL,
  market_cap REAL,
  close_change REAL,
  PRIMARY KEY (date, symbol));

-- The day's biggest movers, five a side, over each of five periods. Every row
-- of this table arrives in ONE call: /v2/companies/top-changes/ takes a
-- comma-separated list of periods, so a day, a week, a fortnight, a month and
-- a year cost the same single credit that a day alone would.
--
-- Keyed by rank rather than symbol: the same company can top both the 7d and
-- the 30d list, and a re-run on the same day must overwrite the ladder rather
-- than grow it. close_date is the API's own latest_close_date -- the session
-- the move ends on, which is not always the day we asked.
CREATE TABLE IF NOT EXISTS mover(
  date TEXT NOT NULL,
  period TEXT NOT NULL,          -- 1d | 7d | 14d | 30d | 365d
  direction TEXT NOT NULL,       -- gainer | loser
  rank INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  price_change REAL,
  last_close REAL,
  close_date TEXT,
  PRIMARY KEY (date, period, direction, rank));

-- The generated FAQ for one company. One row per symbol: it is a cache, and
-- the fingerprint is what makes it one -- unchanged rows mean the stored
-- answer still describes the data, so the button costs nothing to press.
CREATE TABLE IF NOT EXISTS faq(
  symbol TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  model TEXT NOT NULL,
  fingerprint TEXT NOT NULL,     -- the rows it was written from
  items TEXT NOT NULL,           -- JSON: [{question, answer, sources[]}]
  summary TEXT,                  -- JSON: [{point, sources[]}]
  input_tokens INTEGER,
  output_tokens INTEGER);

-- One answer to one free-text question about one company. Keyed by the
-- question itself, so asking the same thing twice is free.
CREATE TABLE IF NOT EXISTS ask(
  symbol TEXT NOT NULL,
  qhash TEXT NOT NULL,           -- the normalised question, hashed
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources TEXT NOT NULL,         -- JSON: [{title,url,date}]
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  PRIMARY KEY (symbol, qhash));

-- Every API response we have paid for, keyed by URL. Never expires: a closed
-- trading day does not change, and neither does a corporate action.
CREATE TABLE IF NOT EXISTS api_cache(
  url TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  body TEXT NOT NULL);

-- What each market-wide feed has already been fetched for, as one contiguous
-- date span. Range calls put the dates in the URL, so a rolling 90-day window
-- produces a brand new URL every day and api_cache never hits -- the whole
-- window would be re-bought daily. This table is what lets a run ask only for
-- the days it is missing.
CREATE TABLE IF NOT EXISTS coverage(
  feed TEXT PRIMARY KEY,
  covered_from TEXT NOT NULL,
  covered_to TEXT NOT NULL);

-- One row per run, with credits spent. This is what makes the credit line in
-- the video honest, and it is where api.ts reads its lifetime total from.
CREATE TABLE IF NOT EXISTS run(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT, ended_at TEXT,
  credits INTEGER DEFAULT 0, cache_hits INTEGER DEFAULT 0,
  note TEXT, error TEXT);
`;

export function connect(dbPath: string = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const con = new Database(dbPath);
  con.pragma("journal_mode = WAL");
  // `event` is derived: every row in it is rebuilt from `api_cache` at zero
  // credits by re-running the backfill. So a shape change drops it rather than
  // migrating it -- there is nothing here that cannot be regenerated for free.
  const cols = con.pragma("table_info(event)") as { name: string }[];
  if (cols.length && !cols.some((c) => c.name === "key")) con.exec("DROP TABLE event");
  con.exec(SCHEMA);
  // `faq` is the one table here that cost real money to fill, so it is altered
  // rather than dropped. An older row simply has no summary until it is next
  // generated.
  const faqCols = con.pragma("table_info(faq)") as { name: string }[];
  if (faqCols.length && !faqCols.some((c) => c.name === "summary")) {
    con.exec("ALTER TABLE faq ADD COLUMN summary TEXT");
  }
  return con;
}

// ---------------------------------------------------------------- coverage

export interface Span {
  from: string;
  to: string;
}

/** What `feed` has already been fetched for, or null if it never has. */
export function getCoverage(con: Database.Database, feed: string): Span | null {
  const r = con.prepare(`SELECT covered_from f, covered_to t FROM coverage WHERE feed = ?`).get(feed) as any;
  return r ? { from: r.f, to: r.t } : null;
}

/**
 * Record that `feed` is now fetched over [from,to].
 *
 * Widens the stored span when the new one touches or overlaps it, and REPLACES
 * it when the two are disjoint. Replacing loses the older span, which is the
 * honest outcome: one contiguous interval cannot describe two with a hole
 * between them, and claiming the hole is covered would silently skip those
 * days forever.
 */
export function markCoverage(con: Database.Database, feed: string, from: string, to: string): Span {
  const prior = getCoverage(con, feed);
  const touches = prior && prior.to >= shift(from, -1) && prior.from <= shift(to, 1);
  const next: Span = touches
    ? { from: prior!.from < from ? prior!.from : from, to: prior!.to > to ? prior!.to : to }
    : { from, to };
  con.prepare(
    `INSERT INTO coverage(feed,covered_from,covered_to) VALUES (?,?,?)
     ON CONFLICT(feed) DO UPDATE SET covered_from=excluded.covered_from, covered_to=excluded.covered_to`
  ).run(feed, next.from, next.to);
  return next;
}

// ---------------------------------------------------------------- events

export interface EventRow {
  date: string;
  symbol: string;
  kind: string;
  /** Distinguishes rows that share date+symbol+kind -- one per headline.
   * Omitted for everything that has at most one row a day. */
  key?: string;
  class: EventClass;
  title: string;
  detail?: string | null;
  source_url?: string | null;
  extra?: Record<string, unknown> | null;
}

/** The single write path for chips. Upsert, not replace: a re-run overwrites
 * the same row rather than growing the table, which is what makes the backfill
 * free to repeat. */
export function upsertEvents(con: Database.Database, rows: EventRow[]): number {
  const stmt = con.prepare(`
    INSERT INTO event(date,symbol,kind,key,class,title,detail,source_url,extra)
    VALUES (@date,@symbol,@kind,@key,@class,@title,@detail,@source_url,@extra)
    ON CONFLICT(date,symbol,kind,key) DO UPDATE SET
      class=excluded.class, title=excluded.title, detail=excluded.detail,
      source_url=excluded.source_url, extra=excluded.extra`);
  const run = con.transaction((rs: EventRow[]) => {
    for (const r of rs) {
      stmt.run({
        date: r.date,
        symbol: r.symbol,
        kind: r.kind,
        key: r.key ?? "",
        class: r.class,
        title: r.title,
        detail: r.detail ?? null,
        source_url: r.source_url ?? null,
        extra: r.extra ? JSON.stringify(r.extra) : null,
      });
    }
  });
  run(rows);
  return rows.length;
}

export interface Chip extends Omit<EventRow, "extra"> {
  extra: Record<string, any> | null;
}

function toChip(r: any): Chip {
  return { ...r, extra: r.extra ? JSON.parse(r.extra) : null };
}

/** Every chip in [from,to], optionally restricted to a watchlist. `symbols`
 * empty means market-wide. */
export function eventsInRange(
  con: Database.Database,
  from: string,
  to: string,
  symbols: string[] = []
): Chip[] {
  if (symbols.length === 0) {
    return con
      .prepare(`SELECT * FROM event WHERE date BETWEEN ? AND ? ORDER BY date, symbol, kind, key`)
      .all(from, to)
      .map(toChip);
  }
  const holes = symbols.map(() => "?").join(",");
  return con
    .prepare(
      `SELECT * FROM event WHERE date BETWEEN ? AND ? AND symbol IN (${holes})
       ORDER BY date, symbol, kind, key`
    )
    .all(from, to, ...symbols)
    .map(toChip);
}

/** Every company we hold a row for -- the options behind the watchlist box. */
export function allSymbols(con: Database.Database): string[] {
  return (
    con.prepare(`SELECT DISTINCT symbol FROM event WHERE symbol <> '' ORDER BY symbol`).all() as {
      symbol: string;
    }[]
  ).map((r) => r.symbol);
}

export function eventsOn(con: Database.Database, date: string): Chip[] {
  return con
    .prepare(`SELECT * FROM event WHERE date = ? ORDER BY class, symbol, kind, key`)
    .all(date)
    .map(toChip);
}

export function eventsForSymbol(con: Database.Database, symbol: string): Chip[] {
  return con
    .prepare(`SELECT * FROM event WHERE symbol = ? ORDER BY date DESC`)
    .all(symbol)
    .map(toChip);
}

// ---------------------------------------------------------------- tickers, runs

export function touchTicker(
  con: Database.Database,
  symbol: string,
  field: "actions_at",
  when: string
): void {
  con.prepare(
    `INSERT INTO ticker(symbol,${field}) VALUES (?,?)
     ON CONFLICT(symbol) DO UPDATE SET ${field}=excluded.${field}`
  ).run(symbol, when);
}

export function tickerFetchedAt(
  con: Database.Database,
  symbol: string,
  field: "actions_at"
): string | null {
  const r = con.prepare(`SELECT ${field} v FROM ticker WHERE symbol = ?`).get(symbol) as any;
  return r?.v ?? null;
}

export function startRun(con: Database.Database, note: string): number {
  const r = con
    .prepare(`INSERT INTO run(started_at,note) VALUES (?,?)`)
    .run(new Date().toISOString(), note);
  return Number(r.lastInsertRowid);
}

export function endRun(
  con: Database.Database,
  id: number,
  credits: number,
  cacheHits: number,
  error?: string
): void {
  con.prepare(`UPDATE run SET ended_at=?, credits=?, cache_hits=?, error=? WHERE id=?`).run(
    new Date().toISOString(),
    credits,
    cacheHits,
    error ?? null,
    id
  );
}

/** Lifetime credits -- the number api.ts enforces its ceiling against. */
export function creditsSpent(con: Database.Database): number {
  const r = con.prepare(`SELECT COALESCE(SUM(credits),0) c FROM run`).get() as any;
  return r.c as number;
}

export function lastRun(con: Database.Database): any | null {
  return con.prepare(`SELECT * FROM run ORDER BY id DESC LIMIT 1`).get() ?? null;
}

// ---------------------------------------------------------------- faq

/** A row the generated text rests on, resolved at generation time so the page
 * never renders a link the model wrote. */
export interface FaqSource {
  title: string;
  url: string | null;
  date: string;
}

export interface FaqRow {
  symbol: string;
  generated_at: string;
  model: string;
  fingerprint: string;
  items: { question: string; answer: string; sources: FaqSource[] }[];
  summary: { point: string; sources: FaqSource[] }[];
  input_tokens?: number | null;
  output_tokens?: number | null;
}

/** Whatever is in the column, as the shape the rest of the code expects.
 * Sources are a record we wrote, so a stored one is trusted -- but a row
 * written before citations existed has no `sources` key at all. */
function faqSources(v: unknown): FaqSource[] {
  return Array.isArray(v) ? (v as FaqSource[]) : [];
}

/**
 * Normalising on read is the whole point of this function.
 *
 * These rows cost money, so they are never dropped on a schema change -- which
 * means a row generated by an older version of this code is still here, and is
 * missing fields the current page renders. One shape comes out of here, and
 * every caller gets it.
 */
export function getFaq(con: Database.Database, symbol: string): FaqRow | null {
  const r = con.prepare(`SELECT * FROM faq WHERE symbol = ?`).get(symbol) as any;
  if (!r) return null;
  const items = (JSON.parse(r.items) as any[]).map((q) => ({
    question: String(q?.question ?? ""),
    answer: String(q?.answer ?? ""),
    sources: faqSources(q?.sources),
  }));
  const summary = (r.summary ? (JSON.parse(r.summary) as any[]) : []).map((s) => ({
    point: String(s?.point ?? ""),
    sources: faqSources(s?.sources),
  }));
  return { ...r, items, summary };
}

export function putFaq(con: Database.Database, row: FaqRow): void {
  con
    .prepare(
      `INSERT INTO faq(symbol,generated_at,model,fingerprint,items,summary,input_tokens,output_tokens)
       VALUES (@symbol,@generated_at,@model,@fingerprint,@items,@summary,@input_tokens,@output_tokens)
       ON CONFLICT(symbol) DO UPDATE SET
         generated_at=excluded.generated_at, model=excluded.model,
         fingerprint=excluded.fingerprint, items=excluded.items, summary=excluded.summary,
         input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens`
    )
    .run({
      ...row,
      items: JSON.stringify(row.items),
      summary: JSON.stringify(row.summary ?? []),
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
    });
}

export interface AskRow {
  symbol: string;
  qhash: string;
  question: string;
  answer: string;
  sources: FaqSource[];
  model: string;
  created_at: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
}

export function getAsk(con: Database.Database, symbol: string, qhash: string): AskRow | null {
  const r = con.prepare(`SELECT * FROM ask WHERE symbol = ? AND qhash = ?`).get(symbol, qhash) as any;
  return r ? { ...r, sources: faqSources(JSON.parse(r.sources)) } : null;
}

export function putAsk(con: Database.Database, row: AskRow): void {
  con
    .prepare(
      `INSERT INTO ask(symbol,qhash,question,answer,sources,model,created_at,input_tokens,output_tokens)
       VALUES (@symbol,@qhash,@question,@answer,@sources,@model,@created_at,@input_tokens,@output_tokens)
       ON CONFLICT(symbol,qhash) DO UPDATE SET
         answer=excluded.answer, sources=excluded.sources, model=excluded.model,
         created_at=excluded.created_at, input_tokens=excluded.input_tokens,
         output_tokens=excluded.output_tokens`
    )
    .run({
      ...row,
      sources: JSON.stringify(row.sources),
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
    });
}

/** The questions already asked about this company, newest first. */
export function recentAsks(con: Database.Database, symbol: string, limit = 5): AskRow[] {
  return (
    con
      .prepare(`SELECT * FROM ask WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`)
      .all(symbol, limit) as any[]
  ).map((r) => ({ ...r, sources: faqSources(JSON.parse(r.sources)) }));
}

/** How much we have cached, for the run summary. */
export function cacheSize(con: Database.Database): { entries: number; bytes: number } {
  const r = con.prepare(`SELECT COUNT(*) entries, COALESCE(SUM(LENGTH(body)),0) bytes FROM api_cache`).get() as any;
  return { entries: r.entries, bytes: r.bytes };
}

// ---------------------------------------------------------------- prices

export interface PriceRow {
  date: string;
  close: number;
  /** Fraction against the previous trading day's close. Null on the first row
   * we hold, because a change needs something to change from. */
  change: number | null;
}

export function upsertPrices(
  con: Database.Database,
  symbol: string,
  rows: { date: string; close: number | null; volume?: number | null }[]
): number {
  const stmt = con.prepare(`
    INSERT INTO price(symbol,date,close,volume) VALUES (?,?,?,?)
    ON CONFLICT(symbol,date) DO UPDATE SET
      close=COALESCE(excluded.close, price.close),
      volume=COALESCE(excluded.volume, price.volume)`);
  const run = con.transaction((rs: typeof rows) => {
    for (const r of rs) if (r.date && r.close != null) stmt.run(symbol, r.date, r.close, r.volume ?? null);
  });
  run(rows);
  return rows.length;
}

/** Closes in [from,to] with the day-over-day change already computed. The
 * previous close comes from the row before `from` when we hold one, so the
 * first day of a month is not silently blank. */
export function pricesInRange(
  con: Database.Database,
  symbol: string,
  from: string,
  to: string
): Map<string, PriceRow> {
  const rows = con
    .prepare(
      `SELECT date, close FROM price
       WHERE symbol = ? AND date <= ? AND date >= date(?, '-10 days')
       ORDER BY date`
    )
    .all(symbol, to, from) as { date: string; close: number }[];
  const out = new Map<string, PriceRow>();
  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    if (rows[i].date < from) continue;
    out.set(rows[i].date, {
      date: rows[i].date,
      close: rows[i].close,
      change: prev && prev.close ? rows[i].close / prev.close - 1 : null,
    });
  }
  return out;
}

/** Whether we hold any close for this symbol inside the window -- the test the
 * route uses before deciding to spend a credit. */
export function hasPrices(con: Database.Database, symbol: string, from: string, to: string): boolean {
  const r = con
    .prepare(`SELECT COUNT(*) n FROM price WHERE symbol = ? AND date BETWEEN ? AND ?`)
    .get(symbol, from, to) as any;
  return r.n > 0;
}

/** The most recent close on or before a date -- the denominator of the
 * ex-dividend drop. Returns null rather than reaching for a nearby price: a
 * drop quoted against a close we do not hold is a number with no basis. */
export function lastClose(
  con: Database.Database,
  symbol: string,
  onOrBefore: string
): number | null {
  const r = con
    .prepare(`SELECT close FROM price WHERE symbol = ? AND date <= ? AND close IS NOT NULL
              ORDER BY date DESC LIMIT 1`)
    .get(symbol, onOrBefore) as { close: number } | undefined;
  return r?.close ?? null;
}

/**
 * The names that could have a rhythm at all: those with a corporate-action
 * history on record. Far smaller than `allSymbols` -- filings and news are
 * market-wide, so most symbols in `event` have never had a per-ticker call
 * spent on them -- which is what keeps the unfiltered agenda from fitting a
 * window for every company on the exchange.
 */
// ---------------------------------------------------------------- the board

export interface BoardRow {
  date: string;
  symbol: string;
  name: string;
  sector: string;
  sub_sector: string;
  market_cap: number | null;
  close_change: number | null;
}

/**
 * A day's board is one snapshot, so a new one REPLACES that day's rows rather
 * than merging into them: merged, a company that left the top 200 since the
 * last fetch kept its old tile and its old move. An empty answer (a failed
 * call) replaces nothing -- a stale board beats a blank one.
 */
export function upsertBoard(con: Database.Database, rows: BoardRow[]): number {
  const clear = con.prepare(`DELETE FROM board WHERE date = ?`);
  const stmt = con.prepare(`
    INSERT INTO board(date,symbol,name,sector,sub_sector,market_cap,close_change)
    VALUES (@date,@symbol,@name,@sector,@sub_sector,@market_cap,@close_change)
    ON CONFLICT(date,symbol) DO UPDATE SET
      name=excluded.name, sector=excluded.sector, sub_sector=excluded.sub_sector,
      market_cap=excluded.market_cap, close_change=excluded.close_change`);
  con.transaction((rs: BoardRow[]) => {
    for (const d of new Set(rs.map((r) => r.date))) clear.run(d);
    rs.forEach((r) => stmt.run(r));
  })(rows);
  return rows.length;
}

/** The most recent day we hold a board for, at or before `on`. The heatmap
 * asks for today and takes Friday's when today is a Sunday -- an empty page on
 * a weekend would be a bug report every weekend. */
export function latestBoardDate(con: Database.Database, on: string): string | null {
  const r = con.prepare(`SELECT MAX(date) d FROM board WHERE date <= ?`).get(on) as any;
  return (r?.d as string) ?? null;
}

export function boardOn(con: Database.Database, date: string): BoardRow[] {
  return con
    .prepare(`SELECT * FROM board WHERE date = ? ORDER BY market_cap DESC`)
    .all(date) as BoardRow[];
}

// ---------------------------------------------------------------- the movers

export interface MoverRow {
  date: string;
  period: string;
  direction: string;
  rank: number;
  symbol: string;
  name: string;
  price_change: number | null;
  last_close: number | null;
  close_date: string | null;
}

/** Same rule as the board: a day's movers are one snapshot. Keyed by rank, a
 * shorter list would otherwise leave the old day's names at the ranks it no
 * longer fills. */
export function upsertMovers(con: Database.Database, rows: MoverRow[]): number {
  const clear = con.prepare(`DELETE FROM mover WHERE date = ?`);
  const stmt = con.prepare(`
    INSERT INTO mover(date,period,direction,rank,symbol,name,price_change,last_close,close_date)
    VALUES (@date,@period,@direction,@rank,@symbol,@name,@price_change,@last_close,@close_date)
    ON CONFLICT(date,period,direction,rank) DO UPDATE SET
      symbol=excluded.symbol, name=excluded.name, price_change=excluded.price_change,
      last_close=excluded.last_close, close_date=excluded.close_date`);
  con.transaction((rs: MoverRow[]) => {
    for (const d of new Set(rs.map((r) => r.date))) clear.run(d);
    rs.forEach((r) => stmt.run(r));
  })(rows);
  return rows.length;
}

/** The most recent day we hold movers for, at or before `on` -- the same
 * weekend fallback the board uses, for the same reason. */
/** The oldest headline on record. Before it, "nothing on the record" means
 * nobody fetched that day, not that nothing was said. */
export function newsRecordFrom(con: Database.Database): string | null {
  const r = con.prepare(`SELECT MIN(date) d FROM event WHERE kind = 'news'`).get() as any;
  return (r?.d as string) ?? null;
}

export function latestMoverDate(con: Database.Database, on: string): string | null {
  const r = con.prepare(`SELECT MAX(date) d FROM mover WHERE date <= ?`).get(on) as any;
  return (r?.d as string) ?? null;
}

export function moversOn(con: Database.Database, date: string, period: string): MoverRow[] {
  return con
    .prepare(`SELECT * FROM mover WHERE date = ? AND period = ? ORDER BY direction, rank`)
    .all(date, period) as MoverRow[];
}

export function symbolsWithHistory(
  con: Database.Database,
  kinds: string[],
  before: string
): string[] {
  const holes = kinds.map(() => "?").join(",");
  return (
    con
      .prepare(
        `SELECT symbol FROM event WHERE symbol <> '' AND kind IN (${holes}) AND date < ?
         GROUP BY symbol ORDER BY symbol`
      )
      .all(...kinds, before) as { symbol: string }[]
  ).map((r) => r.symbol);
}
