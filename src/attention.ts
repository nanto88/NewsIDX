/**
 * Which stories to look at before the week turns. plan.md §3b.4 is the same
 * instinct pointed at the diary; this is it pointed at the news.
 *
 * Two things live here. `threadsOf` collapses the different sources that ran
 * one story into one row, because five newspapers on one press release is one
 * event and counting it five times measures syndication. `needsAttention` ranks those
 * stories, and the component that makes this product's version of the idea
 * different from a news reader is `event`: a story that lands on top of a date
 * the issuer already published.
 *
 * No model, and nothing here decides anything. Every component is a count, a
 * ratio of counts or a difference between two dates, every one is printed on
 * the row it ranks, and the score is a sort order rather than a claim. What it
 * cannot see is stated in METHODOLOGY.md §7: reach, importance and causation
 * are not in the data, and pickup is a floor because only the sources in the
 * Sectors feed are counted.
 */
import type { Database } from "better-sqlite3";
import { type Item, matchesTag, sentimentOf, toItem } from "./calendar.js";
import { eventsInRange, pricesInRange } from "./db.js";
import { daysBetween, shift } from "./dates.js";
import {
  ATTENTION_BASELINE_DAYS,
  ATTENTION_MIN_BASELINE,
  ATTENTION_NEAR_DAYS,
  ATTENTION_TOP,
  ATTENTION_WEIGHTS,
  THREAD_SIMILARITY,
  THREAD_SPAN_DAYS,
} from "./config.js";

// ---------------------------------------------------------------- threading

/** Words that carry no subject. Deliberately short: over-stripping merges
 * stories that share only their grammar. */
const STOP = new Set(
  (
    "a an and are as at be by for from has have in into is it its of on or over per say says said " +
    "the to up with after before their two three second again amid than that this those these new"
  ).split(" ")
);

/** A title as the set of words that could identify it. The ticker comes out --
 * every headline about a company names it, so leaving it in would merge that
 * company's unrelated stories. */
export function titleTokens(item: Item): Set<string> {
  const sym = item.symbol.toLowerCase();
  return new Set(
    item.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && w !== sym && !/^\d+$/.test(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / (a.size + b.size - hit || 1);
}

export interface Thread {
  /**
   * Every ticker the story names, sorted, or `['']` for market-wide news.
   *
   * Plural because the backfill writes one row per symbol: a story about a
   * syndicated loan to four banks is four rows carrying the same headline and
   * the same source. That is right for each bank's own timeline and wrong for
   * a ranked list, where it is one story and must be one row.
   */
  symbols: string[];
  /** Every headline in the story, newest first. */
  members: Item[];
  /** The earliest wording: whoever ran it first, not whoever wrote the
   * punchiest headline. */
  lead: Item;
  from: string;
  to: string;
  /** How many different sources carried the story, counted by source host.
   * A floor, never a total: only what this feed carries is counted. */
  sources: number;
  /** Every token every member shares. A chained thread can share none, and
   * then it says so rather than inventing a label. */
  shared: string[];
  /** Counted per headline, never per thread: five sources on one bullish
   * story is five bullish rows, and collapsing them would reweight the split
   * the rest of the product reports. */
  positive: number;
  negative: number;
  /** Both tones present -- the sources do not agree on what it means. */
  split: boolean;
}

const hostOf = (url: string | null | undefined): string => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Single-link grouping inside one subject: a headline joins a story if it is
 * close enough to ANY member, not just the first one seen. Union-find, so the
 * result does not depend on the order the rows arrived in -- which matters,
 * because a paged feed does not promise one.
 *
 * ponytail: O(n^2) pairs inside a subject bucket. Fine at the few hundred
 * headlines a month a single name attracts; an inverted index on rare tokens
 * if a bucket ever passes ~1k.
 */
export function threadsOf(
  items: Item[],
  opts: { similarity?: number; spanDays?: number } = {}
): Thread[] {
  const { similarity = THREAD_SIMILARITY, spanDays = THREAD_SPAN_DAYS } = opts;
  const bySubject = new Map<string, Item[]>();
  for (const it of items) {
    if (it.kind !== "news" || !it.date) continue;
    const list = bySubject.get(it.symbol) ?? [];
    list.push(it);
    bySubject.set(it.symbol, list);
  }

  const out: Thread[] = [];
  for (const [symbol, list] of bySubject) {
    const toks = list.map(titleTokens);
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        // A run of similar headlines spread over a month is a recurring theme,
        // not one story being picked up.
        if (Math.abs(daysBetween(list[i].date!, list[j].date!)) > spanDays) continue;
        if (jaccard(toks[i], toks[j]) < similarity) continue;
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[b] = a;
      }
    }

    const groups = new Map<number, number[]>();
    for (let i = 0; i < list.length; i++) {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), i]);
    }
    for (const idx of groups.values()) {
      const members = idx.map((i) => list[i]).sort((a, b) => b.date!.localeCompare(a.date!));
      const shared = idx
        .map((i) => toks[i])
        .reduce((acc, t) => new Set([...acc].filter((x) => t.has(x))));
      const positive = members.filter((m) => sentimentOf(m) === "positive").length;
      const negative = members.filter((m) => sentimentOf(m) === "negative").length;
      out.push({
        symbols: [symbol],
        members,
        lead: members[members.length - 1],
        from: members[members.length - 1].date!,
        to: members[0].date!,
        // Rows with no source URL cannot be told apart by host, so each counts
        // as its own source rather than silently collapsing into one.
        sources: new Set(members.map((m, n) => hostOf(m.sourceUrl) || `#${n}`)).size,
        shared: [...shared],
        positive,
        negative,
        split: positive > 0 && negative > 0,
      });
    }
  }
  // One story, however many tickers it names. Identity is the set of rows
  // behind it -- same sources, same headlines -- which is exact rather than
  // fuzzy, because these rows were written from one feed entry.
  const byStory = new Map<string, Thread[]>();
  for (const t of out) {
    const id = t.members
      .map((m) => m.sourceUrl || m.title)
      .sort()
      .join("\u0000");
    byStory.set(id, [...(byStory.get(id) ?? []), t]);
  }
  const merged = [...byStory.values()].map((group) => {
    if (group.length === 1) return group[0];
    const named = [...new Set(group.flatMap((t) => t.symbols))].filter(Boolean).sort();
    return { ...group[0], symbols: named.length ? named : [""] };
  });

  return merged.sort(
    (a, b) =>
      b.to.localeCompare(a.to) ||
      b.sources - a.sources ||
      a.symbols.join().localeCompare(b.symbols.join())
  );
}

// ---------------------------------------------------------------- near a date

/** A date somebody published, close enough to the story to matter. */
export interface Nearby {
  kind: string;
  date: string;
  /** Days from the story's last headline to that date. 0 means the story
   * landed on it. */
  days: number;
}

/**
 * The nearest date the issuer has published for this name, at or after
 * `after`, inside the window.
 */
export function nearestEvent(
  con: Database,
  symbol: string,
  after: string,
  withinDays: number = ATTENTION_NEAR_DAYS
): Nearby | null {
  if (!symbol) return null;
  const found: Nearby[] = eventsInRange(con, after, shift(after, withinDays), [symbol])
    .filter((r) => r.class === "scheduled")
    .map((r) => ({ kind: r.kind, date: r.date, days: daysBetween(after, r.date) }));

  found.sort((a, b) => a.days - b.days);
  return found[0] ?? null;
}

// ---------------------------------------------------------------- the ranking

export interface Ranked {
  thread: Thread;
  /** Different sources over the days it ran. */
  perDay: number;
  /** This name's usual pickup over the trailing window, or null when it has
   * too little history to quote a rate against. */
  usual: number | null;
  /** Sources ÷ usual. Null for the same reason. */
  lift: number | null;
  near: Nearby | null;
  /** The name's own close change on the story's busiest day, where we hold one
   * and the story is about exactly one name. Co-occurrence, never causation. */
  move: number | null;
  moveOn: string | null;
  held: boolean;
  /** Days from the last headline to today. */
  age: number;
  /** Every weighted component, by name, so the row can show its own reasoning. */
  parts: Record<string, number>;
  score: number;
}

export interface Attention {
  from: string;
  to: string;
  rows: Ranked[];
  /** Stories in range, of which `rows` are the ones that cleared the floor. */
  considered: number;
  /** How the baseline was measured, for the note under the list. */
  baselineFrom: string;
}

const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));

/**
 * The floor, and the reason the list is short.
 *
 * One source writing one routine story about a name you happen to hold is not
 * something to look at. Without this, "needs attention" quietly becomes "your
 * watchlist, in date order" -- which is what the agenda page already is. Two
 * ways through: somebody else picked the story up, or it lands on a date.
 */
export const qualifies = (r: Ranked): boolean => r.thread.sources >= 2 || r.near !== null;

/** The day the story was busiest -- the one a price move would sit beside.
 * Ties go to the later day: the second day of a two-day story is the day the
 * market had read it. */
function peakDay(t: Thread): string {
  const n = new Map<string, number>();
  for (const m of t.members) n.set(m.date!, (n.get(m.date!) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
}

export function needsAttention(
  con: Database,
  opts: {
    from: string;
    to: string;
    today: string;
    watchlist?: string[];
    top?: number;
    /** The page's Topic filter. Narrows which stories are RANKED; the baseline
     * below stays unfiltered on purpose, because "their usual pickup" is the
     * name's usual over all coverage -- recomputing it per topic would compare
     * a story against a denominator the reader never sees. */
    tag?: string;
  }
): Attention {
  const { from, to, today, watchlist = [], top = ATTENTION_TOP, tag = "" } = opts;
  if (to < from) return { from, to, rows: [], considered: 0, baselineFrom: from };

  const threads = threadsOf(
    eventsInRange(con, from, to, watchlist)
      .map(toItem)
      .filter((i) => i.kind !== "news" || matchesTag(i, tag))
  );

  // This name's usual pickup, from the same rows threaded the same way. One
  // more read of a table the page has already opened -- no new query shape,
  // and no per-symbol loop.
  //
  // ponytail: reads the whole baseline window market-wide when no watchlist is
  // set. ~90 days of news on one SQLite table; if that ever shows up in a
  // profile, count sources per subject in SQL instead of threading them.
  const baselineFrom = shift(from, -ATTENTION_BASELINE_DAYS);
  const usualBy = new Map<string, number>();
  const past = new Map<string, number[]>();
  for (const t of threadsOf(
    eventsInRange(con, baselineFrom, shift(from, -1), watchlist).map(toItem)
  )) {
    // A story naming four banks is one past story for each of the four.
    for (const sym of t.symbols) past.set(sym, [...(past.get(sym) ?? []), t.sources]);
  }
  for (const [sym, sizes] of past) {
    if (sizes.length < ATTENTION_MIN_BASELINE) continue; // two stories is not a baseline
    usualBy.set(sym, sizes.reduce((a, b) => a + b, 0) / sizes.length);
  }

  const held = new Set(watchlist);
  const nearCache = new Map<string, Nearby | null>();

  const rows: Ranked[] = threads.map((thread) => {
    const span = daysBetween(thread.from, thread.to) + 1;
    const perDay = thread.sources / span;
    // Across the names it mentions: a story is unusual pickup for a name if it
    // is unusual for the names it is about, averaged over the ones we can
    // measure at all.
    const usuals = thread.symbols.map((s2) => usualBy.get(s2)).filter((u): u is number => u != null);
    const usual = usuals.length ? usuals.reduce((a, b) => a + b, 0) / usuals.length : null;
    const lift = usual ? thread.sources / usual : null;

    // The soonest date across every name the story names.
    let near: Nearby | null = null;
    for (const sym of thread.symbols) {
      const key = `${sym}|${thread.to}`;
      if (!nearCache.has(key)) nearCache.set(key, nearestEvent(con, sym, thread.to));
      const n = nearCache.get(key)!;
      if (n && (!near || n.days < near.days)) near = n;
    }

    // A close belongs to one company. A story naming four banks has no single
    // price beside it, so it gets none rather than an arbitrary one.
    const only = thread.symbols.length === 1 ? thread.symbols[0] : "";
    const on = peakDay(thread);
    const move = only ? (pricesInRange(con, only, on, on).get(on)?.change ?? null) : null;

    const parts: Record<string, number> = {
      // A 1x pickup is nothing to report; 3x its own rate is the whole signal.
      pickup: lift == null ? 0 : clamp((lift - 1) / 2),
      speed: clamp((perDay - 0.5) / 2),
      event: near ? clamp(1 - near.days / ATTENTION_NEAR_DAYS) : 0,
      split: thread.split ? 1 : 0,
      // Under 1% is noise on a single IDX name; the band matches EQUITY_BANDS.
      move: move == null ? 0 : clamp((Math.abs(move) - 0.01) / 0.05),
      held: thread.symbols.some((s2) => s2 && held.has(s2)) ? 1 : 0,
      fresh: clamp(1 - daysBetween(thread.to, today) / 21),
    };
    const score = Object.entries(ATTENTION_WEIGHTS).reduce(
      (a, [k, w]) => a + w * (parts[k] ?? 0),
      0
    );

    return {
      thread,
      perDay,
      usual,
      lift,
      near,
      move,
      moveOn: move == null ? null : on,
      held: thread.symbols.some((s2) => !!s2 && held.has(s2)),
      age: daysBetween(thread.to, today),
      parts,
      score,
    };
  });

  return {
    from,
    to,
    considered: rows.length,
    baselineFrom,
    rows: rows
      .filter(qualifies)
      .sort((a, b) => b.score - a.score || b.thread.to.localeCompare(a.thread.to))
      .slice(0, top),
  };
}

/** The weighted contributions worth naming, largest first. Anything under a
 * tenth of a point is rounding, and printing it would bury the reason. */
export function contributions(r: Ranked): { key: string; value: number }[] {
  return Object.entries(ATTENTION_WEIGHTS)
    .map(([key, w]) => ({ key, value: w * (r.parts[key] ?? 0) }))
    .filter((c) => c.value >= 0.1)
    .sort((a, b) => b.value - a.value);
}
