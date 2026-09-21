/**
 * The derived layer. plan.md §3b -- the part of this product that is not in
 * any API response.
 *
 * Two things live here and nothing else: a window fitted from a company's own
 * annual rhythm, and the arithmetic of an ex-dividend drop. Both are
 * deterministic, both are computed from rows we already paid for, and neither
 * is a price forecast.
 *
 * The discipline this module exists to hold: a refusal is a result. When the
 * history is too short, too scattered, or refuted by itself, this returns the
 * reason rather than a wider window. A +-3 week band dressed up as a forecast
 * is worse than saying nothing (METHODOLOGY.md §4).
 */
import {
  FIT_KEEP,
  FIT_MIN_OCCURRENCES,
  FIT_SEASON_GAP_DAYS,
  FIT_SPREAD_MULT,
  FIT_MAX_SPREAD_DAYS,
  FIT_WINDOW_MAX_HALF,
  FIT_WINDOW_MIN_HALF,
} from "./config.js";
import { dayOfYear, fromDayOfYear, year as yearOf } from "./dates.js";
import { mad, median } from "./stats.js";

const YEAR = 365;

// ---------------------------------------------------------------- seasons

/**
 * Split a history into the rhythms it actually contains.
 *
 * BBCA pays a final in March and an interim in November: one company, two
 * annual rhythms. Fitting them together produces a median in the middle of
 * the year and a spread wide enough to refuse everything, so this runs first.
 *
 * The axis is day-of-year and it is circular -- a December/January rhythm is
 * one season, not two -- so the gaps are measured the long way round and the
 * list is rotated to start just after a real break.
 */
export function seasons(dates: string[], gapDays = FIT_SEASON_GAP_DAYS): string[][] {
  const rows = [...new Set(dates)]
    .map((d) => ({ d, doy: dayOfYear(d) }))
    .sort((a, b) => a.doy - b.doy);
  if (rows.length < 2) return rows.length ? [[rows[0].d]] : [];

  const n = rows.length;
  const gapAfter = (i: number) => (rows[(i + 1) % n].doy - rows[i].doy + YEAR) % YEAR;

  let start = -1;
  for (let i = 0; i < n; i++) {
    if (gapAfter(i) > gapDays) {
      start = (i + 1) % n;
      break;
    }
  }
  // No break anywhere: every date is within `gapDays` of the next, the long
  // way round included. That is one season.
  if (start < 0) return [rows.map((r) => r.d)];

  const out: string[][] = [];
  let cur: string[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    cur.push(rows[i].d);
    if (gapAfter(i) > gapDays) {
      out.push(cur.sort());
      cur = [];
    }
  }
  if (cur.length) out.push(cur.sort());
  return out;
}

// ---------------------------------------------------------------- the fit

export interface Fit {
  /** The window, as dates. Never collapsed to a single day. */
  from: string;
  to: string;
  /** Occurrences the fit was built from, after keeping the most recent few. */
  n: number;
  /** Median absolute deviation of the day-of-year, in days. */
  spreadDays: number;
  /** Walk-forward trials and how many landed inside. */
  trials: number;
  hits: number;
}

export type FitResult = { ok: true; fit: Fit } | { ok: false; reason: string };

/**
 * Centre and half-width from a set of day-of-year values.
 *
 * Median and MAD, not mean and standard deviation: one year a company paid a
 * month late would drag a mean and inflate a deviation enough to swallow the
 * signal (src/stats.ts).
 *
 * The half-width is clamped. Below 2 days a window is a date wearing a range's
 * clothes; above 7 it is too vague to act on, and a rhythm that needs more
 * than a fortnight is refused outright by MAX_SPREAD rather than widened here.
 */
function shape(doys: number[]): { centre: number; spread: number; half: number } {
  // A rhythm that straddles New Year has values at both ends of the axis.
  // Lift the low ones over the boundary so the median sits in the season
  // rather than in the middle of the year.
  const lo = Math.min(...doys);
  const hi = Math.max(...doys);
  const adj = hi - lo > YEAR / 2 ? doys.map((d) => (d < YEAR / 2 ? d + YEAR : d)) : doys;

  const centre = median(adj);
  const spread = mad(adj, 0.5);
  const half = Math.min(FIT_WINDOW_MAX_HALF, Math.max(FIT_WINDOW_MIN_HALF, FIT_SPREAD_MULT * spread));
  return { centre, spread, half };
}

/**
 * Onto 1-366, wrapping, and deliberately NOT rounded.
 *
 * A centre is routinely a half day -- the median of an even number of
 * occurrences -- and rounding it here would move the window half a day before
 * anything is measured against it. On a borderline trial that is the
 * difference between a miss and a hit, and it would round in the flattering
 * direction about half the time. Rounding happens once, at the very end, when
 * a day-of-year becomes a calendar date.
 */
function normDoy(doy: number): number {
  return (((doy - 1) % YEAR) + YEAR) % YEAR + 1;
}

/** Circular distance on the day-of-year axis. */
function inside(doy: number, centre: number, half: number): boolean {
  const d = Math.abs(normDoy(doy) - normDoy(centre));
  return Math.min(d, YEAR - d) <= half;
}

/**
 * Fit one season's history to a window ahead of `today`.
 *
 * Scored walk-forward: each past occurrence is predicted using only the
 * occurrences before it, so the hit rate is measurable now rather than next
 * year. Waiting for live outcomes would have meant n=0 on demo day
 * (plan.md §0.3).
 */
export function fitAnnualRhythm(dates: string[], today: string): FitResult {
  const hist = [...new Set(dates)].filter((d) => d < today).sort();
  if (hist.length < FIT_MIN_OCCURRENCES) {
    return {
      ok: false,
      reason: `${hist.length} past occurrence${hist.length === 1 ? "" : "s"} on record — a rhythm needs ${FIT_MIN_OCCURRENCES}`,
    };
  }

  // Issuers drift. Ten years ago is not evidence about next month.
  const kept = hist.slice(-FIT_KEEP);
  const { centre, spread, half } = shape(kept.map(dayOfYear));

  if (spread > FIT_MAX_SPREAD_DAYS) {
    return {
      ok: false,
      reason: `these dates move by ±${Math.round(spread)} days — too scattered to call a window`,
    };
  }

  // Walk forward: occurrence i predicted from 0..i-1 only. Two prior
  // occurrences is the least that makes a median and a deviation mean
  // anything, so scoring starts at i=2.
  let trials = 0;
  let hits = 0;
  for (let i = 2; i < kept.length; i++) {
    const s = shape(kept.slice(0, i).map(dayOfYear));
    trials++;
    if (inside(dayOfYear(kept[i]), s.centre, s.half)) hits++;
  }
  if (trials >= 2 && hits === 0) {
    return {
      ok: false,
      reason: "every past date fell outside the window its own history would have drawn — a drifting date, not a rhythm",
    };
  }

  // Place it in the first year where the window has not already closed.
  const c = normDoy(centre);
  for (const y of [yearOf(today), yearOf(today) + 1]) {
    const from = fromDayOfYear(y, c - half);
    const to = fromDayOfYear(y, c + half);
    if (to >= today) {
      return { ok: true, fit: { from, to, n: kept.length, spreadDays: spread, trials, hits } };
    }
  }
  return { ok: false, reason: "the next occurrence falls outside the horizon" };
}

/** "Right 2 of the last 3 times" -- or the honest absence of one. */
export function hitRateLabel(fit: Fit): string {
  if (fit.trials < 2) return "no hit rate yet — too few past occurrences to test against";
  return `right ${fit.hits} of the last ${fit.trials} times`;
}

// ---------------------------------------------- the ex-dividend drop

export interface Drop {
  /** Negative. -0.043 is a 4.3% drop. */
  pct: number;
  /** Stated on the chip: "amount ÷ close" and a yield figure are not the same claim. */
  basis: string;
  close: number;
}

/**
 * The mechanical effect of the dividend leaving the share price on the
 * ex-date. The one number on the page with no statistics in it at all.
 *
 * This exists because of the moment it is for: a holder who sees a 4.3% gap
 * and sells. They are not losing it, they are receiving it, and the chip says
 * so (plan.md §1).
 */
export function expectedDrop(
  amount: number | null | undefined,
  close: number | null | undefined
): Drop | null {
  if (amount == null || !(amount > 0)) return null;
  if (close == null || !(close > 0)) return null;
  return { pct: -(amount / close), basis: "dividend ÷ last close", close };
}

/** "−4.3%" */
export function fmtPct(pct: number): string {
  const sign = pct < 0 ? "−" : "+";
  return `${sign}${Math.abs(pct * 100).toFixed(1)}%`;
}
