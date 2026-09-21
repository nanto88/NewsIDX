**PUBLIC** — Forewarned. Research tooling, not investment advice.

# Forewarned — which of your IDX holdings has an event coming

You find out your stock had an event when the price gaps. Forewarned shows which of
**your** names has an event in the next 90 days — dated when the issuer dated it,
predicted with a confidence window when nobody dated it, and priced when the effect is
mechanical.

**Track 03 — Market Intelligence.** Built on the Sectors API v2.

> For Indonesian retail investors holding a handful of IDX names: the ex-dividend drop that
> looks like bad news, the general meeting nobody told you about, and the week three of your
> eight names all report at once.

---

## Try it in three commands — no API key, no network

```bash
npm install && npm run demo && npm run demo:serve
```

Open <http://localhost:3000>.

`npm run demo` builds the whole database from fixtures — the same pipeline, the same SQL and
the same renderers a live run uses — so the product works end to end with no key. Every
number it produces is fabricated, and every page says so in a banner.

---

# For end users

## What you get

Four pages, server-rendered, no login:

| Page | URL | What it answers |
|---|---|---|
| **Agenda** | `/` | What is coming for *my* names in the next 90 days, plus the board of the whole market |
| **Month** | `/month` | The whole market's month, and which stories need attention |
| **Day** | `/day?d=2026-09-21` | Everything on the record for one date |
| **Ticker** | `/ticker?s=BBCA` | One company: its events, its fitted rhythm, its history |

## Features

**The agenda**
- **Your watchlist, 90 days ahead** — set it with `?w=BBCA,BBRI,TLKM` in the URL or the
  `WATCHLIST` env var. Everything else on the page stays market-wide.
- **Three kinds of certainty, three shapes** — facts, issuer-scheduled dates, and predicted
  windows never look alike. See [How to read a chip](#how-to-read-a-chip).
- **The cluster warning** — "Three of your eight names land in the week of 21 Sep."
- **The board** — the 200 largest IDX names as one treemap, grouped into the eleven IDX
  sectors, sized by market capitalisation, coloured by the last closed session's move.
  Hover a tile for what was on the record for that company over the preceding three days —
  filings and suspensions first, then headlines, each with its date and source — or
  **"nothing on the record"**, which is most tiles. **Fullscreen** hands it to the browser's
  own fullscreen; the treemap is percentages, so it fills whatever shape it is given.
- **A price strip** — IHSG (the whole exchange) or LQ45 (the 45 most liquid names).

**The numbers the API does not return**
- **Tone, as a percentage.** Sectors tags its own news `Bullish` and `Bearish`; we count
  them into a share, per event (±3 days around its date) and per page. 60/40 or wider is a
  call, anything between is "mixed", and no tagged stories shows as nothing rather than 50%.
- **The mechanical ex-dividend drop.** `dividend ÷ last close`, with the basis and the close
  printed beside it. No close on record means no number — a percentage with no denominator is
  not a claim. The chip says the quiet part out loud: *holders are not losing 4.3%, they are
  receiving it.*
- **A fitted window for a recurring event**, from the company's own ex-dividend and
  general-meeting history, scored walk-forward — each past occurrence predicted using only
  the ones before it, so the accuracy is measurable today rather than in a year.

**Needs attention** (`/month`)
- The month's stories **threaded**, so one press release run by four sources is one row.
- Ranked by how hard a story was picked up against that name's own usual rate — and, the
  part only this product can do, whether it **lands on top of a date the issuer already
  published**: *"3 different sources in 2 days, 7 days before its general meeting."*
- Nothing here is called viral. There is no share count in the data, and pickup counts
  distinct sources, which is a floor on attention paid and never a measure of reach.

**Per ticker** (`/ticker?s=…`)
- Every event on the record, with its official source link.
- The fitted rhythm and its out-of-sample hit rate, with *n* beside it.
- **A plain-language summary and FAQ**, written by Claude from rows already in the database
  and cited by index into a list we handed it — so a link on the page can only point at a
  record we own. Needs `ANTHROPIC_API_KEY`; without it the button renders disabled.
  MOCK_MODE serves a fixture instead, so the demo needs no key.
- **Ask a question** about that company, answered from the same rows.

## How to read a chip

The only natively forward-dated field in the whole API is `upcoming_dividend`. The past is
dense and the future is sparse, so a calendar that renders both tenses the same way either
looks empty ahead or passes a guess off as a schedule.

| Class | Certainty | How it renders |
|---|---|---|
| **Fact** | It happened. Official record attached | Solid fill |
| **Scheduled** | The issuer dated it | Solid fill, cyan left rule |
| **Predicted** | We computed it from the company's own rhythm | Dashed outline, a **window** never a date, plus a confidence measured out of sample |

Three shapes, not three colours — colour alone fails colour-blind readers and fails a
compressed video.

## What it will not tell you

- **No macro events.** Sectors holds no rate, CPI or GDP data. Sourcing them elsewhere would
  make Sectors removable, and the UI must never imply macro coverage.
- **No price-reaction distributions** ("this name usually moves 7% on results") — that depends
  on an unmeasured `/v2/daily/` clamp and a whole price-window subsystem.
- **No earnings-date prediction.** See [the finding that changed the
  design](#the-finding-that-changed-the-design).
- **Not investment advice.** News is context, never causation: chips say what was published
  that day and nothing more.

---

# For developers

## Requirements

Node ≥ 20. No bundler, no framework, no webfont download, no Docker. Three runtime
dependencies: `fastify`, `better-sqlite3`, `@anthropic-ai/sdk`.

## Running against live data

Copy `.env.example` to `.env` and put a Sectors key in it, then:

```bash
npm run probes                # ~12 credits: measure the things the design depends on
npm run backfill              # 90 days of market-wide facts + the watchlist's per-ticker fill
npm run backfill -- --reports # optional, ~32 credits: the market-wide report feed
npm run backfill -- --poll    # the cheap daily shape
npm run serve                 # http://localhost:3000  (PORT overrides)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | `tsc -p .` |
| `npm test` | Builds, then runs 99 `node --test` tests |
| `npm run demo` | Builds the fixture database (`./demo`), no key, no network |
| `npm run demo:serve` | Serves that database in MOCK_MODE |
| `npm run backfill` | API responses → rows |
| `npm run probes` | Measures the API behaviours the design assumes |
| `npm run serve` | Serves the live database |

## Environment

All optional except `SECTORS_API_KEY` for live runs. Full commentary in `.env.example`.

| Variable | Effect |
|---|---|
| `SECTORS_API_KEY` | Sectors API v2 key. Required for `backfill`, `probes`, live `serve` |
| `ANTHROPIC_API_KEY` | Enables the `/ticker` summary, FAQ and ask box. Unset = disabled button |
| `FAQ_MODEL` | Which model writes them. Default `claude-sonnet-5` |
| `WATCHLIST` | Default watchlist when the URL carries no `?w=` |
| `INDEX_SYMBOL` | Overrides the price-strip default (see below) |
| `SHARED_CACHE_DIR` | Read-through to a sibling project's on-disk cache — those calls cost 0 |
| `MOCK_MODE=1` | Fixtures, no key, no network |
| `PORT` | Default 3000 |
| `FOREWARNED_HOME` | Database directory. Default `./data` |
| `FOREWARNED_TODAY` | Pins "today", for reproducible demos |

**What `WATCHLIST` scopes.** Only the per-ticker calls — corporate actions and quarterly
dates, which produce the scheduled chips and the fitted windows. Filings, suspensions and
news are market-wide range calls with no symbol filter, so the database holds facts for every
listed company; the watchlist filters the *agenda*, while `/month` and `/day` show the whole
market. That asymmetry is the credit strategy: one page of filings covers ~950 companies,
and one corporate-actions call covers one.

**Responses are cached in the database**, in `api_cache`, keyed by URL and never expiring —
so "what have we actually paid for?" is a query:

```bash
sqlite3 data/forewarned.db "SELECT fetched_at, url FROM api_cache ORDER BY fetched_at DESC LIMIT 10;"
```

## Repo map

| File | What it is |
|---|---|
| `src/predict.ts` | The derived layer: the two fits, the falsifier, the ex-dividend arithmetic |
| `src/attention.ts` | Headline threading, the nearest dated event, and the ranked "needs attention" list |
| `src/calendar.ts` | View models. Facts and scheduled rows join predicted windows here, never in the database |
| `src/backfill.ts` | API responses → rows. Market-wide ranges, then bounded per-ticker fills |
| `src/db.ts` | Tables for events, tickers, prices, the board, the FAQ cache, the response cache and the run ledger; one write path, idempotent upserts |
| `src/api.ts` | Credit ceiling, documented-cost assertion, permanent cache, MOCK_MODE |
| `src/heatmap.ts` | The board: a squarified treemap of the 200 largest IDX names |
| `src/faq.ts` | The one place a model is used: phrasing rows we already hold |
| `src/render.ts` | Server-rendered HTML |
| `src/server.ts` | The routes: agenda, month, day, ticker, and the two FAQ endpoints |
| `src/mock/fixtures.ts` | Fabricated data in the API's own response shapes |
| `demo.html` | The static design mockup the UI was built from |
| `plan.md` | The build plan, including what was deliberately left out |
| `METHODOLOGY.md` | How every number on the page is made, and what it does not claim |

## Tests

```bash
npm test
```

99 tests covering the fit, the falsifier, the walk-forward scoring, the bucketing, the
idempotent upsert, the escaping, the treemap's geometry, and a token-drift assertion that
fails if a single design-system hex value changes.

## Credits

The hackathon allowance is **1,000 per team and shared with a sibling project**, so this one
enforces its own ceiling of **275**, cumulative across runs, in `config.ts` and asserted on
every call in `api.ts`. The fixture demo spends 20 (fictional) credits for a complete database.

| Lever | Effect |
|---|---|
| Market-wide range calls over per-ticker loops | one `/v2/filings/` page covers every listed company |
| Per-ticker calls cached forever | corporate actions do not change retroactively — the second run is free |
| `SHARED_CACHE_DIR` read-through to a sibling project's cache | calls it has already paid for cost 0 here |
| The expected-drop number reuses closes the backfill already bought | the arithmetic costs nothing on top of the price strip |
| `?since=` polling on the report feed | a full sweep is ~32 pages; an incremental poll is one |
| Daily closes fetched in the backfill, never on a page view | 1 credit per name buys 90 days; browsing can never spend |
| The market-wide price strip is one index series, not 950 | 1 credit colours the default calendar for everybody |
| The board is `/v2/companies/` | sector, market cap and daily change for 200 companies in **one** call — the per-ticker alternative is 200 credits against a 275 ceiling, which is to say it would not exist |

Every run writes a row to `run` with what it spent, which is where the ceiling reads its
lifetime total from. Nothing in the served UI spends a credit except the bounded on-demand
fill for a symbol nobody has fetched yet (`FILL_ON_DEMAND`, and always on in MOCK_MODE).

---

## The finding that changed the design

`/v2/company/get_quarterly_financial_dates/` is documented as supplying `report_date` values
to feed the quarterly-financials endpoint, and its example is `2026: [["2026-03-31","q1"]]`
— a quarter **end**, not the day anybody filed. The market-wide feed is the same shape.

So there is no filing rhythm in that data to fit, and the earnings-date prediction the plan
started from has no source. Two consequences, both in the code:

- **Every report chip states it, on the chip** — *"the feed carries the period (quarter end),
  not the date this was filed"*, with the date we first saw the row, which is the only
  timing fact we actually hold. No report window is drawn anywhere in the product, and
  `predict.ts` does not have a quarterly fit to disable.
- **The rhythm fit moved to data that is verified to vary** — `corporate_actions.dividend[].ex_date`
  and `agm[].agm_date`, which carry genuinely different dates year to year. Those are the
  only two kinds `predictionsFor()` will fit, and the list is a constant you can read.

A window we cannot draw is stated, not widened. A ±3-week band dressed up as a forecast is
worse than saying nothing.

The same logic governs the price strip: which ticker Sectors' `/v2/daily/` actually answers
for IHSG or LQ45 is UNVERIFIED — `npm run probes` (Q16) measures it, and `INDEX_SYMBOL`
overrides the default. A subject that returns no rows renders as a plain grid, never as an
average of the watchlist wearing the index's name.

## Honesty rules the code enforces

1. A predicted chip never renders as a scheduled one — different shape, a window, and the
   word "predicted".
2. Every fact chip links its official record. A fact without a source is an assertion.
3. News is context, never causation: chips say what was published that day and nothing more.
4. A window we cannot draw is stated, not widened.
5. The hit rate says how it was measured, with *n* beside it.
6. **No model decides anything.** Every date, window, percentage and refusal on the page is
   computed by `predict.ts` and `calendar.ts` from rows in the database — `predict.ts` does
   not import a model and never will. Claude appears in exactly one place, the `/ticker`
   summary and FAQ, where it *phrases* rows we already hold and cites them by index into a
   list we gave it, so a link on the page can only point at a record we own. It never
   browses, never recalls, and is never the source of a number.

`METHODOLOGY.md` is one page on how each number is computed, and what none of them claim.

## Not built, deliberately

Accounts, portfolio import, notifications, Docker, any client-side framework.
