<!-- Classification: PUBLIC -->
# NewsIDX

### Know which of your IDX holdings has an event coming, before the price tells you

Most of us find out our stock had an event when we open the app and see a gap. The dividend
went ex yesterday. The general meeting was last week. Three of your names reported in the same
five days and you only noticed the one that moved.

NewsIDX is a **90 day calendar of the Indonesian stock exchange (IDX) that only shows the companies
you hold.** Built on the Sectors API v2 for Track 03, Market Intelligence.

<p align="center">
  <img src="showcase/images/01-agenda-overview.png" alt="NewsIDX agenda: Up next, Needs attention and the month calendar" width="100%">
</p>

> Every screenshot here comes from the demo build, which runs on **fixture data**. The numbers are
> made up, and each page says so in a banner.

---

## For analysts: what it does

| You want to know | NewsIDX shows |
|---|---|
| What is coming for my holdings? | **Up next**: the next event, 7 and 30 day counts, and one date-sorted table of the 90 days ahead |
| What will a dividend do to the price? | **Ex-dividend drop**: dividend over last close, with both inputs printed so you can check the sum |
| Is my month bunching up? | **Cluster warning**: *"three of your eight names land in the week of 21 Sep"* |
| What is the market saying about my names? | **Needs attention**: one press release carried by four outlets is one row, ranked by pickup against that name's usual rate |
| Does news land on a known date? | **Event collision**: *"3 sources in 2 days, 7 days before its general meeting"* |
| What did the whole exchange do? | **The board**: a heatmap of the 200 largest names by sector, plus the biggest movers over a day to a year |
| What is the story on one company? | **Company page**: its events, a price line with news and filings marked on it, and a briefing that cites its sources |

**How much to trust a date.** Every date ahead of today is one the issuer published. Nothing is
predicted. Facts and issuer-scheduled dates are drawn as two different shapes, never two colours,
and every fact links its official record. News is context, never cause.

**Your watchlist lives in the URL** (`?w=BBCA,BBRI,TLKM`). No account, no login: bookmark it or
send it to a colleague. Any day exports to Google Calendar, and **Up next** exports to CSV.

---

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="showcase/images/11-market-board.png" alt="Market board: sector heatmap and movers"><br><b>The board.</b> The 200 largest IDX names by sector, sized by market cap, coloured by the last session's move.</td>
    <td width="50%"><img src="showcase/images/03-agenda-needs-attention-why.png" alt="A ranked story with its score broken into parts"><br><b>Every ranking shows its working.</b> Open <i>Why</i> to see the parts a story's score is made of.</td>
  </tr>
  <tr>
    <td width="50%"><img src="showcase/images/16-company-price-chart.png" alt="Company price line with news and filing markers"><br><b>News and filings on the price line.</b> Hover a marker for the source.</td>
    <td width="50%"><img src="showcase/images/19b-company-briefing-generated.png" alt="Generated company briefing with cited sources"><br><b>Briefing on demand.</b> Nothing is generated until you ask, and every claim links to a record we hold.</td>
  </tr>
  <tr>
    <td width="50%"><img src="showcase/images/02-agenda-up-next-follows-date.png" alt="Up next recounted from a clicked date"><br><b>Click any date</b> and the whole outlook counts forward from it.</td>
    <td width="50%"><img src="showcase/images/21-agenda-light-theme.png" alt="Agenda in the light theme"><br><b>Dark and light themes.</b> No third-party requests, no webfont.</td>
  </tr>
</table>

Works on a phone too: see [agenda](showcase/images/23-mobile-agenda.png),
[market](showcase/images/24-mobile-market.png) and [company](showcase/images/25-mobile-company.png).
All 30 images are in [`showcase/images`](showcase/images).

---

## For developers: run it

```bash
git clone https://github.com/nanto88/NewsIDX.git
cd NewsIDX
npm install
npm run demo          # builds the whole database from fixtures
npm run demo:serve    # open http://localhost:3000
```

No API key, no network, no sign-up. The demo runs fixtures through the same pipeline, SQL and
page renderers a live run uses.

**Go live:** copy `.env.example` to `.env`, add `SECTORS_API_KEY`, then `npm run backfill` and
`npm run serve`.

| Command | What it does |
|---|---|
| `npm test` | Builds, then runs the suite with `node --test`. No key or network needed |
| `npm run demo` / `demo:serve` | Build and serve the fixture database |
| `npm run probes` | Measures the API behaviours the design depends on (about 12 credits) |
| `npm run backfill` | 90 days of market-wide facts plus the watchlist's per-ticker fill |
| `npm run serve` | Serves the live database on `PORT` (default 3000) |

### How it is built

Node 20+, TypeScript, Fastify, SQLite (`better-sqlite3`). Server-rendered HTML, no bundler, no
frontend framework.

```
Sectors API v2 -> api.ts (credit ceiling, permanent cache) -> backfill.ts
  -> SQLite -> calendar.ts / attention.ts (view models) -> render.ts / server.ts
```

Three rules hold the design together:

* **Derived values are never stored.** The database holds only what the API returned. Every
  percentage and ranking is computed on the way out.
* **No model decides anything.** Claude appears in one place, the per-company summary and FAQ,
  where it phrases rows we already hold. It is never the source of a number.
* **Credits are capped.** A hard ceiling is asserted on every API call, and each run writes what
  it spent to a ledger you can query.

### More

* [`docs/DETAILS.md`](docs/DETAILS.md): the full reference, covering configuration, the credit
  strategy, the certainty rules and every UI detail.
* [`METHODOLOGY.md`](METHODOLOGY.md): how each number is made, and what none of them claim.
* [`plan.md`](plan.md): the build plan, including what was deliberately cut.

---

## Disclaimer

**NewsIDX is research tooling. It is not investment advice.** Nothing here is a recommendation to
buy, sell or hold any security. In demo mode every number is fabricated. Verify anything that
matters against the issuer's own filing before you act on it.
