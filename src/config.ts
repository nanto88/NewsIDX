/**
 * Every tunable in the project, in one file. plan.md §6.
 *
 * Ported from ../sentry_fin/server/src/config.ts and cut down: this product has
 * no detector, no LLM and no thresholds to calibrate, so what is left is the
 * credit ceiling, the windows, and the paths.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { today } from "./dates.js";
// Runs compiled from dist/src/config.js, so the package root is two levels up.
// Getting this wrong puts data/ under dist/data/, where it accumulates stale
// credit totals that nothing clears.
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.NEWSIDX_HOME ?? path.resolve(here, "..", "..");

export const BASE_URL = "https://api.sectors.app";

// --- credits. plan.md §6: the 1,000-credit allowance is per TEAM and is shared
// with SentryX, which commits ~233. This project's own ceiling is 275, and it
// is cumulative across runs -- a per-day cap alone still lets a fortnight
// spend everything.
export const TEAM_ALLOWANCE = 1000;
export const SIBLING_COMMITTED = 233;
export const PROJECT_CEILING = 275;
export const DAILY_CREDIT_CAP = 40;

// --- windows. plan.md §4a (90-day agenda) and §8 step 3 (90-day backfill).
export const HORIZON_DAYS = 90;

// --- the rhythm fit (METHODOLOGY.md §4). Every one of these is a refusal
// threshold as much as a parameter: loosen them and the product starts drawing
// windows it cannot defend.
/** A gap this wide in day-of-year starts a new season. A final in March and an
 * interim in November are two rhythms, and fitting them as one refuses both. */
export const FIT_SEASON_GAP_DAYS = 45;
/** Occurrences kept per season. Issuers drift; a decade ago is not evidence. */
export const FIT_KEEP = 6;
/** Fewer than this is not a rhythm yet, it is a coincidence with a date. */
export const FIT_MIN_OCCURRENCES = 3;
/** Window half-width = this × MAD. */
export const FIT_SPREAD_MULT = 1.5;
/** Above this the dates move too much to call a window at all -- refused, not
 * widened. A fortnight of uncertainty is not a forecast. */
export const FIT_MAX_SPREAD_DAYS = 10;
/** Below 2 days a "window" is a date in a range's clothing; above 7 it is too
 * vague to act on. */
export const FIT_WINDOW_MIN_HALF = 2;
export const FIT_WINDOW_MAX_HALF = 7;

// --- the FAQ generator (plan.md §4a). Off unless a key is set; the button
// says so rather than failing on click.
/** Claude writes the /ticker summary and FAQ from the rows we already hold. */
export const FAQ_MODEL = process.env.FAQ_MODEL?.trim() || "claude-sonnet-5";
/** How many of a company's most recent rows the FAQ is written from. Enough to
 * cover a quarter of coverage, small enough to stay one cheap call. */
export const FAQ_ROWS = 40;
export function anthropicKey(): string | null {
  const k = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  return k && !/^your-/.test(k) ? k : null;
}
export const BACKFILL_DAYS = 90;

/** Page size ceiling shared by /v2/filings/, /v2/news/, /v2/suspensions/ and
 * /v2/companies/quarterly-financial-dates/ (spec: "Max 30"). Each page is a
 * credit, so a page loop is a budget loop -- hence PAGE_CAP below. */
export const PAGE_LIMIT = 30;
/** Hard stop on any `has_next` loop. An unbounded pager is the whole budget. */
export const PAGE_CAP = 12;


// --- paths
export const DATA_DIR = path.join(ROOT, "data");
/** Responses are cached in the database (cache.ts). This is an OPTIONAL
 * read-through to a sibling project's on-disk cache, so calls it already paid
 * for cost this project nothing. */
export const SHARED_CACHE_DIR = process.env.SHARED_CACHE_DIR?.trim() || null;
export const DB_PATH = process.env.NEWSIDX_DB ?? path.join(DATA_DIR, "newsidx.db");

/** The watchlist a bare `/` shows. The URL's `?w=` always wins (plan.md §4a). */
export function defaultWatchlist(): string[] {
  const raw = process.env.WATCHLIST ?? "BBCA,BBRI,BMRI,TLKM,ASII,ANTM,ICBP,PGAS";
  return parseWatchlist(raw);
}

/** `?w=bbca,tlkm` -> ["BBCA","TLKM"]. Four-letter IDX symbols only, so a
 * malformed query string cannot turn into a per-ticker API call. */
export function parseWatchlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase().replace(/\.JK$/, "");
    if (/^[A-Z]{4}$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 20) break; // a watchlist is a holding list, not a universe
  }
  return out;
}

/** MOCK_MODE=1 serves deterministic fixtures with no key and no network. The
 * judge-without-a-key path (plan.md §10), and the only mode the demo uses. */
export function mockMode(): boolean {
  const v = (process.env.MOCK_MODE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "mock";
}

export function apiKey(): string {
  return (process.env.SECTORS_API_KEY ?? "").trim();
}

export function port(): number {
  return Number(process.env.PORT ?? 3000);
}

/** The date the product treats as "today". Overridable so the fixture demo is
 * stable and so a judge can walk the calendar without waiting for tomorrow. */
export const runToday = today;

/** Whether a page view may spend credits filling a symbol nobody has fetched
 * yet. Off by default: a crawler must not be able to spend the budget. */
export function fillOnDemand(): boolean {
  const v = (process.env.FILL_ON_DEMAND ?? "").trim().toLowerCase();
  return mockMode() || v === "1" || v === "true";
}

// ---------------------------------------------------------------- the index

/**
 * The indices the calendar's price strip can be drawn from, broadest first.
 *
 * IHSG is the whole exchange and the default subject: a grid covering several
 * companies has no single company to price, and the market they sit in is the
 * honest stand-in. LQ45 is the 45 most liquid names -- the tradeable market
 * rather than the whole tail -- and is the strip worth switching to once the
 * grid is filtered to a few large caps.
 *
 * Which ticker Sectors' `/v2/daily/` actually answers for either is
 * UNVERIFIED: the API documents no index endpoint, and `npm run probes`
 * measures which candidates return rows. A subject that returns none renders
 * as a plain, untinted grid rather than an error -- so offering them costs
 * nothing that a wrong guess would.
 */
export const INDEX_CHOICES: { symbol: string; label: string }[] = [
  { symbol: "IHSG", label: "IHSG · whole exchange" },
  { symbol: "LQ45", label: "LQ45 · 45 most liquid" },
];

/** The indices on offer. INDEX_SYMBOL still wins -- it becomes the default and
 * joins the list -- so a deployment that probed a different ticker keeps it
 * without losing the other choices. */
export function indexChoices(): { symbol: string; label: string }[] {
  const v = process.env.INDEX_SYMBOL?.trim().toUpperCase();
  const custom =
    v && /^[A-Z0-9^.-]{2,12}$/.test(v) && !INDEX_CHOICES.some((c) => c.symbol === v)
      ? [{ symbol: v, label: `${v} · configured` }]
      : [];
  return [...custom, ...INDEX_CHOICES];
}

/** The subject the calendar prices when nobody has picked one. */
export function indexSymbol(): string {
  return indexChoices()[0].symbol;
}

/** Whether a price-strip subject is an index rather than a company -- which
 * decides the tint bands it is banded on. */
export function isIndex(symbol: string | null | undefined): boolean {
  return !!symbol && indexChoices().some((c) => c.symbol === symbol);
}

/** Candidates for the probe to try. Guesses, which is why they are probe
 * INPUT and never a default. */
export const INDEX_CANDIDATES = ["IHSG", "COMPOSITE", "JKSE", "^JKSE", "IDX", "IDXCOMP", "LQ45"];

/**
 * Tint bands for the index, in fractions.
 *
 * A single IDX name moves 1-3% on an ordinary day; the composite does not. Reusing
 * the equity bands would paint every index day the faintest tint and the strip
 * would carry no information. Tune here if the market's character changes.
 */
export const INDEX_BANDS: [number, number] = [0.003, 0.01];
export const EQUITY_BANDS: [number, number] = [0.01, 0.03];

// ---------------------------------------------------------------- the board
/**
 * How many companies the heatmap draws, biggest first.
 *
 * 200 is the API's own LIMIT ceiling, measured -- not a taste call. It is also
 * one credit, and the 201st name would cost a second call for a tile too small
 * to read. The tail of IDX is ~700 more names carrying a few percent of the
 * market's cap between them; they are not missing from the product, they are
 * below the resolution of this picture, and the page says so.
 */
export const BOARD_LIMIT = 200;

/** Names smaller than this are not drawn. 1T IDR is far below the 200th name,
 * so it never binds in practice -- it is here because `include_query_values`
 * only returns fields the `where` clause mentions, and market_cap has to be in
 * there for the tiles to have an area at all. */
export const BOARD_MIN_MCAP = 1_000_000_000_000;

/**
 * How far back a tile looks for something to say.
 *
 * A move shows up on the close; the story that goes with it was filed that day
 * or the day before, and a Monday move carries Friday's and the weekend's
 * news. Three days covers that without reaching so far back that a stale
 * headline gets printed under today's number. Every headline carries its own
 * date on the page precisely because this window is wider than one day.
 */
export const BOARD_NEWS_DAYS = 3;

/**
 * The narrowest the board is ever drawn, in CSS pixels.
 *
 * Below this the page scrolls it horizontally rather than reflowing it: 200
 * tiles on a phone is not a smaller version of this picture, it is a different
 * and worse one, and building a second view for it is building a second thing
 * to keep true. The renderer also sizes its headings against this number, so
 * nothing that fits at the minimum overflows at any larger width.
 *
 * Kept in step with the `.board` media query in render.ts by hand -- there is
 * one of each, and a build step to share one constant with a stylesheet would
 * cost more than it saves.
 */
export const BOARD_MIN_PX = 760;

/** The sector heading strip, in CSS pixels. Kept in step with `.sec > h4` in
 * render.ts by hand, like BOARD_MIN_PX above. */
export const BOARD_HEAD_PX = 17;

/**
 * The shortest the board is ever drawn, in CSS pixels, used to decide whether
 * a sector box can carry a heading at all.
 *
 * 16/9 of BOARD_MIN_PX is 427; 400 is deliberately under it, because the two
 * errors are not symmetric. Dropping a heading that would just have fitted
 * costs a label the hover panel repeats anyway. KEEPING one that does not fit
 * gives the box a negative-height body, and its tiles then render outside the
 * board entirely -- which is what the smallest IDX sector (two names out of
 * two hundred) did before this existed.
 */
export const BOARD_MIN_H_PX = 400;

// ---------------------------------------------------------------- the movers
/**
 * The periods the movers list offers, and the order the switcher shows them.
 *
 * All five arrive in ONE call -- `periods` is a comma-separated list, measured
 * -- so a day, a week, a fortnight, a month and a year cost the same single
 * credit that a day alone would. Which is the only reason the list is five
 * long: under a per-period price this would have been one period, and the
 * question "was this a one-day spike or a year-long climb?" would have gone
 * unanswered to save four credits.
 */
export const MOVER_PERIODS = ["1d", "7d", "14d", "30d", "365d"] as const;
export type MoverPeriod = (typeof MOVER_PERIODS)[number];

/** How many names a side. The API caps `n_stock` at 10 (measured: asking for
 * 20 returns 10); five is what fits beside the board without the section
 * becoming the page. */
export const MOVER_COUNT = 5;

/** How a period is written on the switcher. "365d" is a year to a reader and
 * a parameter to the API; only one of those belongs on a button. */
export const MOVER_LABEL: Record<MoverPeriod, string> = {
  "1d": "1 day",
  "7d": "1 week",
  "14d": "2 weeks",
  "30d": "1 month",
  "365d": "1 year",
};

/**
 * How far back a mover's headlines are read, per period.
 *
 * A 30-day gainer's story is not in the last three days, and showing only the
 * last three would print "nothing on the record" against a stock that rose a
 * quarter on news three weeks ago. So the window IS the period -- what moved
 * it is somewhere inside the span that measured the move, or it is not on our
 * record at all.
 *
 * `1d` gets three days rather than one because IDX does not trade at weekends:
 * a Monday move carries Friday's and the weekend's news, and a one-day window
 * would hide it.
 */
export const MOVER_NEWS_DAYS: Record<MoverPeriod, number> = {
  "1d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  // NOT 365. The news backfill holds BACKFILL_DAYS of record, so a year-long
  // window would promise a year of headlines and deliver ninety days of them.
  // Clamped to what we actually have, and the page says which span it read --
  // a year's move against three months of coverage is a gap worth printing,
  // not one worth hiding behind a wider-looking number.
  "365d": BACKFILL_DAYS,
};

/** Headlines shown per mover. Three, the same as a board tile's hover panel:
 * it is the same question asked of the same rows, and two different answers to
 * "what was on the record" would be one too many. */
export const MOVER_NOTES = 3;

/** `?movers=` is a period name or it is nothing. */
export function parseMoverPeriod(raw: unknown): MoverPeriod {
  const v = String(raw ?? "").trim().toLowerCase();
  return (MOVER_PERIODS as readonly string[]).includes(v) ? (v as MoverPeriod) : "1d";
}

// ---------------------------------------------------------------- attention
/**
 * Two headlines are the same story when their titles overlap this much, by
 * Jaccard over stopword-stripped tokens. 0.40 sits on a plateau: grouping is
 * stable anywhere between 0.25 and 0.45, and only starts splitting real
 * duplicate coverage above 0.50.
 */
export const THREAD_SIMILARITY = 0.4;

/** A story that "runs" for a fortnight is not one story. Beyond this many
 * days apart, two similar headlines are two occurrences of a recurring theme
 * -- monthly sales, quarterly volumes -- and pickup is not what is being
 * measured. */
export const THREAD_SPAN_DAYS = 5;

/** How close a dated event has to be for a story to count as landing on top
 * of it. A fortnight is the same horizon the agenda's "next week / week of"
 * buckets cover, and the contribution decays linearly across it. */
export const ATTENTION_NEAR_DAYS = 14;

/** How far back "this name's usual pickup" is measured. The backfill covers
 * 90 days, so this is all of it. */
export const ATTENTION_BASELINE_DAYS = 90;

/** A name needs at least this many past stories before we will quote a rate
 * against its own baseline. Two stories is not a baseline. */
export const ATTENTION_MIN_BASELINE = 2;

/** Rows on the page. */
export const ATTENTION_TOP = 6;

/**
 * The weights. Arbitrary, and deliberately visible: every row prints its own
 * components, so the sort order can be argued with. An opaque score nobody
 * can decompose is the thing to avoid, not the weighting itself.
 */
export const ATTENTION_WEIGHTS: Record<string, number> = {
  pickup: 3, // different sources, against this name's own usual
  speed: 2, // different sources per day
  event: 3, // lands on top of a date somebody published
  split: 1.5, // the sources disagree
  move: 1.5, // the close moved the same day
  held: 2, // a name in the watchlist
  fresh: 1.5, // recency
};
