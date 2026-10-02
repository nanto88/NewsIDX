/**
 * The token-drift test. plan.md §4: the UI cannot silently drift because the
 * hex values are asserted one by one against ../sentry_fin/design-system.html.
 *
 * The tokens are asserted against a literal list here rather than by parsing
 * the sibling repo, because the submitted repo is standalone -- a test that
 * reads a path outside it would pass on this laptop and fail for a judge.
 */
import assert from "node:assert/strict";

import { test } from "node:test";
import { EQUITY_BANDS, INDEX_BANDS } from "./config.js";
import { chip, domainOf, filterBar, renderDay, renderMarket, upNext, upNextCsv, esc, gcalUrl, page, paginate, pct, priceBand, renderBoard, renderMonth, renderMovers, renderTicker, sentClass, STYLE, tagPhrase } from "./render.js";
import type { Cell, Item } from "./calendar.js";
import type { Board, Mover, Movers, Tile } from "./heatmap.js";

/** An empty ranking: these tests are about the month chrome, and a populated
 * list would make every assertion below depend on the ranking's own fixtures. */
const INDICES = [
  { symbol: "IHSG", label: "IHSG · whole exchange" },
  { symbol: "LQ45", label: "LQ45 · 45 most liquid" },
];
const NO_ATTENTION = { from: "2026-09-01", to: "2026-09-11", rows: [], considered: 0, baselineFrom: "2026-06-03" };

const TOKENS: [string, string][] = [
  ["--bg", "#0a0908"],
  ["--surface", "#131211"],
  ["--surface-2", "#191816"],
  ["--surface-3", "#211f1c"],
  ["--border", "#26241f"],
  ["--border-strong", "#332f28"],
  ["--text", "#f3f1ed"],
  ["--text-muted", "#a29d93"],
  ["--text-faint", "#6b665e"],
  ["--primary", "#22d3ff"],
  ["--up", "#2AB673"],
  ["--down", "#e5484d"],
];

test("every design-system token is present with its exact value", () => {
  for (const [name, value] of TOKENS) {
    assert.ok(STYLE.includes(`${name}:${value}`), `${name} drifted from ${value}`);
  }
});

test("both themes are defined, and the light one is reachable without a toggle", () => {
  assert.ok(STYLE.includes(':root[data-theme="light"]'), "explicit light theme");
  assert.ok(STYLE.includes("prefers-color-scheme: light"), "system light theme");
  assert.ok(STYLE.includes("prefers-reduced-motion"), "reduced motion honoured");
});

const factItem: Item = {
  cls: "fact",
  kind: "filing",
  symbol: "ASII",
  date: "2026-09-11",
  title: "Director sells 400,000 shares",
  detail: "Fixture Holder · sell",
  sourceUrl: "https://idx.invalid/record",
};

const schedItem: Item = {
  cls: "scheduled",
  kind: "exdiv",
  symbol: "TLKM",
  date: "2026-09-23",
  title: "Cash dividend · ex-date",
  detail: "IDR 168 per share",
};

const bullish: Item = {
  cls: "fact",
  kind: "news",
  symbol: "BBCA",
  date: "2026-09-09",
  title: "BBCA raises its dividend",
  tags: ["Dividend", "Bullish"],
  tagCounts: { Dividend: 1, Bullish: 1 },
};

const bearish: Item = { ...bullish, title: "BBCA cuts guidance", tags: ["Bearish"], tagCounts: { Bearish: 1 } };
const plain: Item = { ...bullish, title: "BBCA opens a branch", tags: ["Business Expansion"], tagCounts: { "Business Expansion": 1 } };

test("the two classes render as two different shapes", () => {
  assert.match(chip(factItem), /class="chip fact"/);
  assert.match(chip(schedItem), /class="chip sched"/);
});

test("a headline is marked Bullish or Bearish when Sectors tagged it, and plain otherwise", () => {
  assert.equal(sentClass(bullish), "pos tone");
  assert.equal(sentClass(bearish), "neg tone");
  assert.equal(sentClass(plain), "", "a topic tag gets the page's own colour");
  assert.match(chip(bullish), /<span class="pos tone">BBCA raises its dividend<\/span>/);
  assert.match(chip(bearish), /<span class="neg tone">BBCA cuts guidance<\/span>/);
  assert.match(chip(plain), /<span class="">BBCA opens a branch<\/span>/);
  // Colour is never the only carrier: the tags themselves are on the chip.
  assert.match(chip(bullish), /Dividend · Bullish/);
});

test("the semantic colours are the design system's own up and down", () => {
  assert.ok(STYLE.includes(".pos{color:var(--up)}"));
  assert.ok(STYLE.includes(".neg{color:var(--down)}"));
});

test("nothing on a chip forecasts any more", () => {
  const html = chip(schedItem) + chip(factItem) + chip(bullish);
  for (const gone of ["Predicted", "No window", "expected drop", "confidence"]) {
    assert.ok(!html.includes(gone), `${gone} should be gone from the product`);
  }
});

test("a source link is labelled with the host it opens, not a generic phrase", () => {
  assert.equal(domainOf("https://www.cnbcindonesia.com/market/20260903-17-764619/eraa"), "cnbcindonesia.com");
  assert.equal(domainOf("https://www.idx.co.id/en/listed-companies/corporate-actions/"), "idx.co.id");
  assert.equal(domainOf("https://sub.example.co.uk/x?y=1#z"), "sub.example.co.uk", "only www is stripped");
  // A source string comes from an API, so anything can arrive.
  assert.equal(domainOf("not a url"), null);
  assert.equal(domainOf(""), null);
  assert.equal(domainOf(null), null);

  const html = chip(factItem);
  assert.match(html, /href="https:\/\/idx\.invalid\/record"/, "the link still goes where it went");
  assert.match(html, />idx\.invalid ↗</, "and says which host that is");
  assert.ok(!html.includes("official record"), "the generic label is gone");

  // A source that is not an http(s) URL gets no link at all. `new URL` parses
  // `javascript:` perfectly happily, so this is the check that keeps a string
  // from an API response out of an href.
  for (const hostile of ["javascript:alert(1)", "data:text/html,<script>x</script>", "not a url", "//evil.example"]) {
    const html = chip({ ...factItem, sourceUrl: hostile });
    assert.ok(!html.includes("href=\"javascript"), "no script URL ever reaches an href");
    assert.ok(!html.includes("href=\"data:"), "no data URL either");
    assert.ok(!/<a class="src"/.test(html), `no source link for ${hostile}`);
    assert.match(html, /Director sells 400,000 shares/, "and the row itself still renders");
  }
});

test("percentages carry a real minus sign, not a hyphen", () => {
  assert.equal(pct(-0.0432), "−4.3%");
  assert.equal(pct(0.021), "+2.1%");
  // Flat is neither: a plus sign on an unchanged close claims a direction.
  assert.equal(pct(0), "0.0%");
});

test("markup is escaped, so a title from the API cannot inject", () => {
  assert.equal(esc(`<script>"x"&y`), "&lt;script&gt;&quot;x&quot;&amp;y");
  const html = chip({ ...factItem, title: `<img src=x onerror=alert(1)>` });
  assert.ok(!html.includes("<img"), "raw markup from a response must never reach the page");
});

test("the company filter adds one at a time, so its dropdown keeps working", () => {
  const known = ["ANTM", "BBCA", "ICBP", "TLKM"];
  const bar = (watchlist: string[]) => filterBar({ action: "/month", watchlist, known });

  // Nothing picked: every company, and every option on offer.
  const all = bar([]);
  assert.match(all, /class="pill all">All companies</);
  assert.match(all, /All 4 companies/);
  for (const s of known) assert.ok(all.includes(`<option value="${s}">`), `${s} is offered`);

  // Two picked: the box is EMPTY and named `add`, not the whole list. A
  // datalist matches the entire field, so a box holding "BBCA,TLKM" would
  // offer nothing at all.
  const some = bar(["BBCA", "TLKM"]);
  assert.match(some, /name="add" list="wl-known" value=""/);
  assert.match(some, /<input type="hidden" name="w" value="BBCA,TLKM">/);
  assert.match(some, /2 of 4 companies/);
  // Already-picked names are not offered again; the rest still are.
  assert.ok(!some.includes('<option value="BBCA">'), "no re-adding what is already on");
  assert.ok(some.includes('<option value="ANTM">'), "the rest stay available");
  // Each pill removes just itself, and there is a way back to everything.
  assert.match(some, /href="\/month\?w=TLKM"[^>]*aria-label="Remove BBCA"/s);
  assert.match(some, /class="f-clear" href="\/month">Clear filters</);
  assert.ok(!/f-clear/.test(all), "and no Clear while nothing is narrowed");

  // A ticker we hold nothing for says so, instead of rendering an empty page.
  assert.match(bar(["NOPE"]), /No rows on record for <b>NOPE<\/b>/);
});

test("the shell carries the fixture banner only in mock mode", () => {
  const body = page({ title: "t", active: "agenda", watchlist: ["BBCA"], body: "", mock: true, asOf: null, credits: null });
  assert.match(body, /MOCK_MODE/);
  assert.match(body, /<!doctype html>/);
  const live = page({ title: "t", active: "agenda", watchlist: ["BBCA"], body: "", mock: false, asOf: null, credits: null });
  assert.ok(!live.includes("MOCK_MODE"));
});

test("a list pages at ten, and the last page is short rather than padded", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i);
  const first = paginate(rows, 1);
  assert.deepEqual(first.items, [0,1,2,3,4,5,6,7,8,9]);
  assert.equal(first.pages, 3);
  assert.equal(first.total, 23);

  const last = paginate(rows, 3);
  assert.equal(last.items.length, 3);
  assert.equal(last.from, 20);

  // A page number out of range lands on a real page rather than an empty one.
  assert.equal(paginate(rows, 99).page, 3);
  assert.equal(paginate(rows, 0).page, 1);
  assert.equal(paginate(rows, -4).page, 1);
  assert.equal(paginate([], 1).pages, 1, "an empty list is one empty page, not zero");
});

test("the ticker history pages, and page two shows the older rows", () => {
  const behind = Array.from({ length: 14 }, (_, i) => ({
    cls: "fact" as const,
    kind: "exdiv",
    symbol: "BBCA",
    date: `20${25 - i}-03-15`,
    title: `Cash dividend ${i}`,
  }));
  const t = {
    symbol: "BBCA",
    ahead: [],
    refusals: [],
    behind,
    news: { positive: 0, negative: 0, neutral: 0, total: 0 },
    tags: [],
  };
  const noFaq = { row: null, stale: false, available: false, rows: behind.length, model: "fixtures", asked: [] };
  const p1 = renderTicker(t, ["BBCA"], { mock: false, asOf: null, credits: null, faq: noFaq });
  assert.match(p1, /Behind · 14/);
  assert.match(p1, /1–10<\/b> of 14 rows/);
  assert.match(p1, /page 1 of 2/);
  assert.match(p1, /Cash dividend 0/);
  assert.ok(!p1.includes("Cash dividend 10"), "page one stops at ten");
  assert.match(p1, /href="\/ticker\?symbol=BBCA&amp;w=BBCA&amp;p=2"/);
  // The dead end is visibly dead rather than missing.
  assert.match(p1, /<span class="pg prev" aria-disabled="true">/);
  assert.match(p1, /rel="next"/);

  const p2 = renderTicker(t, ["BBCA"], { mock: false, asOf: null, credits: null, page: 2, faq: noFaq });
  assert.match(p2, /11–14<\/b> of 14 rows/);
  assert.match(p2, /page 2 of 2/);
  assert.match(p2, /Cash dividend 13/);
  assert.ok(!p2.includes("Cash dividend 0<"), "page two drops the newest rows");
});

test("the topic filter narrows the company's news and leaves its dated actions alone", () => {
  const t = {
    symbol: "BBCA",
    ahead: [],
    refusals: [],
    behind: [
      { date: "2026-09-09", symbol: "BBCA", kind: "news", cls: "fact", title: "BBCA raises its dividend", tags: ["Dividend"] },
      { date: "2026-09-08", symbol: "BBCA", kind: "news", cls: "fact", title: "BBCA opens a branch", tags: ["Business Expansion"] },
      { date: "2026-09-07", symbol: "BBCA", kind: "filing", cls: "fact", title: "Director sells shares" },
    ],
    news: { positive: 0, negative: 0, neutral: 2, total: 2 },
    tags: [{ label: "Dividend", n: 1 }, { label: "Business Expansion", n: 1 }],
  };
  const opts = { mock: false, asOf: null, credits: null, faq: { row: null, stale: false, available: false, rows: 3, model: "fixtures", asked: [] } };

  const all = renderTicker(t as any, [], opts);
  assert.match(all, /Behind · 3/);

  const div = renderTicker(t as any, [], { ...opts, tag: "Dividend" });
  assert.match(div, /BBCA raises its dividend/);
  assert.ok(!div.includes("BBCA opens a branch"), "the other topic's headline is gone");
  assert.match(div, /Director sells shares/, "a filing carries no tags and is not swept away with them");
  assert.match(div, /Behind · 2/);
  assert.match(div, /1 headline tagged \u201cDividend\u201d/, "the bar says what it did, in this page's terms");
});

test("the FAQ button is a POST, and is dead when generation is unavailable", () => {
  const t = {
    symbol: "BBCA",
    ahead: [],
    refusals: [],
    behind: [],
    news: { positive: 3, negative: 1, neutral: 0, total: 4 },
    tags: [{ label: "Dividend", n: 2 }],
  };
  const opts = { mock: false, asOf: null, credits: null };

  // No key: the control is present but cannot fire, and says why.
  const off = renderTicker(t, [], {
    ...opts,
    faq: { row: null, stale: false, available: false, why: "ANTHROPIC_API_KEY is not set", rows: 4, model: "claude-sonnet-5", asked: [] },
  });
  assert.match(off, /<form class="genbar" method="post" action="\/ticker\/faq">/, "generating is a POST, never a link");
  assert.match(off, /<button type="submit" disabled/);
  assert.match(off, /ANTHROPIC_API_KEY is not set/);

  // Stored and current: no button at all, because pressing it would do nothing.
  const src = { title: "BBCA raises its dividend", url: "https://www.cnbcindonesia.com/x", date: "2026-09-09" };
  const row = {
    symbol: "BBCA", generated_at: "2026-09-11T10:00:00.000Z", model: "claude-sonnet-5",
    fingerprint: "4@2026-09-11",
    summary: [{ point: "Four headlines are on record.", sources: [src] }],
    items: [
      { question: "Q1?", answer: "A1.", sources: [src] },
      { question: "Q2?", answer: "A2.", sources: [] },
    ],
  };
  const view = { row, stale: false, available: true, rows: 4, model: "claude-sonnet-5", asked: [] };
  const fresh = renderTicker(t, [], { ...opts, faq: view });
  assert.match(fresh, /<details><summary>Q1\?<\/summary>/, "one native details per question");
  assert.match(fresh, /<h2>News summary<\/h2><span class="sub">generated<\/span>/);
  assert.match(fresh, /Four headlines are on record\./);
  // Every generated claim carries the rows it rests on, as a link we built.
  assert.match(fresh, /<div class="cites"><span class="lb">Source<\/span><a href="https:\/\/www\.cnbcindonesia\.com\/x"/);
  assert.match(fresh, /9 Sep cnbcindonesia\.com ↗/);
  // When it is current, the only button left is the deliberate regenerate.
  assert.match(fresh, /Generated <b>2026-09-11 10:00 UTC<\/b>/);
  assert.match(fresh, /<input type="hidden" name="force" value="1">/);
  assert.match(fresh, /<span class="t-busy">Generating…<\/span>/, "the button says it is working");

  // Stale: the button says why it is worth pressing.
  const stale = renderTicker(t, [], { ...opts, faq: { ...view, stale: true, rows: 9 } });
  assert.match(stale, /Regenerate — there are newer rows/);

  // The provider's counts, as one line wearing the sentiment glyphs.
  assert.match(fresh, /<b>3<\/b> bullish/);
  assert.match(fresh, /<b>1<\/b> bearish/);
  // The same filter bar as every page, with a one-company picker in place of
  // the companies field: this page is about exactly one name.
  assert.match(fresh, /<form class="fbar" method="get" action="\/ticker">/, "the bar submits back to the company page");
  assert.match(fresh, /<select name="symbol" aria-label="Company"><option value="BBCA" selected>/);
  assert.match(fresh, /<input type="checkbox" name="tag" value="Dividend">Dividend/, "a topic narrows this company's rows");
  assert.ok(!/name="add"/.test(fresh), "and no multi-company box where only one company fits");
});

test("topics are multi-select checkboxes, and the default is every topic", () => {
  const pulse = (tag: string) => ({
    from: "2026-09-01", to: "2026-09-30", tag, who: "", headlines: [], total: 0,
    page: 1, pages: 1, offset: 0,
    topics: [{ label: "Dividend", n: 4 }, { label: "Bullish", n: 3 }],
    tickers: [],
  });
  const opts = { mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: null, attention: NO_ATTENTION };
  const box = (label: string, on: boolean) =>
    `<input type="checkbox" name="tag" value="${label}"${on ? " checked" : ""}>${label}`;

  // Nothing picked is the default, and it hides nothing.
  const off = renderMonth([], "2026-09", [], { ...opts, pulse: pulse("") });
  assert.ok(off.includes(box("Dividend", false)) && off.includes(box("Bullish", false)), "nothing reads as selected");
  assert.match(off, /<span class="n">4<\/span>/, "each option carries its count");
  assert.ok(!/Clear topics/.test(off), "with no Clear to offer");
  // One form: the checkboxes submit with the month the page is on.
  assert.match(off, /<form class="fbar" method="get" action="\/">[\s\S]*name="month" value="2026-09"[\s\S]*name="tag"/);

  // Picked boxes are the state, so a second tick adds rather than replaces.
  const one = renderMonth([], "2026-09", [], { ...opts, pulse: pulse("Dividend") });
  assert.ok(one.includes(box("Dividend", true)) && one.includes(box("Bullish", false)));

  const two = renderMonth([], "2026-09", [], { ...opts, pulse: pulse("Dividend,Bullish") });
  assert.ok(two.includes(box("Dividend", true)) && two.includes(box("Bullish", true)));
  assert.match(two, /popovertarget="f-topics"[^>]*>2 topics</, "the button says how many are on");
  assert.match(two, /class="f-clear" href="\/\?month=2026-09">Clear topics</, "and one link clears the lot");
});

test("each colour has one role: price, sentiment, alert", () => {
  // Green and red are a price move and nothing else.
  assert.ok(STYLE.includes(".pos{color:var(--up)}") && STYLE.includes(".neg{color:var(--down)}"));
  // Sentiment is a glyph colour of its own; the headline stays body text.
  assert.match(STYLE, /--bull:#[0-9a-f]{6}; --bear:#[0-9a-f]{6}/);
  assert.ok(STYLE.includes(".tone.pos,.tone.neg{color:inherit}"), "a tagged headline is not painted like a price");
  assert.match(STYLE, /\.tone\.pos::before\{[^}]*color:var\(--bull\)/);
  // Urgency is amber, never the price red.
  assert.match(STYLE, /--alert:#f5a524/);
  assert.match(STYLE, /\.att \.story\.hi\{border-color:color-mix\(in srgb,var\(--alert\)/);
  // An active filter is the primary, filled -- the bar is the one place it lives.
  assert.match(STYLE, /\.f-drop\.on\{background:var\(--primary-wash\)/);
  assert.ok(!STYLE.includes("var(--on)"), "the old orange on-colour is gone");
});

test("the price strip filter offers the selection, and lands you back on itself", () => {
  const emptyPulse = {
    from: "2026-09-01", to: "2026-09-11", tag: "", who: "", headlines: [], total: 0,
    page: 1, pages: 1, offset: 0, topics: [], tickers: [],
  };
  const html = renderMonth([], "2026-09", ["TLKM", "ANTM"], {
    mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: "ANTM", pulse: emptyPulse,
    attention: NO_ATTENTION,
  });

  // Submitting a GET form replaces the query and keeps the fragment, so the
  // browser returns to the control instead of the top of the page.
  assert.match(html, /<form class="pricefilter" id="prices" method="get" action="\/#prices">/);
  assert.ok(STYLE.includes("scroll-margin-top:14px"), "and not flush against the viewport edge");

  // The options are both indices plus exactly the companies selected.
  assert.match(html, /<optgroup label="Index"><option value="IHSG">IHSG · whole exchange<\/option>/);
  assert.match(html, /<option value="LQ45">LQ45 · 45 most liquid<\/option>/);
  assert.match(html, /<optgroup label="Companies"><option value="TLKM">TLKM<\/option>/);
  assert.match(html, /<option value="ANTM" selected>ANTM<\/option>/);
  assert.ok(!html.includes('<option value="BBCA"'), "a company you are not looking at is not offered");
  assert.match(html, /priced against <b>ANTM<\/b>/);

  // Nothing picked falls to the broad index rather than to a blank grid.
  const bare = renderMonth([], "2026-09", [], {
    mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: null, pulse: emptyPulse,
    attention: NO_ATTENTION,
  });
  assert.match(bare, /<option value="IHSG" selected>/, "IHSG is the floor, not 'no price strip'");
  assert.ok(!bare.includes("No price strip"));
  assert.match(bare, /priced against <b>IHSG<\/b> — the index, not any one of them/);
});

test("price colour is direction, and the band is the size of the move", () => {
  assert.equal(priceBand(0.004), "up1");
  assert.equal(priceBand(0.018), "up2");
  assert.equal(priceBand(0.045), "up3");
  assert.equal(priceBand(-0.004), "dn1");
  assert.equal(priceBand(-0.018), "dn2");
  assert.equal(priceBand(-0.12), "dn3");
  assert.equal(priceBand(null), "", "no close, no colour");
  assert.equal(priceBand(0), "", "an unchanged day is not green");
});

test("the index is banded on its own scale, not the equity one", () => {
  // A 0.5% day is noise for one name and a real move for the composite. On
  // the equity bands the whole market-wide strip would be one flat tint.
  assert.equal(priceBand(0.005, EQUITY_BANDS), "up1");
  assert.equal(priceBand(0.005, INDEX_BANDS), "up2");
  assert.equal(priceBand(-0.015, INDEX_BANDS), "dn3");
  assert.equal(priceBand(0.0002, INDEX_BANDS), "up1", "still three depths, just closer in");
  assert.equal(priceBand(0, INDEX_BANDS), "", "flat is flat on either scale");
});

test("the hover card's calendar link is an all-day event on the right day", () => {
  const cell = (over: Partial<Cell>): Cell => ({
    date: "2026-03-31",
    day: 31,
    inMonth: true,
    weekend: false,
    today: false,
    marks: [],
    overflow: 0,
    items: [],
    total: 0,
    ...over,
  });
  const item = (over: Partial<Item>): Item =>
    ({ cls: "fact", kind: "dividend", symbol: "BBCA", title: "Ex-dividend", ...over }) as Item;

  const one = new URL(gcalUrl(cell({ items: [item({})], total: 1 }), false));
  assert.equal(one.origin + one.pathname, "https://calendar.google.com/calendar/render");
  assert.equal(one.searchParams.get("action"), "TEMPLATE");
  // End is exclusive, and the month rolls over rather than reading day 32.
  assert.equal(one.searchParams.get("dates"), "20260331/20260401");
  assert.equal(one.searchParams.get("text"), "BBCA: Ex-dividend");

  // A day with several gets a count, and the capped remainder is admitted to
  // rather than silently dropped from the description.
  const many = new URL(
    gcalUrl(cell({ items: [item({}), item({ symbol: "TLKM" })], total: 5 }), false)
  );
  assert.equal(many.searchParams.get("text"), "5 IDX events");
  assert.match(many.searchParams.get("details") ?? "", /\.\.\.and 3 more/);

  // An empty day ahead is a blank reminder, not an agenda of nothing.
  const blank = new URL(gcalUrl(cell({}), false));
  assert.equal(blank.searchParams.get("text"), "IDX reminder");
  assert.match(blank.searchParams.get("details") ?? "", /Nothing on the NewsIDX record/);
  assert.doesNotMatch(blank.searchParams.get("text") ?? "", /0 IDX/);

  // Fixture data must not land unmarked in somebody's real calendar.
  assert.match(
    new URL(gcalUrl(cell({ items: [item({})], total: 1 }), true)).searchParams.get("text") ?? "",
    /^\[DEMO DATA\] /
  );
});

// ---------------------------------------------------------------- the board

/** A board with two sectors and three companies: one with headlines, one
 * without, one on the far right so the panel has to flip. */
function boardFixture(): Board {
  const t = (over: Partial<Tile>): Tile =>
    ({
      symbol: "BBCA", name: "PT Bank Central Asia Tbk.", subSector: "Banks",
      marketCap: 775e12, change: 0.004, notes: [], x: 0, y: 0, w: 100, h: 100, ...over,
    }) as Tile;
  const note = (over: Partial<Item>): Item =>
    ({ cls: "fact", kind: "news", symbol: "BBCA", date: "2026-09-11", title: "Something happened",
       sourceUrl: "https://example.invalid/a", tags: ["Bullish", "Dividend"], ...over }) as Item;
  return {
    date: "2026-09-11",
    sector: "",
    choices: [{ sector: "Financials", n: 2, change: 0.004 }, { sector: "Infrastructures", n: 1, change: -0.01 }],
    newsFrom: "2026-09-09",
    drawn: 3,
    withNotes: 1,
    up: 2,
    down: 1,
    change: 0.001,
    positive: 1,
    negative: 1,
    stories: 2,
    topics: [{ tag: "Dividend", n: 2 }],
    sectors: [
      { sector: "Financials", marketCap: 1275e12, change: 0.004, x: 0, y: 0, w: 90, h: 100,
        tiles: [
          t({ notes: [
            note({}),
            note({ title: "And this", sourceUrl: "https://example.invalid/b",
                   tags: ["Bearish", "Dividend"] }),
          ] }),
          t({ symbol: "BBRI", name: "PT Bank Rakyat Indonesia (Persero) Tbk", change: -0.052,
              marketCap: 500e12, x: 0, y: 60, w: 100, h: 40 }),
        ] },
      { sector: "Transportation & Logistic", marketCap: 9e12, change: 0.036, x: 90, y: 0, w: 10, h: 100,
        tiles: [t({ symbol: "ASSA", name: "PT Adi Sarana Armada Tbk", change: 0.036, marketCap: 9e12 })] },
    ],
  };
}

test("a tile's area is its market cap and its colour is its move", () => {
  const html = renderBoard(boardFixture());
  // Geometry reaches the page as percentages, so the browser does the pixels.
  assert.match(html, /class="tile t-up1[^"]*" *\n? *href="\/ticker\?symbol=BBCA"/);
  assert.match(html, /left:0\.000%;top:60\.000%;width:100\.000%;height:40\.000%/);
  // −5.2% is the top band; +0.4% is the bottom one. Same ladder as the calendar.
  assert.ok(html.includes("t-dn3"), "a 5% fall is the strongest tint");
  assert.equal(priceBand(0.004), "up1");
  assert.equal(priceBand(-0.052), "dn3");
});

test("the hover panel is a sibling of its tile, not a child of it", () => {
  // The smallest tiles are a couple of percent wide; a 280px panel nested
  // inside one would be clipped into nothing. The CSS reveal depends on the
  // adjacency, so the markup order is the contract.
  const html = renderBoard(boardFixture());
  assert.match(html, /<\/a\s*><div class="tip"/);
  assert.match(STYLE, /\.tile:hover \+ \.tip/);
});

test("a panel in the right half of the board opens leftwards", () => {
  const html = renderBoard(boardFixture());
  // ASSA sits at x=60 of the board, so its panel pins its RIGHT edge — the
  // bug this replaced pinned the left and pushed 280px through the board edge.
  const assa = html.slice(html.indexOf("ASSA"));
  assert.match(assa, /class="tip" style="right:/);
  // BBCA is at x=0 and opens rightwards as normal.
  const bbca = html.slice(html.indexOf('symbol=BBCA'));
  assert.match(bbca, /class="tip" style="left:/);
});

test("a tile with nothing on the record says so rather than staying blank", () => {
  const html = renderBoard(boardFixture());
  assert.match(html, /Nothing on the record for BBRI between 9 Sep and 11 Sep/);
  // And the page states the ratio up front, so sparsity is not something you
  // discover by hovering twenty tiles.
  assert.match(html, /1 of the 3 tiles have anything at all/);
});

test("the panel reports what was on the record, never why the price moved", () => {
  const html = renderBoard(boardFixture());
  assert.match(html, /not why it\s+moved/);
  // The panels themselves -- everything between the first and last .tip -- must
  // carry no causal language at all. The explainer below the board may say
  // "because" about the product; a tooltip beside a price may not.
  const panels = html.slice(html.indexOf('class="tip"'), html.lastIndexOf("</div>"));
  assert.doesNotMatch(panels, /because|caused|due to|drove|on the back of/i);
  // Each headline carries its own date, because the window is wider than a day.
  assert.match(html, /News · same day/);
  // Sectors' tag is the colour, on the same classes the rest of the product uses.
  assert.match(html, /class="t pos tone"/);
  assert.match(html, /class="t neg tone"/);
});

test("a sector heading drops a percentage it cannot print whole", () => {
  const html = renderBoard(boardFixture());
  // "Financials" at 60% of the board has room for its number.
  assert.match(html, /Financials<span class="m pos">\+0\.4%<\/span>/);
  // "Transportation & Logistic" at 10% does not: 25 characters plus a number
  // needs ~200px against 76, and a clipped "+0" reads as a different number.
  assert.match(html, /Transportation &amp; Logistic<\/h4>/);
});

test("the board renders its own absence rather than failing", () => {
  const html = renderBoard(null);
  assert.match(html, /No board on record yet/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("a company name from the API cannot inject into a tile or its panel", () => {
  const b = boardFixture();
  b.sectors[0].tiles[0].name = '<img src=x onerror="alert(1)">';
  b.sectors[0].tiles[0].notes[0].title = "</div><script>alert(2)</script>";
  const html = renderBoard(b);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert\(2\)/);
});

test("the bar counts stories, tone and topics over the panels' own window", () => {
  const html = renderBoard(boardFixture());
  assert.match(html, /2<\/span>\s*stories/);
  assert.match(html, /across 1 of 3 names/);
  assert.match(html, /<b class="pos">1<\/b> tagged Bullish/);
  assert.match(html, /<b class="neg">1<\/b> tagged Bearish/);
  assert.match(html, /most tagged/);
  assert.match(html, /<span class="topic">Dividend <b>2<\/b><\/span>/);
  // "Tagged Bullish", never "is bullish": it is Sectors' label on coverage.
  assert.doesNotMatch(html, /sentiment is|market is (bullish|bearish)/i);
});

test("an empty window says so instead of printing four zeroes", () => {
  const b = boardFixture();
  b.sectors.forEach((s) => s.tiles.forEach((t) => (t.notes = [])));
  Object.assign(b, { stories: 0, positive: 0, negative: 0, topics: [], withNotes: 0 });
  const html = renderBoard(b);
  // Scoped to the bar itself: the explainer below the board describes how
  // "most tagged" is counted whether or not there is anything to count, and
  // asserting against the whole page would be asserting against that prose.
  const bar = html.slice(html.indexOf('class="bstats"'), html.indexOf('class="board-wrap"'));
  assert.match(bar, /No stories on the record in this window/);
  assert.doesNotMatch(bar, /tagged Bullish|most tagged/);
});

test("the fullscreen button ships hidden and is revealed only where it works", () => {
  // A dead button is worse than no button: element fullscreen does not exist
  // on iOS Safari, so the script reveals it rather than the markup.
  const html = renderBoard(boardFixture());
  assert.match(html, /<button class="ghost fsbtn" type="button" data-fs="board-wrap" hidden>/);
  assert.match(html, /id="board-wrap"/);
  assert.match(page({ title: "t", active: "agenda", watchlist: [], body: "", mock: false, asOf: null, credits: null }), /el\.requestFullscreen/);
  assert.match(page({ title: "t", active: "agenda", watchlist: [], body: "", mock: false, asOf: null, credits: null }), /btn\.hidden = false/);
  // Escape is the browser's, so the page ships no key handler of its own.
  assert.doesNotMatch(page({ title: "t", active: "agenda", watchlist: [], body: "", mock: false, asOf: null, credits: null }), /key === ['"]Escape['"]/);
});

test("a sector box too short for a heading has none, and its tiles get the box", () => {
  // The heading is a 17px CSS strip and the body below it is inset by 17px.
  // Keep the heading on a 6px box and the body is ZERO high with its top edge
  // below the box, so the tiles render outside the board. The smallest IDX
  // sector is two names out of two hundred, so this is the normal case, not
  // an edge one.
  const b = boardFixture();
  b.sectors[1].h = 1.6; // ~6px of a 400px board
  const html = renderBoard(b);
  assert.doesNotMatch(html, /<h4>Transportation/);
  assert.match(html, /<div class="body full">/);
  // The sector is still named, in the hover panel of every tile in it.
  assert.match(html, /Transportation &amp; Logistic<\/div>/);
  // And a box with room keeps both.
  assert.match(html, /<h4>Financials<span class="m pos">/);
  assert.match(html, /<div class="body">/);
});

test("a selection of topics reads as a list, not as one odd topic", () => {
  assert.equal(tagPhrase(""), "", "nothing picked says nothing");
  assert.equal(tagPhrase("Dividend"), "“Dividend”");
  assert.equal(tagPhrase("Bearish,Dividend"), "“Bearish” or “Dividend”");
  assert.equal(
    tagPhrase("A,B,C"),
    "“A”, “B” or “C”",
    "three read as a list with one or"
  );
  assert.match(tagPhrase('Div<script>"'), /&lt;script&gt;/, "and a label out of the API cannot inject");
});

test("the default state says every topic is showing, rather than looking switched off", () => {
  const pulse = (tag: string) => ({
    from: "2026-09-01", to: "2026-09-30", tag, who: "", headlines: [], total: 0,
    page: 1, pages: 1, offset: 0,
    topics: [{ label: "Dividend", n: 4 }, { label: "Bullish", n: 3 }],
    tickers: [],
  });
  const opts = { mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: null, attention: NO_ATTENTION };

  const off = renderMonth([], "2026-09", [], { ...opts, pulse: pulse("") });
  assert.match(off, /class="f-drop" popovertarget="f-topics"[^>]*>All 2 topics</, "nothing picked reads as everything showing");
  assert.match(off, /every topic/, "and the count agrees");

  const on = renderMonth([], "2026-09", [], { ...opts, pulse: pulse("Dividend") });
  assert.match(on, /class="f-drop on" popovertarget="f-topics"[^>]*>Dividend</, "a narrowed bar looks narrowed");
  assert.match(on, /1 headline|0 headlines tagged/);
});

test("the agenda takes the desktop width; a day stays a reading column", () => {
  const opts = { mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: null, attention: NO_ATTENTION };
  const agenda = renderMonth([], "2026-09", [], {
    ...opts,
    pulse: { from: "2026-09-01", to: "2026-09-30", tag: "", who: "", headlines: [], total: 0, page: 1, pages: 1, offset: 0, topics: [], tickers: [] },
  });
  assert.match(agenda, /<div class="wrap wide">/, "the agenda opts in");

  // Prose set 1300px wide is harder to read, not easier, so the shell only
  // widens for a page that asks. Asserted on the shell itself: that is the
  // one place the decision is made.
  const shell = (wide?: boolean) =>
    page({ title: "t", active: "agenda", watchlist: [], body: "", mock: false, asOf: null, credits: null, wide });
  assert.match(shell(true), /<div class="wrap wide">/);
  assert.match(shell(), /<div class="wrap">/, "and stays a reading column by default");
  assert.ok(!/wrap wide/.test(shell()));
});

test("the dashboard is one column until there is room for two, and reads in order either way", () => {
  // The second track exists only above 1200px. Everything under it is the
  // single column the page was written as.
  assert.match(STYLE, /@media \(min-width:1200px\)\{[\s\S]*?\.wrap\.wide\{max-width:1340px\}/);
  // Both tracks need minmax(0,…): without it the widest child wins the
  // negotiation and shoves the second column off the page.
  assert.match(STYLE, /\.dash\{grid-template-columns:minmax\(0,1\.5fr\) minmax\(0,1fr\)/);

  const opts = { mock: false, asOf: null, credits: null, indices: INDICES, priceSymbol: null, attention: NO_ATTENTION };
  const agenda = renderMonth([], "2026-09", [], {
    ...opts,
    upcoming: [],
    pulse: { from: "2026-09-01", to: "2026-09-30", tag: "", who: "", headlines: [], total: 0, page: 1, pages: 1, offset: 0, topics: [], tickers: [] },
  });
  // Each track is its own column, so DOM order is the reading order at every
  // width: the filters, then what is coming (up next, the month), then what
  // is being said (attention, headlines).
  // Matched on the class attribute: the bare names also occur in the <style>.
  const order = ["fbar", "dash-next", "dash-month", "dash-attention", "dash-headlines"].map((c) =>
    agenda.indexOf(`class="${c}"`)
  );
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "DOM order is the reading order");
  assert.ok(order.every((i) => i > -1), "and every track is present");
  // The market-wide blocks live on /market now.
  assert.ok(!/class="board"|id="movers"/.test(agenda), "no board or movers on the agenda");
});

// ---------------------------------------------------------------- the movers

function moversFixture(over: Partial<Movers> = {}): Movers {
  const m = (o: Partial<Mover>): Mover =>
    ({ rank: 1, symbol: "SOHO", name: "PT Soho Global Health Tbk", change: 0.249,
       lastClose: 1505, closeDate: "2026-09-11", notes: [], ...o }) as Mover;
  return {
    date: "2026-09-11", period: "7d", newsFrom: "2026-09-05", newsTo: "2026-09-11",
    clamped: false, recordFrom: null, withNotes: 1,
    gainers: [
      m({ notes: [{ cls: "fact", kind: "news", symbol: "SOHO", date: "2026-09-10",
                    title: "Soho lifts guidance", sourceUrl: "https://kontan.invalid/x",
                    tags: ["Bullish"] } as Item] }),
      m({ rank: 2, symbol: "MDIA", name: "PT Intermedia Capital Tbk", change: 0.157, lastClose: 250 }),
    ],
    losers: [m({ symbol: "KPIG", name: "MNC Tourism Indonesia Tbk", change: -0.197, lastClose: 65 })],
    ...over,
  };
}

test("a mover prints its rank, its move and the close it ended on", () => {
  const html = renderMovers(moversFixture(), []);
  assert.match(html, /<a class="tick" href="\/ticker\?symbol=SOHO">SOHO<\/a>/);
  assert.match(html, /\+24\.9%/);
  assert.match(html, /Rp1,505/);
  assert.match(html, /class="mv-ch mono neg">−19\.7%/);
  // Gainers and losers are two sides of one section, not two sections.
  assert.match(html, /<h4>Gainers<\/h4>/);
  assert.match(html, /<h4>Losers<\/h4>/);
});

test("headlines sit inline, and a mover without any says so", () => {
  const html = renderMovers(moversFixture(), []);
  // Inline, not behind a hover: a list has room, and the treemap only hides
  // them because a 2%-wide tile does not.
  assert.match(html, /<ul class="mv-notes">/);
  assert.doesNotMatch(html, /class="tip"/);
  assert.match(html, /Soho lifts guidance/);
  // One line: the headline links to its source, then when and where. "News"
  // is not repeated on every row; any other kind is named.
  assert.match(html, /<a class="t pos tone" href="https:\/\/kontan\.invalid\/x" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<span class="k">10 Sep · kontan\.invalid<\/span>/);
  assert.match(html, /Nothing on the record for MDIA between 5 Sep and 11 Sep/);
});

test("a mover note links only to a web page", () => {
  const n = (sourceUrl: string, kind = "news") =>
    ({ cls: "fact", kind, symbol: "SOHO", date: "2026-09-10", title: "t", sourceUrl, tags: [] });
  const base = moversFixture();
  const html = renderMovers(
    { ...base, gainers: [{ ...base.gainers[0], notes: [n("javascript:alert(1)"), n("https://idx.invalid/f", "filing")] as any }] },
    []
  );
  assert.doesNotMatch(html, /href="javascript:/, "a non-http source is text, not a link");
  assert.match(html, /<span class="k">Insider filing · 10 Sep · idx\.invalid<\/span>/, "and a filing says it is one");
});

test("the section refuses to say a headline caused the move", () => {
  const html = renderMovers(moversFixture(), []);
  assert.match(html, /not the\s+reason it moved/);
  const list = html.slice(html.indexOf('class="mv-cols"'), html.indexOf("<details"));
  assert.doesNotMatch(list, /because|caused|due to|drove|on the back of|reason/i);
});

test("every period is offered, and the current one is not a link", () => {
  const html = renderMovers(moversFixture(), []);
  for (const label of ["1 day", "1 week", "2 weeks", "1 month", "1 year"]) {
    assert.ok(html.includes(label), `${label} missing from the switcher`);
  }
  // 7d is current: a span, not an anchor.
  assert.match(html, /<span class="mv-tab on" aria-current="true">1 week<\/span>/);
  assert.match(html, /<a class="mv-tab" href="[^"]*movers=30d[^"]*">1 month<\/a>/);
});

test("switching period keeps the month, the companies and the topic", () => {
  const html = renderMovers(moversFixture(), ["BBCA"], {
    month: "2026-09", tag: "Dividend", w: "BBCA", price: "IHSG",
  });
  const href = html.match(/href="([^"]*movers=1d[^"]*)"/)![1];
  for (const part of ["month=2026-09", "tag=Dividend", "w=BBCA", "price=IHSG", "movers=1d"]) {
    assert.ok(href.includes(part), `${part} dropped from ${href}`);
  }
  // And it anchors, so you land on the list you just changed.
  assert.match(href, /#movers$/);
});

test("the year view admits the record does not reach back a year", () => {
  const html = renderMovers(moversFixture({ period: "365d", clamped: true, newsFrom: "2026-06-13" }), []);
  assert.match(html, /the news record does not reach a full year back/);
  assert.match(html, /The move is still the full year's; the coverage is not/);
  // A period inside the record makes no such claim.
  assert.doesNotMatch(renderMovers(moversFixture(), []), /does not reach a full year back/);
});

test("no movers renders a sentence rather than a 500", () => {
  const html = renderMovers(null, []);
  assert.match(html, /No movers on record yet/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("a name or headline from the API cannot inject into the movers list", () => {
  const f = moversFixture();
  f.gainers[0].name = '<img src=x onerror="alert(1)">';
  f.gainers[0].notes[0].title = "</div><script>alert(2)</script>";
  const html = renderMovers(f, []);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert\(2\)/);
});

test("only the board pans sideways on a phone, never the whole page", () => {
  // A grid item defaults to min-width:auto and so refuses to shrink below its
  // widest child. The board's child is a deliberate 760px that .board-scroll
  // pans; without this rule every sibling section inherits that width and the
  // page itself scrolls sideways on a 375px screen.
  assert.match(STYLE, /\.dash > section\{min-width:0\}/);
  // And the thing being contained is still there to contain.
  assert.match(STYLE, /\.board-scroll\{overflow-x:auto/);
  assert.match(STYLE, /@media \(max-width:760px\)\{[\s\S]*?\.board\{width:760px/);
});

// ---------------------------------------------------------------- up next

test("up next counts dated and predicted apart, and names the holdings with nothing ahead", () => {
  const today = "2026-09-11";
  const items = [
    { cls: "scheduled", kind: "agm", symbol: "BMRI", date: "2026-09-16", title: "General meeting" },
    { cls: "scheduled", kind: "exdiv", symbol: "TLKM", date: "2026-09-23", title: "Cash dividend",
      drop: { pct: -0.043, basis: "dividend ÷ last close", close: 2710 } },
    { cls: "predicted", kind: "agm", symbol: "BBCA", date: "2026-09-14", title: "General meeting",
      window: { from: "2026-09-14", to: "2026-09-28" }, fit: { from: "2026-09-14", to: "2026-09-28", n: 4, spreadDays: 3, trials: 3, hits: 2 } },
  ] as unknown as Item[];
  const html = upNext(items, ["BMRI", "TLKM", "BBCA", "ASII"], today);
  assert.match(html, /Next 7 days<\/div><div class="v">2<\/div>\s*<div class="s">1 dated · 1 predicted/);
  assert.match(html, /largest drop −4\.3% · TLKM/);
  assert.match(html, /Nothing on the calendar for <b>ASII<\/b>/);
  // A predicted row prints a window, never a date.
  assert.ok(!/Mon 14 Sep/.test(html), "the predicted row carries no single date");
  assert.match(html, /<i class="sw p"><\/i>Predicted · right 2 of the last 3 times/);
});

test("the CSV export carries the same rows, and cannot smuggle a formula into a spreadsheet", () => {
  const items = [
    { cls: "scheduled", kind: "exdiv", symbol: "TLKM", date: "2026-09-23", title: "=HYPERLINK(\"x\",\"y\")",
      drop: { pct: -0.043, basis: "dividend ÷ last close", close: 2710 } },
    { cls: "predicted", kind: "agm", symbol: "BBCA", date: "2026-09-14", title: "General meeting",
      window: { from: "2026-09-14", to: "2026-09-28" }, fit: { from: "2026-09-14", to: "2026-09-28", n: 4, spreadDays: 3, trials: 3, hits: 2 } },
  ] as unknown as Item[];
  const lines = upNextCsv(items, "2026-09-11").trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^date,window_from,window_to,days_to_go,ticker/);
  assert.match(lines[1], /^2026-09-23,,,12,TLKM,Ex-dividend,"'=HYPERLINK\(""x"",""y""\)",dated by issuer,,-4\.3,2710,$/);
  // A predicted row has a window and no date, here as on the page.
  assert.match(lines[2], /^,2026-09-14,2026-09-28,3,BBCA,General meeting,General meeting,predicted,2\/3,,,$/);
});

test("a mover window older than the news record says unknown, not quiet", () => {
  // Our headlines start 25 Sep; the move ran 15-21 Sep. "Nothing on the
  // record" would read as a quiet week when nobody fetched it at all.
  const html = renderMovers(
    moversFixture({ newsFrom: "2026-09-15", newsTo: "2026-09-21", recordFrom: "2026-09-25", withNotes: 0 }),
    []
  );
  assert.match(html, /our news record starts 25 Sep — earlier days are unknown, not quiet/);
  assert.match(html, /our headlines start 25 Sep, so this is unknown, not quiet/);
  assert.ok(!/Nothing on the record for [A-Z]+ between 15 Sep and 21 Sep\./.test(html));
});

test("a priced day colours its date the way the close went", () => {
  assert.match(STYLE, /\.cell\.up1 > \.d,\.cell\.up2 > \.d,\.cell\.up3 > \.d\{color:var\(--up\)\}/);
  assert.match(STYLE, /\.cell\.dn1 > \.d,\.cell\.dn2 > \.d,\.cell\.dn3 > \.d\{color:var\(--down\)\}/);
  // After the today rule, so a green or red today is still green or red.
  assert.ok(STYLE.indexOf(".cell.up1 > .d") > STYLE.indexOf(".cell.today .d{"));
});

test("a calendar day opens beside the grid, and the day page is where its panel comes from", () => {
  // The day page wraps its lists in one element the agenda can lift out.
  const day = renderDay({ date: "2026-09-16", scheduled: [], facts: [] }, [], { mock: false, asOf: null, credits: null });
  assert.match(day, /<div id="day-panel">[\s\S]*Scheduled · 0[\s\S]*Facts · 0[\s\S]*<\/div>/);
  // The script swaps the headlines column and can put it back.
  assert.match(day, /querySelector\('\.dash-headlines'\)/);
  assert.match(day, /Close · back to the month/);
  // A modified click is left alone, so the cell is still a real link.
  assert.match(day, /!e\.metaKey && !e\.ctrlKey/);
  // And the facts pager inside the panel pages in place rather than leaving.
  assert.match(day, /closest\('#day-panel \.pager a\[href\]'\)/);
});

test("the board carries its own sector picker, and it keeps the rest of the page", () => {
  const html = renderBoard(boardFixture(), { w: "BBCA,TLKM", movers: "7d" });
  assert.match(html, /<form class="secpick" method="get" action="\/market#board">/);
  assert.match(html, /<input type="hidden" name="w" value="BBCA,TLKM">/);
  assert.match(html, /<input type="hidden" name="movers" value="7d">/);
  assert.match(html, /<option value="" selected>All sectors<\/option>/);
  assert.match(html, /<option value="Financials">Financials \+0\.4%<\/option>/, "each sector carries its move");
  const picked = renderBoard({ ...boardFixture(), sector: "Financials" }, {});
  assert.match(picked, /Financials · 3 names by industry/);
  assert.match(picked, /<option value="Financials" selected>/);
});

test("the market is its own view, and nothing on it takes a page filter", () => {
  const html = renderMarket(["BBCA"], {
    mock: false, asOf: null, credits: null, board: boardFixture(), movers: moversFixture(), indexReturns: [],
    keep: { w: "BBCA" },
  });
  assert.match(html, /class="tab" href="\/market\?w=BBCA" aria-current="page"/);
  assert.match(html, /id="board"/);
  assert.match(html, /id="movers"/);
  assert.ok(!/class="fbar"/.test(html), "no filter bar: the board and movers are the whole market");
  // The period switch stays on this page.
  assert.match(renderMovers(moversFixture(), [], { w: "BBCA" }), /href="\/market\?w=BBCA&amp;movers=1d#movers"/);
});
