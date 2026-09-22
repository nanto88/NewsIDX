# NewsIDX

### Know which of your IDX holdings has an event coming, before the price tells you

Most of us find out our stock had an event when we open the app and see a gap. The dividend
went ex yesterday. The general meeting was last week. Three of your names reported in the same
five days and you only noticed the one that moved.

**Track 03, Market Intelligence.** Built on the Sectors API v2.

```bash
npm install && npm run demo && npm run demo:serve
```

Open <http://localhost:3000>. No API key, no network, nothing to sign up for.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Key Features](#2-key-features)
3. [Architecture](#3-architecture)
4. [Quick Setup (< 5 Minutes)](#4-quick-setup--5-minutes)
5. [CLI Usage](#5-cli-usage)
6. [Configuration](#6-configuration)
7. [Sectors API Integration](#7-sectors-api-integration)
8. [Certainty and Prediction Rules](#8-certainty-and-prediction-rules)
9. [Web Dashboard](#9-web-dashboard)
10. [Testing](#10-testing)
11. [Credit Budget and Run Ledger](#11-credit-budget-and-run-ledger)
12. [Repository Structure](#12-repository-structure)
13. [Disclaimer](#13-disclaimer)

---

## 1. Overview

NewsIDX is a 90 day calendar that only shows the companies you actually hold.

Where the issuer published a date, it shows that date. Where nobody published one, it shows a
window worked out from the company's own past behaviour, and tells you how often that method
has been right. Where the effect is arithmetic, like an ex-dividend drop, it shows the number
and the maths behind it.

The whole thing is a server-rendered site over a SQLite file. No accounts, no login, no
client-side framework. Your watchlist lives in the URL (`?w=BBCA,BBRI,TLKM`), so you can
bookmark it or send it to someone.

---

## 2. Key Features

| Feature | What it does |
|---|---|
| **Your 90 days** | A calendar scoped to your watchlist, with everything else on the page still market-wide |
| **Three certainty classes** | Facts, issuer-scheduled dates and predicted windows are drawn as three different shapes, never three colours |
| **Fitted windows** | Recurring events get a date range fitted from that company's own history, scored walk-forward so the hit rate is measurable today |
| **Ex-dividend arithmetic** | Dividend over last close, with both inputs printed beside it so you can check the sum |
| **Tone as a percentage** | Bullish and bearish news tags counted into a share, per event and per page. Nothing tagged shows nothing, not a meaningless 50% |
| **Cluster warning** | A heads-up when your month bunches: *"three of your eight names land in the week of 21 Sep"* |
| **The board (sector heatmap)** | A treemap of the 200 largest IDX names, grouped into the eleven IDX sectors, sized by market cap and coloured by the last session's move. Hover a tile for what was on the record. Opens fullscreen for a second screen |
| **Topic filter** | Multi-select, and every topic by default. Topics are OR, so a second pick shows more rather than less. Counts are computed before the filter applies, so an option never vanishes the moment you use it |
| **Google Calendar export** | Any day on the calendar exports as an all-day event carrying that day's agenda. An empty day still exports, so you can park your own reminder |
| **Price strip picker** | Price the window against IHSG, LQ45, or one company you pick. A subject with no rows renders as a plain grid, never as a fake average |
| **Watchlist editing in the page** | Add and remove names without touching the URL by hand |
| **"How we worked this out"** | Every ticker page shows the inputs behind its own numbers, inline |
| **Light and dark themes** | A toggle in the header. No third-party requests and no webfont, in either theme |
| **Worth a look** | The month's stories threaded so one press release carried by four outlets is one row, then ranked by pickup against that name's own usual rate |
| **Event collision** | Flags a story that lands on top of a date the issuer already published: *"3 sources in 2 days, 7 days before its general meeting"* |
| **Per-ticker summary and FAQ** | Claude phrases rows already in the database and cites them by position, so a link can only point at a record we own |
| **Price strip** | IHSG for the whole exchange, or LQ45 for the 45 most liquid names |
| **Credit ceiling** | A hard cap asserted on every API call, with a per-run ledger you can query |

---

## 3. Architecture

```
  Sectors API v2
        |
        v
  backfill.ts ................ market-wide range calls first,
        |                      then bounded per-ticker fills
        v
  api.ts ..................... credit ceiling, cost assertion,
        |                      permanent response cache
        v
  SQLite (data/newsidx.db) ... events, tickers, prices, board,
        |                      api_cache, run ledger
        v
  predict.ts ................. the two fits, the falsifier,
        |                      the ex-dividend arithmetic
        v
  calendar.ts / attention.ts . view models. facts and scheduled rows
        |                      meet predicted windows here, never in the db
        v
  render.ts -> server.ts ..... server-rendered HTML, four routes
```

Two rules hold this shape together:

**Derived values are never stored.** The database holds only what an API returned. Every
window, percentage and ranking is computed on the way out, so a bad fit can never poison a row.

**No model decides anything.** `predict.ts` does not import a model and never will. Claude
appears in exactly one place, section 9's summary and FAQ, where it phrases rows we already
hold. It never browses, never recalls, and is never the source of a number.

---

## 4. Quick Setup (< 5 Minutes)

### Prerequisites

* Node 20 or newer. That is the whole list.
* No bundler, no frontend framework, no webfont to download, no Docker.
* Three runtime dependencies: `fastify`, `better-sqlite3`, `@anthropic-ai/sdk`.
* A Sectors API key only if you want live data. The demo needs nothing.

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/nanto88/NewsIDX.git
cd NewsIDX

# 2. Install dependencies
npm install

# 3. Run the demo. Builds the whole database from fixtures.
#    No key, no network, no sign-up.
npm run demo

# 4. Serve it
npm run demo:serve
# open http://localhost:3000
```

`npm run demo` runs fixtures through the same pipeline, the same SQL and the same page
renderers a live run uses, so what you see is the real product. The numbers in it are made up,
and every page says so in a banner.

To go live instead, copy `.env.example` to `.env`, put a Sectors key in it, then run
`npm run backfill` followed by `npm run serve`.

---

## 5. CLI Usage

| Command | What it does |
|---|---|
| `npm run build` | `tsc -p .` |
| `npm test` | Builds, then runs 99 tests through `node --test` |
| `npm run demo` | Builds the fixture database into `./demo`. No key, no network |
| `npm run demo:serve` | Serves that database in mock mode |
| `npm run probes` | Measures the API behaviours the design depends on. About 12 credits |
| `npm run backfill` | 90 days of market-wide facts, plus the watchlist's per-ticker fill |
| `npm run backfill -- --reports` | Adds the market-wide report feed. About 32 credits |
| `npm run backfill -- --poll` | The cheap daily shape, one incremental page |
| `npm run serve` | Serves the live database on `PORT`, default 3000 |

A typical first live run:

```bash
npm run probes
npm run backfill
npm run serve
```

---

## 6. Configuration

Everything is optional except `SECTORS_API_KEY` for live runs. `.env.example` carries the
longer commentary on each one.

| Variable | Effect |
|---|---|
| `SECTORS_API_KEY` | Sectors API v2 key. Needed for `backfill`, `probes` and a live `serve` |
| `ANTHROPIC_API_KEY` | Turns on the ticker summary, FAQ and ask box. Unset leaves the button disabled |
| `FAQ_MODEL` | Which model writes them. Defaults to `claude-sonnet-5` |
| `WATCHLIST` | The default watchlist when the URL carries no `?w=` |
| `INDEX_SYMBOL` | Overrides the price strip's default subject |
| `SHARED_CACHE_DIR` | Read-through to a sibling project's cache. Anything it already bought costs 0 here |
| `MOCK_MODE=1` | Fixtures. No key, no network |
| `PORT` | Defaults to 3000 |
| `NEWSIDX_HOME` | Where the database lives. Defaults to `./data` |
| `NEWSIDX_DB` | Overrides the database path outright |
| `NEWSIDX_TODAY` | Pins what "today" means, for reproducible demos |

### What the watchlist actually scopes

Only the per-ticker calls, which means corporate actions and quarterly dates, which in turn
produce the scheduled chips and the fitted windows. Filings, suspensions and news are
market-wide range calls with no symbol filter, so the database ends up holding facts for every
listed company. The watchlist filters your *agenda*. `/month` and `/day` still show the whole
market.

That asymmetry is the whole credit strategy. One page of filings covers about 950 companies.
One corporate-actions call covers one.

---

## 7. Sectors API Integration

Every response is cached in the database itself, in `api_cache`, keyed by URL and never
expiring. So "what have we actually spent credits on" is just a query:

```bash
sqlite3 data/newsidx.db "SELECT fetched_at, url FROM api_cache ORDER BY fetched_at DESC LIMIT 10;"
```

### Why a URL cache is not enough on its own

`api_cache` keys on the exact URL, which covers the per-ticker calls completely: a corporate
action does not change retroactively, so the second run reads them for free forever.

It does nothing for the market-wide range calls, because those carry their dates in the URL.
Yesterday bought `start=D-90&end=D`. Today asks for `start=D-89&end=D+1`, which is a URL
nothing has ever seen, so all 91 days get bought again at full price. A dense window costs up
to `PAGE_CAP` (12) credits per feed, three feeds per run, against a lifetime ceiling of 275.
Roughly eight daily runs would have spent the entire project allowance on days already sitting
in the database.

So a `coverage` table records the date span each feed has actually been fetched for, and a run
asks only for what is missing:

```bash
sqlite3 data/newsidx.db "SELECT feed, covered_from, covered_to FROM coverage;"
```

Two deliberate choices in that logic, both in `missingSpans()` and both tested:

* **The last covered day is always re-fetched, never skipped.** A feed is still filling on its
  own final day, so treating it as finished would leave a permanent hole in whatever got
  published after the run. One extra day per run is the price of not having one.
* **A requested window disjoint from what is covered is fetched whole.** Fetching just the two
  ends and recording the union would claim the middle without ever having asked for it.

The same applies to `--reports`, which is the expensive feed at roughly 32 pages for the full
universe. It resumes from the last covered date rather than from a `since` that moves with the
clock, so only the first sweep pays for the sweep.

### The finding that changed the design

We started out intending to predict earnings dates. Then we read the endpoint properly.

`/v2/company/get_quarterly_financial_dates/` is documented as supplying `report_date` values to
feed the quarterly-financials endpoint, and its own example is `2026: [["2026-03-31","q1"]]`.
That is a quarter *end*, not the day anybody filed anything. The market-wide feed has the same
shape.

So there is no filing rhythm in that data to fit, and the earnings prediction we had planned
had no source underneath it. Two things follow, and both are in the code:

* **Every report chip says so, on the chip.** "The feed carries the period (quarter end), not
  the date this was filed", along with the date we first saw the row, which is the only timing
  fact we genuinely hold. No report window is drawn anywhere in the product, and `predict.ts`
  does not have a quarterly fit sitting there switched off.
* **The rhythm fit moved to data we verified does vary.** `corporate_actions.dividend[].ex_date`
  and `agm[].agm_date` carry genuinely different dates year to year. Those two are the only
  kinds `predictionsFor()` will fit, and that list is a constant you can go and read.

### The unverified index ticker

Which ticker Sectors' `/v2/daily/` actually answers for IHSG or LQ45 is unverified.
`npm run probes` (Q16) measures it, and `INDEX_SYMBOL` overrides the default. A subject that
returns no rows renders as a plain grid, never as an average of your watchlist wearing the
index's name.

---

## 8. Certainty and Prediction Rules

The Sectors API has exactly one field that natively points forward: `upcoming_dividend`. The
past is dense, the future is thin. A calendar that draws both the same way either looks empty
ahead of today, or quietly passes off a guess as a schedule. So we draw three shapes.

| Class | How sure we are | How it looks |
|---|---|---|
| **Fact** | It happened, and the official record is attached | Solid fill |
| **Scheduled** | The issuer published this date | Solid fill with a cyan rule down the left |
| **Predicted** | We worked it out from the company's own rhythm | Dashed outline, always a window and never a single date, with a confidence measured out of sample |

Shapes rather than colours, because colour on its own fails colour-blind readers, and it also
fails on a compressed video.

### Rules the code keeps

1. A predicted chip never renders like a scheduled one. Different shape, a window, and the word
   "predicted" on it.
2. Every fact chip links its official record. A fact without a source is just an assertion.
3. News is context, never cause. Chips say what was published that day, and nothing more.
4. A window we cannot draw gets stated, not widened. A three-week band dressed up as a forecast
   is worse than saying nothing.
5. The hit rate always says how it was measured, with the sample size beside it.
6. No model decides anything. See [Architecture](#3-architecture).

### How the Topic filter selects

Nothing picked means every topic. That is the default, and a filter nobody has touched must
not hide anything. The bar says so rather than leaving you to infer it: with nothing picked it
carries an **All N tags on record** pill in the product accent, the same affordance the
companies bar above it uses for **All companies**. A row of grey chips on its own reads as
"nothing is on" when in fact nothing is being hidden.

So the bar has three states, and they never look alike:

| State | How it reads |
|---|---|
| Nothing picked (the default) | The accent-washed **All N tags on record** pill, every chip grey and available |
| One or more picked | Those chips turn orange with a tick, and a **Clear all** appears. The all-pill goes away |
| A chip you have not picked | Grey, and clicking it adds it to the selection rather than replacing it |

Orange means the page is showing you less than it has, and it is used for nothing else.

Picking several is OR, not AND. Ticking a second topic widens the page, which is what a reader
means by ticking a second box, and it stops the filter emptying itself on the many pairs that
never co-occur: one story is rarely both a dividend and a suspension. The selection travels as
a comma-separated `?tag=`, capped at 12 topics, and each one is matched case-insensitively as
a substring of the row's own tags, so a picked chip and something typed by hand are one code
path.

### How a window is scored

Fitted from the company's own ex-dividend and general-meeting history, then scored
walk-forward, which means every past occurrence was predicted using only the ones before it.
That is why we can tell you the hit rate today instead of asking you to wait a year to find out.

`METHODOLOGY.md` is a single page on how each number is made, and what none of them claim.

---

## 9. Web Dashboard

```bash
npm run demo:serve
# open http://localhost:3000
```

| Page | URL | What it answers |
|---|---|---|
| **Agenda** | `/` | What is coming for *my* names in the next 90 days, plus a board of the whole market |
| **Month** | `/month` | The market's whole month, and which stories are worth a look |
| **Day** | `/day?d=2026-09-21` | Everything on the record for one date |
| **Ticker** | `/ticker?s=BBCA` | One company: its events, its rhythm, its history |

**The board** sits on the agenda page: the 200 biggest IDX companies as one treemap, grouped by
sector, sized by market cap, coloured by the last session's move. Hover any tile and you get
what was on the record for that company over the past three days, filings and suspensions
first, then headlines, each with a date and a source. Most tiles say "nothing on the record",
because most days most companies do nothing, and we would rather say that than leave a blank.
There is a fullscreen button if you want it on a second screen.

**Worth a look** sits on `/month`. Stories get threaded, so one press release carried by four
outlets is one row and not four. Then ranked by how hard it was picked up compared to that
company's own usual rate, and whether it lands on top of a date the issuer already published.
We never call anything viral. There are no share counts in this data, and counting distinct
sources tells you the floor on attention paid, never the reach.

**The ticker page** carries every event we hold with its official record linked, the fitted
rhythm and its hit rate, a plain-language summary and FAQ, and an ask box for questions about
that company. The summary needs `ANTHROPIC_API_KEY`; without one the button is simply
disabled, and the demo serves a fixture so it works with no key.

**The layout.** Below 1200px the agenda is one column, in the order it reads. Above it the
shell widens to 1340px and the four blocks move into two tracks: the board beside what needs
attention, the month grid beside the headlines. Placement is grid-area on top of the original
DOM order, so a screen reader and the tab key still get board, attention, month, headlines
whatever the width. A day and a company page stay a 780px reading column, because prose set
1300px wide is harder to read, not easier.

**On every page**: a multi-select topic filter that defaults to every topic, a
price strip you can point at IHSG, LQ45 or a single company, a watchlist you can edit in place,
a light and dark theme toggle, and a Google Calendar export on each day cell that carries that
day's agenda as an all-day event.

Nothing in the served UI can spend a credit, except the bounded on-demand fill for a symbol
nobody has fetched before (`FILL_ON_DEMAND`, always on in mock mode).

---

## 10. Testing

```bash
npm test
```

99 tests through `node --test`, covering the fit, the falsifier, the walk-forward scoring, the
bucketing, the idempotent upsert, HTML escaping, the treemap geometry, and one assertion that
fails if a single design-system hex value drifts.

No key and no network needed. The suite builds first, so it also serves as the typecheck.

---

## 11. Credit Budget and Run Ledger

The hackathon allowance is 1,000 per team, shared with a sibling project, so this one holds
itself to 275 across all runs. The ceiling lives in `config.ts` and is asserted on every call in
`api.ts`. The fixture demo spends 22 imaginary credits and builds a complete database.

| What we do | Why it is cheap |
|---|---|
| Market-wide range calls instead of per-ticker loops | one `/v2/filings/` page covers every listed company |
| Per-ticker calls cached forever | corporate actions do not change retroactively, so the second run is free |
| Range calls buy only the days not already covered | the dates live in the URL, so a rolling window would otherwise re-buy all 90 days daily. A repeat run asks for the tail day and stops |
| `SHARED_CACHE_DIR` reads a sibling project's cache | anything it already bought costs nothing here |
| The expected-drop number reuses closes the backfill already bought | the arithmetic is free on top of the price strip |
| `?since=` polling on the report feed | a full sweep is about 32 pages, an incremental poll is one |
| Closes fetched during backfill, never on a page view | 1 credit per name buys 90 days, and browsing can never spend |
| One index series for the price strip, not 950 tickers | 1 credit colours the default calendar for everyone |
| The board is a single `/v2/companies/` call | sector, market cap and daily change for 200 companies at once. Per-ticker it would be 200 credits against a 275 ceiling, which is to say it would not exist |

Every run writes what it spent to the `run` table, and that is where the ceiling reads its
lifetime total from:

```bash
sqlite3 data/newsidx.db "SELECT started_at, kind, credits FROM run ORDER BY started_at DESC;"
```

---

## 12. Repository Structure

```
NewsIDX/
├── src/
│   ├── api.ts .............. credit ceiling, cost assertion, permanent cache, mock mode
│   ├── backfill.ts ......... API responses into rows. Ranges first, then bounded fills
│   ├── db.ts ............... every table, one write path, idempotent upserts
│   ├── predict.ts .......... the two fits, the falsifier, the ex-dividend arithmetic
│   ├── attention.ts ........ threading headlines, nearest dated event, the ranked list
│   ├── calendar.ts ......... view models. Facts and windows meet here, never in the db
│   ├── heatmap.ts .......... the board, a squarified treemap of the 200 largest names
│   ├── faq.ts .............. the one place a model is involved
│   ├── render.ts ........... server-rendered HTML
│   ├── server.ts ........... the routes: agenda, month, day, ticker, two FAQ endpoints
│   ├── config.ts ........... env, paths, the credit ceiling, the design tokens
│   ├── cache.ts, dates.ts, stats.ts
│   ├── *.test.ts ........... 99 tests
│   └── mock/fixtures.ts .... made-up data in the API's own response shapes
├── scripts/
│   ├── backfill-run.ts ..... the backfill entry point
│   ├── demo.ts ............. builds the fixture database
│   └── probes.ts ........... measures the API behaviours the design assumes
├── demo.html ............... the static mockup the UI was built from
├── METHODOLOGY.md .......... how every number is made, and what none of them claim
├── plan.md ................. the build plan, including what got deliberately cut
└── .env.example
```

---

## 13. Disclaimer

**NewsIDX is research tooling. It is not investment advice.**

* Nothing here is a recommendation to buy, sell or hold any security.
* Predicted windows are computed from a company's own past behaviour. They are estimates with a
  published error rate, not schedules, and the product draws them differently for that reason.
* News is context, never cause. A chip tells you what was published on a date and stops there.
* No macro coverage. Sectors holds no rate, CPI or GDP data, and the UI never implies otherwise.
* Run in demo mode, every number on every page is fabricated, and each page says so in a banner.
* Verify anything that matters against the issuer's own filing before you act on it.
