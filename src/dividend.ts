/**
 * The ex-dividend drop: the one number on the page with no statistics in it.
 * Deterministic, computed from rows we already paid for, and not a price
 * forecast.
 */

export interface Drop {
  /** Negative. -0.043 is a 4.3% drop. */
  pct: number;
  /** Stated on the chip: "amount ÷ close" and a yield figure are not the same claim. */
  basis: string;
  close: number;
}

/**
 * The mechanical effect of the dividend leaving the share price on the
 * ex-date.
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
