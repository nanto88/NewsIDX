INTERNAL

# NewsIDX — build plan v2

**You find out your stock had an event when the price gaps. NewsIDX tells you first.**

> **Problem statement (submission field):** For Indonesian retail investors holding a
> handful of IDX names — NewsIDX shows which of *your* holdings has an event in the next
> 90 days, dated when the issuer dated it, predicted with a confidence window when nobody
> dated it, and priced when the effect is mechanical.

Personal project. Stack: TypeScript on Node 20+, Fastify, better-sqlite3,
disk+Redis cache, server-rendered HTML — ported from `../sentry_fin/server`.

Build closes **30 Sep 2026 23:59 WIB** (19 days). Registration closes **22 Sep** —
a non-code deadline someone must own on a named day, not "soon".

---

## 0. What changed from v1, and why

v1 was a calendar of the Indonesian market. v2 is an answer to a question someone actually
asks. Six changes, each tied to the rubric.

| # | Change | Why |
|---|---|---|
| 1 | **Watchlist is the entry point, not the month grid.** Landing view is a 90-day agenda for *your* tickers | 40% of the score is "can someone use this today and benefit". Nobody benefits from all ~950 IDX names on a grid. The two personas in `research.md` §5 both hold 5–15 names |
| 2 | **Four derived numbers promoted to the product surface** (§3b) | A product that only shows raw Sectors data in a new layout adds little. A grid of facts *is* that. The prediction, the ex-div drop, the cluster count and the hit rate are what the API does not return |
| 3 | **Hit rate is backtested out-of-sample, not waited for** | Q3 reports land late Oct — **after** the deadline. v1 step 8 (fill `actual_date` as reports arrive) would produce n≈0 by 30 Sep. Predicting quarter *N* from quarters 1..*N−1* over the history we already paid for gives a real hit rate on day one, for 0 extra credits |
| 4 | **Mobile-first agenda; month grid demoted to a density view** | Retail investors are on phones. A 7-column dark grid with 3 chips per cell is unreadable at 390px, and unreadable on a phone-shot video |
| 5 | **Per-ticker cost cut 120 → 24 credits**, coverage widened by making fills demand-driven and sharing `../sentry_fin`'s cache (§6) | Same product, ~half the committed credits, and the 1,000 pool is shared with SentryX |
| 6 | **Video shot list is in the plan** (§9) | 30% of the score. v1 had no plan for 30% of the score |

Unchanged and still load-bearing: the tense split (§2), the honesty rules (§12), the reuse
map (§10), MOCK_MODE as non-negotiable.

## 1. Who it is for, and the one moment it has to win

| Persona (`research.md` §5) | The moment NewsIDX exists for |
|---|---|
| **Holder of 8 names, no idea which files this week** | Opens the app, sees "BBRI reports 26–31 Oct (82% confidence) · TLKM ex-div Tue 23 Sep" |
| **Seller who panicked on an ex-dividend drop** | Sees "ex-div 23 Sep · expected drop −4.3% · this is not bad news" **before** the print |

Not the target, deliberately: anyone wanting BI-rate or CPI dates. Sectors holds no macro
data (`research.md` §1), Investing.com owns that surface for free, and a macro calendar
fails hard gate 1 — remove Sectors and it still stands. **The UI must never imply macro
coverage.**

## 2. The tense split — the one design rule everything follows

The only natively forward-dated field in the whole API is `upcoming_dividend`
(`research.md` §2). The past is dense, the future is sparse. Render both the same way and
you either look empty ahead or pass a guess off as a schedule.

| Class | Tense | Certainty | Treatment (never mixed) |
|---|---|---|---|
| **Fact** | past, today | It happened. Official record + link | Solid `--surface-2` fill, `--text` |
| **Scheduled** | future | The issuer dated it | Solid fill, 2px `--primary` left rule |
| **Predicted** | future | We computed it from filing rhythm | **No fill, 1px dashed border**, `--text-muted`, the word "predicted", a window never a date, a confidence bar |

Three different *shapes*, not three different colors — colour alone fails colour-blind
users and fails a compressed video. A judge will test exactly this boundary; it is what
makes the name honest.

## 3. What earns a place on a date

### 3a. Chips — the record layer

| Chip | Source | Tense | Credits |
|---|---|---|---|
| Insider filing | `/v2/filings/?start=&end=` — market-wide | fact | 1 per 30 rows |
| Suspension | `/v2/suspensions/?start=` — official reason + IDX PDF | fact | 1 |
| Corporate action effective | `corporate-actions/{sym}` history (ex-div, split, bonus, rights) | fact | 1/ticker, cached forever |
| Report filed | `/v2/companies/quarterly-financial-dates/?since=` — market-wide | fact | 1 **per 30-row page** (~32 for a full sweep, 1–2 with `?since=`) |
| News | `/v2/news/?symbols=&start=&end=` | fact | 1 |
| **Upcoming dividend** | `corporate-actions/{sym}` → `upcoming_dividend` | **scheduled** | same call, already cached |
| **AGM** | `corporate-actions/{sym}` → `agm` | **scheduled** | same call |
| Next report | fitted from `get_quarterly_financial_dates/{sym}` history | **predicted** | 1/ticker, cached forever |

Filings, news, suspensions and report-filed are **market-wide range calls** — dense past
coverage at no per-ticker cost. Per-ticker calls buy only the two things that need them:
the forward dividend and the filing rhythm.

### 3b. The derived layer — this is the product

Four numbers, none of which appear in any API response. All deterministic; the model
phrases, never decides (§12.4).

| # | Output | How | Extra credits |
|---|---|---|---|
| 1 | **Predicted event window** — "24–30 Nov, 2 of 2 held" | Median day-of-year ± MAD over the symbol's own **ex-dividend and AGM** history. *(Amended after build: the quarterly-dates endpoint returns period keys, not filing dates — §7 Q15. `predict.ts` measures this at runtime and renders "no window" with the reason when it holds.)* | 0 — same cached call |
| 2 | **Prediction hit rate** — "7 of 9 past reports landed inside the window we would have drawn" | Out-of-sample backtest: predict quarter *N* from 1..*N−1* only, walk forward over cached history. Published per-ticker and in aggregate | 0 |
| 3 | **Ex-div mechanical drop** — "expected −4.3%; this is not bad news" | dividend ÷ close, falling back to `dividend_yield`, **which the same cached `corporate-actions` call already carries** — so the screener snapshot Q14 was priced for is not needed | **0** |
| 4 | **Event cluster** — "3 of your 8 names land in the week of 22 Sep" | Group the agenda by ISO week, count distinct symbols | 0 |

Optional if time survives step 7: **late-filing watch** — a name past the upper bound of its
own predicted window with no report on record. Same data, zero credits. Cut it without
regret.

## 4. UI — the part the judges actually see

Tokens come from `../sentry_fin/design-system.html` (`:root` is dark; `:root[data-theme="light"]`
already exists). **Copy the token block verbatim and keep `render.test.ts`'s drift
assertion** — that test is why this UI cannot silently drift.

`--bg:#0a0908` · `--surface:#131211` · `--surface-2:#191816` · `--border:#26241f` ·
`--text:#f3f1ed` · `--text-muted:#a29d93` · `--primary:#22d3ff` · `--up:#2AB673` ·
`--down:#e5484d` · Inter / JetBrains Mono stacks.

### 4a. Information architecture — agenda first

| Route | Shows | Priority |
|---|---|---|
| `/?w=BBCA,TLKM,…` | **Agenda.** 90-day horizon for the watchlist, grouped *This week · Next week · Later*, with the cluster warning at the top and the next scheduled event pinned | **The product.** Build first, demo first |
| `/month?month=YYYY-MM` | Month grid. Desktop: date + up to 3 chips + `+N`. Mobile: date + one dot per class (density view), tap → `/day` | Secondary — pattern, not agenda |
| `/day?date=YYYY-MM-DD` | Every event on one date, grouped by class, each linking its official record | Detail |
| `/ticker?symbol=XXXX` | One company's timeline, past and ahead, plus its own hit rate | Detail + the technical-depth shot |

**Why the horizon is 90 days, not "this month":** the demo window (mid-to-late Sep) sits
between IDX reporting seasons — Q2 is filed, Q3 lands late Oct. A month grid of September
is forward-empty by construction. A 90-day agenda carries the predicted Q3 windows, which
is exactly the content the product is for. *(ASSUMPTION on IDX filing seasonality —
Q11/Q13 in §7 settle it with real dates before step 5.)*

**Watchlist without accounts:** tickers live in the URL (`?w=`) and are mirrored to
`localStorage`. Shareable, bookmarkable, judge-testable with no login, no DB user table, no
credits. First run preloads three seeded names so the empty state is never the first thing
anyone sees.

### 4b. Chip anatomy

```
FACT        ▐ filing      BBRI   Komisaris buys 1.2M sh        →  official record
SCHEDULED   ▐ ex-div      TLKM   Tue 23 Sep · expected −4.3%   →  corporate action
PREDICTED   ┆ report      BBRI   predicted 26–31 Oct  ▓▓▓▓▓░░  82%
```

Mono for every date, ticker and number (`--font-mono`); UI font for prose. Kind is a word,
not an emoji — emoji render four different ways across the devices judges will use.

### 4c. States, designed rather than bolted on

| State | What renders |
|---|---|
| Empty watchlist | First-run card with three seeded tickers and one line on what the app does |
| No events in 90 days | Says so plainly, plus the nearest event beyond the horizon. Never a blank pane |
| **Unstable filing rhythm** | "No window — this issuer's filing dates vary too widely to predict." A wide window is worse than no window (§12.5) |
| Stale cache | "Facts as of 29 Sep 08:12 WIB" in the footer of every page |
| MOCK_MODE | Persistent banner: fixtures, no network, no key |
| Credits exhausted | Serves cache, says it is serving cache. Never a 500 |

### 4d. Craft floor — non-negotiable, cheap

- **Mobile-first.** Single column ≤640px; grid appears at ≥768px. Tap targets ≥44px.
- **No client framework, no bundler, no webfont download.** Keep the Inter/JetBrains token
  stacks and let the system font resolve — identical tokens, zero render-blocking requests.
  Target <20KB HTML per page.
- **Real `<a href>` navigation** for every view. The product works with JS disabled; JS is
  only the watchlist input and the theme toggle.
- **Accessibility:** visible focus ring (`--ring`), `aria-current="date"` on today,
  `<time datetime>` on every date, tense stated in text as well as shape, `--text-muted` on
  `--surface` is ≈7:1 contrast (comfortably past 4.5:1), `prefers-reduced-motion` honoured.
- **Light theme for free** — `data-theme="light"` tokens already exist; honour
  `prefers-color-scheme` and offer one toggle. Judges screen-record in both.
- Weekend cells dimmed to `--surface`: IDX does not trade, and an empty weekend is
  information, not a gap.

## 5. Data model

Four tables, in `db.ts`'s existing style, one write path.

- `event` — `(date, symbol, class, kind, payload_json, source_url)`; one row per chip,
  `class ∈ fact|scheduled|predicted`. Every view is one indexed query on `date`.
  Append-with-upsert on `(date, symbol, kind)`, so re-running a backfill is idempotent and
  free.
- `ticker` — the watched universe with per-source cache timestamps.
- `prediction` — `(symbol, quarter, predicted_from, predicted_to, confidence, actual_date, oos)`.
  `oos` marks a backtest row (§3b.2); the hit rate is one query over this table.
- `run` — one row per run with credits spent. Carried from SentryX; it is what makes the
  credit line in the video honest.

## 6. Credits — the effective-credit plan

**The 1,000-credit allowance is per team, and SentryX already commits ~233 of it.** Any
budget that ignores that is wrong before it starts.

Four levers, in order of payoff:

1. **Share SentryX's cache.** Both products call `corporate-actions`, `filings`, `news`,
   `suspensions` and `quarterly-financial-dates` against a disk cache keyed by URL. Point
   `CACHE_DIR` at a shared directory and every overlapping call costs **0**. Do this in
   step 0, before the first paid call.
2. **Market-wide ranges over per-ticker loops.** One `/v2/filings/` range call covers every
   symbol; 60 per-ticker calls cover 60.
3. **Demand-driven per-ticker fills.** Seed 12 names, fill anything else the first time
   someone asks for it, cache it forever. Corporate actions and filing history do not
   change retroactively.
4. **One structured `/v2/companies/` query** carries price and yield for the whole universe
   at 1 credit — that is derived output #3 for every dividend payer, priced once.

| Item | Arithmetic | Credits |
|---|---|---|
| Probes, with retries | §7 | 20 |
| Helper lists, committed once | reuse SentryX's if already cached | 0–3 |
| Seed universe | 12 × (corporate-actions 1 + qtr-dates 1) | 24 |
| 90-day backfill of past facts | range calls, Q9-dependent | 30 |
| On-demand fills (judges, extra names) | 20 × 2 | 40 |
| Daily poll | 2/day × 14 days + weekly qtr-dates | 32 |
| Video / demo re-runs | everything cached by then | 15 |
| **NewsIDX subtotal** | | **164** |
| NewsIDX reserve | | 110 |
| **NewsIDX committed** | | **275** |
| SentryX committed | their §11b-i | 233 |
| **Joint committed** | | **508** |
| **Joint headroom** | | **492** |

Enforce it in code, not in this table: `config.ts` already carries `ALLOWANCE`,
`DAILY_CREDIT_CAP` and `RESERVE`, and `api.ts` asserts the documented cost on every call.
Set NewsIDX's own ceiling to 275 and a daily cap of 40 — **a cumulative cap is the one
that matters; at 1,000 credits a per-day cap alone still lets a fortnight spend everything.**

Steady state after the cache fills is ~2 credits a day.

## 7. Probes — before product code, ~20 credits

Every probe below is also a **cache prepayment**: the calls it makes are calls the product
needs anyway, so the marginal cost of measuring first is zero.

| # | Question | Cost | What it changes |
|---|---|---|---|
| **Q15** | **Are `get_quarterly_financial_dates` values filing dates, or quarter-end period keys?** | 1 | **Answered from the spec before spending it: period keys.** The endpoint feeds `report_date` into quarterly-financials and its example is `2026: [["2026-03-31","q1"]]`. `predict.reportDatesUsable()` re-measures it live and the report window renders as "no window" with the reason. Confirm against a real key, then close it |
| **Q11** | How many years does `get_quarterly_financial_dates/{sym}/` return? | 1 | Same call as Q15. Depth only matters if Q15 ever flips |
| **Q13** | Does `upcoming_dividend` carry a populated forward ex-date — and do any of the 12 seed names have one inside the next 90 days? | 12 (= the seed cache fill) | The entire **scheduled** class. If the answer is "none in window", the demo has no dated future and the seed list must be re-picked by query, not by memory |
| **Q9** | Row volume for `/v2/filings/` and `/v2/suspensions/` — measure **one day**, then extrapolate to 90 | 2 | Filings bill per 30 rows. A dense backfill is either 10 credits or 60, and a 1-day probe is 1/90th the price of finding out the expensive way |
| ~~Q14~~ | ~~A last-close field on the screener~~ | ~~1~~ | **Dead.** `corporate_actions.dividend[]` carries `dividend_yield` on the call we already make, so the drop needs no price at all |
| Q12 | Full IDX `/v2/tags/` vocabulary | 1 | Whether news chips carry topic tags. Cache and commit the answer either way |

**Q7 stays out of scope here.** Price-reaction distributions are §11; the `/v2/daily/`
clamp question does not block anything in this plan.

**Seed the 12 by query, not by memory** — one screener call ordered on `yield_ttm` with a
recent `last_ex_dividend_date`, spread across sub-sectors. "We chose these by querying the
market" is a better video beat than twelve tickers appearing unexplained.

## 8. Build order — 19 days, skeleton first

| # | Deliverable | Done when | By |
|---|---|---|---|
| 0 | Skeleton: repo, `package.json`, `tsconfig.json`, copied modules, **shared `CACHE_DIR`**, `.env.example`, `.gitignore` | `npm run build` passes on an empty pipeline | 12 Sep |
| 1 | Probes (§7) | Five answers in the README, cache warm | 13 Sep |
| 2 | `db.ts` schema + `event` upsert | `npm test` green on the table | 14 Sep |
| 3 | `backfill.ts` — 90-day market-wide facts | A quarter of dates populated from cache | 16 Sep |
| 4 | `calendar.ts` + **agenda route**, MOCK_MODE | **Dark agenda renders with fixture events on a 390px viewport. Demoable path exists** | 18 Sep |
| — | **Registration submitted** | Team page claimed, credits claimed | **20 Sep** (deadline 22nd) |
| 5 | `corporate-actions` cache → scheduled chips + ex-div expected drop | Future rows carry a dated ex-div with a number beside it | 21 Sep |
| 6 | `predict.ts` → predicted chips + out-of-sample hit rate | Predictions visibly distinct; hit rate renders from backtest | 23 Sep |
| 7 | `/month`, `/day`, `/ticker` + states (§4c) | Every chip reaches its official source; no blank panes | 25 Sep |
| 8 | Video: teaser + 3-minute walkthrough (§9) | Both uploaded, links verified public in a logged-out browser | 28 Sep |
| 9 | README, METHODOLOGY, key hygiene | `git log -p \| grep -iE "sk-\|api[_-]?key\|Authorization"` clean | 29 Sep |

**Step 4 is the freeze point** — from there a product exists and everything after is depth.
**Step 8 is not the buffer.** A video shot on 30 Sep is the single most common way a
finished build scores 70%.

## 9. Video — 30% of the score, one shot list

3 minutes, screen recording, one narrator, no slides. Beats:

| Time | Shot | Line |
|---|---|---|
| 0:00–0:20 | A −5% candle on a real chart | "This holder sold here. It was the dividend. It happens every dividend season." |
| 0:20–0:45 | Paste 8 tickers into the watchlist | "Eight names. Which one has an event this week?" |
| 0:45–1:30 | Agenda fills: dated ex-div with expected drop, AGM, the cluster warning | "Dated by the issuer. Priced by arithmetic: −4.3%, mechanical, not news." |
| 1:30–2:15 | Predicted Q3 window, dashed, with confidence — then `/ticker` and the hit rate | "Nobody publishes this date. We fit it from nine years of the company's own filings — and here is how often that window was right, tested out of sample." |
| 2:15–2:40 | `/day` → click through to the IDX PDF | "Every fact links to its official record." |
| 2:40–3:00 | The run ledger: credits spent | "The whole market, 90 days, for under 200 credits." |

Teaser (1 min): beats 1, 3 and 4 only. **Both links tested logged-out** — an inaccessible
video is not judged.

## 10. Reuse map — `../sentry_fin/server`

Its *infrastructure* is this product's infrastructure; its *cascade* is not.

**Copy as-is:** `config.ts` (env, caps) · `dates.ts` (`shift(iso, days)` is the calendar's
backbone) · `stats.ts` (median/MAD/robust-z — §3b.1 is a MAD fit) · `cache.ts` ·
`evidence.ts` (absent channels recorded, never omitted).

**Copy and extend:**
- `api.ts` — keep the `COSTS` table, the credit ceiling, the cost assertion and the free-400
  handling verbatim. Add `"/v2/company/get_quarterly_financial_dates/": 1`. Everything else
  is already wired.
- `db.ts` — schema style and single-write-path discipline; new tables (§5).
- `narrate.ts` — keep the boundary intact: code decides, the model only phrases.
- `render.ts` — keep the token-drift test against `design-system.html`.
- `server.ts` — Fastify route shape. `mock/` — **non-negotiable**: a judge with no API key
  must see the product work. `scripts/task0.ts` — the falsifier pattern, re-pointed at §7.

**Do not copy:** `cascade.ts`, `rules.ts`, `detect.ts` — backward attribution, different
product; reaching for them drags the whole SentryX model in behind them. And **never
`server/.env`** — the new repo gets `.env.example` with placeholders, `.env` git-ignored
from the first commit. A key that has ever been committed anywhere must be **rotated**;
deleting a committed secret does not un-expose it.

**New:** `calendar.ts` (date → chips + tense) · `predict.ts` (rhythm fit → window,
confidence, backtest) · `backfill.ts` (range fetch → date index).

## 11. Out of scope, deliberately

- **Reaction distributions** ("moved a median 7.4% on its last eight reports") — depends on
  the unmeasured Q7 clamp and adds a whole price-window subsystem. Revisit only if the
  agenda lands early.
- **Macro events** — Sectors holds no rate, CPI or GDP data (`research.md` §1). Sourcing
  them elsewhere makes Sectors removable and fails hard gate 1.
- **`forecast_eps_estimate` surprise** — unmeasured Q1; if the field is backfilled consensus
  it is look-ahead bias, and a dishonest number is worse than a missing one.
- Accounts, portfolio import, push notifications, Docker, any client-side framework.

## 12. Honesty rules

1. **Predicted never renders as scheduled.** Different shape, muted colour, confidence
   window shown, the word "predicted" in the chip.
2. **Every fact chip links its official record** — IDX PDF, filing, corporate action. A fact
   without a source is an assertion.
3. **News is context, never causation.** Chips say what was published that day; `/v2/news/`
   carries no causal claim and no timestamp precision against the tape.
4. **The model phrases, the code decides.** The product must be identical with the LLM
   disabled.
5. **A window we cannot draw is stated, not widened.** An unstable filing rhythm returns "no
   window", never a ±3-week band dressed up as a forecast.
6. **The hit rate says how it was measured** — out-of-sample walk-forward over cached
   history, n reported next to it. "7 of 9" with n visible; never a bare percentage.

## 13. Risks and kill criteria

| Risk | Detect | Response |
|---|---|---|
| Q11 returns one year of filing dates | Step 1 | No backtest. Predictions become "the week of", §3b.2 drops from the video, hit rate claim removed |
| No seed name has an ex-div in the 90-day window | Step 1 (Q13) | Re-pick the seed by query. If the whole market is empty in window, the **scheduled** class is demoed on historical dates and the UI says so |
| Filings backfill is 60+ credits | Step 1 (Q9) | Narrow to 45 days, or drop news chips — the agenda does not need them |
| Video slips past 30 Sep | Step 8 date | Ship the teaser cut of the 3-minute video. A rough video beats no video: 30% versus 0% |
| Two submissions, one credit pool | `run` ledger, both projects | 275 hard ceiling in `config.ts`, checked before any batch |

---

> Directory note: requested as `forewardned`, created as `newsidx` to match the product
> name. Rename if the typo was deliberate.
