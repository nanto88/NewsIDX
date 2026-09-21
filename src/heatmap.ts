/**
 * The board, as a treemap: every company sized by what it is worth and
 * coloured by what it did, grouped into the sectors it belongs to.
 *
 * The agenda answers "what is coming". This answers "what just happened", and
 * it is the one view in the product that is market-wide rather than
 * watchlist-scoped -- the `event` table has always held facts for every listed
 * company, and until now nothing outside the filter could see them.
 *
 * Two things are worth knowing before reading the layout code.
 *
 * 1. Everything here is in PERCENTAGES of its own container, never pixels.
 *    The sectors are laid out in one unit rectangle, and the companies inside
 *    each sector are laid out in another. That is what lets the page be
 *    responsive with no measurement and no JavaScript: the browser resolves
 *    the pixels, twice, at whatever size it happens to be.
 *
 * 2. A tile's hover panel is NOT an explanation of its move. It is what was on
 *    the record around that day, each headline carrying its own date, and most
 *    tiles will have nothing -- news covers 30-75 IDX symbols on a good day
 *    against 200 tiles. The empty state says "nothing on the record", because
 *    a tooltip that goes looking for a reason and finds one will be believed.
 */
import type { Database } from "better-sqlite3";
import { type Item, matchesTag, sentimentOf, toItem } from "./calendar.js";
import { BOARD_NEWS_DAYS } from "./config.js";
import { boardOn, eventsInRange, latestBoardDate } from "./db.js";
import { shift } from "./dates.js";

export interface Rect {
  /** All four in percent of the containing box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  symbol: string;
  name: string;
  subSector: string;
  marketCap: number;
  change: number | null;
  /** What was on the record for this company in the days up to the board's
   * date. Usually empty; see the header. */
  notes: Item[];
}

export interface SectorBox extends Rect {
  sector: string;
  marketCap: number;
  /** Cap-weighted, so a sector's number is the number its constituents
   * actually moved it by -- not the average of eleven companies where the
   * smallest counts as much as the largest. */
  change: number | null;
  tiles: Tile[];
}

export interface Board {
  /** The day we asked. The move is the last CLOSED session's, which is why
   * every label on the page says "as of" and not "on". */
  date: string;
  /** The window the hover panels draw their headlines from. */
  newsFrom: string;
  sectors: SectorBox[];
  drawn: number;
  /** How many of the drawn companies have anything on the record. The page
   * prints this rather than letting a reader discover the sparsity by
   * hovering twenty tiles and finding nothing. */
  withNotes: number;
  up: number;
  down: number;
  /** Cap-weighted move of the whole board. */
  change: number | null;
  /** The tone tally over the window, counted the way METHODOLOGY.md §1 counts
   * it everywhere else: Sectors' own `Bullish` and `Bearish` tags, nothing
   * inferred from the text, and neither is a forecast. */
  positive: number;
  negative: number;
  /** Distinct stories behind those counts. A story naming four companies is
   * one story here and four hover panels on the board -- counting it four
   * times would let a single press release decide what the market "talked
   * about". */
  stories: number;
  /** What those stories were tagged, commonest first, sentiment excluded.
   * Bullish and Bearish are tone and are counted above; everything else is a
   * subject. */
  topics: { tag: string; n: number }[];
}

// ---------------------------------------------------------------- the layout

/** The aspect ratio of the worst tile in a row, given the row's areas, their
 * sum, and the side the row is packed along. The number squarify minimises. */
function worst(areas: number[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Infinity;
  let min = Infinity;
  let max = 0;
  for (const a of areas) {
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (min <= 0) return Infinity;
  const s2 = sum * sum;
  const w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk 2000): pack the values into
 * `rect`, row by row along whichever side is shorter, extending a row only
 * while doing so makes its worst tile squarer.
 *
 * Squarified rather than the twenty-line slice-and-dice alternative because
 * slice-and-dice gives the 200th company a tile one pixel wide and 40 tall,
 * which is not a rectangle anyone can hover, read or click. The aspect ratio
 * is the feature.
 *
 * Values must be sorted descending -- the algorithm assumes it, and does not
 * sort, so the caller keeps its own ordering and the mapping back to rows.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const total = values.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;

  // Into area units of the target rectangle, so `worst` compares like with like.
  const scale = (rect.w * rect.h) / total;
  const areas = values.map((v) => (v > 0 ? v : 0) * scale);

  let free: Rect = { ...rect };
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(free.w, free.h);
    // A degenerate strip left over: emit zero-size rects rather than divide by
    // it. The caller drops anything with no area.
    if (side <= 0) break;

    let end = i + 1;
    let sum = areas[i];
    let best = worst([areas[i]], sum, side);
    while (end < areas.length) {
      const next = sum + areas[end];
      const r = worst(areas.slice(i, end + 1), next, side);
      if (r > best) break;
      sum = next;
      best = r;
      end++;
    }

    // The row is `thickness` deep and fills the short side completely.
    const thickness = sum / side;
    const alongHeight = free.w >= free.h;
    let off = 0;
    for (let k = i; k < end; k++) {
      const len = (areas[k] / sum) * side;
      out[k] = alongHeight
        ? { x: free.x, y: free.y + off, w: thickness, h: len }
        : { x: free.x + off, y: free.y, w: len, h: thickness };
      off += len;
    }

    free = alongHeight
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    i = end;
  }
  return out;
}

/** Cap-weighted mean move, or null when nothing in the group has both. */
function weighted(rows: { marketCap: number; change: number | null }[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.change == null || !(r.marketCap > 0)) continue;
    num += r.change * r.marketCap;
    den += r.marketCap;
  }
  return den > 0 ? num / den : null;
}

// ---------------------------------------------------------------- assembly

/**
 * The board for `on`, or the most recent one we hold at or before it.
 *
 * Falling back is not a nicety: the board is fetched on the day it is asked
 * for, IDX does not trade at weekends, and a Sunday visitor to a page that
 * only ever reads today would find it empty. The returned `date` is the day
 * actually drawn, and the page prints it.
 *
 * `tag` is the page's Topic filter. It narrows the stories attached to the
 * tiles -- and so the tone tally and the topic line above the board -- by the
 * same rule the calendar uses: news only, because a tile's colour is its price
 * move and a filing carries no tags. The tiles themselves never move: which
 * companies exist and how far they closed is not a matter of topic.
 */
export function board(con: Database, on: string, tag = ""): Board | null {
  const date = latestBoardDate(con, on);
  if (!date) return null;
  const rows = boardOn(con, date);
  if (!rows.length) return null;

  // One range query for the whole board rather than one per tile: the window
  // holds a few hundred rows market-wide, and 200 round trips to say "nothing"
  // 170 times is the kind of thing that only shows up under load.
  const newsFrom = shift(date, -(BOARD_NEWS_DAYS - 1));
  const notes = new Map<string, Item[]>();
  for (const chip of eventsInRange(con, newsFrom, date)) {
    if (!chip.symbol) continue; // market-wide news belongs to no tile
    const item = toItem(chip);
    if (item.kind === "news" && !matchesTag(item, tag)) continue;
    const list = notes.get(chip.symbol);
    if (list) list.push(item);
    else notes.set(chip.symbol, [item]);
  }
  for (const list of notes.values()) {
    // Newest first, and a filing or a suspension ahead of a headline on the
    // same day: the official record outranks the coverage of it.
    const rank: Record<string, number> = { suspension: 0, filing: 1, exdiv: 1, agm: 1 };
    list.sort(
      (a, b) =>
        (b.date ?? "").localeCompare(a.date ?? "") ||
        (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)
    );
  }

  const bySector = new Map<string, Tile[]>();
  let up = 0;
  let down = 0;
  let withNotes = 0;
  for (const r of rows) {
    const cap = r.market_cap ?? 0;
    if (!(cap > 0)) continue; // a tile with no area is not a tile
    const mine = notes.get(r.symbol) ?? [];
    if (mine.length) withNotes++;
    if (r.close_change != null && r.close_change > 0) up++;
    if (r.close_change != null && r.close_change < 0) down++;
    const tile: Tile = {
      symbol: r.symbol,
      name: r.name,
      subSector: r.sub_sector,
      marketCap: cap,
      change: r.close_change,
      notes: mine,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
    const list = bySector.get(r.sector);
    if (list) list.push(tile);
    else bySector.set(r.sector, [tile]);
  }
  if (!bySector.size) return null;

  const sectors: SectorBox[] = [...bySector]
    .map(([sector, tiles]) => {
      tiles.sort((a, b) => b.marketCap - a.marketCap);
      return {
        sector,
        tiles,
        marketCap: tiles.reduce((a, t) => a + t.marketCap, 0),
        change: weighted(tiles),
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      };
    })
    .sort((a, b) => b.marketCap - a.marketCap);

  const unit: Rect = { x: 0, y: 0, w: 100, h: 100 };
  const boxes = squarify(
    sectors.map((s) => s.marketCap),
    unit
  );
  sectors.forEach((s, i) => Object.assign(s, boxes[i]));
  // Each sector's companies are laid out in their OWN unit square, which the
  // renderer then places inside the sector box below its heading. Two
  // percentage systems, no pixel arithmetic, and the heading can be any height
  // CSS wants it to be.
  for (const s of sectors) {
    const inner = squarify(
      s.tiles.map((t) => t.marketCap),
      unit
    );
    s.tiles.forEach((t, i) => Object.assign(t, inner[i]));
  }

  const all = sectors.flatMap((s) => s.tiles);

  // Tone and topics, over the stories attached to the tiles actually drawn.
  //
  // Deduplicated by story, not by tile: the backfill writes one row per
  // (story, symbol), so a rights issue naming four companies arrives as four
  // rows. Counted as four it would outvote four separate stories, and "what
  // the board was tagged" would be decided by which press release named the
  // most tickers. Counted once, it is one story with one set of tags.
  const seen = new Set<string>();
  const topics = new Map<string, number>();
  let positive = 0;
  let negative = 0;
  for (const t of all) {
    for (const n of t.notes) {
      // The story's identity, matching how backfill keys a headline within its
      // day: the source URL when there is one, the title when there is not.
      const id = `${n.kind}|${n.date}|${n.sourceUrl ?? n.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const tone = sentimentOf(n);
      if (tone === "positive") positive++;
      else if (tone === "negative") negative++;
      for (const tag of n.tags ?? []) {
        const t2 = tag.trim();
        if (!t2 || /^(bullish|bearish)$/i.test(t2)) continue; // tone, counted above
        topics.set(t2, (topics.get(t2) ?? 0) + 1);
      }
    }
  }

  return {
    date,
    newsFrom,
    sectors,
    drawn: all.length,
    withNotes,
    up,
    down,
    change: weighted(all),
    positive,
    negative,
    stories: seen.size,
    // Ties broken alphabetically so the same data renders the same page twice
    // -- a bar that reshuffles on reload reads as new information.
    topics: [...topics]
      .map(([tag, n]) => ({ tag, n }))
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
      .slice(0, 3),
  };
}
