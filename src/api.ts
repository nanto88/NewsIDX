/**
 * Sectors API v2 client. plan.md §6 and §10.
 *
 * Copied from ../sentry_fin/server/src/api.ts with the COSTS table extended by
 * one entry, and the ceiling made CUMULATIVE across runs (plan.md §6: at a
 * shared 1,000-credit allowance a per-day cap alone still lets a fortnight
 * spend everything).
 *
 * Four jobs and nothing else:
 *   1. Every call passes through `Client.get`, which is where the ceiling is
 *      enforced -- this run's daily cap AND the project's lifetime total.
 *   2. Every response is cached by URL, in the database (cache.ts). A closed
 *      trading day's data never changes, so a cache hit costs 0 credits
 *      forever. Point SHARED_CACHE_DIR at a sibling project's on-disk cache
 *      and its paid-for calls cost 0 here too.
 *   3. Per-ticker failure isolation via `tryGet`: one HTTP 500 must not abort
 *      a sweep.
 *   4. MOCK_MODE serves deterministic fixtures with no key and no network --
 *      still charged against the ledger, so the demo's credit line is honest.
 */
import type { Database } from "better-sqlite3";
import { type Cache, makeCache } from "./cache.js";
import { apiKey, BASE_URL, DAILY_CREDIT_CAP, mockMode, PROJECT_CEILING } from "./config.js";
import { mockRoute } from "./mock/fixtures.js";

export class BudgetExhausted extends Error {}
export class CacheMiss extends Error {}

export class ApiError extends Error {
  status: number;
  body: unknown;
  free: boolean; // a structured 400 costs nothing
  constructor(status: number, body: unknown, url: string) {
    super(`HTTP ${status} for ${url}: ${JSON.stringify(body).slice(0, 200)}`);
    this.status = status;
    this.body = body;
    this.free = status === 400;
  }
}

export interface CallRecord {
  url: string;
  cost: number;
  source: string;
}

// ---------------------------------------------------------------- documented costs
// Verified against sectors-api-v2.yaml. Checked on every call rather than
// trusted in a comment: a wrong cost silently breaks the budget, and at a
// shared 1,000-credit allowance that is not an error worth discovering late.
const COSTS: Record<string, number> = {
  "/v2/company/corporate-actions/": 1,
  "/v2/company/get_quarterly_financial_dates/": 1,
  "/v2/companies/quarterly-financial-dates/": 1, // PER PAGE of 30 (~32 for a full sweep)
  "/v2/companies/": 1, // structured query; ?q= is 3 and stays unused
  // Listed explicitly even though the `/v2/companies/` prefix above would
  // match it: a longer prefix wins, so leaving it out would have priced this
  // by accident rather than on purpose. Measured at 1 -- and one call carries
  // every classification and every period asked for.
  "/v2/companies/top-changes/": 1,
  "/v2/filings/": 1, // per page of 30, market-wide
  "/v2/suspensions/": 1, // per page of 30
  "/v2/news/": 1, // per page of 30
  "/v2/daily/": 1,
  // An index is not a stock, and /v2/daily/ answers nothing for IHSG. This is
  // the documented index endpoint (docs.sectors.app, "Index Daily
  // Transaction Data"): lowercase code, up to 90 days, 1 credit.
  "/v2/index-daily/": 1,
  "/v2/subsectors/": 1,
  "/v2/tags/": 1,
};

/** The spec's price for `path`, or null if we have not recorded one. */
export function documentedCost(path: string): number | null {
  const prefixes = Object.keys(COSTS).sort((a, b) => b.length - a.length);
  for (const p of prefixes) if (path.startsWith(p)) return COSTS[p];
  return null;
}

function encodeKeep(s: string): string {
  return encodeURIComponent(s).replace(/%5B|%5D|%27|%3C|%3E|%3D|%20/g, (m) =>
    ({ "%5B": "[", "%5D": "]", "%27": "'", "%3C": "<", "%3E": ">", "%3D": "=", "%20": " " })[m]!
  );
}

function buildQuery(params: Record<string, unknown>): string {
  // Mirrors the spec's own examples: everything percent-encoded except the
  // characters the API's `where` syntax needs literal.
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeKeep(String(k))}=${encodeKeep(String(v))}`)
    .join("&");
}

export class Client {
  spent = 0;
  calls: CallRecord[] = [];
  private cache: Cache;

  /** `committed` is what this project has ALREADY spent in previous runs --
   * read from the run ledger (db.creditsSpent) so the ceiling is a lifetime
   * total, not a per-process one. */
  constructor(con: Database, private committed = 0) {
    this.cache = makeCache(con);
  }

  private reserve(cost: number): void {
    if (this.spent + cost > DAILY_CREDIT_CAP) {
      throw new BudgetExhausted(`daily cap: ${this.spent} spent + ${cost} would exceed ${DAILY_CREDIT_CAP}`);
    }
    if (this.committed + this.spent + cost > PROJECT_CEILING) {
      throw new BudgetExhausted(
        `project ceiling: ${this.committed} already spent + ${this.spent} this run + ${cost} would exceed ${PROJECT_CEILING}`
      );
    }
  }

  /**
   * GET a Sectors endpoint. `cost` is the documented credit price and must be
   * passed explicitly at every call site -- a wrong number here silently
   * breaks the budget, so it is never inferred from the path.
   *
   * `fresh` skips the cache READ (the answer is still written). For endpoints
   * that answer "as of now" with no date in the URL -- the board, the movers --
   * the URL is the same every day, so a cache hit is yesterday's answer
   * served under today's date.
   */
  async get(path: string, params?: Record<string, unknown>, cost = 1, fresh = false): Promise<any> {
    const doc = documentedCost(path);
    if (doc !== null && doc !== cost) {
      throw new Error(
        `${path} is documented at ${doc} credit(s) but the call site passed ${cost}. Fix the call site or COSTS -- do not paper over it.`
      );
    }

    if (mockMode()) {
      // Reserve first: a misconfigured demo must still respect the ceiling.
      this.reserve(cost);
      this.spent += cost;
      this.calls.push({ url: path, cost, source: "mock" });
      return mockRoute(path, params);
    }

    const qs = buildQuery(params ?? {});
    const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;

    const cached = fresh ? undefined : this.cache.get(url);
    if (cached !== undefined) {
      this.calls.push({ url, cost: 0, source: "cache" });
      return cached;
    }

    // Reserve BEFORE anything else: a budget breach must be reported as a
    // budget breach even in a misconfigured env.
    this.reserve(cost);

    const key = apiKey();
    if (!key) {
      throw new CacheMiss(
        `SECTORS_API_KEY is unset and ${path} is not cached. Run the probes (plan.md §7), or you meant MOCK_MODE=1.`
      );
    }

    const res = await fetch(url, {
      headers: { Authorization: key, Accept: "application/json", "User-Agent": "newsidx/0.1" }, // raw key, no Bearer prefix
    });
    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      const err = new ApiError(res.status, body, url);
      if (!err.free) {
        this.spent += cost;
        this.calls.push({ url, cost, source: `http-${res.status}` });
      } else {
        this.calls.push({ url, cost: 0, source: "http-400-free" });
      }
      throw err;
    }

    const body = await res.json();
    this.spent += cost;
    this.calls.push({ url, cost, source: "live" });
    this.cache.set(url, body);
    return body;
  }

  /**
   * Per-ticker isolation. Returns {body, error} -- never throws ApiError or
   * CacheMiss. A backfill that dies on the first bad response is a backfill
   * that dies. BudgetExhausted still propagates: that one must stop the run.
   */
  async tryGet(
    path: string,
    params?: Record<string, unknown>,
    cost = 1,
    fresh = false
  ): Promise<{ body: any | null; error: string | null }> {
    try {
      return { body: await this.get(path, params, cost, fresh), error: null };
    } catch (e) {
      if (e instanceof BudgetExhausted) throw e;
      return { body: null, error: String((e as Error).message ?? e) };
    }
  }
}
