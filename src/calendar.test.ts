import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { day, matchesTag, MAX_TAGS, month, parseTags, pulseOver, sentimentOf, timeline, upcoming } from "./calendar.js";
import { connect, upsertEvents, upsertPrices } from "./db.js";
import { shift } from "./dates.js";
const TODAY = "2026-09-11"; // a Friday

function seeded() {
  const con = connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));
  upsertEvents(con, [
    { date: TODAY, symbol: "ASII", kind: "filing", class: "fact", title: "Director sells 400,000 shares", source_url: "https://idx.invalid/x" },
    { date: "2026-09-16", symbol: "BMRI", kind: "agm", class: "scheduled", title: "General meeting" },
    { date: "2026-09-23", symbol: "TLKM", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
    { date: "2026-09-24", symbol: "PGAS", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
    { date: "2026-09-25", symbol: "BBCA", kind: "agm", class: "scheduled", title: "General meeting" },
    { date: "2026-08-30", symbol: "TLKM", kind: "news", class: "fact", title: "2 headlines" },
  ]);
  return con;
}

const WATCH = ["ASII", "BMRI", "TLKM", "PGAS", "BBCA", "ANTM", "BBRI"];

test("the month grid is whole weeks, Monday first, with today marked once", () => {
  const cells = month(seeded(), "2026-09", TODAY);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells[0].date, "2026-08-31", "September 2026 starts on a Tuesday");
  assert.equal(cells.filter((c) => c.today).length, 1);
  assert.equal(cells.filter((c) => c.weekend).length, cells.length / 7 * 2);
  const sep23 = cells.find((c) => c.date === "2026-09-23")!;
  assert.equal(sep23.marks[0].cls, "scheduled");
});

test("a ticker timeline splits at today and keeps its scheduled future", () => {
  const t = timeline(seeded(), "TLKM", TODAY);
  assert.deepEqual(t.ahead.map((i) => i.date), ["2026-09-23"]);
  assert.deepEqual(t.behind.map((i) => i.date), ["2026-08-30"]);
});

test("a ticker counts its headlines by tag, and lists the other tags separately", () => {
  const con = seeded();
  upsertEvents(con, [
    { date: "2026-09-05", symbol: "TLKM", kind: "news", class: "fact", key: "a", title: "a",
      extra: { tags: ["Bullish", "Dividend"], tag_counts: { Bullish: 1, Dividend: 1 } } },
    { date: "2026-09-04", symbol: "TLKM", kind: "news", class: "fact", key: "b", title: "b",
      extra: { tags: ["Bearish", "Dividend"], tag_counts: { Bearish: 1, Dividend: 1 } } },
    { date: "2026-09-03", symbol: "TLKM", kind: "news", class: "fact", key: "c", title: "c",
      extra: { tags: ["Commodities"], tag_counts: { Commodities: 1 } } },
  ]);
  const t = timeline(con, "TLKM", TODAY);
  assert.deepEqual(t.news, { positive: 1, negative: 1, neutral: 2, total: 4 });
  // Bullish and Bearish are the sentiment, so they are not repeated as topics.
  assert.deepEqual(t.tags, [{ label: "Dividend", n: 2 }, { label: "Commodities", n: 1 }]);
  assert.ok(!t.tags.some((g) => /bullish|bearish/i.test(g.label)));
});

test("the watchlist filters every view, and empty means every company", () => {
  const con = seeded();
  const marksOf = (cells: ReturnType<typeof month>) => cells.reduce((n, c) => n + c.total, 0);

  // The month grid.
  const all = month(con, "2026-09", TODAY);
  const tlkm = month(con, "2026-09", TODAY, { symbols: ["TLKM"] });
  const two = month(con, "2026-09", TODAY, { symbols: ["TLKM", "PGAS"] });
  assert.ok(marksOf(all) > marksOf(two), "a selection narrows the grid");
  assert.ok(marksOf(two) > marksOf(tlkm), "and two names show more than one");
  assert.ok(tlkm.every((c) => c.items.every((i) => i.symbol === "TLKM")), "nothing else leaks in");
  assert.ok(
    two.every((c) => c.items.every((i) => ["TLKM", "PGAS"].includes(i.symbol))),
    "a multi-select shows exactly the names picked"
  );

  // One day.
  assert.equal(day(con, "2026-09-23").scheduled.length, 1, "no selection is every company");
  assert.equal(day(con, "2026-09-23", ["BBCA"]).scheduled.length, 0);
  assert.equal(day(con, "2026-09-23", ["TLKM"]).scheduled.length, 1);
  assert.equal(day(con, "2026-09-23", ["TLKM", "BBCA"]).scheduled.length, 1, "a union, not an intersection");

  // And the headlines block.
  const con2 = tagged();
  assert.equal(pulseOver(con2, shift(TODAY, -14), TODAY).total, 4);
  assert.equal(pulseOver(con2, shift(TODAY, -14), TODAY, ["BBCA"]).total, 1);
  assert.equal(pulseOver(con2, shift(TODAY, -14), TODAY, ["BBCA", "BBRI"]).total, 2);
});

test("a cell carries the rows its hover card needs, capped", () => {
  const cells = month(seeded(), "2026-09", TODAY, { popCap: 1 });
  const busy = cells.find((c) => c.date === "2026-09-23")!;
  assert.equal(busy.items.length, 1);
  assert.equal(busy.total, 1);
  assert.equal(busy.items[0].symbol, "TLKM");
});

function tagged() {
  const con = seeded();
  upsertEvents(con, [
    { date: "2026-09-09", symbol: "BBCA", kind: "news", class: "fact", title: "BBCA raises its dividend",
      extra: { tags: ["Dividend", "Bullish"], tag_counts: { Dividend: 1, Bullish: 1 } } },
    { date: "2026-09-08", symbol: "BBRI", kind: "news", class: "fact", title: "BBRI dividend cut",
      extra: { tags: ["Dividend", "Bearish"], tag_counts: { Dividend: 1, Bearish: 1 } } },
    { date: "2026-09-07", symbol: "BMRI", kind: "news", class: "fact", title: "BMRI buys back stock",
      extra: { tags: ["Stock Buyback"], tag_counts: { "Stock Buyback": 1 } } },
  ]);
  return con;
}

test("the headline list is newest first, with every tag in the range offered as an option", () => {
  const p = pulseOver(tagged(), shift(TODAY, -14), TODAY);
  assert.equal(p.headlines[0].date, "2026-09-09", "newest first");
  assert.equal(p.total, 4);
  assert.deepEqual(p.topics[0], { label: "Dividend", n: 2 }, "commonest tag first");
  assert.ok(p.topics.some((t) => t.label === "Stock Buyback"), "a tag used once is still an option");
  assert.ok(p.tickers.some((t) => t.symbol === "BBCA"));
});

test("a tag filter narrows the headlines but never the options", () => {
  const con = tagged();
  const all = pulseOver(con, shift(TODAY, -14), TODAY);
  const div = pulseOver(con, shift(TODAY, -14), TODAY, undefined, "Dividend");
  assert.equal(div.total, 2);
  assert.ok(div.headlines.every((h) => (h.tags ?? []).includes("Dividend")));
  assert.deepEqual(div.topics, all.topics, "the options survive the filter, or you cannot get back");

  // Free text is the same path as a picked option: partial, any case.
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "divid").total, 2);
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "BULLISH").total, 1);
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "nothing").total, 0);
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "  ").total, all.total, "blank is no filter");
});

test("a company chip narrows the headline list and nothing else on the page", () => {
  const con = tagged();
  const all = pulseOver(con, shift(TODAY, -14), TODAY);
  const bbca = pulseOver(con, shift(TODAY, -14), TODAY, undefined, "", 1, "BBCA");
  assert.equal(bbca.total, 1);
  assert.ok(bbca.headlines.every((h) => h.symbol === "BBCA"));
  assert.deepEqual(bbca.tickers, all.tickers, "the chips survive the filter, or you cannot get back");
  assert.deepEqual(bbca.topics, all.topics);

  // It composes with the tag filter rather than replacing it.
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "Dividend", 1, "BBRI").total, 1);
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "Dividend", 1, "BMRI").total, 0);
  assert.equal(pulseOver(con, shift(TODAY, -14), TODAY, undefined, "", 1, "").total, all.total, "blank is no filter");
});

test("headlines page at ten, newest first, and a filter resets to page one", () => {
  const con = seeded();
  // 24 headlines across three days, newest last so the sort has work to do.
  for (let i = 0; i < 24; i++) {
    upsertEvents(con, [
      {
        date: shift(TODAY, -(i % 3)),
        symbol: "BBCA",
        kind: "news",
        class: "fact",
        key: `story-${i}`,
        title: `headline ${i}`,
        extra: { tags: i % 2 ? ["Bullish"] : ["Bearish"], tag_counts: { [i % 2 ? "Bullish" : "Bearish"]: 1 } },
      },
    ]);
  }
  const at = (page: number) => pulseOver(con, shift(TODAY, -14), TODAY, [], "", page);

  const p1 = at(1);
  assert.equal(p1.headlines.length, 10, "ten a page");
  assert.equal(p1.total, 25, "24 new ones plus the seeded TLKM headline");
  assert.equal(p1.pages, 3);
  assert.equal(p1.offset, 0);

  const p3 = at(3);
  assert.equal(p3.headlines.length, 5, "the last page is short rather than padded");
  assert.equal(p3.offset, 20);

  // No page shares a headline with another, and together they are the whole set.
  const seen = [at(1), at(2), at(3)].flatMap((p) => p.headlines.map((h) => h.title));
  assert.equal(new Set(seen).size, 25, "every headline appears exactly once across the pages");

  // Out of range lands on a real page, like every other list here.
  assert.equal(at(99).page, 3);
  assert.equal(at(0).page, 1);
  assert.equal(at(-4).page, 1);

  // Filtering shrinks the set, so it fits one page again.
  const tagged = pulseOver(con, shift(TODAY, -14), TODAY, [], "Bearish", 1);
  assert.equal(tagged.pages, 2);
  assert.ok(tagged.headlines.every((h) => (h.tags ?? []).includes("Bearish")));
});

test("Bullish is positive, Bearish negative, everything else neutral", () => {
  const news = (tags: string[], tagCounts?: Record<string, number>): any => ({
    cls: "fact", kind: "news", symbol: "BBCA", date: TODAY, title: "n", tags, tagCounts,
  });
  assert.equal(sentimentOf(news(["Bullish", "Dividend"])), "positive");
  assert.equal(sentimentOf(news(["Bearish"])), "negative");
  assert.equal(sentimentOf(news(["Dividend", "Banks"])), "neutral", "a topic tag is not a mood");
  assert.equal(sentimentOf(news([])), "neutral");
  assert.equal(sentimentOf(news(["bullish"])), "positive", "tags are matched case-insensitively");
  // A day's worth of stories collapses into one row, so the counts decide.
  assert.equal(sentimentOf(news(["Bullish", "Bearish"], { Bullish: 3, Bearish: 1 })), "positive");
  assert.equal(sentimentOf(news(["Bullish", "Bearish"], { Bullish: 1, Bearish: 1 })), "neutral", "an even split is neither");
});

test("a tag matches on a substring, in any case", () => {
  const item: any = { cls: "fact", kind: "news", symbol: "BBCA", title: "n", tags: ["Stock Buyback", "Bullish"] };
  assert.ok(matchesTag(item, "buyback"));
  assert.ok(matchesTag(item, "Stock Buyback"));
  assert.ok(matchesTag(item, ""), "no filter matches everything");
  assert.ok(!matchesTag(item, "dividend"));
});

test("the price strip follows the chosen company, not just the selection", () => {
  const con = seeded();
  upsertPrices(con, "TLKM", [{ date: "2026-09-08", close: 3800 }, { date: "2026-09-09", close: 3876 }]);
  upsertPrices(con, "PGAS", [{ date: "2026-09-08", close: 1500 }, { date: "2026-09-09", close: 1470 }]);
  upsertPrices(con, "IHSG", [{ date: "2026-09-08", close: 7851 }, { date: "2026-09-09", close: 7826 }]);
  const on = (cells: ReturnType<typeof month>) => cells.find((c) => c.date === "2026-09-09")!;

  // Two companies selected: no single subject, so the composite.
  const both = month(con, "2026-09", TODAY, { symbols: ["TLKM", "PGAS"], index: "IHSG" });
  assert.equal(on(both).close, 7826);
  assert.equal(on(both).priceOf, "index");

  // ...until one of them is picked to price.
  const pgas = month(con, "2026-09", TODAY, {
    symbols: ["TLKM", "PGAS"],
    index: "IHSG",
    priceSymbol: "PGAS",
  });
  assert.equal(on(pgas).close, 1470);
  assert.equal(on(pgas).priceOf, "company", "a company is banded on the equity scale, not the index one");
  // The grid itself still covers both names.
  assert.ok(pgas.some((c) => c.items.some((i) => i.symbol === "TLKM")));

  // Picking the index back is allowed even with one company selected.
  const idx = month(con, "2026-09", TODAY, { symbols: ["TLKM"], index: "IHSG", priceSymbol: "IHSG" });
  assert.equal(on(idx).close, 7826);
  assert.equal(on(idx).priceOf, "index");
});

test("a filtered month carries each trading day's close and its change", () => {
  const con = seeded();
  upsertPrices(con, "TLKM", [
    { date: "2026-09-08", close: 3800 },
    { date: "2026-09-09", close: 3876 }, // +2.0%
    { date: "2026-09-10", close: 3760 }, // -3.0%
  ]);
  const cells = month(con, "2026-09", TODAY, { symbols: ["TLKM"] });
  const at = (d: string) => cells.find((c) => c.date === d)!;
  assert.equal(at("2026-09-09").close, 3876);
  assert.ok(Math.abs(at("2026-09-09").change! - 0.02) < 1e-9);
  assert.ok(Math.abs(at("2026-09-10").change! + 0.0299) < 1e-3);
  assert.equal(at("2026-09-11").close, null, "a day with no close stays blank, not zero");

  // Market-wide, a close has no subject.
  assert.equal(month(con, "2026-09", TODAY).find((c) => c.date === "2026-09-09")!.close, null);
});

test("the first shown day still gets a change, from the close before the window", () => {
  const con = seeded();
  upsertPrices(con, "TLKM", [
    { date: "2026-08-28", close: 4000 },
    { date: "2026-08-31", close: 4100 },
  ]);
  // The grid for September starts on 31 Aug; its change comes from 28 Aug.
  const cells = month(con, "2026-09", TODAY, { symbols: ["TLKM"] });
  const first = cells.find((c) => c.date === "2026-08-31")!;
  assert.ok(Math.abs(first.change! - 0.025) < 1e-9);
});

test("a tag filter narrows the grid's headlines, and leaves scheduled events alone", () => {
  const con = tagged();
  const newsOn = (cells: ReturnType<typeof month>, date: string) =>
    (cells.find((c) => c.date === date)?.items ?? []).filter((i) => i.kind === "news");

  const all = month(con, "2026-09", TODAY);
  const div = month(con, "2026-09", TODAY, { tag: "Dividend" });

  assert.equal(newsOn(all, "2026-09-07").length, 1, "BMRI buyback is a headline");
  assert.equal(newsOn(div, "2026-09-07").length, 0, "…and it is not a Dividend one");
  assert.equal(newsOn(div, "2026-09-09").length, 1, "the Dividend headline stays");

  // Whatever the filter says, the calendar still shows the things it exists for.
  const dated = (cells: ReturnType<typeof month>) =>
    cells.flatMap((c) => c.items).filter((i) => i.kind !== "news").length;
  assert.equal(dated(div), dated(all), "filings and reports carry no topic tags");
});

// ---------------------------------------------------------------- the topic filter

test("no topic picked means every topic, which is the default", () => {
  const item = { kind: "news", tags: ["Dividend"] } as any;
  assert.equal(matchesTag(item, ""), true);
  assert.equal(matchesTag(item, "   "), true);
  assert.equal(matchesTag(item, ","), true);
  assert.deepEqual(parseTags(""), []);
});

test("several topics are OR, so picking a second one shows more and not less", () => {
  const dividend = { kind: "news", tags: ["Dividend", "Corporate"] } as any;
  const bullish = { kind: "news", tags: ["Bullish"] } as any;
  const neither = { kind: "news", tags: ["Suspension"] } as any;

  assert.equal(matchesTag(dividend, "Dividend"), true);
  assert.equal(matchesTag(bullish, "Dividend"), false);

  // Adding Bullish must not drop Dividend, which is what AND would do.
  assert.equal(matchesTag(dividend, "Dividend,Bullish"), true);
  assert.equal(matchesTag(bullish, "Dividend,Bullish"), true);
  assert.equal(matchesTag(neither, "Dividend,Bullish"), false);
});

test("the list tolerates how a person actually types it", () => {
  assert.deepEqual(parseTags(" Dividend , Bullish "), ["Dividend", "Bullish"]);
  assert.deepEqual(parseTags("Dividend,,Bullish,"), ["Dividend", "Bullish"]);
  assert.deepEqual(parseTags("Dividend,dividend,DIVIDEND"), ["Dividend"], "the same topic twice is once");
  assert.equal(matchesTag({ kind: "news", tags: ["Dividend"] } as any, "divid"), true, "still a substring match");
});

test("the number of topics is capped, so a URL cannot be used as a payload", () => {
  const many = Array.from({ length: MAX_TAGS + 8 }, (_, i) => `t${i}`).join(",");
  assert.equal(parseTags(many).length, MAX_TAGS);
});

test("an item with no tags survives an empty filter and fails a real one", () => {
  const untagged = { kind: "news" } as any;
  assert.equal(matchesTag(untagged, ""), true);
  assert.equal(matchesTag(untagged, "Dividend"), false);
});

test("up next counts forward from any date, and a past date keeps what was ahead of it", () => {
  const con = connect(path.join(mkdtempSync(path.join(tmpdir(), "fw-")), "t.db"));
  upsertEvents(con, [
    { date: "2026-09-10", symbol: "BBCA", kind: "agm", class: "fact", title: "General meeting" },
    { date: "2026-09-02", symbol: "ANTM", kind: "exdiv", class: "fact", title: "Cash dividend · ex-date" },
    { date: "2026-09-05", symbol: "ANTM", kind: "news", class: "fact", title: "a headline" },
    { date: "2026-09-08", symbol: "BBCA", kind: "filing", class: "fact", title: "Director sells shares" },
    { date: "2026-10-20", symbol: "TLKM", kind: "exdiv", class: "scheduled", title: "Cash dividend · ex-date" },
  ]);
  const NOW = "2026-10-05";
  const titles = (from: string) => upcoming(con, [], from, NOW).map((i) => `${i.date} ${i.symbol}`);

  // From today: only what an issuer has dated ahead.
  assert.deepEqual(titles(NOW), ["2026-10-20 TLKM"]);
  // From a day in September: the meeting and dividend that were ahead then,
  // as they turned out -- and never a headline or a filing.
  assert.deepEqual(titles("2026-09-01"), ["2026-09-02 ANTM", "2026-09-10 BBCA", "2026-10-20 TLKM"]);
  // Later in the month the earlier one has dropped off the front.
  assert.deepEqual(titles("2026-09-03"), ["2026-09-10 BBCA", "2026-10-20 TLKM"]);
  // Without `now` it behaves exactly as before: scheduled only.
  assert.deepEqual(upcoming(con, [], "2026-09-01").map((i) => i.symbol), ["TLKM"]);
});
