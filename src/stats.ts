/**
 * The two robust statistics predict.ts needs. Copied from
 * ../sentry_fin/server/src/stats.ts; the OLS and percentile helpers stayed
 * behind with the attribution product that used them.
 *
 * Mean and standard deviation are the wrong tools here: one year when a
 * company paid its dividend a month late would drag the mean and inflate the
 * spread enough to swallow the signal.
 */

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error("median of empty sequence");
  const mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation, floored. The floor is a parameter because this
 * module is used on a scale of DAYS here, not returns: a company that filed on
 * exactly the same day of the year three times running has a true MAD of 0,
 * and a 0 spread must still produce a window with width. */
export function mad(xs: number[], floor = 0.5): number {
  const m = median(xs);
  return Math.max(median(xs.map((x) => Math.abs(x - m))), floor);
}
