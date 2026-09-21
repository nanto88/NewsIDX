/**
 * ISO date arithmetic. Copied from ../sentry_fin/server/src/dates.ts, plus the
 * three helpers the calendar needs (week bucketing and day-of-year, which is
 * the axis predict.ts fits on).
 *
 * UTC throughout, deliberately. IDX is UTC+7 and a local-time Date rolls the
 * date backwards for anyone running this west of Greenwich.
 */

/** `iso` moved by `days` (negative moves back). */
export function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Today, as the whole process understands it.
 *
 * NEWSIDX_TODAY pins it -- the fixture demo runs on a fixed date, and a
 * renderer reading the wall clock while the data layer reads the pin is how
 * the month pulse ended up labelled "what happened" on the current month.
 * One reader of the variable, so the two can never disagree again.
 */
export function today(): string {
  const v = process.env.NEWSIDX_TODAY?.trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
}

/** Whole days from `start` to `end`. Negative when `end` is earlier. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 864e5);
}

/** UTC day of week, Sunday=0. IDX does not trade on 0 or 6. */
export function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const w = weekday(iso);
  return w === 0 || w === 6;
}

/** The Monday of `iso`'s week -- the key the agenda groups on (plan.md §4a). */
export function weekStart(iso: string): string {
  const w = weekday(iso);
  return shift(iso, w === 0 ? -6 : 1 - w);
}

/** 1-366. The axis an annual rhythm is fitted on (predict.ts). */
export function dayOfYear(iso: string): number {
  const [y] = iso.split("-").map(Number);
  return daysBetween(`${y}-01-01`, iso) + 1;
}

/** Inverse of dayOfYear, so a fitted window can be read back as a date.
 * Out-of-range values roll into the neighbouring year, which is what a
 * late-December rhythm needs. */
export function fromDayOfYear(year: number, doy: number): string {
  return shift(`${year}-01-01`, Math.round(doy) - 1);
}

export function year(iso: string): number {
  return Number(iso.slice(0, 4));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "23 Sep" -- the agenda's date format. */
export function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Tue 23 Sep" */
export function fmtWithDay(iso: string): string {
  return `${DAYS[weekday(iso)]} ${fmtShort(iso)}`;
}

/** "Tuesday 23 September 2026" -- the /day heading. */
export function fmtLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const long = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday(iso)];
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `${long} ${d} ${month} ${y}`;
}

/** "22-28 Oct" / "29 Oct-4 Nov" -- a predicted window never renders as one date. */
export function fmtRange(from: string, to: string): string {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${MONTHS[m1 - 1]}` : `${d1} ${MONTHS[m1 - 1]}–${d2} ${MONTHS[m2 - 1]}`;
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
  return `${long} ${y}`;
}

/** Days in `ym` (YYYY-MM). */
export function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
