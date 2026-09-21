/**
 * The API response cache, in the same SQLite file as everything else.
 *
 * It used to be sha256-named JSON files on disk with an optional Redis in
 * front. One table is simpler and, more to the point, queryable -- "what have
 * we actually paid for?" is now a SELECT rather than a directory listing:
 *
 *   sqlite3 data/newsidx.db \
 *     "SELECT fetched_at, url FROM api_cache ORDER BY fetched_at DESC LIMIT 10;"
 *
 * Values never expire. A closed trading day's data does not change, and a
 * corporate action does not change retroactively, so a hit is free forever.
 *
 * `SHARED_CACHE_DIR` is the one piece of the old disk cache worth keeping: a
 * sibling project's on-disk cache can still be read through, so its paid-for
 * responses cost this project 0 credits. Read-only, and copied into the table
 * on first touch.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Database } from "better-sqlite3";
import { SHARED_CACHE_DIR } from "./config.js";

export interface Cache {
  get(url: string): unknown | undefined;
  set(url: string, value: unknown): void;
}

/** The sibling cache's file naming, so its entries are readable as-is. */
function legacyPath(dir: string, url: string): string {
  const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
  return path.join(dir, `${hash}.json`);
}

export function makeCache(con: Database): Cache {
  const read = con.prepare(`SELECT body FROM api_cache WHERE url = ?`);
  const write = con.prepare(
    `INSERT INTO api_cache(url, fetched_at, body) VALUES (?,?,?)
     ON CONFLICT(url) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body`
  );

  return {
    get(url) {
      const row = read.get(url) as { body: string } | undefined;
      if (row) return JSON.parse(row.body);

      if (SHARED_CACHE_DIR) {
        const p = legacyPath(SHARED_CACHE_DIR, url);
        if (fs.existsSync(p)) {
          try {
            const value = JSON.parse(fs.readFileSync(p, "utf-8")).value;
            if (value !== undefined) {
              write.run(url, new Date().toISOString(), JSON.stringify(value));
              return value;
            }
          } catch {
            /* a corrupt sibling entry is a cache miss, not a crash */
          }
        }
      }
      return undefined;
    },

    set(url, value) {
      write.run(url, new Date().toISOString(), JSON.stringify(value));
    },
  };
}
