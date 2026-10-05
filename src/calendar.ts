/**
 * View models. plan.md §4a.
 *
 * Facts and scheduled events both live in `event`. Nothing derived is ever
 * written to the database, so there is no row anywhere in this product that a
 * company did not date or a source did not publish.
 *
 * Nothing in this file talks to the API, so every route is a SQLite read.
 */
import type { Database } from "better-sqlite3";
import { isIndex } from "./config.js";
import {
  type Chip,
  type EventClass,
  eventsForSymbol,
  eventsInRange,
  eventsOn,
  lastClose,
  pricesInRange,
} from "./db.js";
import { type Drop, expectedDrop } from "./dividend.js";
import {
  daysInMonth,
  fmtShort,
  fmtWithDay,
  isWeekend,
  shift,
  weekday,
  weekStart,
} from "./dates.js";
import { HORIZON_DAYS } from "./config.js";

/** Fact or scheduled: we only ever show what a company dated or a source
 * published. */
export type ViewClass = EventClass;

export interface Item {
  cls: ViewClass;
  kind: string;
  symbol: string;
  date?: string;
  title: string;
  detail?: string | null;
  sourceUrl?: string | null;
  /** The tags Sectors put on the story. The only categorisation on the page. */
  tags?: string[] | null;
  tagCounts?: Record<string, number> | null;
  /** Scheduled ex-dividend rows only: the mechanical drop. */
  drop?: Drop | null;
}

export type Sentiment = "positive" | "negative" | "neutral";

/**
 * The tag, read straight off the row: `Bullish` is positive, `Bearish` is
 * negative, anything else is neutral. Sectors' label, not ours -- we do not
 * classify text and we do not weigh one story against another.
 *
 * One row can carry several stories for one day (backfill merges them), so
 * the counts decide: three bullish and one bearish is a positive day, an even
 * split is neutral.
 */
export function sentimentOf(item: Item): Sentiment {
  const counts = item.tagCounts ?? Object.fromEntries((item.tags ?? []).map((t) => [t, 1]));
  let bull = 0;
  let bear = 0;
  for (const [tag, n] of Object.entries(counts)) {
    const t = tag.toLowerCase();
    if (t === "bullish") bull += n;
    else if (t === "bearish") bear += n;
  }
  return bull > bear ? "positive" : bear > bull ? "negative" : "neutral";
}

/** How many topics one filter may carry. Past this the URL is being used as a
 * denial-of-service rather than a filter, and 12 is already more topics than
 * the bar renders as chips. */
export const MAX_TAGS = 12;

/** How long a `?tag=` string may be before it is truncated. Room for MAX_TAGS
 * long labels and their separators, and no room for a URL used as a payload. */
export const TAG_QUERY_MAX = 320;

/**
 * The Topic filter as a list. `?tag=` is comma separated, so a picked chip, a
 * handful of picked chips and something typed by hand are all one code path.
 *
 * Empty means every topic, which is the default: a filter nobody has touched
 * must not hide anything.
 */
export function parseTags(tag: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(tag ?? "").split(",")) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * Case-insensitive substring against the row's own tags.
 *
 * Several topics are OR, not AND: picking a second topic shows MORE, which is
 * what a reader means by ticking a second box. AND would empty the page the
 * moment two topics rarely co-occur, and most pairs here never do -- one story
 * is not usually both a dividend and a suspension.
 */
export function matchesTag(item: Item, tag: string): boolean {
  const wanted = parseTags(tag);
  if (!wanted.length) return true;
  const have = (item.tags ?? []).map((t) => String(t).toLowerCase());
  return wanted.some((w) => have.some((h) => h.includes(w.toLowerCase())));
}

const KIND_LABEL: Record<string, string> = {
  filing: "Insider filing",
  suspension: "Trading suspension",
  report: "Quarterly report",
  news: "News",
  exdiv: "Ex-dividend",
  agm: "General meeting",
  split: "Stock split",
};

export const kindLabel = (kind: string): string => KIND_LABEL[kind] ?? kind;

/** A stored row as the shape every view model uses. Exported for
 * attention.ts, which threads the same rows the pulse lists. */
export function toItem(c: Chip): Item {
  return {
    cls: c.class,
    kind: c.kind,
    symbol: c.symbol,
    date: c.date,
    title: c.title,
    detail: c.detail,
    sourceUrl: c.source_url,
    tags: Array.isArray(c.extra?.tags) ? c.extra!.tags : null,
    tagCounts: c.extra?.tag_counts ?? null,
    // The dividend per share, kept off the public shape: it is an input to
    // the drop, not something a chip renders on its own.
    ...(typeof c.extra?.amount === "number" ? { amount: c.extra.amount } : {}),
  } as Item;
}

/**
 * Put the mechanical drop on every scheduled ex-dividend row.
 *
 * Mutates in place because it is the same row either way -- the drop is a
 * property of a dividend we are already showing, not a second event.
 */
export function attachDrops(con: Database, items: Item[], asOf: string): Item[] {
  for (const i of items) {
    if (i.kind !== "exdiv" || i.cls !== "scheduled" || !i.symbol) continue;
    const amount = (i as any).amount ?? null;
    i.drop = expectedDrop(amount, lastClose(con, i.symbol, asOf));
  }
  return items;
}

// ---------------------------------------------------------------- month grid

export interface Cell {
  date: string;
  day: number;
  inMonth: boolean;
  weekend: boolean;
  today: boolean;
  marks: { kind: string; cls: ViewClass; n: number; label: string }[];
  overflow: number;
  /** The rows behind the marks -- what the hover card shows without a round
   * trip. Capped, because a market-wide day can carry thirty filings. */
  items: Item[];
  total: number;
  /** The day's close: the filtered company's, or the index's market-wide. */
  close?: number | null;
  /** Fraction against the previous trading day. */
  change?: number | null;
  /** Whose close this is, so the cell can band and label it correctly. */
  priceOf?: "company" | "index" | null;
}

/** Six weeks of cells, Monday first, with the leading and trailing days of the
 * neighbouring months dimmed rather than blank -- a calendar that starts
 * mid-row is harder to scan than one that shows the seam.
 *
 * `symbols` is the watchlist, and it narrows the whole grid. Empty means the
 * market; one name means that company's year at a glance. */
export function month(
  con: Database,
  ym: string,
  today: string,
  opts: {
    symbols?: string[];
    index?: string | null;
    /** Whose closes colour the grid. Defaults below. */
    priceSymbol?: string | null;
    /** The tag filter in force. It narrows headlines only -- a filing has no
     * topic tags, and hiding scheduled events because of a news filter would
     * empty the calendar of the things it exists to show. */
    tag?: string;
    maxMarks?: number;
    popCap?: number;
  } = {}
): Cell[] {
  const { symbols = [], index = null, priceSymbol, tag = "", maxMarks = 2, popCap = 6 } = opts;
  // A price strip needs ONE subject. The caller picks it (see the price filter
  // on /month); with no choice made it is the single selected company, or the
  // composite when the grid covers several names.
  const subject = priceSymbol ?? (symbols.length === 1 ? symbols[0] : index) ?? null;
  const first = `${ym}-01`;
  const lead = (weekday(first) + 6) % 7; // Monday-first offset
  const start = shift(first, -lead);
  const total = Math.ceil((lead + daysInMonth(ym)) / 7) * 7;
  const end = shift(start, total - 1);

  // One read for the whole grid, grouped in memory: the marks and the hover
  // card are two views of the same rows, and two queries would let them
  // disagree.
  const byDate = new Map<string, Item[]>();
  for (const row of eventsInRange(con, start, end, symbols)) {
    const item = toItem(row);
    if (item.kind === "news" && !matchesTag(item, tag)) continue;
    byDate.set(item.date!, [...(byDate.get(item.date!) ?? []), item]);
  }
  // Never an average of whatever names happen to be in the database -- that is
  // a different number wearing the index's name.
  const prices = subject ? pricesInRange(con, subject, start, end) : new Map();

  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    const date = shift(start, i);
    const items = byDate.get(date) ?? [];

    const groups = new Map<string, { kind: string; cls: ViewClass; n: number; symbol: string }>();
    for (const it of items) {
      const key = `${it.kind}|${it.cls}`;
      const g = groups.get(key) ?? { kind: it.kind, cls: it.cls, n: 0, symbol: it.symbol };
      g.n += 1;
      groups.set(key, g);
    }
    const marks: Cell["marks"] = [...groups.values()]
      .sort((a, b) => (a.cls === b.cls ? b.n - a.n : a.cls === "scheduled" ? -1 : 1))
      .map((d) => ({
        kind: d.kind,
        cls: d.cls,
        n: d.n,
        label:
          d.n > 1
            ? `${d.n} ${d.kind === "filing" ? "filings" : d.kind === "news" ? "headlines" : d.kind}`
            : d.symbol
              ? `${d.symbol} ${d.kind}`
              : d.kind,
      }));

    cells.push({
      date,
      day: Number(date.slice(8)),
      inMonth: date.slice(0, 7) === ym,
      weekend: isWeekend(date),
      today: date === today,
      marks: marks.slice(0, maxMarks),
      overflow: Math.max(0, marks.length - maxMarks),
      items: items.slice(0, popCap),
      total: items.length,
      close: prices.get(date)?.close ?? null,
      change: prices.get(date)?.change ?? null,
      priceOf: prices.get(date) ? (isIndex(subject) ? "index" : "company") : null,
    });
  }
  return cells;
}

// ---------------------------------------------------------------- happening now

/** Ten a page, like every other list in the product. */
export const PULSE_HEADLINES = 10;

export interface Pulse {
  from: string;
  to: string;
  /** The tag filter in force, as the reader typed or picked it. */
  tag: string;
  /** The one company the headline list is narrowed to, if any. This narrows
   * the LIST and nothing else on the page -- the companies bar at the top is
   * what scopes the whole view. */
  who: string;
  headlines: Item[];
  /** Matching headlines in the range, of which `headlines` is one page. */
  total: number;
  /** 1-based, clamped to a real page. */
  page: number;
  pages: number;
  /** Index of the first headline shown, for "11–20 of 34". */
  offset: number;
  /** Every tag on record in the range, commonest first. These are the filter's
   * options, so they are counted BEFORE the filter -- options that vanish the
   * moment you use one are a dead end. */
  topics: { label: string; n: number }[];
  /** The names the range kept naming. */
  tickers: { symbol: string; n: number; kinds: string[] }[];
}

/**
 * The headlines over an explicit range, optionally narrowed to one tag.
 *
 * The range is the caller's, not a rolling window: /month hands it the month
 * on screen, clipped at today. A block that stays on "the last 14 days" while
 * you page back through the calendar is the single fastest way to make a feed
 * look broken.
 */
export function pulseOver(
  con: Database,
  from: string,
  to: string,
  symbols: string[] = [],
  tag = "",
  page = 1,
  who = ""
): Pulse {
  if (to < from) {
    return { from, to, tag, who, headlines: [], total: 0, page: 1, pages: 1, offset: 0, topics: [], tickers: [] };
  }
  const rows = eventsInRange(con, from, to, symbols).map(toItem);
  const news = rows.filter((r) => r.kind === "news");

  const topicCount = new Map<string, number>();
  for (const r of news) {
    for (const t of r.tags ?? []) {
      const label = String(t).trim();
      if (label) topicCount.set(label, (topicCount.get(label) ?? 0) + 1);
    }
  }

  const matched = news
    .filter((r) => matchesTag(r, tag) && (!who || r.symbol === who))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  // Counted before `who` is applied, like the topics: a chip that disappears
  // the moment you use it leaves no way back to the rest of the list.
  const tickerCount = new Map<string, { n: number; kinds: Set<string> }>();
  for (const r of tag ? news.filter((r2) => matchesTag(r2, tag)) : rows) {
    if (!r.symbol) continue;
    const t = tickerCount.get(r.symbol) ?? { n: 0, kinds: new Set<string>() };
    t.n += 1;
    t.kinds.add(r.kind);
    tickerCount.set(r.symbol, t);
  }

  // Same rule as every other list: a page number out of range lands on a real
  // page rather than an empty one.
  const pages = Math.max(1, Math.ceil(matched.length / PULSE_HEADLINES));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const offset = (current - 1) * PULSE_HEADLINES;

  return {
    from,
    to,
    tag,
    who,
    headlines: matched.slice(offset, offset + PULSE_HEADLINES),
    total: matched.length,
    page: current,
    pages,
    offset,
    topics: [...topicCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, n]) => ({ label, n })),
    tickers: [...tickerCount.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 6)
      .map(([sym, t]) => ({ symbol: sym, n: t.n, kinds: [...t.kinds] })),
  };
}

// ---------------------------------------------------------------- up next

/**
 * Everything the issuers have dated ahead for the selected names across the
 * horizon: the list the agenda page opens with.
 */
export function upcoming(con: Database, symbols: string[], today: string): Item[] {
  const to = shift(today, HORIZON_DAYS);
  return attachDrops(
    con,
    eventsInRange(con, today, to, symbols).filter((r) => r.class === "scheduled").map(toItem),
    today
  ).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

// ---------------------------------------------------------------- one date

export interface Day {
  date: string;
  scheduled: Item[];
  facts: Item[];
}

export function day(con: Database, date: string, symbols: string[] = []): Day {
  const rows = attachDrops(
    con,
    eventsOn(con, date)
      .map(toItem)
      .filter((r) => !symbols.length || symbols.includes(r.symbol)),
    date
  );
  return {
    date,
    scheduled: rows.filter((r) => r.cls === "scheduled"),
    facts: rows.filter((r) => r.cls === "fact"),
  };
}

// ---------------------------------------------------------------- one company

export interface Timeline {
  symbol: string;
  ahead: Item[];
  behind: Item[];
  /** This name's headlines, split by the provider's own tag. */
  news: { positive: number; negative: number; neutral: number; total: number };
  /** Everything the coverage was tagged with EXCEPT Bullish and Bearish --
   * those two are the sentiment, and repeating them as topics would double-
   * count the same label in two places on one page. */
  tags: { label: string; n: number }[];
}

/** Bullish and Bearish are read as sentiment, so they are not topics. */
const SENTIMENT_TAG = /^(bullish|bearish)$/i;

// ---------------------------------------------------------------- the price chart

export interface ChartMark {
  date: string;
  /** The close the line is at on this date (the last one on or before it), so
   * the marker sits on the line rather than floating beside it. */
  close: number;
  news: Item[];
  /** Filings, suspensions, dividends, meetings: everything that is not news. */
  record: Item[];
}

export interface Chart {
  symbol: string;
  from: string;
  to: string;
  points: { date: string; close: number }[];
  marks: ChartMark[];
}

/**
 * One company's closes over the last `days`, with the dates its news and
 * filings landed on. A database read only: it never spends.
 *
 * The topic narrows NEWS exactly as it does on the list. With no closes held
 * there is no line to hang a marker on, so `marks` is empty rather than drawn
 * on an invented axis.
 */
export function chartFor(
  con: Database,
  symbol: string,
  today: string,
  tag = "",
  days: number = HORIZON_DAYS
): Chart {
  const from = shift(today, -days);
  const points = [...pricesInRange(con, symbol, from, today).values()].map((p) => ({
    date: p.date,
    close: p.close,
  }));
  if (!points.length) return { symbol, from, to: today, points, marks: [] };

  const start = points[0].date;
  const at = (d: string) => [...points].reverse().find((p) => p.date <= d)?.close ?? points[0].close;
  const byDate = new Map<string, ChartMark>();
  for (const r of eventsForSymbol(con, symbol).map(toItem)) {
    if (!r.date || r.date < start || r.date > today) continue;
    if (r.kind === "news" && !matchesTag(r, tag)) continue;
    const m = byDate.get(r.date) ?? { date: r.date, close: at(r.date), news: [], record: [] };
    (r.kind === "news" ? m.news : m.record).push(r);
    byDate.set(r.date, m);
  }
  return {
    symbol,
    from: start,
    to: today,
    points,
    marks: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export function timeline(con: Database, symbol: string, today: string): Timeline {
  const rows = attachDrops(con, eventsForSymbol(con, symbol).map(toItem), today);
  const news = rows.filter((r) => r.kind === "news");

  const tagCount = new Map<string, number>();
  for (const r of news) {
    for (const t of r.tags ?? []) {
      const label = String(t).trim();
      if (label && !SENTIMENT_TAG.test(label)) tagCount.set(label, (tagCount.get(label) ?? 0) + 1);
    }
  }

  return {
    symbol,
    ahead: rows
      .filter((r) => r.date! >= today && r.cls === "scheduled")
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
    // The whole history: the page decides how much of it to show (render.ts
    // pages at ten), and a hard slice here would silently hide years.
    behind: rows.filter((r) => r.date! < today),
    news: {
      positive: news.filter((r) => sentimentOf(r) === "positive").length,
      negative: news.filter((r) => sentimentOf(r) === "negative").length,
      neutral: news.filter((r) => sentimentOf(r) === "neutral").length,
      total: news.length,
    },
    tags: [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, n]) => ({ label, n })),
  };
}
