**PUBLIC**. NewsIDX is research tooling, not investment advice.

# NewsIDX

### Know which of your IDX holdings has an event coming, before the price tells you

Most of us find out our stock had an event when we open the app and see a gap. The dividend
went ex yesterday. The general meeting was last week. Three of your names reported in the
same five days and you only noticed the one that moved.

NewsIDX is a calendar for the next 90 days that only shows the companies you actually
hold. Where the issuer published a date, it shows that date. Where nobody published one, it
shows a window it worked out from the company's own past behaviour, and tells you how often
that method has been right. Where the effect is arithmetic, like an ex-dividend drop, it
shows the number and the maths behind it.

**Track 03, Market Intelligence.** Built on the Sectors API v2.

---

## Try it in one line

```bash
npm install && npm run demo && npm run demo:serve
```

Open <http://localhost:3000>.

No API key, no network, nothing to sign up for. `npm run demo` builds the entire database
from fixtures and runs it through the same pipeline, the same SQL and the same page
renderers a live run uses, so what you see is the real product. The numbers in it are made
up, and every page says so in a banner.

---

# If you just want to use it

## The four pages

| Page | URL | What it answers |
|---|---|---|
| **Agenda** | `/` | What's coming for *my* names in the next 90 days, plus a board of the whole market |
| **Month** | `/month` | The market's whole month, and which stories are worth a look |
| **Day** | `/day?d=2026-09-21` | Everything on the record for one date |
| **Ticker** | `/ticker?s=BBCA` | One company: its events, its rhythm, its history |

No login, no accounts. Your watchlist lives in the URL (`?w=BBCA,BBRI,TLKM`), so you can
bookmark it or send it to someone.

## What it does

**Your 90 days, at a glance**

* Only your names. Set the watchlist in the URL or with the `WATCHLIST` env var. Everything
  else on the page stays market-wide, so you don't lose sight of the rest.
* Three kinds of certainty, drawn three different ways, so you never mistake a guess for a
  schedule. See [how to read a chip](#how-to-read-a-chip) below.
* A heads-up when your month bunches: *"three of your eight names land in the week of 21 Sep."*
* A board of the 200 biggest IDX companies as one treemap, grouped by sector, sized by market
  cap and coloured by the last session's move. Hover any tile and you get what was on the
  record for that company over the past three days: filings and suspensions first, then
  headlines, each with a date and a source. Most tiles say **"nothing on the record"**,
  because most days most companies do nothing, and we'd rather say that than leave a blank.
  There's a fullscreen button if you want it on a second screen.
* A price strip along the top, either IHSG for the whole exchange or LQ45 for the 45 most
  liquid names.

**Numbers the API doesn't give you, that we work out**

* **Tone, as a percentage.** Sectors tags its own news bullish or bearish. We count those
  tags into a share, both around a single event (three days either side) and across a page.
  60/40 or wider counts as a call. Anything narrower is "mixed". If nothing was tagged we
  show nothing at all, rather than a meaningless 50%.
* **The ex-dividend drop.** Dividend divided by the last close, with both the dividend and
  the close printed right next to it so you can check the sum. If we have no close on record
  we show no number, because a percentage without a denominator isn't a claim. And the chip
  says the thing people get wrong out loud: you are not losing 4.3%, you are receiving it.
* **A window for events that repeat.** Fitted from the company's own ex-dividend and general
  meeting history, then scored walk-forward, which means every past occurrence was predicted
  using only the ones before it. That's why we can tell you the hit rate today instead of
  asking you to wait a year to find out.

**Worth a look** (on `/month`)

* Stories get threaded, so one press release carried by four outlets is one row and not four.
* Then ranked by how hard it was picked up compared to that company's own usual rate, and,
  the bit nothing else does, whether it lands on top of a date the issuer already published.
  *"3 different sources in 2 days, 7 days before its general meeting."*
* We never call anything viral. There are no share counts in this data, and counting distinct
  sources tells you the floor on attention paid, never the reach.

**One company at a time** (`/ticker?s=...`)

* Every event we hold, each linked to its official record.
* The fitted rhythm and how often it has been right, with the sample size next to it.
* A plain-language summary and FAQ. Claude writes these from rows already in our database and
  cites them by position in a list we hand it, so a link on the page can only ever point at a
  record we own. Needs `ANTHROPIC_API_KEY`; without one the button is simply disabled. The
  demo serves a fixture, so it works with no key.
* An ask box for questions about that company, answered from the same rows.

## How to read a chip

The Sectors API has exactly one field that natively points forward: `upcoming_dividend`. The
past is dense, the future is thin. A calendar that draws both the same way either looks empty
ahead of today, or quietly passes off a guess as a schedule. So we draw three shapes.

| What it is | How sure we are | How it looks |
|---|---|---|
| **Fact** | It happened, and the official record is attached | Solid fill |
| **Scheduled** | The issuer published this date | Solid fill with a cyan rule down the left |
| **Predicted** | We worked it out from the company's own rhythm | Dashed outline, always a window and never a single date, with a confidence measured out of sample |

Shapes rather than colours, because colour on its own fails colour-blind readers, and it also
fails on a compressed video.

## What it won't tell you

* **Nothing macro.** Sectors holds no rate, CPI or GDP data, and pulling that from somewhere
  else would make Sectors removable from this product. So the UI never hints at macro coverage.
* **No "this name usually moves 7% on results".** That needs a price-window subsystem and an
  API limit we haven't measured.
* **No earnings-date prediction.** There's a good reason, and it's [further down](#the-thing-that-changed-the-design).
* **Not advice.** News here is context, never cause. A chip tells you what was published that
  day and stops there.

---

# If you want to run or change it

## What you need

Node 20 or newer. That's it. No bundler, no frontend framework, no webfont to download, no
Docker. Three runtime dependencies: `fastify`, `better-sqlite3` and `@anthropic-ai/sdk`.

## Running against live data

Copy `.env.example` to `.env`, put a Sectors key in it, then:

```bash
npm run probes                # ~12 credits, measures the API behaviours the design assumes
npm run backfill              # 90 days of market-wide facts, plus the watchlist's per-ticker fill
npm run backfill -- --reports # optional, ~32 credits, the market-wide report feed
npm run backfill -- --poll    # the cheap daily shape
npm run serve                 # http://localhost:3000, or set PORT
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | `tsc -p .` |
| `npm test` | Builds, then runs 99 tests through `node --test` |
| `npm run demo` | Builds the fixture database into `./demo`. No key, no network |
| `npm run demo:serve` | Serves that database in mock mode |
| `npm run backfill` | Turns API responses into rows |
| `npm run probes` | Measures the API behaviours the design depends on |
| `npm run serve` | Serves the live database |

## Environment

Everything is optional except `SECTORS_API_KEY` for live runs. `.env.example` has the longer
commentary on each one.

| Variable | Effect |
|---|---|
| `SECTORS_API_KEY` | Sectors API v2 key. Needed for `backfill`, `probes` and a live `serve` |
| `ANTHROPIC_API_KEY` | Turns on the ticker summary, FAQ and ask box. Leave it unset and the button is disabled |
| `FAQ_MODEL` | Which model writes them. Defaults to `claude-sonnet-5` |
| `WATCHLIST` | The default watchlist when the URL has no `?w=` |
| `INDEX_SYMBOL` | Overrides the price strip's default subject |
| `SHARED_CACHE_DIR` | Read-through to a sibling project's cache. Anything it already paid for costs 0 here |
| `MOCK_MODE=1` | Fixtures. No key, no network |
| `PORT` | Defaults to 3000 |
| `NEWSIDX_HOME` | Where the database lives. Defaults to `./data` |
| `NEWSIDX_TODAY` | Pins what "today" means, for reproducible demos |

### What the watchlist actually scopes

Only the per-ticker calls, which means corporate actions and quarterly dates, which in turn
produce the scheduled chips and the fitted windows. Filings, suspensions and news are
market-wide range calls with no symbol filter, so the database ends up holding facts for
every listed company. The watchlist filters your *agenda*; `/month` and `/day` still show the
whole market.

That asymmetry is the whole credit strategy. One page of filings covers about 950 companies.
One corporate-actions call covers one.

### Seeing what you've paid for

Responses are cached in the database itself, in `api_cache`, keyed by URL and never expiring.
So the question "what have we actually spent credits on?" is just a query:

```bash
sqlite3 data/newsidx.db "SELECT fetched_at, url FROM api_cache ORDER BY fetched_at DESC LIMIT 10;"
```

## Where things live

| File | What it is |
|---|---|
| `src/predict.ts` | The derived layer: the two fits, the falsifier, the ex-dividend arithmetic |
| `src/attention.ts` | Threading headlines, finding the nearest dated event, ranking what's worth a look |
| `src/calendar.ts` | View models. Facts and scheduled rows meet predicted windows here, never in the database |
| `src/backfill.ts` | API responses into rows. Market-wide ranges first, then bounded per-ticker fills |
| `src/db.ts` | Tables for events, tickers, prices, the board, the FAQ cache, the response cache and the run ledger. One write path, idempotent upserts |
| `src/api.ts` | The credit ceiling, the documented-cost assertion, the permanent cache, mock mode |
| `src/heatmap.ts` | The board: a squarified treemap of the 200 largest IDX names |
| `src/faq.ts` | The one place a model is involved, phrasing rows we already hold |
| `src/render.ts` | Server-rendered HTML |
| `src/server.ts` | The routes: agenda, month, day, ticker, and the two FAQ endpoints |
| `src/mock/fixtures.ts` | Made-up data in the API's own response shapes |
| `demo.html` | The static mockup the UI was built from |
| `plan.md` | The build plan, including what got deliberately cut |
| `METHODOLOGY.md` | How every number on the page is made, and what none of them claim |

## Tests

```bash
npm test
```

99 of them, covering the fit, the falsifier, the walk-forward scoring, the bucketing, the
idempotent upsert, HTML escaping, the treemap geometry, and one assertion that fails if a
single design-system hex value drifts.

## About the credits

The hackathon allowance is 1,000 per team, shared with a sibling project, so this one holds
itself to 275 across all runs. The ceiling lives in `config.ts` and gets asserted on every
call in `api.ts`. The fixture demo spends 22 imaginary credits and builds a complete database.

| What we do | Why it's cheap |
|---|---|
| Market-wide range calls instead of per-ticker loops | one `/v2/filings/` page covers every listed company |
| Per-ticker calls cached forever | corporate actions don't change retroactively, so the second run is free |
| `SHARED_CACHE_DIR` reads a sibling project's cache | anything it already bought costs nothing here |
| The expected-drop number reuses closes the backfill already bought | the arithmetic is free on top of the price strip |
| `?since=` polling on the report feed | a full sweep is ~32 pages, an incremental poll is one |
| Closes fetched during backfill, never on a page view | 1 credit per name buys 90 days, and browsing can never spend |
| One index series for the price strip, not 950 tickers | 1 credit colours the default calendar for everyone |
| The board is a single `/v2/companies/` call | sector, market cap and daily change for 200 companies at once. Per-ticker it would be 200 credits against a 275 ceiling, which is to say it wouldn't exist |

Every run writes what it spent to the `run` table, and that's where the ceiling reads its
lifetime total from. Nothing in the served UI can spend a credit, except the bounded
on-demand fill for a symbol nobody has fetched before (`FILL_ON_DEMAND`, always on in mock mode).

---

## The thing that changed the design

We started out intending to predict earnings dates. Then we read the endpoint properly.

`/v2/company/get_quarterly_financial_dates/` is documented as supplying `report_date` values
to feed the quarterly-financials endpoint, and its own example is `2026: [["2026-03-31","q1"]]`.
That's a quarter *end*, not the day anybody filed anything. The market-wide feed has the same
shape.

Which means there is no filing rhythm in that data to fit, and the earnings prediction we'd
planned had no source underneath it. Two things follow, and both are in the code:

* **Every report chip says so, on the chip.** "The feed carries the period (quarter end), not
  the date this was filed", along with the date we first saw the row, which is the only
  timing fact we genuinely hold. No report window is drawn anywhere in the product, and
  `predict.ts` doesn't have a quarterly fit sitting there switched off.
* **The rhythm fit moved to data we verified does vary.** `corporate_actions.dividend[].ex_date`
  and `agm[].agm_date` carry genuinely different dates year to year. Those two are the only
  kinds `predictionsFor()` will fit, and that list is a constant you can go and read.

A window we can't draw gets stated, not widened. A three-week band dressed up as a forecast
is worse than saying nothing.

The price strip follows the same rule. Which ticker Sectors' `/v2/daily/` actually answers for
IHSG or LQ45 is unverified. `npm run probes` (Q16) measures it, and `INDEX_SYMBOL` overrides
the default. A subject that returns no rows renders as a plain grid, never as an average of
your watchlist wearing the index's name.

## Rules the code keeps

1. A predicted chip never renders like a scheduled one. Different shape, a window, and the
   word "predicted" on it.
2. Every fact chip links its official record. A fact without a source is just an assertion.
3. News is context, never cause. Chips say what was published that day, and nothing more.
4. A window we can't draw gets stated, not widened.
5. The hit rate always says how it was measured, with the sample size beside it.
6. **No model decides anything.** Every date, window, percentage and refusal on the page is
   computed by `predict.ts` and `calendar.ts` from rows in the database. `predict.ts` does not
   import a model and never will. Claude shows up in exactly one place, the ticker summary and
   FAQ, where it phrases rows we already hold and cites them by index into a list we handed
   it. It never browses, never recalls, and is never the source of a number.

`METHODOLOGY.md` is a single page on how each number is made, and what none of them claim.

## Deliberately not built

Accounts, portfolio import, notifications, Docker, any client-side framework.
