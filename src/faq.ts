/**
 * The generated block on /ticker: a summary of the news, five questions and
 * answers, and a box to ask one of your own. plan.md §4a.
 *
 * Claude writes all three from the rows this database already holds -- nothing
 * else. The model never browses, never recalls, and is told in as many words
 * that a headline is coverage and not a cause: the rest of the product refuses
 * to forecast, and a paragraph of generated prose is exactly where that
 * discipline would leak away.
 *
 * Every claim carries its rows. The model cites them by INDEX into the list we
 * gave it, never by URL -- we resolve those indexes against our own records at
 * generation time and store the result, so no link on the page was written by
 * a model, and a citation can only ever point at something we actually hold.
 *
 * Everything is cached. The summary and FAQ are keyed by symbol and
 * fingerprinted by the rows behind them; a question is keyed by the question.
 * Only new rows, or an explicit regenerate, can cost a call.
 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Database } from "better-sqlite3";
import { anthropicKey, FAQ_MODEL, FAQ_ROWS, mockMode } from "./config.js";
import { getAsk, getFaq, putAsk, putFaq, type AskRow, type FaqRow, type FaqSource } from "./db.js";
import type { Item } from "./calendar.js";
import { kindLabel, sentimentOf } from "./calendar.js";

/** A free-text question longer than this is not a question about a company. */
export const MAX_QUESTION = 200;

/**
 * Identifies the rows an answer was written from. Newest date plus a count is
 * enough: rows are append-only, so either number moving means there is
 * something the stored text has not read.
 */
export function fingerprint(items: Item[]): string {
  const dated = items.filter((i) => i.date);
  const newest = dated.reduce((a, b) => (a > (b.date ?? "") ? a : (b.date ?? "")), "");
  return `${dated.length}@${newest || "none"}`;
}

/** The same question in different clothes is the same question. */
export function questionHash(q: string): string {
  return createHash("sha256").update(q.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 16);
}

/**
 * The rows the model may use, numbered.
 *
 * The numbers are the citation scheme: the model answers with `[3]`, and we
 * turn 3 back into a record we hold. Dates, kinds, titles and tags only -- no
 * prices, no derived numbers, nothing the database did not receive.
 */
function corpus(symbol: string, items: Item[]): { text: string; sources: FaqSource[] } {
  const rows = items
    .filter((i) => i.date)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, FAQ_ROWS);
  const lines = rows.map((i, n) => {
    const tags = (i.tags ?? []).join(", ");
    const when = i.cls === "scheduled" ? `${i.date} (scheduled, upcoming)` : i.date;
    return `[${n + 1}] ${when} | ${kindLabel(i.kind)} | ${i.title}${tags ? ` | tags: ${tags}` : ""}`;
  });
  return {
    text: `Company: ${symbol} (Indonesia Stock Exchange)\nRows on record, newest first:\n${lines.join("\n")}`,
    sources: rows.map((i) => ({ title: i.title, url: i.sourceUrl ?? null, date: i.date ?? "" })),
  };
}

/** Citation indexes back into records we hold. Anything out of range is
 * dropped rather than guessed at. */
function resolve(ids: unknown, sources: FaqSource[]): FaqSource[] {
  if (!Array.isArray(ids)) return [];
  const out: FaqSource[] = [];
  for (const raw of ids) {
    const n = Number(raw);
    const src = Number.isInteger(n) ? sources[n - 1] : undefined;
    if (src && !out.some((s) => s.title === src.title && s.date === src.date)) out.push(src);
  }
  return out;
}

const RULES = `The rows in the user message are the ONLY facts you may use. They come from a
market data provider: dated events an issuer scheduled or filed, and news
headlines with the provider's own topic tags.

Rules, in order of importance:
1. Every statement must be supported by the rows, and must cite the rows it
   rests on by their [number]. Never add a fact that is not there -- no
   figures, no names, no dates, no context from memory. If the rows do not
   answer something, say plainly that the data on record does not cover it,
   and cite nothing.
2. Never forecast, and never advise. No price direction, no targets, no
   valuation, no buy, sell, hold or "investors should". This tool states what
   is on record and stops there.
3. The tags "Bullish" and "Bearish" are the PROVIDER'S labels on how a story
   was covered. They describe coverage, not outcomes, and they are not
   evidence about a price. Say "tagged Bullish", never "the stock will rise".
4. Plain English, no jargon, no markdown, no [number] markers in the prose --
   the citations go in the sources field, not the text.`;

const SYSTEM_BRIEF = `You write a short briefing about one listed company for a research tool: a
summary of the news on record, then the questions a reader of that record
would actually ask.

${RULES}
5. The summary is two to four flowing paragraphs of prose, not bullet points
   and not one-line fragments. Each paragraph is three to five full sentences
   that run on from one another. Open with the overall shape of the record --
   the period it covers, the volume of coverage, the theme running through it.
   Then give the individual stories their own sentences: what the row says,
   when it is dated, how the provider tagged it, and how it sits beside the
   rows around it. Close on what is dated ahead, or say that nothing is.
   Write it as a person would brief a colleague: joined-up sentences with
   clauses, not a list wearing paragraph clothes.
6. Return exactly five questions. Prefer questions the rows genuinely answer.
   Each answer is at most 60 words and states the date or the count it rests on.`;

const SYSTEM_ASK = `You answer one question about one listed company for a research tool, from
the rows on record and nothing else.

${RULES}
5. Answer in at most 80 words. If the rows do not answer the question, say so
   in one sentence and suggest what the record does cover instead.`;

const CITED = {
  type: "array",
  items: { type: "integer" },
} as const;

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "array",
      items: {
        type: "object",
        properties: { point: { type: "string" }, sources: CITED },
        required: ["point", "sources"],
        additionalProperties: false,
      },
    },
    faq: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer: { type: "string" }, sources: CITED },
        required: ["question", "answer", "sources"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "faq"],
  additionalProperties: false,
};

const ASK_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, sources: CITED },
  required: ["answer", "sources"],
  additionalProperties: false,
};

/** One model call, JSON in hand or a reason why not. */
async function call(
  system: string,
  user: string,
  schema: Record<string, unknown>
): Promise<{ data: any; input: number; output: number } | { error: string }> {
  const key = anthropicKey();
  if (!key) return { error: "ANTHROPIC_API_KEY is not set" };
  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create({
      model: FAQ_MODEL,
      max_tokens: 4000,
      // A small, well-specified job over forty rows -- but the citations have
      // to be right, so not the very bottom of the range.
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") {
      return { error: `the model declined this request (${res.stop_details?.category ?? "no category"})` };
    }
    const block = res.content.find((b) => b.type === "text");
    return {
      data: JSON.parse(block && "text" in block ? block.text : "{}"),
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
    };
  } catch (e) {
    // A failed generation must never take the page down with it: this is an
    // extra on a page that already works without it.
    return { error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/**
 * The fixture path. MOCK_MODE means no key and no network anywhere in this
 * product, and the demo has to show the feature rather than a disabled button.
 * Assembled from the rows on screen, and the page says on every view that
 * fixture output is fabricated.
 */
function mockBrief(symbol: string, items: Item[], sources: FaqSource[]) {
  const news = items.filter((i) => i.kind === "news");
  const pos = news.filter((i) => sentimentOf(i) === "positive").length;
  const neg = news.filter((i) => sentimentOf(i) === "negative").length;
  const next = items
    .filter((i) => i.cls === "scheduled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
  const tags = [...new Set(news.flatMap((i) => i.tags ?? []))].filter((t) => !/^(bullish|bearish)$/i.test(t));
  const first = sources.slice(0, 1);
  const two = sources.slice(0, 2);
  return {
    summary: [
      {
        point:
          `The record for ${symbol} holds ${news.length} headline(s) alongside ${items.length - news.length} dated event(s), ` +
          `and it is fixture data, so every one of them is fabricated. Taken together the rows describe how ${symbol} ` +
          `has been covered over the period on file, not what its price did. Nothing here was derived from a market feed.`,
        sources: two,
      },
      {
        point:
          `Of those headlines, ${pos} carry the provider's Bullish tag and ${neg} carry Bearish — labels on how a story ` +
          `was covered, not on any outcome that followed it. ` +
          (tags.length
            ? `The subjects that keep recurring are ${tags.slice(0, 5).join(", ")}, which is the provider's own categorisation rather than ours.`
            : `Beyond the sentiment labels no topic tags are on record, so the coverage resists grouping by subject.`),
        sources: first,
      },
      {
        point: next?.date
          ? `Dated ahead, the issuer has a ${kindLabel(next.kind).toLowerCase()} on ${next.date}; that is a date the issuer set, ` +
            `and the record says nothing about what it will contain.`
          : `Nothing is dated ahead on record for ${symbol}, so the file ends with the coverage already published.`,
        sources: first,
      },
    ],
    faq: [
      { question: `What has been on record for ${symbol} recently?`, answer: `${news.length} headline(s) and ${items.length - news.length} dated event(s). This is fixture data, so every one of them is fabricated.`, sources: two },
      { question: `How was ${symbol}'s coverage tagged?`, answer: `${pos} Bullish and ${neg} Bearish, by the provider's own labels. They describe how a story was covered, not what a price did.`, sources: first },
      { question: `What subjects keep coming up?`, answer: tags.length ? `${tags.slice(0, 5).join(", ")} — the provider's categories, counted, not interpreted.` : `No topic tags on record yet.`, sources: first },
      { question: `Is anything dated ahead?`, answer: next?.date ? `Yes — ${kindLabel(next.kind).toLowerCase()} on ${next.date}, as the issuer dated it.` : `Nothing the issuer has dated is on record ahead.`, sources: first },
      { question: `Does any of this say where the price is going?`, answer: `No. The rows are things that happened or are scheduled, plus how coverage was tagged. Nothing here is a forecast, and nothing here is investment advice.`, sources: [] },
    ],
  };
}

/**
 * Write (or return) the summary and FAQ for one company.
 *
 * Returns the stored row untouched when the rows behind it have not changed,
 * so the button is free to press. `force` is the explicit regenerate, and it
 * is the only way to spend a call on data we have already read.
 */
export async function ensureFaq(
  con: Database,
  symbol: string,
  items: Item[],
  now: string = new Date().toISOString(),
  force = false
): Promise<{ row: FaqRow; spent: boolean } | { row: null; error: string }> {
  const fp = fingerprint(items);
  const stored = getFaq(con, symbol);
  if (!force && stored && stored.fingerprint === fp && stored.summary.length) {
    return { row: stored, spent: false };
  }
  const { text, sources } = corpus(symbol, items);
  if (!sources.length) return { row: null, error: "no rows on record for this company yet" };

  if (mockMode()) {
    const m = mockBrief(symbol, items, sources);
    const row: FaqRow = {
      symbol,
      generated_at: now,
      model: "fixtures",
      fingerprint: fp,
      summary: m.summary,
      items: m.faq,
    };
    putFaq(con, row);
    return { row, spent: false };
  }

  const out = await call(SYSTEM_BRIEF, text, BRIEF_SCHEMA);
  if ("error" in out) return { row: null, error: out.error };
  const faq = (Array.isArray(out.data.faq) ? out.data.faq : []).slice(0, 5);
  const summary = (Array.isArray(out.data.summary) ? out.data.summary : []).slice(0, 5);
  if (!faq.length && !summary.length) return { row: null, error: "the model returned nothing" };

  const row: FaqRow = {
    symbol,
    generated_at: now,
    model: FAQ_MODEL,
    fingerprint: fp,
    summary: summary.map((s: any) => ({ point: String(s.point ?? ""), sources: resolve(s.sources, sources) })),
    items: faq.map((q: any) => ({
      question: String(q.question ?? ""),
      answer: String(q.answer ?? ""),
      sources: resolve(q.sources, sources),
    })),
    input_tokens: out.input,
    output_tokens: out.output,
  };
  putFaq(con, row);
  return { row, spent: true };
}

/**
 * Answer one free-text question about one company.
 *
 * Cached by the question itself, so a refresh, a back button or the same
 * question tomorrow costs nothing. The length cap is the only throttle this
 * needs: it is a POST, so nothing can reach it by crawling.
 */
export async function askFaq(
  con: Database,
  symbol: string,
  items: Item[],
  question: string,
  now: string = new Date().toISOString()
): Promise<{ row: AskRow; spent: boolean } | { row: null; error: string }> {
  const q = question.trim().replace(/\s+/g, " ");
  if (!q) return { row: null, error: "ask a question first" };
  if (q.length > MAX_QUESTION) {
    return { row: null, error: `that question is ${q.length} characters — keep it under ${MAX_QUESTION}` };
  }
  const qhash = questionHash(q);
  const cached = getAsk(con, symbol, qhash);
  if (cached) return { row: cached, spent: false };

  const { text, sources } = corpus(symbol, items);
  if (!sources.length) return { row: null, error: "no rows on record for this company yet" };

  if (mockMode()) {
    const row: AskRow = {
      symbol,
      qhash,
      question: q,
      answer: `Fixture answer: the record for ${symbol} holds ${sources.length} rows, the newest from ${sources[0].date}. With MOCK_MODE on there is no model and no network, so this text is fabricated — set ANTHROPIC_API_KEY and run without MOCK_MODE for a real answer.`,
      sources: sources.slice(0, 2),
      model: "fixtures",
      created_at: now,
    };
    putAsk(con, row);
    return { row, spent: false };
  }

  const out = await call(SYSTEM_ASK, `${text}\n\nQuestion: ${q}`, ASK_SCHEMA);
  if ("error" in out) return { row: null, error: out.error };
  const answer = String(out.data.answer ?? "").trim();
  if (!answer) return { row: null, error: "the model returned no answer" };

  const row: AskRow = {
    symbol,
    qhash,
    question: q,
    answer,
    sources: resolve(out.data.sources, sources),
    model: FAQ_MODEL,
    created_at: now,
    input_tokens: out.input,
    output_tokens: out.output,
  };
  putAsk(con, row);
  return { row, spent: true };
}
