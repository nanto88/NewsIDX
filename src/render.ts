/**
 * Server-rendered HTML. plan.md §4.
 *
 * The tokens below are copied verbatim from ../sentry_fin/design-system.html
 * (dark is :root, light is the opt-in), and render.test.ts asserts them one by
 * one. That test is the reason this UI cannot drift: change a hex here and the
 * suite fails before anyone sees the page.
 *
 * No bundler, no client framework, no webfont download -- the token stacks name
 * Inter and JetBrains Mono and then fall back to the system, so there is no
 * render-blocking request. The only JavaScript on the page is the theme
 * toggle; every navigation is a real <a href>.
 */
import {
  Cell,
  Day,
  Item,
  MAX_TAGS,
  Pulse,
  Timeline,
  kindLabel,
  matchesTag,
  parseTags,
  sentimentOf,
} from "./calendar.js";
import { type Attention, contributions } from "./attention.js";
import type { Board, SectorBox, Tile } from "./heatmap.js";
import type { AskRow, FaqRow } from "./db.js";
import { MAX_QUESTION } from "./faq.js";
import { fmtPct, hitRateLabel } from "./predict.js";
import {
  ATTENTION_BASELINE_DAYS,
  ATTENTION_NEAR_DAYS,
  BOARD_HEAD_PX,
  BOARD_MIN_H_PX,
  BOARD_MIN_PX,
  EQUITY_BANDS,
  INDEX_BANDS,
  isIndex,
} from "./config.js";
import { daysBetween, fmtLong, fmtRange, fmtShort, fmtWithDay, monthLabel, shift, today as todayIso } from "./dates.js";

/** What each weighted component is called on the page. The keys are
 * ATTENTION_WEIGHTS'; naming them here keeps the wording out of the maths. */
const ATTENTION_LABEL: Record<string, string> = {
  pickup: "pickup vs its own usual",
  speed: "speed of pickup",
  event: "near a dated event",
  split: "sources disagree",
  move: "same-day price move",
  held: "name you hold",
  fresh: "recency",
};

/**
 * The generative mark on the briefing button -- the four-point sparkle that
 * has become the standard "a model wrote this" affordance.
 *
 * Inline and drawn in `currentColor` rather than fetched, because this page
 * makes no third-party requests and carries two themes: a remote PNG would be
 * a render-blocking hop to someone else's CDN, would leak every reader's IP to
 * it, and would still be black in dark mode. It is also the only icon in the
 * product, so it is a shape here rather than a sprite sheet.
 */
const AI_MARK = `<svg class="ai" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M14 2 16 7.5 21.5 9.5 16 11.5 14 17 12 11.5 6.5 9.5 12 7.5Z"/>
  <path fill="currentColor" d="M6 13 7 16 10 17 7 18 6 21 5 18 2 17 5 16Z"/>
</svg>`;

export const STYLE = `
  /* Tokens copied verbatim from ../sentry_fin/design-system.html — dark is :root, light is opt-in.
     plan.md §4: the token-drift test asserts against that file, so these values do not get "improved". */
  :root{
    color-scheme: dark light;
    --primary:#22d3ff; --primary-light:#a5f0ff; --primary-dark:#5ce1ff;
    --up:#2AB673; --down:#e5484d;
    --font-ui:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    --font-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    --bg:#0a0908; --surface:#131211; --surface-2:#191816; --surface-3:#211f1c;
    --border:#26241f; --border-strong:#332f28;
    --text:#f3f1ed; --text-muted:#a29d93; --text-faint:#6b665e;
    --primary-wash: color-mix(in srgb, var(--primary) 15%, transparent);
    --up-wash: color-mix(in srgb, var(--up) 14%, transparent);
    --down-wash: color-mix(in srgb, var(--down) 12%, transparent);
    --ring: color-mix(in srgb, var(--text) 14%, transparent);
    --shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 28px -10px rgba(0,0,0,.5);
    --ease: cubic-bezier(.2,.7,.3,1);
  }
  :root[data-theme="light"]{
    --primary:#0091ea; --primary-light:#40c4ff; --primary-dark:#0064a8;
    --bg:#faf8f6; --surface:#ffffff; --surface-2:#f5f2ef; --surface-3:#efece8;
    --border:#ece8e3; --border-strong:#ddd7cf;
    --text:#1a1a1a; --text-muted:#6d6a64; --text-faint:#a29d94;
    --primary-wash: color-mix(in srgb, var(--primary) 11%, transparent);
    --shadow: 0 1px 2px rgba(20,15,5,.04), 0 8px 24px -8px rgba(20,15,5,.08);
  }
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){
      --primary:#0091ea; --primary-light:#40c4ff; --primary-dark:#0064a8;
      --bg:#faf8f6; --surface:#ffffff; --surface-2:#f5f2ef; --surface-3:#efece8;
      --border:#ece8e3; --border-strong:#ddd7cf;
      --text:#1a1a1a; --text-muted:#6d6a64; --text-faint:#a29d94;
      --primary-wash: color-mix(in srgb, var(--primary) 11%, transparent);
      --shadow: 0 1px 2px rgba(20,15,5,.04), 0 8px 24px -8px rgba(20,15,5,.08);
    }
  }

  /* Ours, not the design system's: the colour a filter turns when it is ON.
     The primary is the product's own accent and is already everywhere --
     brand dot, tabs, scheduled chips -- so an active filter painted in it
     reads as chrome. Orange belongs to nothing else here, which is the whole
     job: at a glance you can see the page is showing you less than it has. */
  :root{
    --on:#ff9f43;
    --on-wash: color-mix(in srgb, var(--on) 16%, transparent);
  }
  :root[data-theme="light"]{ --on:#b8560c; }
  @media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){ --on:#b8560c; } }

  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-ui);
       font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
  h1,h2,h3{margin:0;text-wrap:balance}
  .mono,time,.tick,.num{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
  a{color:inherit}
  :focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px}
  @media (prefers-reduced-motion:reduce){*{transition-duration:.001ms !important;animation-duration:.001ms !important}}

  .wrap{max-width:780px;margin:0 auto;padding:0 16px 56px}

  /* ---------------- chrome ---------------- */
  .mock{background:var(--primary-wash);border-bottom:1px solid var(--border);
        font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;
        color:var(--primary-dark);padding:7px 16px;text-align:center}
  .top{display:flex;align-items:center;gap:12px;padding:18px 0 14px;border-bottom:1px solid var(--border)}
  .brand{font-size:17px;font-weight:700;letter-spacing:-.015em;display:flex;align-items:baseline;gap:9px}
  .brand .dot{width:7px;height:7px;border-radius:50%;background:var(--primary);box-shadow:0 0 10px var(--primary-wash)}
  .brand small{font-family:var(--font-mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;
               text-transform:uppercase;color:var(--text-faint)}
  .top .sp{flex:1}
  button.ghost{background:var(--surface);color:var(--text-muted);border:1px solid var(--border);
               border-radius:8px;padding:7px 11px;font-size:12px;font-family:inherit;cursor:pointer;min-height:34px}
  button.ghost:hover{color:var(--text);border-color:var(--border-strong)}

  /* tabs = the two routes worth a tab; a single day is a drill-down */
  .tabs{display:flex;gap:4px;overflow-x:auto;padding:12px 0 0;scrollbar-width:none}
  .tabs::-webkit-scrollbar{display:none}
  .tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--text-muted);
       font-family:var(--font-mono);font-size:12px;padding:8px 11px;cursor:pointer;white-space:nowrap;min-height:44px}
  .tab:hover{color:var(--text)}
  .tab[aria-selected="true"]{color:var(--primary);border-bottom-color:var(--primary)}

  /* ---------------- shared pieces ---------------- */
  .kicker{font-family:var(--font-mono);font-size:10.5px;font-weight:600;letter-spacing:.09em;
          text-transform:uppercase;color:var(--text-faint);margin:26px 0 10px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}
  .muted{color:var(--text-muted)}
  .faint{color:var(--text-faint)}

  .wl{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 0 0}
  .wl-label{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--text-faint)}
  .wl form{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .wl-picked{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .wl-count{font-size:11px;color:var(--text-faint);margin-left:auto;white-space:nowrap}
  .wl-warn{flex-basis:100%;margin:2px 0 0;font-size:12px;color:var(--down)}
  .wl-warn b{font-family:var(--font-mono);font-weight:600}

  /* Methodology lives one click away: present, never in front of the answer. */
  details.why{margin-top:6px}
  details.why > summary{font-family:var(--font-mono);font-size:11px;color:var(--text-faint);
                        cursor:pointer;list-style:none;width:fit-content;
                        border-bottom:1px dashed var(--border-strong);padding:1px 0}
  details.why > summary::-webkit-details-marker{display:none}
  details.why > summary::before{content:"▸ ";display:inline-block;transition:transform .12s var(--ease)}
  details.why[open] > summary::before{content:"▾ "}
  details.why > summary:hover{color:var(--text-muted)}
  details.why[open] > summary{margin-bottom:5px}
  details.why > :not(summary){font-size:12px;color:var(--text-muted);line-height:1.5}
  details.why.block{margin-top:22px}
  details.why.block > summary{font-size:12px}
  .wl .pill{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);
            border:1px solid var(--border);border-radius:999px;padding:4px 10px}
  .wl .pill.add{color:var(--text-faint);border-style:dashed;text-decoration:none}
  .wl .pill.all{color:var(--primary-dark);border-color:color-mix(in srgb,var(--primary) 32%,transparent);
                background:var(--primary-wash)}

  /* ---------------- chips: three classes, three shapes (plan.md §2) ---------------- */
  .rows{display:flex;flex-direction:column;gap:7px}
  .chip{display:grid;grid-template-columns:78px 52px 1fr;gap:12px;align-items:baseline;
        padding:11px 13px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2)}
  .chip .when{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
  .chip .tick{font-size:12.5px;font-weight:600}
  .chip .what{font-size:13px}
  .chip .kind{font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;
              color:var(--text-faint);display:block;margin-bottom:3px}
  .chip.sched{box-shadow:inset 2px 0 0 var(--primary)}
  .chip.sched .kind{color:var(--primary-dark)}
  .chip.fact .kind{color:var(--text-faint)}
  /* Predicted: no fill and a dashed edge. A shape, not a colour -- colour
     alone fails colour-blind readers and fails a compressed video. */
  .chip.pred{background:none;border-style:dashed}
  .chip.pred .when,.chip.pred .kind,.chip.pred .what{color:var(--text-muted)}
  .chip.pred .when{font-weight:600}
  details.how{margin-top:5px}
  details.how summary{font-size:11px;color:var(--text-faint);cursor:pointer;list-style:none}
  details.how summary::-webkit-details-marker{display:none}
  details.how summary::before{content:"▸ ";font-size:9px}
  details.how[open] summary::before{content:"▾ "}
  details.how .note{margin-top:4px;font-size:11.5px}
  .drop{font-family:var(--font-mono);font-size:11.5px;color:var(--down)}
  .note{color:var(--text-muted);font-size:12px;margin-top:3px}
  .src{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);
       border-bottom:1px dashed color-mix(in srgb,var(--primary) 40%,transparent);cursor:default}

  .legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:22px;padding-top:14px;border-top:1px solid var(--border)}
  .legend span{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--text-muted)}
  .sw{width:22px;height:13px;border-radius:4px;border:1px solid var(--border);background:var(--surface-2)}
  .sw.s{box-shadow:inset 2px 0 0 var(--primary)}
  .sw.p{background:none;border-style:dashed}

  /* ---------------- month grid ---------------- */
  .mhead{display:flex;align-items:center;gap:10px;margin-top:18px}
  .mhead h2{font-size:15px;font-family:var(--font-mono);font-weight:600}
  .mtitle{font-size:16px;font-family:var(--font-mono);font-weight:600;margin-top:20px}

  /* --- which company's closes colour the grid */
  .pricefilter{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:12px;
               scroll-margin-top:14px}
  .pricefilter label{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.07em;
                     text-transform:uppercase;color:var(--text-faint)}
  .pricefilter select{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
                      border:1px solid var(--border);border-radius:999px;padding:6px 11px;min-height:34px}
  .pricefilter select:focus-visible{border-color:var(--primary)}
  .pricefilter button{font-family:var(--font-mono);font-size:12px;background:var(--surface);color:var(--text-muted);
                      border:1px solid var(--border);border-radius:999px;padding:6px 12px;cursor:pointer;min-height:34px}
  .pricefilter button:hover{color:var(--text);border-color:var(--border-strong)}
  .pricefilter .hint{font-size:11.5px;color:var(--text-faint)}
  .dow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:14px 0 5px}
  .dow span{font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--text-faint);text-align:center}
  .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
  .cell{background:var(--surface);border:1px solid var(--border);border-radius:8px;
        min-height:88px;padding:6px;display:flex;flex-direction:column;gap:4px}
  .cell .d{font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .cell.wknd{background:var(--surface-2);border-color:transparent}
  .cell.out{opacity:.38}
  .cell.today{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary-wash)}
  .cell.today .d{color:var(--primary);font-weight:600}
  .mini{font-family:var(--font-mono);font-size:9.5px;line-height:1.35;padding:2px 4px;border-radius:4px;
        background:var(--surface-2);border:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mini.s{box-shadow:inset 2px 0 0 var(--primary)}
  .more{font-family:var(--font-mono);font-size:9.5px;color:var(--text-faint);padding-left:3px}
  .dots{display:none;gap:3px}
  .dots i{width:5px;height:5px;border-radius:50%;background:var(--text-muted)}
  .dots i.s{background:var(--primary)}
  @media (max-width:880px){ .summary{grid-template-columns:repeat(2,1fr)} }
  @media (max-width:640px){
    .cell{min-height:52px;align-items:flex-start}
    .mini,.more{display:none}
    .dots{display:flex}
    .summary{grid-template-columns:1fr}
    .chip{grid-template-columns:1fr;gap:2px}
    .chip .when{order:-1}
  }

  /* ---------------- day + ticker ---------------- */
  .daycard{display:flex;flex-direction:column;gap:7px;margin-top:8px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  .tw{overflow-x:auto;margin-top:10px;border:1px solid var(--border);border-radius:10px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
  th{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;
     color:var(--text-faint);font-weight:600;background:var(--surface-2)}
  tbody tr:last-child td{border-bottom:0}

  .empty{border:1px dashed var(--border-strong);border-radius:10px;padding:14px;color:var(--text-muted);font-size:13px}
  footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--border);
         font-family:var(--font-mono);font-size:11px;color:var(--text-faint);
         display:flex;flex-wrap:wrap;gap:6px 16px}
  [hidden]{display:none !important}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0 0 0 0);white-space:nowrap;border:0}

  /* --- added for the served app: the watchlist is an input, not a static pill row */
  .wl form{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  /* One company at a time, so the field is short and the dropdown works. */
  .wl input{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
            border:1px solid var(--border);border-radius:999px;padding:6px 12px;
            width:190px;min-width:120px;flex:0 1 190px;min-height:34px}
  .wl input:focus-visible{border-color:var(--primary)}
  @media (max-width:640px){
    .wl-count{margin-left:0}
    .wl input{flex:1 1 140px;width:auto}
  }
  .wl input::placeholder{color:var(--text-faint)}
  .wl button{font-family:var(--font-mono);font-size:12px;background:var(--surface);color:var(--text-muted);
             border:1px solid var(--border);border-radius:999px;padding:6px 12px;cursor:pointer;min-height:34px}
  .wl button:hover{color:var(--text);border-color:var(--border-strong)}
  a.pill{text-decoration:none}
  a.pill:hover{border-color:var(--border-strong);color:var(--text)}
  a.src{cursor:pointer}
  a.src:hover{color:var(--primary)}
  .tab{text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .cellwrap{display:block;text-decoration:none;color:inherit}
  .cellwrap:hover .cell{border-color:var(--border-strong)}
  .tickerlink{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);text-decoration:none}
  .tickerlink:hover{text-decoration:underline}

  /* --- ticker filter, shared by /month, /day and /ticker */
  .tf{display:flex;gap:6px;align-items:center;margin-left:auto}
  .tf select{font-family:var(--font-mono);font-size:12px;background:var(--surface);color:var(--text);
             border:1px solid var(--border);border-radius:8px;padding:6px 9px;min-height:34px}
  .tf button{font-family:var(--font-mono);font-size:12px;background:var(--surface);color:var(--text-muted);
             border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;min-height:34px}
  .tf button:hover{color:var(--text);border-color:var(--border-strong)}
  .tf label{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-faint)}

  /* --- hover card on a calendar cell. Touch devices have no hover, so the
         whole cell is a link to /day and the card is suppressed below 640px. */
  .cellwrap{position:relative}
  .cellwrap>a{display:block;text-decoration:none;color:inherit}
  .pop{position:absolute;z-index:20;left:0;top:calc(100% + 4px);width:280px;
       background:var(--surface-3);border:1px solid var(--border-strong);border-radius:10px;
       padding:10px;box-shadow:var(--shadow);opacity:0;visibility:hidden;
       transition:opacity .12s var(--ease)}
  /* The card now holds a link, so the pointer has to cross the 4px gap to
     reach it. This bridges the gap without moving the card. */
  .pop::before{content:"";position:absolute;inset:-6px;z-index:-1}
  .cellwrap:nth-child(7n) .pop,.cellwrap:nth-child(7n-1) .pop{left:auto;right:0}
  .cellwrap:nth-child(n+29) .pop{top:auto;bottom:calc(100% + 4px)}
  /* Plain :focus-within keeps the card open after a MOUSE click on the
     calendar link: the link holds focus, so the card outlives the pointer and
     sits there until you click somewhere else. Swapping in :focus-visible
     alone is worse -- it breaks the keyboard path, because focus leaves the
     day link before it lands on the calendar link, the card closes in the gap
     and the browser drops the now-invisible target to <body>.
     So: open while focus is anywhere inside, UNLESS the thing holding it is
     the calendar link focused without a ring, which is exactly the click. */
  .cellwrap:hover .pop,
  .cellwrap:focus-within:not(:has(.gcal:focus:not(:focus-visible))) .pop{opacity:1;visibility:visible}
  .pop h4{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.05em;
          color:var(--text-muted);margin-bottom:6px}
  .pop ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
  .pop li{font-size:11.5px;line-height:1.35;display:flex;gap:6px;align-items:baseline}
  .pop li .k{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
             color:var(--text-faint);flex:0 0 auto}
  .pop li.s .k{color:var(--primary-dark)}
  .pop li.p{color:var(--text-muted)}
  .pop .more{font-family:var(--font-mono);font-size:10px;color:var(--text-faint);margin-top:6px}
  .pop .gcal{display:inline-block;margin-top:8px;font-family:var(--font-mono);font-size:10px;
             letter-spacing:.05em;color:var(--primary-dark);text-decoration:none}
  .pop .gcal:hover{text-decoration:underline}
  @media (max-width:640px){ .pop{display:none} }

  /* --- sentiment: Sectors' own Bullish/Bearish tag, in the semantic colours
         the design system already reserves for up and down. The headline
         itself carries the colour -- a tagged story IS the signal, so there is
         nothing else to badge. */
  .pos{color:var(--up)}
  .neg{color:var(--down)}
  .sent{font-family:var(--font-mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase}

  /* --- steppers: one treatment for every prev/next in the product, whether it
         moves through a list, a month or a day. Each side says where it goes,
         because "←" alone makes you click to find out. */
  .pager{display:flex;align-items:center;gap:8px;margin-top:12px;
         font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .pager .mid{flex:1;text-align:center;line-height:1.35}
  .pager .mid b{color:var(--text);font-weight:600}
  .pager .of{display:block;font-size:10.5px;color:var(--text-faint)}
  .pg{display:inline-flex;align-items:center;gap:7px;text-decoration:none;
      font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);
      background:var(--surface);border:1px solid var(--border);border-radius:9px;
      padding:7px 12px;min-height:36px;transition:border-color .12s var(--ease),color .12s var(--ease)}
  .pg:hover{color:var(--text);border-color:var(--border-strong);background:var(--surface-2)}
  .pg .ar{color:var(--text-faint);font-size:13px;line-height:1}
  .pg:hover .ar{color:var(--primary)}
  .pg .lb{display:flex;flex-direction:column;line-height:1.2}
  .pg .lb small{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-faint)}
  .pg[aria-disabled="true"]{opacity:.38;pointer-events:none;background:transparent}
  .pg.next{margin-left:auto;text-align:right}
  .pg.next .lb{align-items:flex-end}
  @media (max-width:640px){
    .pager{flex-wrap:wrap}
    .pager .mid{order:3;flex-basis:100%;text-align:left}
    .pg{flex:1}
    .pg.next{margin-left:0;justify-content:flex-end}
  }

  /* --- daily close on a ticker-filtered grid. Direction is the colour;
         SIZE is the band, so a 4% day is visibly not a 0.2% day. Three bands
         only: more would be a heat map nobody can read at a glance. */
  .px{display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-top:auto;
      font-family:var(--font-mono);font-size:11px;color:var(--text-muted)}
  .px .c{font-weight:600;color:var(--text)}
  .px .d{font-size:10px}
  .cell.up1{background:color-mix(in srgb,var(--up) 7%,var(--surface))}
  .cell.up2{background:color-mix(in srgb,var(--up) 15%,var(--surface))}
  .cell.up3{background:color-mix(in srgb,var(--up) 26%,var(--surface))}
  .cell.dn1{background:color-mix(in srgb,var(--down) 7%,var(--surface))}
  .cell.dn2{background:color-mix(in srgb,var(--down) 15%,var(--surface))}
  .cell.dn3{background:color-mix(in srgb,var(--down) 26%,var(--surface))}
  /* The whole strip takes the direction, close included. Tinting only the
     little percentage left the number a reader actually looks at -- the close
     -- printed in plain body text on every single day, so the grid read as
     uncoloured at a glance and you had to find the +/- to know which way the
     day went. */
  .cell.up1 .px,.cell.up2 .px,.cell.up3 .px,
  .cell.up1 .px .c,.cell.up2 .px .c,.cell.up3 .px .c,
  .cell.up1 .px .d,.cell.up2 .px .d,.cell.up3 .px .d{color:var(--up)}
  .cell.dn1 .px,.cell.dn2 .px,.cell.dn3 .px,
  .cell.dn1 .px .c,.cell.dn2 .px .c,.cell.dn3 .px .c,
  .cell.dn1 .px .d,.cell.dn2 .px .d,.cell.dn3 .px .d{color:var(--down)}

  /* --- the topic filter, a full-width bar under the companies bar. Both are
         data filters and they read as one stack; the view tabs below them are
         navigation, which is a different kind of control. */
  .tb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0 0;
      border-top:1px solid var(--border);margin-top:10px}
  .tb-label{font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
            color:var(--text-faint)}
  .tb-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:1 1 100%}
  .tb .tag{font-family:var(--font-mono);font-size:11px;background:var(--surface-2);
           border:1px solid var(--border);border-radius:999px;padding:3px 9px;color:var(--text-muted);
           text-decoration:none}
  .tb .tag b{color:var(--text);font-weight:600}
  .tb .tag.hot{border-color:color-mix(in srgb,var(--primary) 35%,transparent);color:var(--primary-dark)}
  /* "Everything is showing" is a state, not a button: same treatment as the
     companies bar's All companies pill, and deliberately not the orange that
     means a filter is narrowing the page. */
  .tb .tag.all{color:var(--primary-dark);border-color:color-mix(in srgb,var(--primary) 32%,transparent);
               background:var(--primary-wash)}
  .tb .tag:hover{border-color:var(--border-strong);color:var(--text)}
  .tb .tag[aria-pressed="true"]{border-color:var(--on);color:var(--on);
           background:var(--on-wash)}
  .tb .tag[aria-pressed="true"] b{color:var(--on)}
  .tb .tag[aria-pressed="true"]:hover{border-color:var(--on);color:var(--on)}
  /* A tick, so a set of toggles does not read as a set of links. */
  .tb .tag[aria-pressed="true"]::before{content:"✓ ";font-weight:700}
  .tb form{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .tb input{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
            border:1px solid var(--border);border-radius:999px;padding:6px 12px;min-width:200px;min-height:34px}
  .tb input::placeholder{color:var(--text-faint)}
  .tb button,.tb a.clear{font-family:var(--font-mono);font-size:12px;background:var(--surface);
            color:var(--text-muted);border:1px solid var(--border);border-radius:999px;padding:6px 12px;
            cursor:pointer;min-height:34px;text-decoration:none;display:inline-flex;align-items:center}
  .tb button:hover,.tb a.clear:hover{color:var(--text);border-color:var(--border-strong)}
  /* The way back out of a filter, in the same colour as the thing that is on. */
  .tb a.clear{color:var(--on);border-color:color-mix(in srgb,var(--on) 40%,transparent)}
  .tb a.clear:hover{color:var(--on);border-color:var(--on)}
  .tb-count{font-size:11px;color:var(--text-faint);margin-left:auto;white-space:nowrap}
  @media (max-width:640px){ .tb-count{margin-left:0;flex-basis:100%} }

  /* --- needs attention: the ranked stories above the headline list.
         Shares the pulse's surface and radius -- they are two views of the
         same rows, and a second card style would imply a second source. */
  .att{display:grid;gap:8px;margin-top:12px}
  .att .story{background:var(--surface);border:1px solid var(--border);border-radius:12px;
              padding:11px 13px;display:grid;grid-template-columns:30px 1fr;gap:11px;align-items:start}
  .att .story.hi{border-color:color-mix(in srgb,var(--down) 42%,transparent)}
  .att .story.mid{border-color:color-mix(in srgb,var(--primary) 34%,transparent)}
  .att .rk{font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text-faint);
           text-align:right;line-height:1.35}
  .att .story.hi .rk{color:var(--down)} .att .story.mid .rk{color:var(--primary-dark)}
  .att .hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
  .att .hd .tick{font-family:var(--font-mono);font-size:11.5px;font-weight:600}
  .att .hd .when{font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint)}
  .att h3{margin:1px 0 0;font-size:13.5px;font-weight:600;letter-spacing:-.005em}
  .att h3 a{text-decoration:none} .att h3 a:hover{text-decoration:underline}
  .att .flags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .att .flag{font-family:var(--font-mono);font-size:10.5px;border:1px solid var(--border);
             border-radius:999px;padding:2px 8px;color:var(--text-muted);background:var(--surface-2);
             white-space:nowrap}
  .att .flag.k{border-color:color-mix(in srgb,var(--primary) 40%,transparent);color:var(--primary-dark)}
  .att .flag.d{border-color:color-mix(in srgb,var(--down) 40%,transparent);color:var(--down)}
  .att .flag.u{border-color:color-mix(in srgb,var(--up) 40%,transparent);color:var(--up)}
  .att .flag.w{border-style:dashed}
  /* the score as its parts. A single number nobody can decompose is the thing
     to avoid, so the bar is only ever a picture of the line beneath it. */
  .att .why{font-family:var(--font-mono);font-size:10px;color:var(--text-faint);margin-top:6px;
            display:flex;flex-wrap:wrap;gap:9px}
  .att .why b{font-weight:600;color:var(--text-muted)}
  .att details{margin-top:7px}
  .att summary{cursor:pointer;font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);
               list-style:none}
  .att summary::-webkit-details-marker{display:none}
  .att summary::before{content:"\\25b8 "}
  .att details[open] summary::before{content:"\\25be "}
  .att details ul{list-style:none;margin:6px 0 0;padding:0 0 0 12px;border-left:1px solid var(--border);
                  display:grid;gap:4px;font-size:12px}
  .att details li{display:grid;grid-template-columns:50px 1fr;gap:8px;align-items:baseline}
  .att details .d{font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint)}
  .att details .h{font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint)}
  @media (max-width:640px){
    /* One column, so the rank reads as a label above the story rather than
       drifting to the far right of an empty row. */
    .att .story{grid-template-columns:1fr;gap:2px}
    .att .rk{text-align:left;font-size:13px}
    .att details li{grid-template-columns:1fr}
  }

  /* --- happening now */
  .pulse{display:grid;gap:10px;margin-top:14px;padding:14px;border-radius:12px;
         background:var(--surface);border:1px solid var(--border)}
  .pulse .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .pulse .tag{font-family:var(--font-mono);font-size:11px;background:var(--surface-2);
              border:1px solid var(--border);border-radius:999px;padding:3px 9px;color:var(--text-muted)}
  .pulse .tag b{color:var(--text);font-weight:600}
  .pulse .tag.hot{border-color:color-mix(in srgb,var(--primary) 35%,transparent);color:var(--primary-dark)}
  .pulse ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .pulse ol li{font-size:12.5px;display:grid;grid-template-columns:56px 44px 1fr;gap:10px;align-items:baseline}
  .pulse ol li .d{font-family:var(--font-mono);font-size:11px;color:var(--text-faint)}
  .pulse a.tag{text-decoration:none}
  .pulse a.tag:hover{border-color:var(--border-strong);color:var(--text)}
  .pulse a.tag[aria-current="true"]{border-color:var(--on);color:var(--on);background:var(--on-wash)}
  .pulse a.tag[aria-current="true"] b{color:var(--on)}
  .pulse a.tag[aria-current="true"]:hover{border-color:var(--on);color:var(--on)}
  .tagfilter{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .tagfilter input{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
                   border:1px solid var(--border);border-radius:999px;padding:6px 12px;min-width:200px;min-height:34px}
  .tagfilter input::placeholder{color:var(--text-faint)}
  .tagfilter button,.tagfilter a.clear{font-family:var(--font-mono);font-size:12px;background:var(--surface);
                   color:var(--text-muted);border:1px solid var(--border);border-radius:999px;
                   padding:6px 12px;cursor:pointer;min-height:34px;text-decoration:none;
                   display:inline-flex;align-items:center}
  .tagfilter button:hover,.tagfilter a.clear:hover{color:var(--text);border-color:var(--border-strong)}

  /* --- the tag split on a company page */
  .split{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}
  .split .n{font-family:var(--font-mono);font-size:12px;border:1px solid var(--border);
            border-radius:999px;padding:3px 10px;background:var(--surface-2)}
  .split .n b{font-weight:600}
  .split .n.pos{color:var(--up);border-color:color-mix(in srgb,var(--up) 32%,transparent);background:var(--up-wash)}
  .split .n.neg{color:var(--down);border-color:color-mix(in srgb,var(--down) 32%,transparent);background:var(--down-wash)}
  .taglist{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
  .taglist a{font-family:var(--font-mono);font-size:11px;background:var(--surface-2);text-decoration:none;
             border:1px solid var(--border);border-radius:999px;padding:3px 9px;color:var(--text-muted)}
  .taglist a:hover{color:var(--text);border-color:var(--border-strong)}
  .taglist a b{color:var(--text);font-weight:600}

  /* --- generated FAQ. One native <details> per question: no script, open by
         URL fragment, and readable with the stylesheet off. */
  .faq{display:flex;flex-direction:column;gap:6px;margin-top:8px}
  .faq details{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 13px}
  .faq details[open]{background:var(--surface-2);border-color:var(--border-strong)}
  .faq summary{cursor:pointer;list-style:none;font-size:13px;font-weight:600;display:flex;gap:9px;align-items:baseline}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary::before{content:"+";font-family:var(--font-mono);color:var(--text-faint);flex:0 0 auto}
  .faq details[open] summary::before{content:"−";color:var(--primary)}
  .faq summary:hover{color:var(--primary-light)}
  .faq .a{font-size:12.5px;color:var(--text-muted);line-height:1.6;margin:8px 0 0 18px}
  .genbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px}
  .genbar button{font-family:var(--font-mono);font-size:12px;background:var(--primary-wash);color:var(--primary-dark);
                 border:1px solid color-mix(in srgb,var(--primary) 35%,transparent);border-radius:999px;
                 padding:7px 14px;cursor:pointer;min-height:34px}
  .genbar button:hover{border-color:var(--primary)}
  .genbar button[disabled]{background:var(--surface-2);color:var(--text-faint);
                           border-color:var(--border);cursor:not-allowed}
  .genbar form{margin:0}

  /* --- generating takes seconds, so the button says so and stops taking a
         second press. Pure CSS swap driven by one class; with JavaScript off
         the form still submits and this simply never fires. */
  .genbar .ai{margin-right:6px;vertical-align:-2px}
  .genbar button[disabled] .ai{opacity:.55}
  .genbar .t-busy,.genbar .sp{display:none}
  .genbar.busy .t-idle,.genbar.busy .ai{display:none}
  .genbar.busy .t-busy{display:inline}
  .genbar.busy .sp{display:inline-block;width:11px;height:11px;margin-right:7px;vertical-align:-1px;
                   border:2px solid color-mix(in srgb,var(--primary) 35%,transparent);
                   border-top-color:var(--primary);border-radius:50%;animation:sp .7s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){
    .genbar.busy .sp{animation:none;border-top-color:color-mix(in srgb,var(--primary) 35%,transparent)}
  }
  .genbar.busy button{cursor:progress}
  .genbar .wait{font-size:11.5px;color:var(--text-faint);display:none}
  .genbar.busy .wait{display:inline}

  /* --- sources under a generated claim */
  .cites{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-top:5px}
  .cites .lb{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.07em;
             text-transform:uppercase;color:var(--text-faint)}
  .cites a,.cites span.dead{font-family:var(--font-mono);font-size:10.5px;color:var(--primary-dark);
            text-decoration:none;border-bottom:1px dashed color-mix(in srgb,var(--primary) 40%,transparent)}
  .cites a:hover{color:var(--primary);border-bottom-style:solid}
  .cites span.dead{color:var(--text-faint);border-bottom-color:var(--border)}

  /* --- the news summary */
  .brief{margin:8px 0 0;display:flex;flex-direction:column;gap:11px}
  .brief p{margin:0;font-size:13px;line-height:1.65}

  /* --- ask a question */
  .askbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
  .askbox input{flex:1;min-width:220px;font-size:13px;background:var(--surface-2);color:var(--text);
                border:1px solid var(--border);border-radius:999px;padding:9px 14px;min-height:38px;
                font-family:var(--font-ui)}
  .askbox input::placeholder{color:var(--text-faint)}
  .askbox input:focus-visible{border-color:var(--primary)}
  .answer{margin-top:9px;padding:12px 14px;border-radius:10px;background:var(--surface-2);
          border:1px solid var(--border)}
  .answer .q{font-size:12.5px;font-weight:600;display:flex;gap:8px;align-items:baseline}
  .answer .q::before{content:"Q";font-family:var(--font-mono);font-size:10px;color:var(--primary);
                     letter-spacing:.08em}
  .answer .a{font-size:12.5px;color:var(--text-muted);line-height:1.6;margin:7px 0 0}
  .asked{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-top:8px}
  .asked a{font-size:11.5px;color:var(--text-muted);background:var(--surface-2);text-decoration:none;
           border:1px solid var(--border);border-radius:999px;padding:3px 10px}
  .asked a:hover{color:var(--text);border-color:var(--border-strong)}
  @media (max-width:640px){ .pulse ol li{grid-template-columns:1fr;gap:2px} }

  /* ---------------- the board: a treemap of the 200 largest IDX names ----------------
     Every tile is positioned in PERCENT by heatmap.ts -- sectors in the outer
     box, companies in their sector's body -- so the whole picture reflows at
     any width without a line of JavaScript or a single measurement.

     The six tint steps are the same colour-mix ladder the calendar's price
     cells use, so a 4% day means the same green on both pages. Size is the
     second channel: a big mover with a small market cap gets a strong tint on
     a small tile, which is exactly what it is. */
  .board{position:relative;width:100%;aspect-ratio:16/9;margin-top:12px;
         border:1px solid var(--border);border-radius:12px;background:var(--bg);overflow:hidden}
  .board-scroll{overflow-x:auto;overflow-y:hidden}
  .sec{position:absolute;border:1px solid var(--bg);background:var(--surface)}
  .sec > h4{position:absolute;inset:0 0 auto 0;height:17px;margin:0;padding:0 6px;
            display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis;
            font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.04em;
            color:var(--text-muted);background:var(--surface-2)}
  .sec > h4 .m{font-weight:500}
  .sec > h4 .m.pos{color:var(--up)} .sec > h4 .m.neg{color:var(--down)}
  .sec > .body{position:absolute;inset:17px 0 0 0}
  /* A box too short for a heading has none, and its tiles get all of it. */
  .sec > .body.full{inset:0}

  .tile{position:absolute;display:block;overflow:hidden;text-decoration:none;color:var(--text);
        border:1px solid var(--bg);background:var(--surface-3);padding:2px 3px;
        font-family:var(--font-mono);line-height:1.15}
  .tile .s{display:block;font-size:10px;font-weight:600;letter-spacing:.02em}
  .tile .m{display:block;font-size:9px;color:var(--text-muted)}
  /* The tint ladder, shared by the tiles and by the legend's swatches so the
     key is painted by the same rules as the thing it explains. */
  .t-up1{background:color-mix(in srgb,var(--up) 7%,var(--surface))}
  .t-up2{background:color-mix(in srgb,var(--up) 15%,var(--surface))}
  .t-up3{background:color-mix(in srgb,var(--up) 26%,var(--surface))}
  .t-dn1{background:color-mix(in srgb,var(--down) 7%,var(--surface))}
  .t-dn2{background:color-mix(in srgb,var(--down) 15%,var(--surface))}
  .t-dn3{background:color-mix(in srgb,var(--down) 26%,var(--surface))}
  .t-up1 .m,.t-up2 .m,.t-up3 .m{color:var(--up)}
  .t-dn1 .m,.t-dn2 .m,.t-dn3 .m{color:var(--down)}
  /* Tiles below ~3% of a sector box cannot hold two lines of type. Hiding the
     move rather than clipping it keeps the ticker readable, and the panel has
     the number anyway. */
  .tile.xs .m{display:none}
  .tile.xxs .s{font-size:8px;letter-spacing:-.02em}
  /* A tile with something on the record is marked, so a reader knows where
     hovering pays off instead of sampling twenty tiles that say nothing. */
  .tile.has::after{content:"";position:absolute;top:2px;right:2px;width:3px;height:3px;
                   border-radius:50%;background:var(--primary)}
  .tile:hover,.tile:focus-visible{outline:1.5px solid var(--primary);outline-offset:-1.5px;z-index:3}

  /* The panel is a sibling of the tiles inside .board, not a child of one:
     a child of a 2%-wide tile with overflow:hidden would be invisible. CSS
     only, so it works with the keyboard and survives JavaScript being off. */
  .tile:hover + .tip,.tile:focus-visible + .tip{visibility:visible;opacity:1}
  /* pointer-events:none deliberately: the panel is a label, not a surface. The
     sources behind it are one click away on the tile's own /ticker page, and a
     hoverable panel over a 2%-wide tile is a flicker trap. */
  .tip{position:absolute;visibility:hidden;opacity:0;z-index:9;width:min(280px,46vw);
       transition:opacity .08s var(--ease);pointer-events:none;
       background:var(--surface);border:1px solid var(--border-strong);border-radius:10px;
       padding:9px 11px;box-shadow:0 8px 28px rgba(0,0,0,.45)}
  .tip .hd{display:flex;gap:7px;align-items:baseline;font-family:var(--font-mono);font-size:11px}
  .tip .hd .s{font-weight:600}
  .tip .hd .m{margin-left:auto}
  .tip .hd .m.pos{color:var(--up)} .tip .hd .m.neg{color:var(--down)}
  .tip .nm{font-size:11.5px;color:var(--text-muted);margin:3px 0 0;line-height:1.35}
  .tip .meta{font-family:var(--font-mono);font-size:10px;color:var(--text-faint);margin-top:4px}
  .tip ul{list-style:none;margin:8px 0 0;padding:8px 0 0;border-top:1px solid var(--border);
          display:grid;gap:7px}
  .tip li{font-size:11.5px;line-height:1.35}
  .tip li .k{font-family:var(--font-mono);font-size:9.5px;color:var(--text-faint);
             display:block;margin-bottom:1px;letter-spacing:.05em;text-transform:uppercase}
  .tip li .t.pos{color:var(--up)} .tip li .t.neg{color:var(--down)}
  .tip .none{font-size:11.5px;color:var(--text-faint);margin:8px 0 0;padding-top:8px;
             border-top:1px solid var(--border);line-height:1.35}

  .boardhd{display:flex;align-items:baseline;gap:12px}
  .boardhd .kicker{flex:1}
  .fsbtn{align-self:center}

  /* The tone tally and the topics. Its own line, above the board: it describes
     the same window the panels do, and putting it inside the picture would
     cost a sector box. */
  .bstats{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin:-4px 0 0;
          font-size:12px;color:var(--text-muted)}
  .bstats .n{font-family:var(--font-mono);font-weight:600;color:var(--text)}
  .bstats b{font-family:var(--font-mono);font-weight:600}
  .bstats .sep{color:var(--text-faint)}
  .bstats .topic{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);
                 background:var(--surface-2);border:1px solid var(--border);
                 border-radius:999px;padding:2px 9px;margin-left:5px}
  .bstats .topic b{color:var(--text);margin-left:3px}

  /* Fullscreen is the browser's own, so there is no overlay to get wrong and
     Escape already works. The board drops its 16/9 and fills whatever shape
     the screen is -- the layout is percentages, so any shape is fine. */
  .board-wrap:fullscreen{background:var(--bg);padding:10px;display:flex;align-items:stretch}
  .board-wrap:fullscreen .board-scroll{flex:1;display:flex}
  .board-wrap:fullscreen .board{flex:1;width:auto;height:auto;aspect-ratio:auto;margin:0}

  .scale{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px;
         font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint)}
  .scale .ramp{display:flex;gap:2px}
  .scale .ramp i{width:15px;height:11px;border-radius:2px;display:block;border:1px solid var(--border)}

  @media (max-width:760px){
    /* 200 tiles do not fit a phone. Rather than draw a second view, the board
       keeps its size and scrolls -- one picture, legible, that you pan. */
    .board{width:760px;aspect-ratio:16/10}
  }
`;

// ---------------------------------------------------------------- primitives

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The host a link points at, without the `www.`.
 *
 * This is the label every source link carries, because "official record" said
 * the same thing on all of them: a filing from the exchange and a headline
 * from a newspaper are not the same kind of source, and the reader deserves to
 * know which one they are about to open before they open it.
 *
 * Returns null on anything that is not an http(s) URL with a host. That is
 * also the only check standing between an API field and the page: `new URL`
 * happily parses `javascript:alert(1)`, and an href built from a source string
 * we never validated is a script somebody else gets to run in this origin. No
 * host, no link -- callers render the row without one.
 */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/** A fraction as a signed percentage, with a real minus sign. Zero carries no
 * sign: a flat close is neither up nor down, and "+0.0%" claims a direction
 * the number does not have. */
export function pct(x: number, digits = 1): string {
  const s = (x * 100).toFixed(digits);
  if (x === 0) return `${s}%`;
  return x < 0 ? `−${s.replace("-", "")}%` : `+${s}%`;
}

const qs = (watchlist: string[]): string => (watchlist.length ? `?w=${watchlist.join(",")}` : "");

function nav(active: string, watchlist: string[]): string {
  const w = qs(watchlist);
  // Two views, not four. The agenda IS the calendar now, and a single day is
  // somewhere you arrive by clicking a cell -- not a destination worth a tab.
  const tabs: [string, string, string][] = [
    ["agenda", `/${w}`, "Agenda"],
    ["ticker", `/ticker${w ? `${w}&` : "?"}symbol=${watchlist[0] ?? "BBCA"}`, "Company"],
  ];
  return `<nav class="tabs" aria-label="Views">${tabs
    .map(
      ([id, href, label]) =>
        `<a class="tab" href="${esc(href)}"${id === active ? ' aria-current="page" aria-selected="true"' : ""}>${esc(label)}</a>`
    )
    .join("")}</nav>`;
}

export interface Shell {
  title: string;
  active: string;
  watchlist: string[];
  body: string;
  mock: boolean;
  asOf: string | null;
  credits: string | null;
  /** The route this page is on, and its own query params, so the watchlist
   * bar in the shell can round-trip you back to it. */
  self?: string;
  keep?: Record<string, string | undefined>;
  /** Every company on record, for the filter's dropdown. */
  known?: string[];
  /** A route-specific filter bar, under the companies bar and above the view
   * tabs. Only /month has one. */
  filters?: string;
}

export function page(s: Shell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
<style>${STYLE}</style>
</head>
<body>
${s.mock ? `<div class="mock mono">MOCK_MODE · fixture data, no API key, no network · every number on this page is fabricated</div>` : ""}
<div class="wrap">
  <header class="top">
    <a class="brand" href="/${qs(s.watchlist)}" style="text-decoration:none"><span class="dot"></span>NewsIDX <small>IDX event agenda</small></a>
    <span class="sp"></span>
    <button class="ghost" id="theme" type="button">Light</button>
  </header>
  ${watchlistBar(s.watchlist, s.self ?? "/", s.keep ?? {}, s.known ?? [])}
  ${s.filters ?? ""}
  ${nav(s.active, s.watchlist)}
  ${s.body}
  <footer>
    <span>${s.mock ? "fixtures" : "Sectors API"}${s.asOf ? ` as of ${esc(s.asOf)}` : ""}</span>
    ${s.credits ? `<span>${esc(s.credits)}</span>` : ""}
    <span>research tooling, not investment advice</span>
  </footer>
</div>
<script>
  // The only script on the page. Navigation is real links; this is the theme
  // the design system already ships (plan.md §4d).
  var btn = document.getElementById('theme');
  var dark = function(){ return (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'dark'; };
  var paint = function(){ btn.textContent = dark() ? 'Light' : 'Dark'; };
  try { var saved = localStorage.getItem('fw-theme'); if (saved) document.documentElement.dataset.theme = saved; } catch (e) {}
  btn.addEventListener('click', function(){
    var next = dark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('fw-theme', next); } catch (e) {}
    paint();
  });
  paint();

  // Fullscreen: the browser's own, so Escape already closes it, the window
  // manager already animates it, and there is no overlay of ours to trap focus
  // in. The button ships hidden and is revealed only where the API exists --
  // an iPhone has no element fullscreen, and a dead button is worse than none.
  document.querySelectorAll('[data-fs]').forEach(function (btn) {
    var el = document.getElementById(btn.dataset.fs);
    if (!el || !el.requestFullscreen) return;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else el.requestFullscreen().catch(function () { btn.hidden = true; });
    });
    document.addEventListener('fullscreenchange', function () {
      var on = document.fullscreenElement === el;
      btn.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
      btn.setAttribute('aria-pressed', String(on));
    });
  });

  // Generating takes seconds. Mark the form busy so the button says so, and
  // stop a second press from starting a second paid call. Disabling happens a
  // tick later so the submission itself is already under way.
  document.querySelectorAll('form.genbar').forEach(function (f) {
    f.addEventListener('submit', function () {
      if (f.classList.contains('busy')) return;
      f.classList.add('busy');
      f.setAttribute('aria-busy', 'true');
      setTimeout(function () {
        f.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      }, 0);
    });
  });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- chips

const CLASS_ATTR: Record<string, string> = { fact: "fact", scheduled: "sched", predicted: "pred" };

/**
 * The colour a headline is printed in: green for Sectors' `Bullish` tag, red
 * for `Bearish`, the page's own text colour for everything else. Colour alone
 * is never the message -- the tags themselves are listed next to it, so the
 * same information survives without it.
 */
export function sentClass(item: Item): string {
  const s = sentimentOf(item);
  return s === "positive" ? "pos" : s === "negative" ? "neg" : "";
}

/** The row's tags, as text. This is the categorisation the page is built on,
 * so it is shown rather than implied. */
function tagLine(item: Item): string {
  const tags = item.tags ?? [];
  if (!tags.length) return "";
  return `<div class="note faint mono" style="font-size:11px">${tags.map((t) => esc(t)).join(" · ")}</div>`;
}

/**
 * The ex-dividend drop, on the chip for the dividend that causes it.
 *
 * This is the one moment this product was built for: a holder sees a 4.3% gap
 * on the open and sells into it. The number is arithmetic -- the dividend
 * leaving the share price -- and the sentence after it is the whole point, so
 * it is said in words and not left to be inferred from a minus sign.
 *
 * The basis is printed because "dividend ÷ close" is a specific claim, and a
 * percentage with no denominator is not one.
 */
function dropNote(item: Item): string {
  if (!item.drop) return "";
  const { pct, basis, close } = item.drop;
  return `<div class="note"><span class="drop">expected drop ${esc(fmtPct(pct))}</span>
    <span class="faint">· ${esc(basis)} ${esc(close.toLocaleString("en-US"))}</span></div>
    <div class="note faint">Mechanical, not bad news: holders are not losing
    ${esc(fmtPct(pct).replace("−", ""))} — they are receiving it.</div>`;
}

function tickerCell(item: Item, watchlist: string[]): string {
  if (!item.symbol) return `<span class="tick faint">market</span>`;
  const w = watchlist.length ? `?w=${watchlist.join(",")}&` : "?";
  return `<a class="tick tickerlink" href="/ticker${w}symbol=${esc(item.symbol)}">${esc(item.symbol)}</a>`;
}

/**
 * What a predicted chip says instead of a date.
 *
 * Three things, in this order: the window, the hit rate, and -- behind a
 * disclosure, because it is the working and not the answer -- how it was
 * fitted. The word "predicted" is in the text as well as in the shape, so the
 * class survives a screenshot, a screen reader and a compressed video.
 */
function predictedBody(item: Item): string {
  const f = item.fit!;
  const rate = hitRateLabel(f);
  return `<div class="note">Predicted window · ${esc(rate)}</div>
    <details class="how"><summary>How we worked this out</summary>
      <div class="note faint">Fitted from this company's own ${esc(kindLabel(item.kind).toLowerCase())}
      history — ${f.n} past occurrence${f.n === 1 ? "" : "s"}, median day of year ±
      ${f.spreadDays.toFixed(1)} days of typical drift. Scored walk-forward: each past
      occurrence predicted from only the ones before it${f.trials >= 2 ? `, ${f.hits} of ${f.trials} landed inside` : ""}.
      Nobody has published this date.</div>
    </details>`;
}

/** One chip. Three classes, three shapes, and the tense is always in the text
 * as well as the shape (plan.md §2, §12.1). */
export function chip(item: Item, watchlist: string[] = []): string {
  const cls = CLASS_ATTR[item.cls] ?? "fact";
  const predicted = item.cls === "predicted" && item.window && item.fit;

  // A fact's kind is what KIND of record it is; its title is what the record
  // says. Scheduled chips lead with the number that matters (the dividend),
  // because that is the thing a holder is about to be surprised by.
  // A history spans years, so a bare "26 Nov" in a timeline is ambiguous:
  // show the year whenever it is not the current one.
  const stamp = (iso: string) =>
    iso.slice(0, 4) === todayIso().slice(0, 4) ? fmtShort(iso) : `${fmtShort(iso)} ${iso.slice(0, 4)}`;
  // A predicted row renders a RANGE where the other two render a day. That is
  // the whole point: we do not hold a date, so we must not print one.
  const when = predicted
    ? fmtRange(item.window!.from, item.window!.to)
    : item.cls === "scheduled"
      ? fmtWithDay(item.date!)
      : stamp(item.date!);
  const kind = predicted
    ? `Predicted · ${kindLabel(item.kind)}`
    : item.cls === "scheduled"
      ? `Scheduled · ${kindLabel(item.kind)}`
      : kindLabel(item.kind);
  const lead = item.cls === "fact" ? item.title : (item.detail ?? item.title);
  const host = domainOf(item.sourceUrl);
  const src = host
    ? ` · <a class="src" href="${esc(item.sourceUrl)}" rel="noreferrer noopener" target="_blank"
         title="Open the source at ${esc(host)}">${esc(host)} ↗</a>`
    : "";
  const note = predicted
    ? predictedBody(item)
    : item.cls === "fact" && item.detail
      ? `<div class="note">${esc(item.detail)}</div>`
      : dropNote(item);

  return `<div class="chip ${cls}">
    <span class="when">${
      predicted
        ? esc(when)
        : `<time datetime="${esc(item.date)}">${esc(when)}</time>`
    }</span>
    ${tickerCell(item, watchlist)}
    <div class="what"><span class="kind">${esc(kind)}</span>
      <span class="${sentClass(item)}">${esc(lead)}</span>${src}
      ${tagLine(item)}
      ${note}</div>
  </div>`;
}

export const PAGE_SIZE = 10;

/** One page of a list, and the numbers a pager needs to describe it. */
export function paginate<T>(items: T[], page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const from = (current - 1) * size;
  return { items: items.slice(from, from + size), page: current, pages, total: items.length, from };
}

/**
 * One step of a prev/next control.
 *
 * Every stepper in the product renders through this, so a month, a day and a
 * page of rows all behave the same way: the destination is written on the
 * button, a dead end is visibly dead rather than missing, and `rel` tells a
 * browser which direction it is.
 */
export function step(
  dir: "prev" | "next",
  href: string | null,
  kicker: string,
  label: string
): string {
  const arrow = dir === "prev" ? "←" : "→";
  const inner =
    dir === "prev"
      ? `<span class="ar" aria-hidden="true">${arrow}</span><span class="lb"><small>${esc(kicker)}</small>${esc(label)}</span>`
      : `<span class="lb"><small>${esc(kicker)}</small>${esc(label)}</span><span class="ar" aria-hidden="true">${arrow}</span>`;
  const cls = `pg ${dir === "prev" ? "prev" : "next"}`;
  return href
    ? `<a class="${cls}" rel="${dir}" href="${esc(href)}" aria-label="${esc(`${kicker}: ${label}`)}">${inner}</a>`
    : `<span class="${cls}" aria-disabled="true">${inner}</span>`;
}

/**
 * Prev/next through a list, with a count. A pager is a set of links, not a
 * widget: the page number lives in the URL so a row deep in a company's
 * history can be sent to somebody, and it works with JavaScript off like the
 * rest of the product.
 */
function pager(
  action: string,
  params: Record<string, string | undefined>,
  p: { page: number; pages: number; total: number; from: number; items: unknown[] },
  what = "rows"
): string {
  if (p.pages <= 1) return "";
  const href = (n: number) =>
    `${action}?${Object.entries({ ...params, p: String(n) })
      .filter(([, v]) => v)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&")}`;
  return `<nav class="pager" aria-label="${esc(what)} pages">
    ${step("prev", p.page > 1 ? href(p.page - 1) : null, "Newer", p.page > 1 ? `page ${p.page - 1}` : "none")}
    <span class="mid"><b>${p.from + 1}–${p.from + p.items.length}</b> of ${p.total} ${esc(what)}
      <small class="of">page ${p.page} of ${p.pages}</small></span>
    ${step("next", p.page < p.pages ? href(p.page + 1) : null, "Older", p.page < p.pages ? `page ${p.page + 1}` : "none")}
  </nav>`;
}

function legend(extra?: string): string {
  return `<div class="legend">
    <span><i class="sw"></i>Fact — it happened, with the source it came from</span>
    <span><i class="sw s"></i>Scheduled — the issuer dated it</span>
    <span><i class="sw p"></i>Predicted — we fitted it from the company's own history. A window, never a date, with the hit rate beside it</span>
    <span><b class="pos">Green</b> / <b class="neg">red</b> — Sectors tagged that story Bullish / Bearish. Their label, not ours, and a description of coverage rather than a forecast.</span>
    ${extra ? `<span>${esc(extra)}</span>` : ""}
  </div>`;
}

/**
 * The one filter in the product: which companies every page is about.
 *
 * It scopes every route, so it lives in the shell above the tabs rather than
 * on any single page -- there used to be a second, per-page "Ticker" dropdown
 * as well, and two controls meaning the same thing is one control too many.
 *
 * The box adds ONE company at a time, and that is the whole design. It used to
 * hold the full comma-separated list, which quietly broke the dropdown: a
 * browser matches a <datalist> against the entire field, so once the value was
 * "BBCA,TLKM" nothing matched and the suggestions stopped appearing exactly
 * when you had most use for them. An empty box suggests properly, needs no
 * comma typed by hand, and never makes you retype a list to change one name.
 *
 * The selection itself lives in the pills -- each one a link that removes it --
 * so the current state is readable rather than parsed out of a text field.
 * Empty is the default and means every company, which the count says out loud.
 *
 * `self` + `keep` carry the page you are on through both the form and the
 * remove links, so filtering on /month leaves you on /month.
 */
function watchlistBar(
  watchlist: string[],
  self: string,
  keep: Record<string, string | undefined>,
  known: string[] = []
): string {
  const kept = Object.entries(keep).filter(([, v]) => v) as [string, string][];
  const href = (list: string) =>
    `${self}?${[["w", list], ...kept]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&")}`;

  // Only what can still be added: an option you already picked is noise.
  const options = known.filter((s) => !watchlist.includes(s));
  // A name we hold no rows for filters the page to nothing, which looks like
  // a broken product unless we say what happened.
  const unknown = known.length ? watchlist.filter((s) => !known.includes(s)) : [];

  const count = watchlist.length
    ? `${watchlist.length} of ${known.length} ${known.length === 1 ? "company" : "companies"}`
    : `All ${known.length || ""} ${known.length === 1 ? "company" : "companies"}`.replace("  ", " ");

  return `<div class="wl">
    <span class="wl-label mono" id="wl-lab">Companies</span>
    <div class="wl-picked" role="group" aria-labelledby="wl-lab">
      ${
        watchlist.length
          ? watchlist
              .map(
                (s) =>
                  `<a class="pill" href="${esc(href(watchlist.filter((x) => x !== s).join(",")))}"
                      title="Stop showing ${esc(s)}" aria-label="Remove ${esc(s)}">${esc(s)} <span aria-hidden="true">×</span></a>`
              )
              .join("")
          : `<span class="pill all">All companies</span>`
      }
    </div>
    <form method="get" action="${esc(self)}">
      ${kept.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
      <input type="hidden" name="w" value="${esc(watchlist.join(","))}">
      <input type="text" name="add" list="wl-known" value=""
             aria-label="Add a company by ticker — pick from the list or type one"
             placeholder="${watchlist.length ? "Add another…" : "Narrow to a company…"}"
             spellcheck="false" autocomplete="off" enterkeyhint="done">
      <datalist id="wl-known">${options.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
      <button type="submit">Add</button>
      ${watchlist.length ? `<a class="pill add" href="${esc(href(""))}">Show all</a>` : ""}
    </form>
    <span class="wl-count mono">${esc(count)}</span>
    ${
      unknown.length
        ? `<p class="wl-warn">No rows on record for <b>${unknown.map((s) => esc(s)).join("</b>, <b>")}</b> —
             check the ticker, or run the backfill to fetch it.</p>`
        : ""
    }
  </div>`;
}

/**
 * The topic filter, as its own bar under the companies bar.
 *
 * It sits with the watchlist rather than inside the headline list because both
 * are filters over the same rows, and a control buried in the block it filters
 * is only findable once you have already scrolled to what you were trying to
 * narrow. The view tabs below are navigation, which is why they come after.
 *
 * Chips and free text are one control: a chip sets the box, the box takes
 * anything, and the <datalist> offers what is actually on record. A GET form,
 * so a filtered view is a URL somebody can send, and it works with JavaScript
 * off like everything else here. Every link anchors at #headlines, because the
 * list it narrows is further down the page.
 */
/**
 * How a Topic selection reads in a sentence. One topic is one quoted label;
 * several are joined with "or", because the filter is a union -- writing them
 * comma-separated inside one pair of quotes reads like a single odd topic
 * nobody has.
 */
export function tagPhrase(tag: string): string {
  const t = parseTags(tag);
  if (!t.length) return "";
  if (t.length === 1) return `\u201c${esc(t[0]!)}\u201d`;
  const quoted = t.map((x) => `\u201c${esc(x)}\u201d`);
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

export function tagBar(o: {
  /** The route the bar submits back to -- whichever page it is sitting on. */
  action: string;
  tag: string;
  topics: { label: string; n: number }[];
  /** Everything else that page's URL is carrying, so filtering by topic does
   * not quietly drop the month, the company or the price strip. */
  hidden: Record<string, string | undefined>;
  /** What the right-hand side says the filter is doing, in this page's terms. */
  count: string;
}): string {
  // Options are counted BEFORE the filter is applied. Options that vanish the
  // moment you use one are a dead end.
  if (!o.topics.length && !o.tag) return "";

  const params = (tag: string) =>
    Object.entries({ ...o.hidden, tag })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
  // No fragment. This bar sits at the top of the page, so picking a tag should
  // leave you looking at the bar you just used -- jumping you down to the list
  // it narrows loses the other chips and the Clear link. The pager inside the
  // list anchors instead, because that one IS in the list.
  const here = (q: string) => `${o.action}${q ? `?${q}` : ""}`;
  const kept = Object.entries(o.hidden).filter(([, v]) => v) as [string, string][];

  // The filter is a LIST, and the default is every topic. Selected chips are
  // the whole state: the text input is just another way to write the same
  // list, so the two never disagree.
  const selected = parseTags(o.tag);
  const isOn = (label: string) => selected.some((t) => t.toLowerCase() === label.toLowerCase());
  // Each chip toggles itself in or out and leaves the rest of the selection
  // alone. Replacing the list on every click is what made this single-select.
  const toggled = (label: string) =>
    (isOn(label)
      ? selected.filter((t) => t.toLowerCase() !== label.toLowerCase())
      : [...selected, label].slice(0, MAX_TAGS)
    ).join(",");

  return `<div class="tb">
    <span class="tb-label mono" id="tb-lab">Topic</span>
    <form method="get" action="${esc(o.action)}">
      ${kept.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
      <input name="tag" list="pulse-tags" value="${esc(selected.join(", "))}" aria-labelledby="tb-lab"
             placeholder="All topics. Or pick: Bullish, Dividend, …" spellcheck="false" autocomplete="off" enterkeyhint="search">
      <datalist id="pulse-tags">
        ${o.topics.map((t) => `<option value="${esc(t.label)}">${t.n}</option>`).join("")}
      </datalist>
      <button type="submit">Filter</button>
      ${selected.length ? `<a class="clear" href="${esc(here(params("")))}">Clear${selected.length > 1 ? ` all ${selected.length}` : ""}</a>` : ""}
    </form>
    <span class="tb-count mono">${esc(o.count)}</span>
    ${
      o.topics.length
        ? `<div class="tb-chips" role="group" aria-labelledby="tb-lab">${
            // The default is every topic, so it gets said out loud. Without
            // this the chips are all grey and the bar reads as "nothing is
            // on" when in fact nothing is being hidden -- the same reason the
            // companies bar carries an "All companies" pill.
            selected.length ? "" : `<span class="tag all">All ${o.topics.length} tags on record</span>`
          }${o.topics
            .slice(0, 14)
            .map((t) => {
              const on = isOn(t.label);
              // role=group + aria-pressed, not a link list: this reads as a set
              // of toggles, which is what it now is.
              return `<a class="tag${t.n >= 3 ? " hot" : ""}${on ? " on" : ""}" href="${esc(
                here(params(toggled(t.label)))
              )}" role="button" aria-pressed="${on ? "true" : "false"}" title="${
                on ? `Stop showing ${esc(t.label)}` : `Add ${esc(t.label)} to the filter`
              }"><b>${esc(t.label)}</b> ×${t.n}</a>`;
            })
            .join("")}</div>`
        : ""
    }
  </div>`;
}

// ---------------------------------------------------------------- pages

// ---------------------------------------------------------------- the board

/** A market cap as a reader says it out loud. IDX caps run to the hundreds of
 * trillions of rupiah, so T is the working unit and B is the tail. */
function cap(idr: number): string {
  if (idr >= 1e12) return `Rp${(idr / 1e12).toFixed(idr >= 1e13 ? 0 : 1)}T`;
  if (idr >= 1e9) return `Rp${(idr / 1e9).toFixed(0)}B`;
  return `Rp${Math.round(idr / 1e6)}M`;
}

const posneg = (x: number | null | undefined): string =>
  x == null || x === 0 ? "" : x > 0 ? "pos" : "neg";

/**
 * One company's tile, plus the panel that belongs to it.
 *
 * They are emitted as adjacent siblings because the reveal is `:hover + .tip`
 * — pure CSS, so it works with the keyboard, works with JavaScript off, and
 * costs nothing to render. The panel cannot be a CHILD of the tile: the
 * smallest tiles here are two percent of a sector box, and a 280px panel
 * inside one would be clipped into nothing.
 *
 * `anchor` flips the panel to the left and/or above when the tile sits in the
 * far half of the board, which is the whole of the edge handling. There is no
 * measurement and no script — the side is decided server-side from coordinates
 * we already computed.
 */
function boardTile(t: Tile, s: SectorBox, newsFrom: string, date: string): string {
  const band = priceBand(t.change);
  // Two lines of 10px type need roughly this much of a sector box. Below it
  // the move is dropped, then the ticker shrinks; below that the tile is still
  // hoverable, which is what the panel is for.
  const small = t.w < 13 || t.h < 15 ? " xs" : "";
  const tiny = t.w < 9 || t.h < 9 ? " xxs" : "";
  const notes = t.notes.slice(0, 3);
  const move = t.change == null ? "—" : pct(t.change);

  const list = notes.length
    ? `<ul>${notes
        .map((n) => {
          const when = n.date === date ? "same day" : `${fmtShort(n.date!)}`;
          return `<li><span class="k">${esc(kindLabel(n.kind))} · ${esc(when)}${
            domainOf(n.sourceUrl) ? ` · ${esc(domainOf(n.sourceUrl)!)}` : ""
          }</span><span class="t ${sentClass(n)}">${esc(n.title)}</span></li>`;
        })
        .join("")}${
        t.notes.length > notes.length
          ? `<li class="k">+${t.notes.length - notes.length} more — open the company</li>`
          : ""
      }</ul>`
    : `<p class="none">Nothing on the record for ${esc(t.symbol)} between ${esc(
        fmtShort(newsFrom)
      )} and ${esc(fmtShort(date))}. That is coverage, not calm.</p>`;

  // Which corner the panel opens from, decided from the tile's position in the
  // WHOLE board rather than in its sector -- the two differ, and using the
  // sector-local number is why a tile at the left edge of a right-hand sector
  // opened a 280px panel straight through the board's right edge.
  //
  // The panel itself is still positioned in sector-local percentages; only the
  // choice of which edge to pin is global. The offsets below are exact
  // (`right: x%` pins the panel's right edge however wide its container is),
  // so no measurement is needed on either axis.
  const gx = s.x + (t.x / 100) * s.w;
  const gy = s.y + (t.y / 100) * s.h;
  const side = gx > 50 ? `right:${(100 - t.x - t.w).toFixed(3)}%` : `left:${t.x.toFixed(3)}%`;
  // A full panel is ~240px in a ~430px board, so the flip has to happen well
  // above the halfway line or a tile at 45% hangs out of the bottom.
  const vert = gy > 35 ? `bottom:${(100 - t.y - t.h).toFixed(3)}%` : `top:${t.y.toFixed(3)}%`;

  return `<a class="tile${band ? ` t-${band}` : ""}${small}${tiny}${t.notes.length ? " has" : ""}"
      href="/ticker?symbol=${esc(t.symbol)}"
      style="left:${t.x.toFixed(3)}%;top:${t.y.toFixed(3)}%;width:${t.w.toFixed(3)}%;height:${t.h.toFixed(3)}%"
      title="${esc(t.symbol)} ${esc(move)} · ${esc(t.name)}"
    ><span class="s">${esc(t.symbol)}</span><span class="m">${esc(move)}</span></a
    ><div class="tip" style="${side};${vert}">
      <div class="hd"><span class="s">${esc(t.symbol)}</span>
        <span class="m ${posneg(t.change)}">${esc(move)}</span></div>
      <p class="nm">${esc(t.name)}</p>
      <div class="meta">${esc(cap(t.marketCap))} · ${esc(t.subSector)} · ${esc(s.sector)}</div>
      ${list}
    </div>`;
}

/**
 * A sector's move, when its heading is wide enough to print it whole.
 *
 * "Healthcare −0" is a different number from "Healthcare −0.0%", and a clipped
 * one is indistinguishable from a real one -- so the number is dropped rather
 * than truncated, and the box carries its name alone. The name may still
 * ellipsis, which is honest: a reader can see it was cut.
 *
 * The fit is estimated from the character count against BOARD_MIN_PX, the
 * width the board never goes below (it scrolls instead). 6.1px per character
 * is 10px JetBrains Mono measured, and the estimate is conservative by a
 * character or two -- a heading that loses a number it would just have fitted
 * costs nothing, one that keeps a number it cannot fit prints a lie.
 */
/**
 * Whether a sector box is tall enough to give 17px to a heading.
 *
 * The heading is a CSS strip at a fixed height and the body below it is
 * `inset: 17px 0 0 0`. A box shorter than 17px therefore gets a body of
 * height ZERO whose top edge falls BELOW the box -- and its tiles, sized as a
 * percentage of nothing, render outside the board. It is not a rounding
 * artefact; it is a sector box smaller than its own furniture, and the
 * smallest IDX sector is two names out of two hundred.
 *
 * So the threshold is twice the strip: a heading plus at least as much room
 * again for the companies it labels. Below it the box carries tiles alone, and
 * the sector is still named in every one of their hover panels.
 */
function headFits(s: SectorBox): boolean {
  return (s.h / 100) * BOARD_MIN_H_PX >= 2 * BOARD_HEAD_PX;
}

function headMove(s: SectorBox): string {
  if (s.change == null) return "";
  const text = pct(s.change);
  const needed = (s.sector.length + text.length + 1) * 6.1 + 14; // + gap and padding
  if ((s.w / 100) * BOARD_MIN_PX < needed) return "";
  return `<span class="m ${posneg(s.change)}">${esc(text)}</span>`;
}

/**
 * The board, as a section that drops into the agenda.
 *
 * Deliberately NOT scoped by the watchlist. Every other view in this product
 * answers "what about my names"; this one answers "what did the market do",
 * and narrowing it to eight companies would turn a market picture into eight
 * rectangles. The watchlist still has the last word on where you go next --
 * every tile is a link to that company's page, which is scoped.
 */
export function renderBoard(b: Board | null): string {
  if (!b) {
    return `<p class="kicker">The board</p>
      <div class="empty">No board on record yet. It is one API call — run the backfill, or
      start the server with a key set, and the next visit draws it.</div>`;
  }

  const ramp = (dir: "up" | "dn") =>
    (dir === "dn" ? [3, 2, 1] : [1, 2, 3]).map((n) => `<i class="t-${dir}${n}"></i>`).join("");

  // The tone tally and the topics, over the same window the panels draw from.
  // Deliberately NOT merged into the four counters at the top of the page:
  // those are the watchlist's last fortnight, these are the whole board's last
  // three days, and two different questions sharing a row would be read as one.
  const tone = b.stories
    ? `<span class="n">${esc(b.stories)}</span> stor${b.stories === 1 ? "y" : "ies"}
       across ${esc(b.withNotes)} of ${esc(b.drawn)} names
       <span class="sep">·</span>
       <b class="pos">${esc(b.positive)}</b> tagged Bullish
       <span class="sep">·</span>
       <b class="neg">${esc(b.negative)}</b> tagged Bearish`
    : `<span class="faint">No stories on the record in this window.</span>`;

  const topics = b.topics.length
    ? `<span class="sep">·</span> most tagged ${b.topics
        .map((t) => `<span class="topic">${esc(t.tag)} <b>${esc(t.n)}</b></span>`)
        .join("")}`
    : "";

  return `<div class="boardhd">
      <p class="kicker">The board · ${esc(b.drawn)} largest IDX names as of ${esc(
        fmtShort(b.date)
      )}</p>
      <button class="ghost fsbtn" type="button" data-fs="board-wrap" hidden>Fullscreen</button>
    </div>
    <div class="bstats">${tone}${topics}</div>
    <div class="board-wrap" id="board-wrap"><div class="board-scroll"><div class="board">
      ${b.sectors
        .map(
          (s) => `<div class="sec" style="left:${s.x.toFixed(3)}%;top:${s.y.toFixed(3)}%;width:${s.w.toFixed(
            3
          )}%;height:${s.h.toFixed(3)}%">
            ${headFits(s) ? `<h4>${esc(s.sector)}${headMove(s)}</h4>` : ""}
            <div class="body${headFits(s) ? "" : " full"}">${s.tiles
              .map((t) => boardTile(t, s, b.newsFrom, b.date))
              .join("")}</div>
          </div>`
        )
        .join("")}
    </div></div></div>
    <div class="scale">
      <span class="ramp">${ramp("dn")}</span><span>−3% · −1% · flat · +1% · +3%</span>
      <span class="ramp">${ramp("up")}</span>
      <span>· area = market cap · <i class="sw" style="background:var(--primary);width:5px;height:5px;border-radius:50%"></i> has something on the record</span>
    </div>
    <details class="why">
      <summary>What this is, and what it is not</summary>
      <p>Colour is the last closed session's move, as the Sectors API reported it when we
      asked on ${esc(fmtShort(b.date))} — so a board drawn on a Monday is Friday's close.
      Area is market capitalisation. Both come from one market-wide call, which is why the
      whole board costs a single credit rather than one per company.</p>
      <p>The ${esc(b.drawn)} largest names are drawn. The rest of IDX is roughly 700 more
      companies carrying a few percent of the market's value between them — not excluded
      from the product, just below the resolution of this picture.</p>
      <p><b>Hovering a tile shows what was on the record for that company between
      ${esc(fmtShort(b.newsFrom))} and ${esc(fmtShort(b.date))}, newest first — not why it
      moved.</b> Each headline carries its own date because that window is wider than a day.
      ${esc(b.withNotes)} of the ${esc(b.drawn)} tiles have anything at all; the other
      ${esc(b.drawn - b.withNotes)} say so rather than reaching further back for something
      to print. A filing or a suspension is the exchange's own record; a headline is
      coverage, and green or red on one is Sectors' Bullish/Bearish tag, not a forecast.</p>
      <p>The line above the board counts <b>distinct stories</b>, not tiles. One story naming
      four companies shows up on four tiles but is counted once — otherwise the press release
      that named the most tickers would decide what the market "talked about". The tone
      tally is Sectors' own Bullish and Bearish tags and nothing inferred from the text;
      "most tagged" is every other tag those stories carried, commonest first. All of it
      covers ${esc(fmtShort(b.newsFrom))}–${esc(fmtShort(b.date))} and only the
      ${esc(b.drawn)} companies drawn here.</p>
    </details>`;
}

/**
 * The stories worth looking at before the week turns, ranked.
 *
 * Every flag on a row is a fact from the rows underneath it, and the line
 * beneath the flags is the score broken into the components that produced it
 * -- so the ordering can be disagreed with rather than just trusted. The
 * heading says what the list is NOT: pickup is how many different sources in
 * this feed ran the story, which is a floor on attention paid and says nothing
 * at all about how many people read it.
 */
function attentionSection(a: Attention, watchlist: string[]): string {
  if (!a.considered) return "";
  const w = watchlist.length ? `&w=${encodeURIComponent(watchlist.join(","))}` : "";

  if (!a.rows.length) {
    return `<p class="kicker">Needs attention</p>
      <div class="empty">None of the ${a.considered} stor${a.considered === 1 ? "y" : "ies"} in this
      range was carried by a second source or landed near a dated event. Nothing here needs
      looking at before the rest of the month does.</div>`;
  }

  const best = a.rows[0].score;
  const rows = a.rows
    .map((r, i) => {
      const t = r.thread;
      const cls = i === 0 ? "hi" : r.score >= best * 0.7 ? "mid" : "";
      const span = Math.abs(daysBetween(t.from, t.to)) + 1;
      const f: string[] = [];

      f.push(`<span class="flag k">${t.sources} different source${t.sources === 1 ? "" : "s"}${
        span > 1 ? ` in ${span} days` : " in a day"
      }</span>`);
      if (r.lift != null && r.lift >= 1.5) {
        f.push(`<span class="flag k" title="Its usual is ${r.usual!.toFixed(1)} sources a story, over
          the ${ATTENTION_BASELINE_DAYS} days to ${esc(fmtShort(a.from))}">${r.lift.toFixed(1)}× ${esc(
          t.symbols.length === 1 ? `${t.symbols[0]}'s` : "their"
        )} usual pickup</span>`);
      }
      // The one component that makes this list this product's, and the one
      // place a fitted window must never be printed as a date.
      if (r.near) {
        const when =
          r.near.days === 0
            ? r.near.cls === "predicted"
              ? "inside its predicted"
              : "on its"
            : `${r.near.days} day${r.near.days === 1 ? "" : "s"} before its${
                r.near.cls === "predicted" ? " predicted" : ""
              }`;
        const what =
          r.near.cls === "predicted"
            ? `${kindLabel(r.near.kind).toLowerCase()} window · ${esc(
                fmtRange(r.near.window!.from, r.near.window!.to)
              )}`
            : `${kindLabel(r.near.kind).toLowerCase()} · ${esc(fmtShort(r.near.date))}`;
        f.push(
          `<a class="flag d${r.near.cls === "predicted" ? " w" : ""}" href="/day?date=${esc(
            r.near.date
          )}${w}">${when} ${what}</a>`
        );
      }
      if (t.split) {
        f.push(`<span class="flag">sources disagree · ${t.positive} bullish, ${t.negative} bearish</span>`);
      }
      // Co-occurrence. The wording says "the same day" and never "because".
      // The threshold is the same 1% the score starts counting at, so a
      // component named in the line below always has a flag above it.
      if (r.move != null && Math.abs(r.move) >= EQUITY_BANDS[0]) {
        f.push(`<span class="flag ${r.move > 0 ? "u" : "d"}">${esc(t.symbols[0])} closed ${pct(
          r.move
        )} the same day</span>`);
      }
      if (r.held) {
        const yours = t.symbols.filter((s2) => s2 && watchlist.includes(s2));
        f.push(`<span class="flag w">you hold ${esc(yours.join(", "))}</span>`);
      }

      const parts = contributions(r);
      return `<article class="story ${cls}">
        <div class="rk">${i + 1}</div>
        <div>
          <div class="hd">
            ${
              t.symbols.some(Boolean)
                ? // Every name the story names, each linking its own page. A
                  // story about a syndicated loan is one row, not four.
                  t.symbols
                    .filter(Boolean)
                    .slice(0, 5)
                    .map(
                      (sym) =>
                        `<a class="tick" href="/ticker?symbol=${esc(sym)}${w}">${esc(sym)}</a>`
                    )
                    .join('<span class="when">·</span>') +
                  (t.symbols.filter(Boolean).length > 5
                    ? `<span class="when">+${t.symbols.filter(Boolean).length - 5} more</span>`
                    : "")
                : `<span class="tick faint">market</span>`
            }
            <span class="when">${esc(fmtShort(t.from))}${
              t.from === t.to ? "" : "–" + esc(fmtShort(t.to))
            }</span>
          </div>
          <h3>${
            domainOf(t.lead.sourceUrl)
              ? `<a class="${sentClass(t.lead)}" href="${esc(t.lead.sourceUrl)}" target="_blank"
                   rel="noreferrer noopener"
                   title="Open the source at ${esc(domainOf(t.lead.sourceUrl))}">${esc(
                     t.lead.title
                   )} ↗</a>`
              : `<span class="${sentClass(t.lead)}">${esc(t.lead.title)}</span>`
          }</h3>
          <div class="flags">${f.join("")}</div>
          <div class="why">${parts
            .slice(0, 4)
            .map((c) => `<span><b>${esc(ATTENTION_LABEL[c.key] ?? c.key)}</b> ${c.value.toFixed(1)}</span>`)
            .join("")}<span>= ${r.score.toFixed(1)}</span></div>
          ${
            t.members.length > 1
              ? `<details><summary>${t.members.length} headlines</summary>
                  <ul>${t.members
                    .slice()
                    .sort((x, y) => x.date!.localeCompare(y.date!))
                    .map(
                      (m) => `<li><span class="d">${esc(fmtShort(m.date!))}</span>
                        <span><span class="${sentClass(m)}">${
                          domainOf(m.sourceUrl)
                            ? `<a class="${sentClass(m)}" href="${esc(m.sourceUrl)}" target="_blank"
                                 rel="noreferrer noopener">${esc(m.title)} ↗</a>`
                            : esc(m.title)
                        }</span>
                        <span class="h">${[domainOf(m.sourceUrl), (m.tags ?? []).join(" · ")]
                          .filter(Boolean)
                          .map((x) => esc(x))
                          .join(" · ")}</span></span></li>`
                    )
                    .join("")}</ul></details>`
              : ""
          }
        </div></article>`;
    })
    .join("");

  return `<p class="kicker">Needs attention · ${esc(fmtShort(a.from))}–${esc(fmtShort(a.to))}</p>
    <p class="note"><b>${a.rows.length}</b> of ${a.considered} stor${
      a.considered === 1 ? "y" : "ies"
    } cleared the floor — carried by a second source, or landing within
    ${ATTENTION_NEAR_DAYS} days of a dated event. Sources are counted by publisher, and only the
    ones in this feed, so the number is a floor on attention paid and never a measure of how many
    people read anything. The ordering is a sort, not a claim: each row shows the parts it is made
    of.</p>
    <div class="att">${rows}</div>`;
}

/**
 * The headlines the range carries, filtered by tag.
 *
 * The filter itself is `tagBar`, up beside the companies bar -- the tags are
 * Sectors' own, so what narrows this list is the categorisation the data
 * already ships with rather than one invented here.
 *
 * The heading names the tense the range actually is: a month still running is
 * "this month so far", a finished one is a recap, and a month that has not
 * started has nothing to report.
 */
function pulseSection(p: Pulse, watchlist: string[], keep: { month: string; price?: string }): string {
  const today = todayIso();
  const future = p.from > today;
  const label = future
    ? "Nothing on record yet"
    : p.to >= today
      ? "Headlines this month · so far"
      : "Headlines this month";

  // The block sits below the calendar, so every control in it anchors back to
  // itself -- filtering a list and landing a screen above it reads as the
  // filter having done nothing. Same trick as the price strip's form.
  const here = (q: string) => `/${q ? `?${q}` : ""}#headlines`;

  // A new filter always lands on page 1: page 3 of the old one is meaningless
  // under the new one, and an empty page reads as no results at all. Anything
  // not named in the override is carried over, so narrowing by company keeps
  // the tag you were already reading under.
  const params = (over: { tag?: string; who?: string; page?: number } = {}) =>
    Object.entries({
      month: keep.month,
      w: watchlist.join(",") || undefined,
      price: keep.price,
      tag: over.tag ?? p.tag,
      who: over.who ?? p.who,
      p: (over.page ?? 1) > 1 ? String(over.page) : undefined,
    })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");

  if (!p.topics.length && !p.total && !p.tag) {
    return `<p class="kicker" id="headlines">${label}</p>
      <div class="empty">${
        future
          ? "This month has not started — no news on record."
          : "No news on record for this month. Run the backfill to fill it in."
      }</div>`;
  }

  const counted = (s: "positive" | "negative" | "neutral") =>
    p.headlines.filter((h) => sentimentOf(h) === s).length;

  return `<p class="kicker" id="headlines">${label} · ${esc(fmtShort(p.from))}–${esc(fmtShort(p.to))}</p>
  <div class="pulse">
    ${
      p.tickers.length
        ? `<div class="row"><span class="faint mono" style="font-size:10.5px">MOST ACTIVE</span>
             ${p.tickers
               .map((t) => {
                 // A company chip narrows THIS LIST and nothing else: it used
                 // to jump to the company page, which answered a question
                 // nobody asked by leaving the month you were reading. Its
                 // own page is one click further on, from the headline.
                 const on = t.symbol === p.who;
                 return `<a class="tag${on ? " hot" : ""}" href="${esc(here(params({ who: on ? "" : t.symbol })))}"${
                   on ? ' aria-current="true"' : ""
                 } title="${on ? "Show every company again" : `Show ${esc(t.symbol)} headlines only`}"><b>${esc(
                   t.symbol
                 )}</b> ${t.n} · ${esc(t.kinds.map(kindLabel).join(", ").toLowerCase())}</a>`;
               })
               .join("")}
             ${p.who ? `<a class="clear" href="${esc(here(params({ who: "" })))}">Show all companies</a>` : ""}</div>`
        : ""
    }
    ${
      p.total
        ? `<ol>${p.headlines
            .map(
              (h) => `<li><span class="d">${esc(fmtShort(h.date!))}</span>
                <span class="tick">${esc(h.symbol || "market")}</span>
                <span class="${sentClass(h)}">${
                  // The headline is its own link text here, so the host goes in
                  // the tooltip rather than the line. Still guarded: no host,
                  // no href.
                  domainOf(h.sourceUrl)
                    ? `<a class="src ${sentClass(h)}" href="${esc(h.sourceUrl)}" rel="noreferrer noopener" target="_blank"
                         title="Open the source at ${esc(domainOf(h.sourceUrl))}">${esc(h.title)} ↗</a>`
                    : esc(h.title)
                }${
                  (h.tags ?? []).length
                    ? ` <span class="faint mono" style="font-size:10.5px">${(h.tags ?? []).map((t) => esc(t)).join(" · ")}</span>`
                    : ""
                }</span></li>`
            )
            .join("")}</ol>
           <p class="note">${p.total} headline${p.total === 1 ? "" : "s"}${p.tag ? ` tagged ${tagPhrase(p.tag)}` : ""}${p.who ? ` naming <b>${esc(p.who)}</b>` : ""} in this range —
             on this page: ${counted("positive")} bullish, ${counted("negative")} bearish, ${counted("neutral")} neither, by Sectors' own tags.</p>
           ${
             p.pages > 1
               ? `<nav class="pager" aria-label="Headline pages">
                    ${step("prev", p.page > 1 ? here(params({ page: p.page - 1 })) : null, "Newer", p.page > 1 ? `page ${p.page - 1}` : "none")}
                    <span class="mid"><b>${p.offset + 1}–${p.offset + p.headlines.length}</b> of ${p.total} headlines
                      <small class="of">page ${p.page} of ${p.pages}</small></span>
                    ${step("next", p.page < p.pages ? here(params({ page: p.page + 1 })) : null, "Older", p.page < p.pages ? `page ${p.page + 1}` : "none")}
                  </nav>`
               : ""
           }`
        : `<div class="empty">No headline in this month ${
            p.tag ? `carries ${parseTags(p.tag).length === 1 ? "the tag" : "any of the tags"} ${tagPhrase(p.tag)}` : ""
          }${p.tag && p.who ? " and " : ""}${p.who ? `names ${esc(p.who)}` : ""}. Pick another, or clear the filter.</div>`
    }
  </div>`;
}

/**
 * Direction and size in one class.
 *
 * Default bands are 1% and 3%: below 1% is noise on a single IDX name, above
 * 3% is a day somebody noticed. The composite lives on a different scale
 * entirely, so the caller passes INDEX_BANDS for the market-wide strip --
 * same three depths, calibrated to what a big day actually is for that series.
 */
export function priceBand(
  change: number | null | undefined,
  bands: [number, number] = EQUITY_BANDS
): string {
  if (change == null) return "";
  const mag = Math.abs(change);
  const step = mag >= bands[1] ? 3 : mag >= bands[0] ? 2 : 1;
  return change === 0 ? "" : `${change > 0 ? "up" : "dn"}${step}`;
}

/**
 * A Google Calendar "create event" link for one day -- an all-day entry (the
 * end date is exclusive) carrying that day's agenda in the description.
 *
 * A day with nothing on it is still worth a link -- an empty date ahead is
 * where you park your own reminder to look -- so it carries a blank IDX
 * reminder rather than an agenda of nothing.
 *
 * Google's TEMPLATE endpoint takes no reminder settings, so the alert is
 * whatever the reader's calendar defaults to; a meeting is the same URL with
 * guests added on their side. Demo data says so in the title, because
 * fabricated dates landing unmarked in a real calendar is how a fixture turns
 * into a diary entry somebody later acts on.
 */
export function gcalUrl(c: Cell, mock: boolean): string {
  const one = c.items.length === 1 ? c.items[0] : null;
  const title = !c.total
    ? "IDX reminder"
    : one
      ? `${one.symbol ? `${one.symbol}: ` : ""}${one.title}`
      : `${c.total} IDX event${c.total === 1 ? "" : "s"}`;
  const lines = c.total
    ? c.items.map((i) => `- ${kindLabel(i.kind)}: ${i.symbol ? `${i.symbol} ` : ""}${i.title}`)
    : ["Nothing on the NewsIDX record for this day when the reminder was set."];
  if (c.total > c.items.length) lines.push(`- ...and ${c.total - c.items.length} more`);
  lines.push("", "Added from NewsIDX. Research tooling, not investment advice.");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: mock ? `[DEMO DATA] ${title}` : title,
    dates: `${c.date.replace(/-/g, "")}/${shift(c.date, 1).replace(/-/g, "")}`,
    details: lines.join("\n"),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function renderMonth(
  cells: Cell[],
  ym: string,
  watchlist: string[],
  opts: {
    mock: boolean;
    asOf: string | null;
    credits: string | null;
    /** The indices the strip can be drawn from, broadest first. */
    indices?: { symbol: string; label: string }[];
    /** Whose closes the strip is showing, as the route resolved it. */
    priceSymbol?: string | null;
    pulse: Pulse;
    attention: Attention;
    known?: string[];
    /** The market-wide picture, drawn above everything else. Null until a
     * board has been fetched, which is a state the page renders rather than a
     * reason not to serve it. */
    board?: Board | null;
  }
): string {
  const w = watchlist.length ? `&w=${encodeURIComponent(watchlist.join(","))}` : "";
  const indices = opts.indices ?? [];
  const priced = opts.priceSymbol ?? indices[0]?.symbol ?? null;
  const onIndex = isIndex(priced);

  /**
   * Whose closes colour the grid.
   *
   * The company filter says which companies the calendar is ABOUT; a price
   * strip can only be about one of them, so this picks which. The options are
   * the selection itself -- pricing a company you are not looking at would be
   * a third, unrelated filter -- plus the indices, which are the only honest
   * subjects for a grid covering several names. There is no "off": a month
   * with no price at all was a grid that answered fewer questions for no gain,
   * so the broad index is the floor rather than blank.
   */
  // The control anchors itself: submitting a GET form keeps the fragment in
  // the action (the form data replaces the query, nothing else), so the
  // browser lands back on the strip you just changed instead of at the top of
  // the page. No script, and the resulting URL is still shareable.
  const opt = (sym: string, label: string) =>
    `<option value="${esc(sym)}"${priced === sym ? " selected" : ""}>${esc(label)}</option>`;
  const priceFilter = `<form class="pricefilter" id="prices" method="get" action="/#prices">
      <input type="hidden" name="month" value="${esc(ym)}">
      ${watchlist.length ? `<input type="hidden" name="w" value="${esc(watchlist.join(","))}">` : ""}
      ${opts.pulse.tag ? `<input type="hidden" name="tag" value="${esc(opts.pulse.tag)}">` : ""}
      ${opts.pulse.who ? `<input type="hidden" name="who" value="${esc(opts.pulse.who)}">` : ""}
      <label for="pricepick">Price strip</label>
      <select id="pricepick" name="price">
        ${
          indices.length
            ? `<optgroup label="Index">${indices.map((i) => opt(i.symbol, i.label)).join("")}</optgroup>`
            : ""
        }
        ${
          watchlist.length
            ? `<optgroup label="Companies">${watchlist.map((s) => opt(s, s)).join("")}</optgroup>`
            : ""
        }
      </select>
      <button type="submit">Show</button>
      ${
        watchlist.length
          ? ""
          : `<span class="hint">Pick companies above to price one of them instead.</span>`
      }
    </form>`;
  const prev = shift(`${ym}-01`, -1).slice(0, 7);
  const next = shift(`${ym}-01`, 32).slice(0, 7);
  const dow = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    .map((d) => `<span>${d}</span>`)
    .join("");

  const now = todayIso();
  const grid = cells
    .map((c) => {
      const marks = c.marks
        .map((m) => `<span class="mini${m.cls === "scheduled" ? " s" : ""}">${esc(m.label)}</span>`)
        .join("");
      const dots = c.marks.map((m) => `<i class="${m.cls === "scheduled" ? "s" : ""}"></i>`).join("");
      const bands = c.priceOf === "index" ? INDEX_BANDS : EQUITY_BANDS;
      const classes = ["cell", c.weekend ? "wknd" : "", c.inMonth ? "" : "out", c.today ? "today" : "", priceBand(c.change, bands)]
        .filter(Boolean)
        .join(" ");
      const price =
        c.close != null
          ? `<div class="px"><span class="c">${esc(c.close.toLocaleString("en-US"))}</span>
             <span class="d">${c.change == null ? "" : pct(c.change)}</span></div>`
          : "";
      // The hover card. Everything it shows is already in the page, so it
      // costs a pointer move rather than a round trip.
      //
      // A day with nothing on it gets one too, as long as it is still ahead:
      // an empty date in the future is exactly where you want to park your own
      // reminder to check. Empty days behind you get nothing -- there is
      // nothing to say and nothing to diarise.
      const pop = c.items.length || c.date >= now
        ? `<div class="pop" role="note"><h4>${esc(fmtWithDay(c.date))}</h4>
           <ul>${
             c.items.length
               ? c.items
            .map(
              (i) =>
                `<li class="${i.cls === "scheduled" ? "s" : ""}"><span class="k">${esc(kindLabel(i.kind))}</span>
                 <span class="${sentClass(i)}">${i.symbol ? `<b>${esc(i.symbol)}</b> ` : ""}${esc(i.title)}</span></li>`
            )
            .join("")
               : `<li class="p">Nothing on record for this day.</li>`
           }</ul>${
            c.total > c.items.length
              ? `<div class="more">+${c.total - c.items.length} more · click for the full day</div>`
              : ""
          }<a class="gcal" href="${esc(gcalUrl(c, opts.mock))}" target="_blank" rel="noopener noreferrer"
             >+ Google Calendar</a></div>`
        : "";
      const inner = `<div class="${classes}"${c.today ? ' aria-current="date"' : ""}>
        <span class="d">${c.day}${c.today ? " · today" : ""}</span>
        ${marks}${c.overflow ? `<span class="more">+${c.overflow}</span>` : ""}
        <div class="dots">${dots}</div>
        ${price}
      </div>`;
      // The card holds a link of its own, so it sits beside the day link
      // rather than inside it -- nested anchors are not HTML.
      return `<div class="cellwrap"><a href="/day?date=${c.date}${w}">${inner}</a>${pop}</div>`;
    })
    .join("");

  return page({
    title: "NewsIDX Agenda",
    active: "agenda",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    self: "/",
    known: opts.known,
    keep: {
      month: ym,
      tag: opts.pulse.tag || undefined,
      who: opts.pulse.who || undefined,
      price: opts.priceSymbol ?? undefined,
    },
    filters: tagBar({
      action: "/",
      tag: opts.pulse.tag,
      topics: opts.pulse.topics,
      hidden: {
        month: ym,
        w: watchlist.join(",") || undefined,
        price: opts.priceSymbol ?? undefined,
        who: opts.pulse.who || undefined,
      },
      count: opts.pulse.tag
        ? `${opts.pulse.total} headline${opts.pulse.total === 1 ? "" : "s"} tagged ${tagPhrase(opts.pulse.tag)}`
        : `All ${opts.pulse.topics.length} tag${opts.pulse.topics.length === 1 ? "" : "s"} on record shown`,
    }),
    // The board is what just happened, so it leads; the calendar and the
    // headlines under it are what is coming and what has been said.
    body: `${renderBoard(opts.board ?? null)}
    ${attentionSection(opts.attention, watchlist)}
    <h2 class="mtitle">${esc(monthLabel(ym))}</h2>
    <nav class="pager" aria-label="Month">
      ${step("prev", `/?month=${prev}${w}`, "Previous", monthLabel(prev))}
      ${step("next", `/?month=${next}${w}`, "Next", monthLabel(next))}
    </nav>
    ${priceFilter}
    <p class="note">${
      watchlist.length === 1
        ? `Showing <b>${esc(watchlist[0])}</b> only`
        : watchlist.length
          ? `Showing ${watchlist.length} selected companies`
          : "Every company on record"
    }${
      priced
        ? `, priced against <b>${esc(priced)}</b>${
            onIndex ? " — the index, not any one of them" : ""
          }: its close on each trading day, green up, red down, and the deeper the tint the bigger the move.`
        : "."
    }
      Hover a date for what is on it; click for the full day. Any date from today on
      also carries a Google Calendar link, so an empty one is somewhere to park your own reminder. On a phone the cells collapse to one dot
      per class — the grid is the pattern view, the agenda is the product.</p>
    <div class="dow">${dow}</div>
    <div class="grid">${grid}</div>
    ${legend("Weekend cells dimmed — IDX does not trade, and an empty weekend is information")}
    ${pulseSection(opts.pulse, watchlist, { month: ym, price: opts.priceSymbol ?? undefined })}`,
  });
}

export function renderDay(
  d: Day,
  watchlist: string[],
  opts: { mock: boolean; asOf: string | null; credits: string | null; page?: number; known?: string[] }
): string {
  const w = watchlist.length ? `&w=${encodeURIComponent(watchlist.join(","))}` : "";
  const facts = paginate(d.facts, opts.page ?? 1);
  const section = (label: string, items: Item[], emptyNote?: string, tail = "") =>
    `<p class="kicker">${esc(label)} · ${items.length}</p>` +
    (items.length
      ? `<div class="daycard">${items.map((i) => chip(i, watchlist)).join("")}</div>${tail}`
      : `<div class="empty">${esc(emptyNote ?? "Nothing on this date.")}</div>`);

  return page({
    title: "NewsIDX Agenda",
    active: "agenda",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    self: "/day",
    known: opts.known,
    keep: { date: d.date },
    body: `<p class="kicker">One date · everything on it</p>
      <h2 class="mtitle">${esc(fmtLong(d.date))}</h2>
      <nav class="pager" aria-label="Day">
        ${step("prev", `/day?date=${shift(d.date, -1)}${w}`, "Previous", fmtWithDay(shift(d.date, -1)))}
        ${step("next", `/day?date=${shift(d.date, 1)}${w}`, "Next", fmtWithDay(shift(d.date, 1)))}
      </nav>
      ${
        watchlist.length
          ? `<p class="note">Showing ${watchlist.length === 1 ? `<b>${esc(watchlist[0])}</b>` : `${watchlist.length} selected companies`} only.</p>`
          : ""
      }
      ${section("Scheduled", d.scheduled, "Nothing the issuers have dated for this day.")}
      ${(() => {
        const body = section(
          "Facts",
          facts.items,
          "No filings, suspensions, reports or news on record for this date.",
          pager("/day", { date: d.date, w: watchlist.join(",") || undefined }, facts)
        );
        // The count in the heading is the page's, so restate the real total.
        return body.replace(
          `Facts · ${facts.items.length}`,
          `Facts · ${facts.total}`
        );
      })()}
      ${legend()}`,
  });
}

/**
 * How this name's coverage was tagged, and what it was tagged about.
 *
 * Counts only. The two sentiment tags are the provider's; the topic tags below
 * them link into the month view's filter, so "what did the Dividend stories
 * say" is one click rather than a scroll.
 */
function newsSplit(t: Timeline): string {
  if (!t.news.total) {
    return `<div class="empty">No headlines on record for this name yet.</div>`;
  }
  // Counts only. The topic tags used to be listed again here as links into the
  // month -- one filter said twice, in two places, doing two different things.
  // They are the Topic bar at the top of the page now, filtering this page.
  return `<div class="split">
      <span class="n pos"><b>${t.news.positive}</b> positive</span>
      <span class="n neg"><b>${t.news.negative}</b> negative</span>
      <span class="n"><b>${t.news.neutral}</b> neutral</span>
      <span class="muted" style="font-size:12px">of ${t.news.total} headline${t.news.total === 1 ? "" : "s"} on record —
        positive means the provider tagged it Bullish, negative Bearish, neutral neither.
        ${
          t.tags.length
            ? "Narrow the lists below with the Topic filter above."
            : "No topic tags beyond the sentiment ones on record for this name."
        }</span>
    </div>`;
}

/** The rows a generated claim rests on, as links. Built from records we hold,
 * never from anything the model wrote -- and a source without a usable host
 * still shows, as text, rather than vanishing. */
function cites(sources: { title: string; url: string | null; date: string }[] | undefined): string {
  if (!sources?.length) return "";
  return `<div class="cites"><span class="lb">Source</span>${sources
    .map((s) => {
      const host = domainOf(s.url);
      const label = `${esc(s.date ? fmtShort(s.date) : "")} ${esc(host ?? s.title.slice(0, 40))}`.trim();
      return host
        ? `<a href="${esc(s.url!)}" rel="noreferrer noopener" target="_blank" title="${esc(s.title)}">${label} ↗</a>`
        : `<span class="dead" title="${esc(s.title)}">${label}</span>`;
    })
    .join("")}</div>`;
}

/**
 * The generated block: a summary of the news, five questions, and a box for
 * one of your own.
 *
 * Generating is a POST, never a link: a page view must not be able to spend,
 * and a crawler must not be able to spend at all. It is stored against a
 * fingerprint of the rows, so the button is free to press when nothing has
 * changed -- and "Regenerate" is the deliberate exception that always spends.
 */
function faqSection(t: Timeline, watchlist: string[], faq: FaqView): string {
  const w = watchlist.length ? watchlist.join(",") : "";
  const hidden = `<input type="hidden" name="symbol" value="${esc(t.symbol)}">
       ${w ? `<input type="hidden" name="w" value="${esc(w)}">` : ""}`;

  const genButton = (label: string, opts: { force?: boolean; disabled?: boolean; title?: string } = {}) =>
    `<form class="genbar" method="post" action="/ticker/faq">
       ${hidden}
       ${opts.force ? `<input type="hidden" name="force" value="1">` : ""}
       <button type="submit"${opts.disabled ? " disabled" : ""}${opts.title ? ` title="${esc(opts.title)}"` : ""}>
         <span class="sp" aria-hidden="true"></span>${AI_MARK}<span class="t-idle">${esc(label)}</span><span class="t-busy">Generating…</span>
       </button>
       <span class="wait">asking ${esc(faq.model)} — a few seconds</span>
     </form>`;

  const control = !faq.available
    ? genButton("Generate", { disabled: true, title: faq.why ?? "generation is unavailable" })
    : !faq.row
      ? genButton("Generate the briefing")
      : faq.stale
        ? genButton("Regenerate — there are newer rows", { force: true })
        : genButton("Regenerate", { force: true, title: "Rewrites from the same rows, and spends a call" });

  const meta = faq.row
    ? `<p class="note faint">Generated <b>${esc(faq.row.generated_at.replace("T", " ").slice(0, 16))} UTC</b>
         by ${esc(faq.row.model)}, from the ${esc(faq.rows)} rows on record for this name.
         ${faq.stale ? "There are newer rows since — regenerate to include them. " : "Stored, so reopening this page costs nothing. "}
         Answers are generated; the sources they cite are not. Not investment advice.</p>`
    : "";

  if (faq.error) {
    return `<p class="kicker">Summary &amp; questions · generated</p>
      <div class="empty">Could not generate: ${esc(faq.error)}</div>
      ${control}`;
  }
  if (!faq.row) {
    return `<p class="kicker">Summary &amp; questions · generated</p>
      <div class="empty">${
        faq.available
          ? "Nothing generated for this company yet. Write a summary and five questions from the rows on this page."
          : `Generation is off — ${esc(faq.why ?? "no model configured")}.`
      }</div>
      ${control}`;
  }

  return `<p class="kicker">News summary · generated</p>
    ${
      faq.row.summary.length
        ? `<div class="brief">${faq.row.summary
            .map((s) => `<p>${esc(s.point)}${cites(s.sources)}</p>`)
            .join("")}</div>`
        : `<div class="empty">This briefing predates the summary — regenerate to add one.</div>`
    }

    <p class="kicker">Top 5 questions</p>
    <div class="faq">${faq.row.items
      .map(
        (q) => `<details><summary>${esc(q.question)}</summary>
                  <p class="a">${esc(q.answer)}${cites(q.sources)}</p></details>`
      )
      .join("")}</div>
    ${control}
    ${meta}
    ${askSection(t, watchlist, faq)}`;
}

/** The free-text box, the last answer, and the questions already asked. */
function askSection(t: Timeline, watchlist: string[], faq: FaqView): string {
  const w = watchlist.length ? watchlist.join(",") : "";
  const back = (hash: string) =>
    `/ticker?symbol=${encodeURIComponent(t.symbol)}${w ? `&w=${encodeURIComponent(w)}` : ""}&ask=${encodeURIComponent(hash)}#ask`;

  const answer = faq.ask
    ? `<div class="answer">
         <p class="q">${esc(faq.ask.question)}</p>
         <p class="a">${esc(faq.ask.answer)}${cites(faq.ask.sources)}</p>
         <p class="note faint">Answered ${esc(faq.ask.created_at.replace("T", " ").slice(0, 16))} UTC by
           ${esc(faq.ask.model)}, from the rows on this page. Stored, so asking it again is free.</p>
       </div>`
    : "";

  return `<p class="kicker" id="ask">Ask about ${esc(t.symbol)}</p>
    <form class="genbar askbox" method="post" action="/ticker/ask">
      <input type="hidden" name="symbol" value="${esc(t.symbol)}">
      ${w ? `<input type="hidden" name="w" value="${esc(w)}">` : ""}
      <label class="sr" for="askq">Ask a question about ${esc(t.symbol)}</label>
      <input id="askq" name="q" type="text" maxlength="${MAX_QUESTION}" required
             placeholder="e.g. what did the board decide about dividends?"
             autocomplete="off"${faq.available ? "" : " disabled"}>
      <button type="submit"${faq.available ? "" : " disabled"}>
        <span class="sp" aria-hidden="true"></span><span class="t-idle">Ask</span><span class="t-busy">Thinking…</span>
      </button>
      <span class="wait">asking ${esc(faq.model)} — a few seconds</span>
    </form>
    ${faq.askError ? `<div class="empty">${esc(faq.askError)}</div>` : ""}
    ${answer}
    ${
      faq.asked.length
        ? `<div class="asked"><span class="faint mono" style="font-size:10.5px">ASKED BEFORE</span>
             ${faq.asked
               .map((a) => `<a href="${esc(back(a.qhash))}" title="Stored answer, free to reopen">${esc(a.question)}</a>`)
               .join("")}</div>`
        : ""
    }
    <p class="note faint">Answered only from the rows on this page — never from anything else the model
      might know, and never as advice.</p>`;
}

/** What the ticker page needs to know about the stored briefing. */
export interface FaqView {
  row: FaqRow | null;
  /** Whether the rows have moved since the stored text was written. */
  stale: boolean;
  /** Whether generation can happen at all (a key, or fixtures). */
  available: boolean;
  why?: string | null;
  error?: string | null;
  rows: number;
  /** Which model the buttons should name while they wait. */
  model: string;
  /** The answer being shown, if a question was just asked or reopened. */
  ask?: AskRow | null;
  askError?: string | null;
  /** Questions already answered for this company -- all free to reopen. */
  asked: AskRow[];
}

/**
 * The windows we did NOT draw, and why.
 *
 * A refusal is a result (METHODOLOGY.md §4). Silently omitting one would leave
 * the page looking like a company with no rhythm and a company whose rhythm we
 * rejected are the same thing, and they are not. This is also the honest half
 * of the hit rate: a product that only ever shows its successful fits is
 * reporting a number it has already filtered.
 */
function refusals(rows: Timeline["refusals"]): string {
  if (!rows.length) return "";
  return `<p class="kicker">No window drawn</p>
    <div class="rows">${rows
      .map(
        (r) => `<div class="chip fact">
          <span class="when faint">—</span>
          <span class="tick faint">no fit</span>
          <div class="what"><span class="kind">${esc(kindLabel(r.kind))}</span>
            <span class="faint">${esc(r.reason)}</span></div>
        </div>`
      )
      .join("")}</div>
    <p class="note faint">A window we cannot defend is stated, not widened.</p>`;
}

export function renderTicker(
  t: Timeline,
  watchlist: string[],
  opts: {
    mock: boolean;
    asOf: string | null;
    credits: string | null;
    page?: number;
    faq: FaqView;
    known?: string[];
    /** The Topic filter, shared with the agenda. */
    tag?: string;
  }
): string {
  const tag = opts.tag ?? "";
  // Same rule the calendar grid uses: a topic narrows NEWS and leaves the rest
  // alone. A filing carries no tags, and dropping every dated action because
  // the reader picked "Dividend" would empty the page rather than narrow it.
  const keep = (i: Item) => i.kind !== "news" || matchesTag(i, tag);
  const ahead = t.ahead.filter(keep);
  const behind = paginate(t.behind.filter(keep), opts.page ?? 1);
  const shown = t.behind.filter((i) => i.kind === "news" && matchesTag(i, tag)).length;

  return page({
    title: "NewsIDX Agenda",
    active: "ticker",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    self: "/ticker",
    known: opts.known,
    // No `symbol` here on purpose: the filter above must be able to change
    // which company this page is about, and a kept symbol would outrank it.
    keep: { tag: tag || undefined },
    filters: tagBar({
      action: "/ticker",
      tag,
      topics: t.tags,
      hidden: { symbol: t.symbol, w: watchlist.join(",") || undefined },
      count: tag
        ? `${shown} headline${shown === 1 ? "" : "s"} tagged \u201c${tag}\u201d`
        : `${t.tags.length} tag${t.tags.length === 1 ? "" : "s"} on record`,
    }),
    body: `<p class="kicker">One company · past and ahead</p>
      <div class="mhead"><h2 class="mono">${esc(t.symbol)}</h2></div>
      ${
        watchlist.length > 1
          ? `<p class="note">Showing <b>${esc(t.symbol)}</b>, the first of your ${watchlist.length} selected companies —
             ${watchlist
               .filter((s) => s !== t.symbol)
               .map((s) => `<a class="tickerlink" href="/ticker?symbol=${esc(s)}&w=${esc(watchlist.join(","))}">${esc(s)}</a>`)
               .join(" · ")}</p>`
          : ""
      }
      <p class="kicker">How this name's news was tagged</p>
      ${newsSplit(t)}
      ${faqSection(t, watchlist, opts.faq)}
      <p class="kicker">Ahead</p>
      ${
        ahead.length
          ? `<div class="rows">${ahead.map((i) => chip(i, watchlist)).join("")}</div>`
          : `<div class="empty">Nothing the issuer has dated ahead for this name, and no rhythm we would draw a window from.</div>`
      }
      ${refusals(t.refusals)}
      <p class="kicker">Behind${behind.total ? ` · ${behind.total}` : ""}</p>
      ${
        behind.items.length
          ? `<div class="rows">${behind.items.map((i) => chip(i, watchlist)).join("")}</div>
             ${pager("/ticker", { symbol: t.symbol, w: watchlist.join(",") || undefined, tag: tag || undefined }, behind)}`
          : `<div class="empty">No facts on record for this name yet.</div>`
      }
      ${legend()}`,
  });
}
