/**
 * MOCK_MODE fixtures. plan.md §10: a judge with no API key must see the
 * product work.
 *
 * Every number here is fabricated and the UI says so on every page. The
 * SHAPES, though, are copied from sectors-api-v2.yaml's own response examples,
 * because a fixture that disagrees with the API teaches the pipeline to parse
 * something that will never arrive:
 *
 *   filings         results[].{symbol,timestamp,title,source,transaction_type,...}
 *   suspensions     results[].{symbol,suspension_date,reason,pdf_url}
 *   news            results[].{title,source,timestamp,symbols[],tags[]}
 *   corporate-actions   corporate_actions.{agm[],dividend[],stock_split[],upcoming_dividend}
 *   quarterly dates     {"2026":[["2026-03-31","q1"]]}  <- a quarter END, deliberately
 *
 * That last one is the point of the whole fixture set: the spec documents
 * these as period keys, so the demo exercises predict.reportDatesUsable()
 * FAILING and the UI rendering "no window" with the reason. The positive
 * filing-lag path is covered in predict.test.ts against synthetic dates,
 * where it is unambiguously a test rather than a claim about the API.
 */
import { isWeekend, shift } from "../dates.js";

export const TODAY = "2026-09-11";

type Row = Record<string, any>;

// ---------------------------------------------------------------- insider filings
// A market-wide feed: dense on trading days, which is what makes "every date
// carries something" true rather than aspirational (plan.md §3a).
const FILING_CAST: [string, string, string][] = [
  ["ASII", "Director sells 400,000 shares", "sell"],
  ["ANTM", "Commissioner buys 1,200,000 shares", "buy"],
  ["MDKA", "Institution buys 4,500,000 shares", "buy"],
  ["BRPT", "Director buys 900,000 shares", "buy"],
  ["INKP", "Major shareholder sells 2,100,000 shares", "sell"],
  ["SIDO", "Commissioner buys 350,000 shares", "buy"],
  ["EXCL", "Institution sells 1,750,000 shares", "sell"],
];

function filings(): Row[] {
  const out: Row[] = [];
  for (let i = 0; i <= 14; i++) {
    const date = shift(TODAY, -i);
    if (isWeekend(date)) continue;
    const n = (i % 3) + 1;
    for (let k = 0; k < n; k++) {
      const [symbol, title, type] = FILING_CAST[(i + k) % FILING_CAST.length];
      out.push({
        symbol: `${symbol}.JK`,
        title,
        body: `${title}. Fabricated fixture row.`,
        source: "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/",
        timestamp: `${date}T14:29:39`,
        transaction_type: type,
        holder_type: k === 0 ? "insider" : "institution",
        holder_name: "Fixture Holder",
        amount_transaction: 400000 + k * 100000,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- suspensions
const SUSPENSIONS: Row[] = [
  {
    symbol: "MDKA.JK",
    suspension_date: "2026-09-07",
    reason: "Terjadinya penurunan harga kumulatif yang signifikan pada saham MDKA.JK (fixture)",
    pdf_url: "https://www.idx.co.id/StaticData/NewsAndAnnouncement/ANNOUNCEMENTSTOCK/Exchange/",
  },
];

// ---------------------------------------------------------------- news
const NEWS: Row[] = [
  {
    title: "ICBP raises instant-noodle prices in three provinces",
    source: "https://kontan.invalid/fixture-news-1",
    timestamp: `${TODAY}T09:12:00`,
    symbols: ["ICBP.JK"],
    // `Bullish` and `Bearish` are Sectors' own tags. The tone tally counts
    // them and nothing else (METHODOLOGY.md §1), so the fixtures carry the
    // same vocabulary the live feed does.
    tags: ["Bullish", "Consumer", "Pricing"],
  },
  {
    title: "ICBP flags higher wheat costs for the coming quarter",
    source: "https://bisnis.invalid/fixture-news-2",
    timestamp: `${TODAY}T16:40:00`,
    symbols: ["ICBP.JK"],
    tags: ["Bearish", "Consumer"],
  },
  {
    title: "Analysts lift ICBP target after margin beat",
    source: "https://investor.invalid/fixture-news-3",
    timestamp: "2026-09-09T11:20:00",
    symbols: ["ICBP.JK"],
    tags: ["Bullish", "Analyst Ratings"],
  },
  {
    title: "IDX composite closes flat as banks drift",
    source: "https://cnbc.invalid/fixture-news-4",
    timestamp: "2026-09-09T18:05:00",
    symbols: [],
    tags: ["Market Sentiment"],
  },
  {
    title: "TLKM board approves interim dividend schedule",
    source: "https://kontan.invalid/fixture-news-5",
    timestamp: "2026-09-04T11:00:00",
    symbols: ["TLKM.JK"],
    tags: ["Bullish", "Dividend"],
  },
  {
    title: "TLKM data-centre capex questioned by two brokerages",
    source: "https://investor.invalid/fixture-news-6",
    timestamp: "2026-09-08T09:30:00",
    symbols: ["TLKM.JK"],
    tags: ["Bearish", "Capital & Funding"],
  },
  {
    title: "TLKM wins enterprise contract in East Java",
    source: "https://bisnis.invalid/fixture-news-7",
    timestamp: "2026-09-10T14:05:00",
    symbols: ["TLKM.JK"],
    tags: ["Bullish", "Business Expansion"],
  },
  {
    title: "ANTM output guidance cut on ore grade",
    source: "https://kontan.invalid/fixture-news-8",
    timestamp: "2026-09-07T10:15:00",
    symbols: ["ANTM.JK"],
    tags: ["Bearish", "Commodities"],
  },
  {
    title: "ANTM smelter permit delayed again",
    source: "https://katadata.invalid/fixture-news-9",
    timestamp: "2026-09-03T08:40:00",
    symbols: ["ANTM.JK"],
    tags: ["Bearish", "Politics & Regulation"],
  },
  // The backfill covers 90 days, so a month view one step back must not look
  // broken. These sit outside the 14-day tone window on purpose -- they fill
  // the calendar without moving the agenda's coverage tally.
  // --- Duplicate coverage. The live feed carries one story from several
  // sources, and without it nothing in the product can distinguish a story the
  // market picked up from a story one desk filed. These three sets are the
  // only reason the fixtures can demonstrate it.
  {
    title: "TLKM board approves interim dividend schedule, sets October payment",
    source: "https://bisnis.invalid/fixture-news-16",
    timestamp: "2026-09-04T13:20:00",
    symbols: ["TLKM.JK"],
    tags: ["Bullish", "Dividend"],
  },
  {
    title: "Telkom board approves the interim dividend schedule",
    source: "https://cnbc.invalid/fixture-news-17",
    timestamp: "2026-09-05T08:55:00",
    symbols: ["TLKM.JK"],
    tags: ["Bullish", "Dividend"],
  },
  {
    title: "BMRI general meeting to vote on the digital build-out budget",
    source: "https://kontan.invalid/fixture-news-18",
    timestamp: "2026-09-08T10:05:00",
    symbols: ["BMRI.JK"],
    tags: ["Capital & Funding"],
  },
  {
    title: "Mandiri general meeting to vote on its digital build-out budget",
    source: "https://bisnis.invalid/fixture-news-19",
    timestamp: "2026-09-08T16:30:00",
    symbols: ["BMRI.JK"],
    tags: ["Bullish", "Capital & Funding"],
  },
  {
    title: "Brokers split on the BMRI digital build-out budget before the meeting",
    source: "https://investor.invalid/fixture-news-20",
    timestamp: "2026-09-09T09:40:00",
    symbols: ["BMRI.JK"],
    tags: ["Bearish", "Capital & Funding", "Analyst Ratings"],
  },
  {
    title: "Antam output guidance cut on the ore grade",
    source: "https://bisnis.invalid/fixture-news-21",
    timestamp: "2026-09-07T14:25:00",
    symbols: ["ANTM.JK"],
    tags: ["Bearish", "Commodities"],
  },
  {
    title: "BBCA loan growth steady through July, management says",
    source: "https://bisnis.invalid/fixture-news-10",
    timestamp: "2026-08-06T10:00:00",
    symbols: ["BBCA.JK"],
    tags: ["Bullish", "Financial Metrics"],
  },
  {
    title: "IDX tightens disclosure deadlines for small caps",
    source: "https://cnbc.invalid/fixture-news-11",
    timestamp: "2026-08-12T15:30:00",
    symbols: [],
    tags: ["Politics & Regulation"],
  },
  {
    title: "ANTM nickel shipments slip on weather",
    source: "https://kontan.invalid/fixture-news-12",
    timestamp: "2026-08-18T09:05:00",
    symbols: ["ANTM.JK"],
    tags: ["Bearish", "Commodities"],
  },
  {
    title: "TLKM fibre rollout reaches 12 more cities",
    source: "https://bisnis.invalid/fixture-news-13",
    timestamp: "2026-08-21T13:45:00",
    symbols: ["TLKM.JK"],
    tags: ["Bullish", "Business Expansion"],
  },
  {
    title: "ICBP distribution arm opens Sulawesi depot",
    source: "https://investor.invalid/fixture-news-14",
    timestamp: "2026-08-27T08:20:00",
    symbols: ["ICBP.JK"],
    tags: ["Bullish", "Business Expansion"],
  },
  {
    title: "Foreign funds trim IDX bank exposure in August",
    source: "https://cnbc.invalid/fixture-news-15",
    timestamp: "2026-08-29T17:10:00",
    symbols: ["BBCA.JK", "BBRI.JK"],
    tags: ["Bearish", "Foreign Investment"],
  },
];

// ---------------------------------------------------------------- corporate actions
//
// The dividend and AGM histories are what predict.fitAnnualRhythm actually
// fits, and each cast member exercises one branch:
//
//   BBCA  four Decembers, tight spread        -> a window, with a hit rate
//   BBRI  five Novembers, tight spread        -> a window, with a hit rate
//   ICBP  four Octobers, moderate spread      -> a window
//   ASII  four dates spread over five weeks   -> NO window (too wide)
//   ANTM  two dividends ever                  -> NO window (too little history)
//   TLKM  a dated upcoming_dividend           -> a SCHEDULED chip, not predicted
//   PGAS  a dated upcoming_dividend
//   BMRI  a dated AGM inside the horizon
//
const CORPORATE_ACTIONS: Record<string, Row> = {
  TLKM: {
    agm: [{ agm_date: "2026-05-22", agm_time: "14:00:00", agm_place: "Jakarta (fixture)" }],
    dividend: [
      { ex_date: "2023-06-08", payment_date: "2023-06-29", dividend_amount: 132, dividend_yield: 0.0335 },
      { ex_date: "2024-06-06", payment_date: "2024-06-27", dividend_amount: 146, dividend_yield: 0.0361 },
      { ex_date: "2025-06-05", payment_date: "2025-06-26", dividend_amount: 155, dividend_yield: 0.0392 },
    ],
    upcoming_dividend: {
      ex_date: "2026-09-23",
      payment_date: "2026-10-14",
      dividend_amount: 168,
      dividend_yield: 0.0432,
    },
  },
  PGAS: {
    dividend: [
      { ex_date: "2024-05-14", payment_date: "2024-06-04", dividend_amount: 62, dividend_yield: 0.0187 },
      { ex_date: "2025-05-20", payment_date: "2025-06-10", dividend_amount: 68, dividend_yield: 0.0194 },
    ],
    upcoming_dividend: {
      ex_date: "2026-09-24",
      payment_date: "2026-10-15",
      dividend_amount: 74,
      dividend_yield: 0.0211,
    },
  },
  BBCA: {
    agm: [
      { agm_date: "2024-03-14", agm_time: "09:30:00", agm_place: "Menara BCA, Jakarta (fixture)" },
      { agm_date: "2025-03-12", agm_time: "09:30:00", agm_place: "Menara BCA, Jakarta (fixture)" },
      { agm_date: "2026-09-25", agm_time: "09:30:00", agm_place: "Menara BCA, Jakarta (fixture)" },
    ],
    dividend: [
      { ex_date: "2022-12-05", payment_date: "2022-12-23", dividend_amount: 42, dividend_yield: 0.0051 },
      { ex_date: "2023-12-04", payment_date: "2023-12-22", dividend_amount: 48, dividend_yield: 0.0055 },
      { ex_date: "2024-12-06", payment_date: "2024-12-23", dividend_amount: 52, dividend_yield: 0.0059 },
      { ex_date: "2025-12-03", payment_date: "2025-12-22", dividend_amount: 55, dividend_yield: 0.0064 },
    ],
    stock_split: [{ date: "2021-10-13", split_ratio: 5 }],
    upcoming_dividend: null,
  },
  BBRI: {
    agm: [{ agm_date: "2026-03-18", agm_time: "14:00:00", agm_place: "Jakarta (fixture)" }],
    dividend: [
      { ex_date: "2021-11-25", payment_date: "2021-12-16", dividend_amount: 55, dividend_yield: 0.0128 },
      { ex_date: "2022-11-29", payment_date: "2022-12-20", dividend_amount: 62, dividend_yield: 0.0141 },
      { ex_date: "2023-11-27", payment_date: "2023-12-18", dividend_amount: 69, dividend_yield: 0.0152 },
      { ex_date: "2024-11-28", payment_date: "2024-12-19", dividend_amount: 74, dividend_yield: 0.0163 },
      { ex_date: "2025-11-26", payment_date: "2025-12-17", dividend_amount: 80, dividend_yield: 0.0171 },
    ],
    upcoming_dividend: null,
  },
  ICBP: {
    dividend: [
      { ex_date: "2022-10-12", payment_date: "2022-11-02", dividend_amount: 111, dividend_yield: 0.0118 },
      { ex_date: "2023-10-09", payment_date: "2023-10-30", dividend_amount: 118, dividend_yield: 0.0122 },
      { ex_date: "2024-10-16", payment_date: "2024-11-06", dividend_amount: 126, dividend_yield: 0.0129 },
      { ex_date: "2025-10-13", payment_date: "2025-11-03", dividend_amount: 133, dividend_yield: 0.0134 },
    ],
    upcoming_dividend: null,
  },
  ASII: {
    dividend: [
      { ex_date: "2022-10-31", payment_date: "2022-11-21", dividend_amount: 88, dividend_yield: 0.0154 },
      { ex_date: "2023-11-20", payment_date: "2023-12-11", dividend_amount: 94, dividend_yield: 0.0161 },
      { ex_date: "2024-10-08", payment_date: "2024-10-29", dividend_amount: 98, dividend_yield: 0.0168 },
      { ex_date: "2025-11-27", payment_date: "2025-12-18", dividend_amount: 104, dividend_yield: 0.0175 },
    ],
    upcoming_dividend: null,
  },
  ANTM: {
    dividend: [
      { ex_date: "2024-06-12", payment_date: "2024-07-03", dividend_amount: 41, dividend_yield: 0.0242 },
      { ex_date: "2025-06-25", payment_date: "2025-07-16", dividend_amount: 46, dividend_yield: 0.0261 },
    ],
    upcoming_dividend: null,
  },
  BMRI: {
    agm: [
      { agm_date: "2024-03-04", agm_time: "14:00:00", agm_place: "Jakarta (fixture)" },
      { agm_date: "2025-03-10", agm_time: "14:00:00", agm_place: "Jakarta (fixture)" },
      { agm_date: "2026-09-16", agm_time: "10:00:00", agm_place: "Plaza Mandiri, Jakarta (fixture)" },
    ],
    dividend: [
      { ex_date: "2025-04-08", payment_date: "2025-04-29", dividend_amount: 294, dividend_yield: 0.0512 },
    ],
    upcoming_dividend: null,
  },
};

// ---------------------------------------------------------------- quarterly dates
// Spec-faithful: every date is its own quarter end, which is exactly what the
// falsifier is there to detect.
const QUARTER_ENDS: Record<string, string[][]> = {
  "2025": [
    ["2025-03-31", "q1"],
    ["2025-06-30", "q2"],
    ["2025-09-30", "q3"],
    ["2025-12-31", "q4"],
  ],
  "2026": [
    ["2026-03-31", "q1"],
    ["2026-06-30", "q2"],
  ],
};

const REPORTED: Row[] = [
  { symbol: "BBCA.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "BBRI.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "BMRI.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "TLKM.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "ASII.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "ANTM.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "ICBP.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "PGAS.JK", date: "2026-06-30", quarter: "q2" },
  { symbol: "BRIS.JK", date: "2026-06-30", quarter: "q2" },
];

// ---------------------------------------------------------------- daily closes
// A deterministic walk, so the demo's calendar shows the same green and red
// every time it is rebuilt. Fabricated, like everything else here.
const BASE_CLOSE: Record<string, number> = {
  // The fabricated indices the demo colours its market-wide calendar from.
  IHSG: 7850,
  LQ45: 985,
  BBCA: 8650, BBRI: 4680, BMRI: 6125, TLKM: 3890,
  ASII: 5725, ANTM: 1905, ICBP: 11250, PGAS: 1640,
};

function dailyRows(symbol: string, start: string, end: string): Row[] {
  const base = BASE_CLOSE[symbol];
  if (!base) return [];
  const out: Row[] = [];
  // Older than 120 days: a walk of its own, so the index strip's 1Y has a
  // year to measure while the 120 days every other test pins stay as they were.
  let old = Math.round(base * 0.92);
  for (let i = 400; i > 120; i--) {
    const date = shift(TODAY, -i);
    if (isWeekend(date)) continue;
    const seed = (symbol.charCodeAt(0) + Number(date.slice(8)) * 5 + Number(date.slice(5, 7))) % 13;
    old = Math.round(old * (1 + (seed - 6) / (symbol === "IHSG" || symbol === "LQ45" ? 2400 : 400)));
    if (date >= start && date <= end) {
      out.push({ symbol: `${symbol}.JK`, date, close: old, volume: 1e8 + seed * 1e7, market_cap: old * 1e11 });
    }
  }
  let close = base;
  for (let i = 120; i >= 0; i--) {
    const date = shift(TODAY, -i);
    if (isWeekend(date)) continue;
    // A repeatable pseudo-walk: mostly small moves, a few that matter.
    const seed = (symbol.charCodeAt(0) + Number(date.slice(8)) * 7 + Number(date.slice(5, 7))) % 17;
    // An index is not a single name: the composite is a weighted average of
    // ~950 of them, so it moves a fraction as far on the same day. Damped here
    // so the fixture strip bands the way a real one would (config.INDEX_BANDS).
    const move = (seed - 8) / (symbol === "IHSG" || symbol === "LQ45" ? 1600 : 250);
    close = Math.round(close * (1 + move));
    if (date >= start && date <= end) {
      out.push({ symbol: `${symbol}.JK`, date, close, volume: 1e8 + seed * 1e7, market_cap: close * 1e11 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- router

function sym(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return (parts.at(-1) ?? "").toUpperCase().replace(/\.JK$/, "");
}

function page(rows: Row[], params: Row): Row {
  const limit = Number(params.limit ?? 30);
  const offset = Number(params.offset ?? 0);
  const slice = rows.slice(offset, offset + limit);
  return {
    results: slice,
    pagination: {
      total_count: rows.length,
      showing: slice.length,
      limit,
      offset,
      has_next: offset + limit < rows.length,
      next_offset: offset + limit,
    },
  };
}

function within(date: string, params: Row): boolean {
  if (params.start && date < String(params.start)) return false;
  if (params.end && date > String(params.end)) return false;
  return true;
}


// ---------------------------------------------------------------- the board
// The heatmap's whole input, in the shape ONE /v2/companies/ call returns:
// `query_values` carries exactly the fields the `where` clause named, which is
// why the live call filters on all four. The sectors and sub-sectors are IDX's
// real vocabulary (measured, not invented); the caps and the moves are
// fabricated like everything else here.
//
// Deliberately overlaps the news and filing fixtures above -- ICBP, TLKM,
// MDKA, ASII, ANTM and the rest -- so the demo shows tiles both with and
// without something on the record, which is the honest ratio a live board has.
const BOARD: [string, string, string, string, number, number][] = [
  ["BBCA", "PT Bank Central Asia Tbk.", "Financials", "Banks", 775, 0.004],
  ["BBRI", "PT Bank Rakyat Indonesia (Persero) Tbk", "Financials", "Banks", 500, -0.012],
  ["BMRI", "PT Bank Mandiri (Persero) Tbk", "Financials", "Banks", 402, 0.021],
  ["BBNI", "PT Bank Negara Indonesia (Persero) Tbk", "Financials", "Banks", 138, -0.005],
  ["BRIS", "PT Bank Syariah Indonesia Tbk", "Financials", "Banks", 75, 0.038],
  ["BRPT", "PT Barito Pacific Tbk", "Basic Materials", "Basic Materials", 230, -0.041],
  ["AMMN", "PT Amman Mineral Internasional Tbk.", "Basic Materials", "Basic Materials", 356, 0.051],
  ["ANTM", "PT Aneka Tambang Tbk", "Basic Materials", "Basic Materials", 88, 0.027],
  ["MDKA", "PT Merdeka Copper Gold Tbk", "Basic Materials", "Basic Materials", 54, -0.063],
  ["INKP", "PT Indah Kiat Pulp & Paper Tbk", "Basic Materials", "Basic Materials", 41, 0.006],
  ["TPIA", "PT Chandra Asri Pacific Tbk", "Basic Materials", "Basic Materials", 62, -0.018],
  ["TLKM", "PT Telkom Indonesia (Persero) Tbk", "Infrastructures", "Telecommunication", 268, 0.014],
  ["EXCL", "PT XLSmart Telecom Sejahtera Tbk", "Infrastructures", "Telecommunication", 47, -0.022],
  ["TOWR", "PT Sarana Menara Nusantara Tbk", "Infrastructures", "Telecommunication", 33, 0.002],
  ["PGAS", "PT Perusahaan Gas Negara Tbk", "Infrastructures", "Utilities", 39, -0.009],
  ["JSMR", "PT Jasa Marga (Persero) Tbk", "Infrastructures", "Transportation Infrastructure", 31, 0.017],
  ["ADRO", "PT Alamtri Resources Indonesia Tbk", "Energy", "Oil, Gas & Coal", 96, -0.031],
  ["AADI", "PT Adaro Andalan Indonesia Tbk", "Energy", "Oil, Gas & Coal", 91, 0.04],
  ["PTBA", "PT Bukit Asam Tbk", "Energy", "Oil, Gas & Coal", 34, -0.015],
  ["MEDC", "PT Medco Energi Internasional Tbk", "Energy", "Oil, Gas & Coal", 29, 0.008],
  ["ITMG", "PT Indo Tambangraya Megah Tbk", "Energy", "Oil, Gas & Coal", 27, -0.003],
  ["ICBP", "PT Indofood CBP Sukses Makmur Tbk", "Consumer Non-Cyclicals", "Food & Beverage", 128, 0.033],
  ["INDF", "PT Indofood Sukses Makmur Tbk", "Consumer Non-Cyclicals", "Food & Beverage", 72, 0.011],
  ["UNVR", "PT Unilever Indonesia Tbk", "Consumer Non-Cyclicals", "Nondurable Household Products", 64, -0.026],
  ["GGRM", "PT Gudang Garam Tbk", "Consumer Non-Cyclicals", "Tobacco", 22, -0.007],
  ["HMSP", "PT H.M. Sampoerna Tbk", "Consumer Non-Cyclicals", "Tobacco", 78, 0.001],
  ["AMRT", "PT Sumber Alfaria Trijaya Tbk", "Consumer Non-Cyclicals", "Food & Staples Retailing", 110, 0.019],
  ["ASII", "PT Astra International Tbk", "Consumer Cyclicals", "Automobiles & Components", 198, -0.048],
  ["MAPI", "PT Mitra Adiperkasa Tbk", "Consumer Cyclicals", "Retailing", 24, 0.012],
  ["ACES", "PT Aspirasi Hidup Indonesia Tbk", "Consumer Cyclicals", "Retailing", 13, -0.02],
  ["SIDO", "PT Industri Jamu dan Farmasi Sido Muncul Tbk", "Healthcare", "Pharmaceuticals & Health Care Research", 18, 0.029],
  ["KLBF", "PT Kalbe Farma Tbk", "Healthcare", "Pharmaceuticals & Health Care Research", 68, -0.011],
  ["SILO", "PT Siloam International Hospitals Tbk", "Healthcare", "Healthcare Equipment & Providers", 31, 0.006],
  ["BREN", "PT Barito Renewables Energy Tbk", "Infrastructures", "Utilities", 412, -0.055],
  ["DCII", "PT DCI Indonesia Tbk", "Technology", "Software & IT Services", 87, 0.044],
  ["GOTO", "PT GoTo Gojek Tokopedia Tbk", "Technology", "Software & IT Services", 76, -0.034],
  ["BELI", "PT Global Digital Niaga Tbk", "Technology", "Software & IT Services", 41, -0.069],
  ["CTRA", "PT Ciputra Development Tbk", "Properties & Real Estate", "Properties & Real Estate", 17, 0.009],
  ["BSDE", "PT Bumi Serpong Damai Tbk", "Properties & Real Estate", "Properties & Real Estate", 21, -0.014],
  ["PANI", "PT Pantai Indah Kapuk Dua Tbk", "Properties & Real Estate", "Properties & Real Estate", 190, 0.023],
  ["UNTR", "PT United Tractors Tbk", "Industrials", "Industrial Goods", 95, -0.016],
  ["ASSA", "PT Adi Sarana Armada Tbk", "Transportation & Logistic", "Logistics & Deliveries", 9, 0.036],
];

// ---------------------------------------------------------------- the movers
// Five gainers and five losers over each of five periods, in the shape ONE
// /v2/companies/top-changes/ call returns: {classification: {period: rows}}.
//
// The cast is drawn from BOARD above plus a few names that are NOT on it --
// SOHO, MDIA, SHIP, CARE -- because that is the honest shape of this list: the
// biggest movers on IDX are frequently small companies far outside the 200
// largest, which is exactly why so few of them have a headline on record. A
// fixture where every mover is a blue chip with three stories would demo a
// product that does not exist.
const MOVER_CAST: [string, string, number][] = [
  ["SOHO", "PT Soho Global Health Tbk", 1505],
  ["MDIA", "PT Intermedia Capital Tbk", 250],
  ["SHIP", "PT Sillo Maritime Perdana Tbk", 2690],
  ["ICBP", "PT Indofood CBP Sukses Makmur Tbk", 11200],
  ["ANTM", "PT Aneka Tambang Tbk", 3140],
  ["CARE", "PT Metro Healthcare Indonesia Tbk", 336],
  ["MDKA", "PT Merdeka Copper Gold Tbk", 1820],
  ["BREN", "PT Barito Renewables Energy Tbk", 5975],
  ["TLKM", "PT Telkom Indonesia (Persero) Tbk", 2710],
  ["BELI", "PT Global Digital Niaga Tbk", 352],
];

/** Deterministic, period-dependent, and never zero: a fixture that returned
 * the same ladder for every period would make the switcher look broken. */
function movers(period: string, gaining: boolean): Row[] {
  const span = Number(period.replace("d", ""));
  const base = Math.log10(span + 1) * 0.11; // a month moves further than a day
  return MOVER_CAST.slice(gaining ? 0 : 5).slice(0, 5).map((c, i) => {
    const [symbol, name, close] = c;
    const mag = base + (5 - i) * 0.018 + (span % 7) * 0.004;
    return {
      name,
      symbol: `${symbol}.JK`,
      price_change: Number(((gaining ? 1 : -1) * mag).toFixed(12)),
      last_close_price: close,
      latest_close_date: TODAY,
    };
  });
}

export function mockRoute(path: string, params?: Record<string, any>): any {
  const p = params ?? {};

  if (path.startsWith("/v2/filings/")) {
    return page(filings().filter((r) => within(r.timestamp.slice(0, 10), p)), p);
  }
  if (path.startsWith("/v2/suspensions/")) {
    return page(SUSPENSIONS.filter((r) => within(r.suspension_date, p)), p);
  }
  if (path.startsWith("/v2/news/")) {
    return page(NEWS.filter((r) => within(r.timestamp.slice(0, 10), p)), p);
  }
  if (path.startsWith("/v2/companies/quarterly-financial-dates/")) {
    const since = p.since ? String(p.since) : null;
    return page(REPORTED.filter((r) => !since || r.date >= since), p);
  }
  // Must come BEFORE the bare /v2/companies/ branch below: both match that
  // prefix, and the more specific path has to win.
  if (path.startsWith("/v2/companies/top-changes/")) {
    const periods = String(p.periods ?? "1d").split(",").map((x: string) => x.trim()).filter(Boolean);
    const n = Number(p.n_stock ?? 5);
    const byPeriod = (gaining: boolean) =>
      Object.fromEntries(periods.map((per: string) => [per, movers(per, gaining).slice(0, n)]));
    return { top_gainers: byPeriod(true), top_losers: byPeriod(false) };
  }

  // Must come AFTER the quarterly-financial-dates branch above: both start
  // with /v2/companies/, and the more specific path has to win.
  if (path.startsWith("/v2/companies/")) {
    const rows = BOARD.map(([symbol, company_name, sector, sub_sector, cap, chg]) => ({
      symbol: `${symbol}.JK`,
      company_name,
      query_values: {
        sector,
        sub_sector,
        market_cap: cap * 1e12,
        daily_close_change: chg,
      },
    }));
    rows.sort((a, b) => b.query_values.market_cap - a.query_values.market_cap);
    return { results: rows.slice(0, Number(p.limit ?? 200)) };
  }

  if (path.startsWith("/v2/company/corporate-actions/")) {
    const s = sym(path);
    return { symbol: `${s}.JK`, corporate_actions: CORPORATE_ACTIONS[s] ?? {} };
  }
  if (path.startsWith("/v2/company/get_quarterly_financial_dates/")) {
    return QUARTER_ENDS;
  }
  if (path.startsWith("/v2/daily/")) {
    const s = sym(path);
    const end = String(p.end ?? TODAY);
    const start = String(p.start ?? shift(end, -30));
    return { results: dailyRows(s, start, end) };
  }
  if (path.startsWith("/v2/index-daily/")) {
    // The real shape: a bare array, a lowercase code in the path, `price`.
    const code = path.split("/").filter(Boolean).at(-1)!.toUpperCase();
    const end = String(p.end ?? TODAY);
    const start = String(p.start ?? shift(end, -30));
    return dailyRows(code, start, end).map((r: any) => ({ index_code: code, date: r.date, price: r.close }));
  }
  if (path.startsWith("/v2/tags/")) {
    // Placeholder: the real IDX vocabulary is probe Q12's answer, committed
    // once it has been measured. Fixtures never stand in for a measurement.
    return { tags: ["fixture-tag-a", "fixture-tag-b"] };
  }

  throw new Error(`no fixture for ${path} -- add one rather than calling the network in MOCK_MODE`);
}
