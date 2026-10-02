/**
 * Fastify routes. plan.md §4a — four routes, server-rendered from SQLite, no
 * bundler and no client framework.
 *
 * Serving is a read path. The only way a page view spends a credit is the
 * demand-driven fill for a symbol nobody has ever fetched, which is bounded to
 * a few per request and off unless FILL_ON_DEMAND (or MOCK_MODE) is set --
 * otherwise a crawler could walk /ticker?symbol=… and spend the allowance.
 */
import Fastify from "fastify";
import { Client } from "./api.js";
import { day, month, pulseOver, TAG_QUERY_MAX, timeline, type Timeline, upcoming } from "./calendar.js";
import { needsAttention } from "./attention.js";
import {
  anthropicKey,
  defaultWatchlist,
  FAQ_MODEL,
  fillOnDemand,
  indexChoices,
  indexSymbol,
  mockMode,
  parseMoverPeriod,
  parseWatchlist,
  port,
  runToday,
} from "./config.js";
import { shift } from "./dates.js";
import {
  allSymbols,
  connect,
  creditsSpent,
  endRun,
  getAsk,
  getFaq,
  hasPrices,
  lastRun,
  latestBoardDate,
  latestMoverDate,
  recentAsks,
  startRun,
  tickerFetchedAt,
} from "./db.js";
import { ensureTicker, fillBoard, fillMovers, fillPrices } from "./backfill.js";
import { board, indexReturns, movers } from "./heatmap.js";
import { askFaq, ensureFaq, fingerprint, MAX_QUESTION } from "./faq.js";
import { renderDay, renderMarket, renderMonth, renderTicker, type FaqView, upNextCsv } from "./render.js";

const con = connect();

function shellOpts() {
  const run = lastRun(con);
  const spent = creditsSpent(con);
  const stamp = run?.ended_at ?? run?.started_at ?? null;
  return {
    mock: mockMode(),
    asOf: stamp ? String(stamp).replace("T", " ").slice(0, 16) + " UTC" : null,
    credits: `${spent} credits spent to date`,
    // The options behind the one filter this product has.
    known: allSymbols(con),
  };
}

/** `?p=` -- a page number, or 1. Anything else is 1: a pager is a link, and a
 * link can be edited. */
function pageFrom(q: Record<string, any>): number {
  const n = Number(q.p);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * The only filter in the product. Empty is the default and it means every
 * company -- an unfiltered page is the honest starting point, and a built-in
 * list of eight names pretending to be "yours" was never that.
 */
function watchlistFrom(q: Record<string, any>): string[] {
  return parseWatchlist(q.w);
}

/** Fill symbols we have never seen, so a pasted ticker populates instead of
 * rendering an empty page. Bounded, budgeted, and silent on failure: a fill
 * that cannot happen must still render the page. */
async function fill(symbols: string[]): Promise<void> {
  if (!fillOnDemand()) return;
  const missing = symbols.filter((s) => !tickerFetchedAt(con, s, "actions_at")).slice(0, 3);
  if (!missing.length) return;
  const client = new Client(con, creditsSpent(con));
  const id = startRun(con, `on-demand fill: ${missing.join(",")}`);
  try {
    for (const s of missing) await ensureTicker(con, client, s, runToday());
    endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);
  } catch (e) {
    endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  }
}

/**
 * One credit buys the whole board for a day, and only once a day.
 *
 * The guard is `latestBoardDate`, not a timestamp: the board is keyed by the
 * day we asked, so a second visit on the same day reads the row it already
 * has. A reload is free, a crawler on the agenda is free, and the worst case
 * is one credit between midnights.
 *
 * Silent on failure, like every other fill here -- a market picture that could
 * not be fetched renders as the page saying so, never as a 500.
 */
async function fillBoardToday(): Promise<void> {
  if (!fillOnDemand()) return;
  const today = runToday();
  if (latestBoardDate(con, today) === today) return;
  const client = new Client(con, creditsSpent(con));
  const id = startRun(con, `board: ${today}`);
  try {
    await fillBoard(con, client, today);
    endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);
  } catch (e) {
    endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  }
}

/**
 * Every period's biggest movers, for 1 credit, once a day.
 *
 * Same guard as the board and for the same reason: keyed by the day we asked,
 * so a reload reads the rows it already has. The five periods came back in one
 * response, so switching between them on the page is a database read and can
 * never cost anything.
 */
async function fillMoversToday(): Promise<void> {
  if (!fillOnDemand()) return;
  const today = runToday();
  if (latestMoverDate(con, today) === today) return;
  const client = new Client(con, creditsSpent(con));
  const id = startRun(con, `movers: ${today}`);
  try {
    await fillMovers(con, client, today);
    endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);
  } catch (e) {
    endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  }
}

/** One credit buys a month of closes for one company, cached forever after.
 * Only ever spent when somebody actually selects that company for that month,
 * and never for a month that has not started. */
async function fillMonthPrices(symbol: string, ym: string): Promise<void> {
  if (!fillOnDemand()) return;
  const first = `${ym}-01`;
  // Ten days BEFORE the month, in the same call and for the same credit.
  //
  // A day's colour is its change against the previous close, so the first
  // trading day of a month has nothing to compare against unless we hold the
  // close before it -- and fetching exactly the month guaranteed we never did.
  // Every month opened with one grey, directionless cell, and so did the
  // leading days of the previous month that the grid draws in its first row.
  // Ten days clears the longest IDX holiday run.
  const from = shift(first, -10);
  const to = shift(first, 31).slice(0, 10);
  const end = to > runToday() ? runToday() : to;
  if (from > runToday()) return; // a future month has no closes to fetch
  if (hasPrices(con, symbol, from, end)) return;
  const client = new Client(con, creditsSpent(con));
  const id = startRun(con, `prices: ${symbol} ${ym}`);
  try {
    await fillPrices(con, client, symbol, from, end);
    endRun(con, id, client.spent, client.calls.filter((c) => c.source === "cache").length);
  } catch (e) {
    endRun(con, id, client.spent, 0, String((e as Error).message ?? e));
  }
}

const app = Fastify({ logger: false });

/**
 * `?add=` is the filter box adding one company. Merge it into `?w=` and bounce
 * to the canonical URL, so what ends up in the address bar (and in anything
 * anyone copies out of it) is the selection itself rather than the keystroke
 * that produced it. One hook, every route.
 */
app.addHook("onRequest", async (req, reply) => {
  const q = (req.query ?? {}) as Record<string, unknown>;
  if (q.add === undefined) return;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const merged = [...new Set([...parseWatchlist(str(q.w)), ...parseWatchlist(str(q.add))])];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k !== "add" && k !== "w" && v != null) params.set(k, String(v));
  }
  if (merged.length) params.set("w", merged.join(","));
  const path = req.url.split("?")[0];
  const qs = params.toString();
  return reply.redirect(qs ? `${path}?${qs}` : path, 303);
});

// The FAQ button is the only POST in the product, and a form posts urlencoded.
// Three lines of URLSearchParams rather than a body-parser dependency.
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(String(body))));
});

/** Everything the ticker page needs to know about the stored FAQ, without
 * generating anything: a GET must never spend. */
function faqView(
  t: Timeline,
  opts: { error?: string | null; askHash?: string | null; askError?: string | null } = {}
): FaqView {
  const rows = [...t.ahead, ...t.behind];
  const stored = getFaq(con, t.symbol);
  const available = mockMode() || !!anthropicKey();
  return {
    row: stored,
    stale: !!stored && stored.fingerprint !== fingerprint(rows),
    available,
    why: available ? null : "ANTHROPIC_API_KEY is not set",
    error: opts.error ?? null,
    rows: rows.filter((i) => i.date).length,
    model: mockMode() ? "fixtures" : FAQ_MODEL,
    ask: opts.askHash ? getAsk(con, t.symbol, opts.askHash) : null,
    askError: opts.askError ?? null,
    asked: recentAsks(con, t.symbol),
  };
}

/**
 * The agenda: the market board, then the month around it.
 *
 * One page, two URLs -- `/month` was its own view until the two said the same
 * thing in two places, and every link anyone ever sent still has to work.
 */
const renderAgendaPage = async (req: any, reply: any) => {
  const q = req.query as any;
  const w = watchlistFrom(q);
  await fill(w);
  const today = runToday();
  const ym = /^\d{4}-\d{2}$/.test(String(q.month ?? "")) ? String(q.month) : today.slice(0, 7);
  // A price strip needs one subject. `?price=` is the reader's choice from the
  // control on the page; it must name the index or one of the selected
  // companies, so a crafted URL cannot make us fetch an arbitrary symbol.
  const indices = indexChoices();
  const index = indexSymbol();
  // An index is not a four-letter ticker, so it does not come through the
  // watchlist parser. Matched against the offered list instead, which is the
  // same guard: a crafted URL can only name a subject we already publish.
  const raw = String(q.price ?? "").trim().toUpperCase();
  const asked = indices.some((i) => i.symbol === raw) ? raw : parseWatchlist(q.price)[0];
  const allowed = [...indices.map((i) => i.symbol), ...w];
  const priceSymbol = (asked && allowed.includes(asked) ? asked : null) ?? (w.length === 1 ? w[0] : index);
  if (priceSymbol) await fillMonthPrices(priceSymbol, ym);
  reply.type("text/html; charset=utf-8");
  // The pulse range is the month on screen, clipped at today: a future month
  // has nothing on record yet, and borrowing this month's headlines to fill it
  // would date September news under an October heading.
  const monthStart = `${ym}-01`;
  const monthEnd = shift(`${ym}-01`, 32).slice(0, 8) + "01";
  // `?tag=` is a comma-separated LIST, and empty means every topic. Picked
  // chips and something typed by hand arrive the same way, and each is matched
  // case-insensitively against the row's own tags. Several topics are OR:
  // ticking a second box shows more, not less. The cap is generous enough for
  // MAX_TAGS long labels and small enough that the URL is not a payload;
  // parseTags() enforces the real limit on how many survive.
  // Every block on the agenda takes it -- attention, grid and headlines --
  // because a filtered list beside two unfiltered ones is three answers to the
  // same question. Repeated `tag` params (the bar's checkboxes) arrive as an
  // array, which String() joins with the same comma.
  const tag = String(q.tag ?? "").slice(0, TAG_QUERY_MAX);
  // `?who=` narrows the headline list to one company, and only that list.
  // Normalised through the same parser as the companies bar, so it is a
  // ticker or it is nothing.
  const who = parseWatchlist(q.who)[0] ?? "";
  const pulseTo = monthEnd < today ? shift(monthEnd, -1) : today;
  return renderMonth(month(con, ym, today, { symbols: w, index, priceSymbol, tag }), ym, w, {
    ...shellOpts(),
    indices,
    priceSymbol,
    // The same range the headlines below it cover, so the two answer the same
    // question. Deliberately NOT filtered by the tag: a tag narrows what you
    // are reading, and silently hiding the month's biggest story because it
    // carries a different one would defeat the point of the block.
    upcoming: upcoming(con, w, today),
    attention: needsAttention(con, { from: monthStart, to: pulseTo, today, watchlist: w, tag }),
    pulse: pulseOver(con, monthStart, pulseTo, w, tag, pageFrom(q), who),
  });
};

app.get("/", renderAgendaPage);
app.get("/month", renderAgendaPage);

/**
 * The market: index strip, board and movers. Market-wide on purpose, so it
 * takes no page filter -- not the watchlist, not the topic. `?sector=` narrows
 * the board and `?movers=` picks the period; both are the block's own control.
 */
app.get("/market", async (req, reply) => {
  const q = req.query as any;
  const w = watchlistFrom(q);
  await fillBoardToday();
  await fillMoversToday();
  const today = runToday();
  const sector = String(q.sector ?? "").slice(0, 60);
  reply.type("text/html; charset=utf-8");
  return renderMarket(w, {
    ...shellOpts(),
    board: board(con, today, "", sector),
    // A database read: the backfill buys the closes, this only divides them.
    indexReturns: indexChoices()
      .map((i) => indexReturns(con, i.symbol, i.label, today))
      .filter((x): x is NonNullable<typeof x> => x !== null),
    // Every period is already in the database -- they arrived in one call --
    // so this switch is free.
    movers: movers(con, today, parseMoverPeriod(q.movers), ""),
    keep: { w: w.join(",") || undefined, sector: sector || undefined },
  });
});

// Read-only: no fill, so a download can never spend a credit.
app.get("/upnext.csv", async (req, reply) => {
  const w = watchlistFrom(req.query as any);
  const today = runToday();
  reply
    .type("text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="newsidx-upnext-${today}.csv"`);
  return upNextCsv(upcoming(con, w, today), today);
});

app.get("/day", async (req, reply) => {
  const q = req.query as any;
  const w = watchlistFrom(q);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(q.date ?? "")) ? String(q.date) : runToday();
  reply.type("text/html; charset=utf-8");
  return renderDay(day(con, date, w), w, { ...shellOpts(), page: pageFrom(q) });
});

app.get("/ticker", async (req, reply) => {
  const q = req.query as any;
  const w = watchlistFrom(q);
  // One company page needs one company: ?symbol= (the page's own picker, or a
  // link from anywhere else), then the first of the selected companies.
  const symbol =
    parseWatchlist(q.symbol)[0] ??
    w[0] ??
    defaultWatchlist()[0] ??
    allSymbols(con)[0] ??
    "BBCA";
  await fill([symbol]);
  reply.type("text/html; charset=utf-8");
  const t = timeline(con, symbol, runToday());
  return renderTicker(t, w, {
    ...shellOpts(),
    page: pageFrom(q),
    // The same Topic filter the agenda carries, on the same query param.
    tag: String(q.tag ?? "").slice(0, TAG_QUERY_MAX),
    faq: faqView(t, {
      error: typeof q.faqerror === "string" ? q.faqerror.slice(0, 200) : null,
      askHash: typeof q.ask === "string" ? q.ask.slice(0, 64) : null,
      askError: typeof q.askerror === "string" ? q.askerror.slice(0, 200) : null,
    }),
  });
});

/**
 * Generate the FAQ for one company, then send the reader back to the page.
 *
 * POST-redirect-GET, so a refresh does not re-submit, and a POST rather than a
 * link so no page view -- and no crawler -- can trigger a model call. It is
 * still a cache underneath: unchanged rows return the stored answer without
 * spending anything.
 */
app.post("/ticker/faq", async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, string>;
  const w = parseWatchlist(b.w);
  const symbol = parseWatchlist(b.symbol)[0];
  if (!symbol) return reply.redirect("/");
  const back = (extra = "") =>
    `/ticker?symbol=${encodeURIComponent(symbol)}${w.length ? `&w=${encodeURIComponent(w.join(","))}` : ""}${extra}`;

  const t = timeline(con, symbol, runToday());
  // `force` is the explicit regenerate: the one way to spend on rows we have
  // already read. Without it an unchanged fingerprint returns the stored text.
  const out = await ensureFaq(con, symbol, [...t.ahead, ...t.behind], undefined, b.force === "1");
  return reply.redirect(out.row ? back() : back(`&faqerror=${encodeURIComponent(out.error)}`), 303);
});

/**
 * One free-text question about one company, answered from its rows.
 *
 * Same shape as the briefing: a POST so nothing can reach it by crawling, a
 * redirect so a refresh does not re-ask, and a cache keyed by the question so
 * reopening an answer is free. The length cap is the only other throttle it
 * needs.
 */
app.post("/ticker/ask", async (req, reply) => {
  const b = (req.body ?? {}) as Record<string, string>;
  const w = parseWatchlist(b.w);
  const symbol = parseWatchlist(b.symbol)[0];
  if (!symbol) return reply.redirect("/");
  const back = (extra = "") =>
    `/ticker?symbol=${encodeURIComponent(symbol)}${w.length ? `&w=${encodeURIComponent(w.join(","))}` : ""}${extra}#ask`;

  const q = String(b.q ?? "").slice(0, MAX_QUESTION + 1);
  const t = timeline(con, symbol, runToday());
  const out = await askFaq(con, symbol, [...t.ahead, ...t.behind], q);
  return reply.redirect(
    out.row ? back(`&ask=${encodeURIComponent(out.row.qhash)}`) : back(`&askerror=${encodeURIComponent(out.error)}`),
    303
  );
});

app.setNotFoundHandler((_req, reply) => reply.redirect("/"));

const address = await app.listen({ port: port(), host: "0.0.0.0" });
console.log(`newsidx listening on ${address} (${mockMode() ? "MOCK_MODE fixtures" : "live Sectors data"}, today=${runToday()})`);
