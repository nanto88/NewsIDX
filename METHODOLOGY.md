**INTERNAL** — NewsIDX. Research tooling, not investment advice.

# How every number on the page is made

Five numbers, one rule each. None of them is produced by a language model, and none of them
is a price forecast. (Claude writes the prose summary and FAQ on `/ticker`, from rows this
database already holds and citing them; it computes nothing on this page.)

---

## 1. Tone — bullish or bearish, as a percentage

**What it says:** "80% bullish · 12 of 15 tagged" over the last 14 days.

Sectors puts `Bullish` and `Bearish` tags on its own news rows. We count them:

```
bullish share = bullish tags ÷ (bullish tags + bearish tags)
```

- **Bullish** at 60% or more, **bearish** at 40% or less, **mixed** in between. A 55/45
  split is not a mood.
- Stories with neither tag do not vote. No tagged stories at all shows as "no tagged
  coverage" — never as 50%.
- On an event chip, the window is that company's news **±3 days around the event date**.
  On a page header it is the whole period shown.

**What it is not.** It describes *coverage*, not a price, and not a cause. Bullish coverage
before an ex-dividend date does not predict the ex-dividend drop, and the code never
combines the two. The labels are Sectors', not ours, and the UI says so.

Code: `tone()` and `attachTone()` in `src/calendar.ts`.

## 2. The ex-dividend drop — arithmetic, not opinion

**What it says:** "IDR 168 per share · expected drop −4.3%".

```
expected drop = − dividend per share ÷ last close on or before today
```

No close on record means **no number shown**. The obvious fallback — the issuer's own
`dividend_yield` — is an *annual* figure and this is *one* payment, so quoting it here would
answer a different question in the same sentence.

That is the mechanical effect of the dividend leaving the share price on the ex-date. It is
the one number on the page with no statistics in it at all. The chip says the part people
get wrong out loud: *holders are not losing 4.3%, they are receiving it.*

The basis and the close itself are printed beside the percentage: a number is only checkable
if its denominator is on the page.

Code: `expectedDrop()` in `src/dividend.ts`.

## 3. The event cluster

**What it says:** "3 of your 8 names land in the week of 21 Sep."

Group the dated events ahead by ISO week; report a week holding **three or more distinct
companies** from the watchlist. Two is a coincidence.

Code: `clusterOf()` in `src/calendar.ts`.

## 4. No predicted dates

Every date ahead of today on the page is one the issuer published. Nothing is fitted from a
company's history.

We tried: an annual-rhythm fit for ex-dividend dates and general meetings, scored
walk-forward. On real data it drew 2 windows across 332 companies (only 4 had enough
corporate-action history), at 5 of 8 out of sample. Too little reach for a third chip shape,
so it was removed.

Earnings dates were never a candidate. `get_quarterly_financial_dates` looks like a history
of filing dates, but the values are **period keys** — each date is its own quarter end
(`2026-03-31` for Q1). Measured on live data across 7 years of BBCA history: every lag
between a returned date and its quarter end was **zero**. Every report chip carries the
reason in its own text — *"the feed carries the period (quarter end), not the date this was
filed"* — with the date we first saw the row, which is the only timing fact we hold about it.

## 5. The daily close on the calendar

**What it says:** `6,600 +1.9%` on a green cell, `6,700 −1.1%` on a red one.

A close needs a subject. Filtered to one company that is the company; market-wide it is the
composite, and only when `INDEX_SYMBOL` names a ticker that was **measured** to return rows
from `/v2/daily/` (probe Q16 — Sectors v2 documents no index endpoint, so which ticker works
is unverified until the probe answers). Unset, the market-wide grid stays uncoloured. It is
never an average of whatever names happen to be in the database: that is a different number
wearing the index's name. Closes come from `/v2/daily/{symbol}/`, one credit for up to 90 days.

```
change = close ÷ previous trading day's close − 1
```

Colour is direction. **Tint depth is size**, in three bands: under 1%, 1–3%, and 3% or more.
Three and not more, because a finer gradient is a heat map nobody can read at a glance. The
composite is banded at **0.3% and 1%** instead (`INDEX_BANDS`): a weighted average of ~950
names does not move like one of them, and reusing the equity bands would paint every index
day the faintest tint. A day
that closed unchanged gets no colour, and a day with no close stays blank — IDX does not
trade weekends, and an empty Saturday is information.

The price strip sits beside the event chips and is never joined to them. A green day next to
an insider filing is two facts on one date, not a cause and an effect.

*Measured, not assumed:* the spec says wider ranges are "clamped to the most recent 90 days",
which would have meant only the trailing quarter could ever be coloured. A live call with
`start=2026-06-01&end=2026-06-30` returned 20 rows dated 2–30 June, so a historical month can
be priced for one credit.

## 6. Headline threads — one story, however many sources ran it

**What it says:** *"3 different sources in 2 days"*, with the three headlines behind a disclosure.

Two headlines are the same story when they name the same subject and their titles overlap.
The subject is `event.symbol` (`''` for market-wide news). The overlap is Jaccard on the
title's words, lowercased, punctuation dropped, stopwords dropped, **and the ticker dropped** —
every headline about a company names it, so leaving it in merges that company's unrelated
stories.

```
similar(a,b) = |tokens(a) ∩ tokens(b)| ÷ |tokens(a) ∪ tokens(b)|   ≥ THREAD_SIMILARITY (0.40)
```

Grouping is **single-link**: a headline joins a story if it is close enough to any member, not
just the first one seen, and it is computed with union-find so the result does not depend on
the order a paged feed returned the rows in. Two similar headlines more than `THREAD_SPAN_DAYS`
(5) apart are **not** merged — *"vehicle sales slip for a second month"* twice, sixty days
apart, is a recurring theme rather than one story being picked up.

0.40 is not a knife edge: grouping is stable anywhere between 0.25 and 0.45, and only starts
splitting genuine duplicate coverage above 0.50.

**Sources** is the count of distinct source hosts — different publishers, not different
headlines, so one newsroom filing twice counts once. A row with no source URL counts as its own
source rather than silently collapsing into another.

**What it does not claim.** Same subject and overlapping wording is not a verified same-event
claim. Every member keeps its own date, tags and source link, and the bullish/bearish counts
stay **per headline** — five sources on one bullish story is five bullish rows, and collapsing
them would reweight the tone split in §1.

Code: `threadsOf()` in `src/attention.ts`.

## 7. Needs attention — which stories to look at first

**What it says:** a ranked list above the month's headlines, each row carrying the facts that
put it there.

### The floor

A story appears only if **two or more sources carried it**, or it **lands within
`ATTENTION_NEAR_DAYS` (14) of a dated event**. Without that floor the list quietly becomes
"your watchlist, in date order", which is what the agenda page already is.

### Near a dated event

For a story ending on date *d* and a company *S*, the nearest event at or after *d* and within
14 days. Only **scheduled** rows count: a date the issuer published, from `event`.

### The components

Each is a count, a ratio of counts, or a difference between two dates. Each is clamped to
0–1, multiplied by its weight in `ATTENTION_WEIGHTS`, and **printed on the row it ranks**.

| Component | How | Weight |
|---|---|---|
| `pickup` | sources ÷ this name's own usual, over the trailing `ATTENTION_BASELINE_DAYS` (90) | 3 |
| `event` | `1 − days ÷ 14` to the nearest dated event | 3 |
| `speed` | sources ÷ days the story ran | 2 |
| `held` | the name is in the watchlist | 2 |
| `split` | the sources carry both Bullish and Bearish | 1.5 |
| `move` | the name's own close change on the story's busiest day | 1.5 |
| `fresh` | `1 − age ÷ 21` days | 1.5 |

`pickup` needs a baseline of at least `ATTENTION_MIN_BASELINE` (2) past stories for that name.
Below that the rate is **not quoted and contributes nothing** — two stories is not a baseline,
and a flattering default would be worse than silence.

**The score is a sort order, not a claim.** The weights are a judgement, which is exactly why
every row shows its own decomposition and why the components sum visibly to the total. An
opaque number nobody can take apart is the thing the honesty rules guard against; the
weighting itself is not.

### What it cannot tell you

- **Reach.** Five sources is five sources, not five hundred thousand readers. There is no
  share count, view count or social signal anywhere in the data, and nothing on the page says
  "viral".
- **Importance.** A syndicated press release is picked up hard by design. Pickup measures
  attention paid, not consequence.
- **Causation.** A price move shown beside a story is same-day co-occurrence, printed as such.
- **Completeness.** Only sources carried by `/v2/news/` are counted, so pickup is a floor and
  never a total.

Code: `needsAttention()` and `nearestEvent()` in `src/attention.ts`.

## The two classes on a chip

| Class | Means | Shape |
|---|---|---|
| **Fact** | It happened; official record linked | Solid |
| **Scheduled** | The issuer published the date | Solid, cyan left rule |

Two shapes, not two colours — colour alone fails colour-blind readers and a compressed
video.

## What this product will not do

- Say **why** a price moved. News is context; `/v2/news/` carries no causal claim.
- Show a date ahead of today that the issuer did not publish.
- Report a percentage without the count behind it.
- Imply coverage of macroeconomic events. Sectors holds no rate, CPI or GDP data, and the
  UI never suggests otherwise.
- Call anything viral, trending or widely read. Pickup is sources in one feed, and that is
  all the page ever claims it is.
