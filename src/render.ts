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
import type { Board, IndexReturn, Mover, Movers, SectorBox, Tile } from "./heatmap.js";
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
  MOVER_LABEL,
  MOVER_PERIODS,
  type MoverPeriod,
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
  /* Light theme text is darkened from the design system's values on purpose.
     On white, #a29d94 faint text was 2.6:1 and #2AB673 gain text 2.6:1, below
     WCAG AA's 4.5:1 for body text; every value here clears 4.5:1 on --bg,
     --surface and --surface-2. The dark theme keeps the pinned tokens. */
  :root[data-theme="light"]{
    --primary:#0091ea; --primary-light:#40c4ff; --primary-dark:#0064a8;
    --bg:#faf8f6; --surface:#ffffff; --surface-2:#f5f2ef; --surface-3:#efece8;
    --border:#ece8e3; --border-strong:#ddd7cf;
    --text:#1a1a1a; --text-muted:#57534c; --text-faint:#736e66;
    --up:#137a45; --down:#c62828;
    --primary-wash: color-mix(in srgb, var(--primary) 11%, transparent);
    --shadow: 0 1px 2px rgba(20,15,5,.04), 0 8px 24px -8px rgba(20,15,5,.08);
  }
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){
      --primary:#0091ea; --primary-light:#40c4ff; --primary-dark:#0064a8;
      --bg:#faf8f6; --surface:#ffffff; --surface-2:#f5f2ef; --surface-3:#efece8;
      --border:#ece8e3; --border-strong:#ddd7cf;
      --text:#1a1a1a; --text-muted:#57534c; --text-faint:#736e66;
    --up:#137a45; --down:#c62828;
      --primary-wash: color-mix(in srgb, var(--primary) 11%, transparent);
      --shadow: 0 1px 2px rgba(20,15,5,.04), 0 8px 24px -8px rgba(20,15,5,.08);
    }
  }

  /* Ours, not the design system's: colour ROLES. Each hue means one thing.
       --primary   interactive and "the issuer dated it" (the design system's)
       --up/--down a price moved. Nothing else is ever green or red.
       --bull/--bear the provider's sentiment tag. A glyph colour only -- the
                   headline itself stays body text, because a tag on coverage
                   is not a price move and must not look like one.
       --alert     needs you soon: under a week to go, the top-ranked story.
     An active filter wears --primary filled: the bar is the one place it
     lives, so it needs no hue of its own. */
  :root{
    --bull:#8ea2ff; --bear:#e58ad9; --alert:#f5a524;
    --alert-wash: color-mix(in srgb, var(--alert) 14%, transparent);
  }
  :root[data-theme="light"]{ --bull:#3b56c4; --bear:#a3368f; --alert:#8f5300; }
  @media (prefers-color-scheme: light){ :root:not([data-theme="dark"]){ --bull:#3b56c4; --bear:#a3368f; --alert:#8f5300; } }

  *{box-sizing:border-box}
  /* Type scale: 12 meta · 13 dense rows · 14 body · 16 section · 22 page.
     Sans for words, mono only where digits must line up: dates, tickers,
     prices, percentages, counts. Nothing on the page is set under 11px. */
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font-ui);
       font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
  h1,h2,h3{margin:0;text-wrap:balance}
  .mono,time,.tick,.num{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
  a{color:inherit}
  :focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:4px}
  @media (prefers-reduced-motion:reduce){*{transition-duration:.001ms !important;animation-duration:.001ms !important}}

  .wrap{max-width:780px;margin:0 auto;padding:0 16px 56px}

  /* ---------------- the dashboard shell ----------------
     780px is a reading column, which is right for a day or a company and
     wrong for the agenda: on a 1440px screen it left 660px of empty gutter
     and stacked four blocks into three and a half screens of scrolling.
     So the agenda opts into a second track. Everything below 1200px stays
     exactly as it was -- one column, in the order the page reads. */
  .dash{display:grid;gap:8px}
  /* A grid item defaults to min-width:auto, so it refuses to shrink below its
     widest child -- and the board's child is a deliberate 760px that
     .board-scroll is supposed to pan. Without this every section in the grid
     inherits that 760px and the whole PAGE scrolls sideways on a phone
     instead of just the treemap. Declared in the base rule, not the two-track
     one: the single column is where it actually bites. */
  .dash > section{min-width:0}
  /* Full width at 16:9 is a whole screen of treemap. Capped, and never under
     the 400px the sector headings are sized against (BOARD_MIN_H_PX). The
     phone keeps its own panned 760px board. */
  @media (min-width:761px){ .board{aspect-ratio:auto;height:clamp(400px,38vw,560px)} }
  /* Two tracks with one job each: the left is what is COMING (up next, the
     month), the right is what is being SAID (ranked stories, headlines).
     Each track is its own column, so a long list on one side never opens a
     gap on the other, and the DOM order -- left track, then right -- is the
     reading order at every width, for a screen reader and the tab key too. */
  .dash-col{min-width:0}
  @media (min-width:1200px){
    .wrap.wide{max-width:1340px}
    .dash{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);column-gap:32px;align-items:start}
  }
  /* The first heading in a track supplies no top margin, so both tracks
     start level. */
  .dash-col > .sh:first-child,.dash-col > section:first-child > .sh:first-child{margin-top:20px}

  /* ---------------- chrome ---------------- */
  .mock{background:var(--alert-wash);border-bottom:1px solid var(--border);
        font-size:12px;color:var(--text);padding:6px 16px;text-align:center}
  .mock b{color:var(--alert)}
  /* One bar: brand, the three views, About, theme. Navigation used to be a
     second row under the filters, so the page opened on three rows of chrome. */
  .top{display:flex;align-items:center;gap:6px 16px;flex-wrap:wrap;padding:14px 0 12px;
       border-bottom:1px solid var(--border)}
  .brand{font-size:16px;font-weight:700;letter-spacing:-.015em;display:flex;align-items:center;gap:8px;text-decoration:none}
  .brand .dot{width:7px;height:7px;border-radius:50%;background:var(--primary)}
  .top .sp{flex:1}
  button.ghost{background:var(--surface);color:var(--text-muted);border:1px solid var(--border);
               border-radius:8px;padding:6px 11px;font-size:13px;font-family:inherit;cursor:pointer;min-height:34px}
  button.ghost:hover{color:var(--text);border-color:var(--border-strong)}

  /* The three views, as a segmented control. A single day is a drill-down. */
  .tabs{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;background:var(--surface);
        border:1px solid var(--border);border-radius:9px;padding:2px}
  .tabs::-webkit-scrollbar{display:none}
  .tab{color:var(--text-muted);font-size:13px;font-weight:500;padding:5px 12px;border-radius:7px;
       white-space:nowrap;min-height:30px}
  .tab:hover{color:var(--text)}
  .tab[aria-selected="true"]{color:var(--text);background:var(--surface-3)}
  @media (max-width:640px){ .top .tabs{order:3;flex-basis:100%} .tab{flex:1;justify-content:center} }

  /* ---------------- shared pieces ---------------- */
  /* A section heading: sans, body colour, one size up. The old one was 10.5px
     mono capitals in the faintest grey, which is why ten sections all read
     as equally (un)important. */
  .kicker,.sh h2{font-size:16px;font-weight:600;letter-spacing:-.01em;color:var(--text);margin:32px 0 12px}
  .sh{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;margin:32px 0 12px}
  .sh h2{margin:0}
  .sh .sub{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
  .sh .end{margin-left:auto;display:flex;gap:10px;align-items:center}
  .muted{color:var(--text-muted)}
  .faint{color:var(--text-muted)}

  /* ---------------- the filter bar ----------------
     One pattern on every page: a single GET form, fields left to right,
     Apply, and a Clear that only exists while something is narrowed. The
     topics live in a popover of checkboxes instead of a row of 14 chips. */
  .fbar{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:12px 0;
        border-bottom:1px solid var(--border)}
  .f-field{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
  .f-lab{font-size:12px;font-weight:600;color:var(--text-muted)}
  .fbar .pill{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);text-decoration:none;
              border:1px solid var(--border);border-radius:999px;padding:3px 10px;min-height:28px;
              display:inline-flex;align-items:center;gap:5px}
  .fbar a.pill:hover{border-color:var(--border-strong);color:var(--text)}
  .fbar .pill.on{background:var(--primary-wash);border-color:color-mix(in srgb,var(--primary) 40%,transparent);color:var(--text)}
  .fbar .pill.all{color:var(--text-muted)}
  .fbar input[type=text],.fbar select{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
         border:1px solid var(--border);border-radius:8px;padding:5px 10px;min-height:32px}
  .fbar input[type=text]{width:150px}
  .fbar input::placeholder{color:var(--text-muted)}
  .fbar input:focus-visible,.fbar select:focus-visible{border-color:var(--primary)}
  .f-drop{font-family:var(--font-ui);font-size:13px;background:var(--surface-2);color:var(--text);
          border:1px solid var(--border);border-radius:8px;padding:5px 10px;min-height:32px;cursor:pointer}
  .f-drop::after{content:" ▾";color:var(--text-muted)}
  .f-drop.on{background:var(--primary-wash);border-color:color-mix(in srgb,var(--primary) 40%,transparent)}
  .f-apply{font-family:var(--font-ui);font-size:13px;font-weight:600;background:var(--primary-wash);color:var(--text);
           border:1px solid color-mix(in srgb,var(--primary) 40%,transparent);border-radius:8px;padding:5px 14px;
           min-height:32px;cursor:pointer}
  .f-apply:hover{border-color:var(--primary)}
  .f-clear{font-size:13px;color:var(--primary-dark);text-decoration:none;padding:6px 0}
  .f-clear:hover{text-decoration:underline}
  .f-count{font-size:12px;color:var(--text-muted);margin-left:auto;white-space:nowrap}
  .f-warn{flex-basis:100%;margin:0;font-size:12px;color:var(--alert)}
  .f-warn b{font-family:var(--font-mono);font-weight:600}
  .f-pop .opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px 12px;margin:10px 0 14px}
  .f-pop label{display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0;cursor:pointer}
  .f-pop label .n{margin-left:auto;font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
  .f-pop input[type=checkbox]{accent-color:var(--primary);width:15px;height:15px;margin:0}
  .f-pop .acts{display:flex;gap:12px;align-items:center}
  @media (max-width:640px){ .f-count{margin-left:0;flex-basis:100%} .fbar input[type=text]{flex:1 1 120px} }

  /* ---------------- disclosure: popovers ----------------
     Every explanation the page used to print inline lives behind an ⓘ next
     to the heading it explains, and the key to the shapes behind About. The
     native popover: no script, Escape and light-dismiss for free, and in a
     browser without it the text simply renders inline. */
  .info{width:22px;height:22px;border-radius:50%;border:1px solid var(--border-strong);background:none;
        color:var(--text-muted);font:600 12px/1 var(--font-ui);cursor:pointer;padding:0;flex:none}
  .info:hover{color:var(--text);border-color:var(--text-muted)}
  [popover].pop-card{margin:auto;width:min(560px,calc(100vw - 32px));max-height:min(80vh,720px);overflow:auto;
        background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:14px;
        padding:18px 20px;box-shadow:var(--shadow)}
  [popover].pop-card::backdrop{background:rgba(0,0,0,.45)}
  [popover].pop-card h3{font-size:16px;font-weight:600;margin:0 0 8px}
  [popover].pop-card h4{font-size:13px;font-weight:600;margin:14px 0 4px}
  [popover].pop-card p{font-size:13px;line-height:1.6;color:var(--text-muted);margin:0 0 10px}
  [popover].pop-card p b{color:var(--text)}
  [popover].pop-card .x{float:right;margin:-4px -6px 0 8px}
  /* About opens as a drawer from the right, because it is reference you keep
     beside the page rather than a question the page is asking you. */
  [popover].pop-card.drawer{margin:0 0 0 auto;height:100vh;max-height:none;border-radius:14px 0 0 14px}
  .key{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;font-size:12px;color:var(--text-muted)}
  .key span{display:inline-flex;align-items:center;gap:6px}
  .key.full{flex-direction:column;gap:10px;font-size:13px}
  .key.full span{align-items:flex-start}
  .key.full .sw{flex:none;margin-top:3px}

  /* ---------------- chips: three classes, three shapes (plan.md §2) ---------------- */
  .rows{display:flex;flex-direction:column;gap:7px}
  .chip{display:grid;grid-template-columns:78px 52px 1fr;gap:12px;align-items:baseline;
        padding:11px 13px;border-radius:9px;border:1px solid var(--border);background:var(--surface-2)}
  .chip .when{font-family:var(--font-mono);font-size:12px;color:var(--text-muted)}
  .chip .tick{font-size:12.5px;font-weight:600}
  .chip .what{font-size:13px}
  .chip .kind{font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
              color:var(--text-muted);display:block;margin-bottom:3px}
  .chip.sched{box-shadow:inset 2px 0 0 var(--primary)}
  .chip.sched .kind{color:var(--primary-dark)}
  .chip.fact .kind{color:var(--text-muted)}
  /* Predicted: no fill and a dashed edge. A shape, not a colour -- colour
     alone fails colour-blind readers and fails a compressed video. */
  .chip.pred{background:none;border-style:dashed}
  .chip.pred .when,.chip.pred .kind,.chip.pred .what{color:var(--text-muted)}
  .chip.pred .when{font-weight:600}
  details.how{margin-top:5px}
  details.how summary{font-size:11px;color:var(--text-muted);cursor:pointer;list-style:none;
                      min-height:24px;display:flex;align-items:center}
  details.how summary::-webkit-details-marker{display:none}
  details.how summary::before{content:"▸ ";font-size:9px}
  details.how[open] summary::before{content:"▾ "}
  details.how .note{margin-top:4px;font-size:11.5px}
  .drop{font-family:var(--font-mono);font-size:11.5px;color:var(--down)}
  .note{color:var(--text-muted);font-size:12px;margin-top:3px}
  .src{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);
       border-bottom:1px dashed color-mix(in srgb,var(--primary) 40%,transparent);cursor:default}

  .sw{width:22px;height:13px;border-radius:4px;border:1px solid var(--border);background:var(--surface-2)}
  .sw.s{box-shadow:inset 2px 0 0 var(--primary)}
  .sw.p{background:none;border-style:dashed}

  /* ---------------- up next: the book's next 90 days, first ----------------
     The question the product exists to answer, so it opens the page and spans
     both tracks. Tiles are counts a manager reads in one pass; the table is
     the same rows sorted by date, so the tiles can be checked against it. */
  .nx-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .nx-csv{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);text-decoration:none;
          padding:5px 0;white-space:nowrap}
  .nx-csv:hover{text-decoration:underline}
  /* ---------------- a calendar day, opened in the headlines column ---------------- */
  .dayhead{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .dayhead h3{font-size:15px;font-family:var(--font-mono);font-weight:600;outline:none}
  .dayhead .acts{display:flex;gap:8px;align-items:center}
  .dayhead .acts a{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);text-decoration:none;padding:5px 0}
  .dayhead .acts a:hover{text-decoration:underline}
  .cellwrap > a.picked > .cell{box-shadow:0 0 0 2px var(--primary);border-color:var(--primary)}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .kpi{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 13px;min-width:0}
  .kpi .k{font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
  .kpi .v{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:22px;font-weight:600;
          letter-spacing:-.02em;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kpi .v small{font-size:12px;font-weight:500;color:var(--text-muted);letter-spacing:0}
  .kpi .s{font-size:11.5px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kpi.lead{border-color:color-mix(in srgb,var(--primary) 45%,var(--border));background:
            linear-gradient(var(--primary-wash),var(--primary-wash)),var(--surface)}
  /* The wrapper pans on a phone, like the board: the certainty column is the
     honesty rule in text, so it scrolls rather than being hidden. */
  .nx-scroll{margin-top:10px;overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:10px}
  .nx{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
  .nx th{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
         color:var(--text-muted);text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--surface-2)}
  .nx td{padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:baseline}
  .nx tr:last-child td{border-bottom:0}
  .nx tbody tr:hover td{background:var(--surface-2)}
  .nx .r{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
  .nx .when{font-family:var(--font-mono);font-size:12px;white-space:nowrap}
  .nx .soon{color:var(--alert);font-weight:600}
  /* The certainty column carries the chip's shape, so the three classes read
     the same here as everywhere else on the page. */
  .nx .cert{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--text-muted);white-space:nowrap}
  .nx tr.pred td{color:var(--text-muted)}
  .nx .sw{width:16px;height:10px;border-color:var(--text-muted)}
  .nx .tickerlink{display:inline-block;padding:5px 0}
  .nx .more td{font-size:12px;color:var(--text-muted);text-align:center;white-space:normal}
  .nx td{white-space:nowrap}
  @media (max-width:880px){
    .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
    .kpi .v small{display:block;margin-top:1px}
  }
  @media (max-width:640px){ .nx td,.nx th{padding:8px} }

  /* ---------------- month grid ---------------- */
  .mhead{display:flex;align-items:center;gap:10px;margin-top:18px}
  .mhead h2{font-size:15px;font-family:var(--font-mono);font-weight:600}
  .mtitle{font-size:16px;font-family:var(--font-mono);font-weight:600;margin-top:20px}

  /* --- which company's closes colour the grid */
  .pricefilter{display:flex;flex-wrap:wrap;gap:6px;align-items:center;
               scroll-margin-top:14px}
  .pricefilter label{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.07em;
                     text-transform:uppercase;color:var(--text-muted)}
  .pricefilter select{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
                      border:1px solid var(--border);border-radius:999px;padding:6px 11px;min-height:34px}
  .pricefilter select:focus-visible{border-color:var(--primary)}
  .pricefilter button{font-family:var(--font-mono);font-size:12px;background:var(--surface);color:var(--text-muted);
                      border:1px solid var(--border);border-radius:999px;padding:6px 12px;cursor:pointer;min-height:34px}
  .pricefilter button:hover{color:var(--text);border-color:var(--border-strong)}
  .pricefilter .hint{font-size:11.5px;color:var(--text-muted)}
  .dow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin:14px 0 5px}
  .dow span{font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;color:var(--text-muted);text-align:center}
  .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
  .cell{background:var(--surface);border:1px solid var(--border);border-radius:8px;
        min-height:88px;padding:6px;display:flex;flex-direction:column;gap:4px}
  .cell .d{font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .cell.wknd{background:var(--surface-2);border-color:transparent}
  .cell.out{opacity:.38}
  .cell.today{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary-wash)}
  .cell.today .d{color:var(--primary);font-weight:600}
  .mini{font-family:var(--font-mono);font-size:11px;line-height:1.35;padding:2px 4px;border-radius:4px;
        background:var(--surface-2);border:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mini.s{box-shadow:inset 2px 0 0 var(--primary)}
  .more{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);padding-left:3px}
  .dots{display:none;gap:3px}
  .dots i{width:5px;height:5px;border-radius:50%;background:var(--text-muted)}
  .dots i.s{background:var(--primary)}
  @media (max-width:640px){
    .cell{min-height:52px;align-items:flex-start}
    .mini,.more{display:none}
    .dots{display:flex}
    .chip{grid-template-columns:1fr;gap:2px}
    .chip .when{order:-1}
  }

  /* ---------------- day + ticker ---------------- */
  .daycard{display:flex;flex-direction:column;gap:7px;margin-top:8px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  .tw{overflow-x:auto;margin-top:10px;border:1px solid var(--border);border-radius:10px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
  th{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;
     color:var(--text-muted);font-weight:600;background:var(--surface-2)}
  tbody tr:last-child td{border-bottom:0}

  .empty{border:1px dashed var(--border-strong);border-radius:10px;padding:14px;color:var(--text-muted);font-size:13px}
  footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--border);
         font-family:var(--font-mono);font-size:11px;color:var(--text-muted);
         display:flex;flex-wrap:wrap;gap:6px 16px}
  [hidden]{display:none !important}
  .js .autobtn{display:none}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
      clip:rect(0 0 0 0);white-space:nowrap;border:0}

  a.src{cursor:pointer}
  a.src:hover{color:var(--primary)}
  .tab{text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .cellwrap{display:block;text-decoration:none;color:inherit}
  .cellwrap:hover .cell{border-color:var(--border-strong)}
  .tickerlink{font-family:var(--font-mono);font-size:11px;color:var(--primary-dark);text-decoration:none}
  .tickerlink:hover{text-decoration:underline}

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
  .pop li .k{font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
             color:var(--text-muted);flex:0 0 auto}
  .pop li.s .k{color:var(--primary-dark)}
  .pop li.p{color:var(--text-muted)}
  .pop .more{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:6px}
  .pop .gcal{display:inline-block;margin-top:4px;padding:6px 0;font-family:var(--font-mono);font-size:11px;
             letter-spacing:.05em;color:var(--primary-dark);text-decoration:none}
  .pop .gcal:hover{text-decoration:underline}
  @media (max-width:640px){ .pop{display:none} }

  /* --- sentiment: Sectors' own Bullish/Bearish tag, in the semantic colours
         the design system already reserves for up and down. The headline
         itself carries the colour -- a tagged story IS the signal, so there is
         nothing else to badge. */
  .pos{color:var(--up)}
  .neg{color:var(--down)}
  /* A sentiment tag is not a price move, so the headline keeps the body
     colour and only the glyph takes the sentiment role. */
  .tone.pos,.tone.neg{color:inherit}
  .tone::before{font-size:.8em;text-decoration:none;display:inline-block;margin-right:.35em}
  .tone.pos::before{content:"▲";content:"▲" / "Bullish:";color:var(--bull)}
  .tone.neg::before{content:"▼";content:"▼" / "Bearish:";color:var(--bear)}
  .bull{color:var(--bull)} .bear{color:var(--bear)}
  .sent{font-family:var(--font-mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase}

  /* --- steppers: one treatment for every prev/next in the product, whether it
         moves through a list, a month or a day. Each side says where it goes,
         because "←" alone makes you click to find out. */
  .pager{display:flex;align-items:center;gap:8px;margin-top:12px;
         font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .pager .mid{flex:1;text-align:center;line-height:1.35}
  .pager .mid b{color:var(--text);font-weight:600}
  .pager .of{display:block;font-size:11.5px;color:var(--text-muted)}
  .pg{display:inline-flex;align-items:center;gap:7px;text-decoration:none;
      font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);
      background:var(--surface);border:1px solid var(--border);border-radius:9px;
      padding:7px 12px;min-height:36px;transition:border-color .12s var(--ease),color .12s var(--ease)}
  .pg:hover{color:var(--text);border-color:var(--border-strong);background:var(--surface-2)}
  .pg .ar{color:var(--text-muted);font-size:13px;line-height:1}
  .pg:hover .ar{color:var(--primary)}
  .pg .lb{display:flex;flex-direction:column;line-height:1.2}
  .pg .lb small{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--text-muted)}
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
  .px .d{font-size:11px}
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
  /* The date takes it too: it is the first thing the eye lands on in a cell,
     and a grey date over a green close made the day read as neutral. Today
     keeps its ring, so it stays findable when its date turns green or red. */
  .cell.up1 > .d,.cell.up2 > .d,.cell.up3 > .d{color:var(--up)}
  .cell.dn1 > .d,.cell.dn2 > .d,.cell.dn3 > .d{color:var(--down)}

  /* --- needs attention: the ranked stories above the headline list.
         Shares the pulse's surface and radius -- they are two views of the
         same rows, and a second card style would imply a second source. */
  .att{display:grid;gap:8px;margin-top:12px}
  .att .story{background:var(--surface);border:1px solid var(--border);border-radius:12px;
              padding:11px 13px;display:grid;grid-template-columns:30px 1fr;gap:11px;align-items:start}
  .att .story.hi{border-color:color-mix(in srgb,var(--alert) 45%,transparent)}
  .att .story.mid{border-color:color-mix(in srgb,var(--primary) 34%,transparent)}
  .att .rk{font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--text-muted);
           text-align:right;line-height:1.35}
  .att .story.hi .rk{color:var(--alert)} .att .story.mid .rk{color:var(--primary-dark)}
  .att .hd{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
  .att .hd .tick{font-family:var(--font-mono);font-size:11.5px;font-weight:600}
  .att .hd .when{font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .att h3{margin:1px 0 0;font-size:13.5px;font-weight:600;letter-spacing:-.005em}
  .att h3 a{text-decoration:none} .att h3 a:hover{text-decoration:underline}
  .att .flags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
  .att .flag{font-family:var(--font-mono);font-size:11.5px;border:1px solid var(--border);
             border-radius:999px;padding:2px 8px;color:var(--text-muted);background:var(--surface-2);
             white-space:nowrap}
  .att .flag.k{border-color:color-mix(in srgb,var(--primary) 40%,transparent);color:var(--primary-dark)}
  .att .flag.e{border-color:color-mix(in srgb,var(--alert) 45%,transparent);color:var(--alert);text-decoration:none}
  .att .flag.d{border-color:color-mix(in srgb,var(--down) 40%,transparent);color:var(--down)}
  .att .flag.u{border-color:color-mix(in srgb,var(--up) 40%,transparent);color:var(--up)}
  .att .flag.w{border-style:dashed}
  /* the score as its parts. A single number nobody can decompose is the thing
     to avoid, so the bar is only ever a picture of the line beneath it. */
  .att .why{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:6px;
            display:flex;flex-wrap:wrap;gap:9px}
  .att .why b{font-weight:600;color:var(--text-muted)}
  .att details{margin-top:7px}
  .att summary{cursor:pointer;font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted);
               list-style:none;padding:5px 0}
  .att summary::-webkit-details-marker{display:none}
  .att summary::before{content:"\\25b8 "}
  .att details[open] summary::before{content:"\\25be "}
  .att details ul{list-style:none;margin:6px 0 0;padding:0 0 0 12px;border-left:1px solid var(--border);
                  display:grid;gap:4px;font-size:12px}
  .att details li{display:grid;grid-template-columns:50px 1fr;gap:8px;align-items:baseline}
  .att details .d{font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
  .att details .h{font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
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
  .pulse ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .pulse ol li{font-size:12.5px;display:grid;grid-template-columns:56px 44px 1fr;gap:10px;align-items:baseline}
  .pulse ol li .d{font-family:var(--font-mono);font-size:11px;color:var(--text-muted)}
  /* --- the tag split on a company page */
  .co-head{display:flex;align-items:baseline;gap:6px 14px;flex-wrap:wrap;margin-top:22px}
  .co-head h1{font-family:var(--font-mono);font-size:24px;font-weight:700;letter-spacing:-.01em}
  .co-stat{font-size:13px;color:var(--text-muted)}
  .co-stat b{font-family:var(--font-mono);font-weight:600;color:var(--text)}
  /* --- generated FAQ. One native <details> per question: no script, open by
         URL fragment, and readable with the stylesheet off. */
  .faq{display:flex;flex-direction:column;gap:6px;margin-top:8px}
  .faq details{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:11px 13px}
  .faq details[open]{background:var(--surface-2);border-color:var(--border-strong)}
  .faq summary{cursor:pointer;list-style:none;font-size:13px;font-weight:600;display:flex;gap:9px;align-items:baseline}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary::before{content:"+";font-family:var(--font-mono);color:var(--text-muted);flex:0 0 auto}
  .faq details[open] summary::before{content:"−";color:var(--primary)}
  .faq summary:hover{color:var(--primary-light)}
  .faq .a{font-size:12.5px;color:var(--text-muted);line-height:1.6;margin:8px 0 0 18px}
  .genbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px}
  .genbar button{font-family:var(--font-mono);font-size:12px;background:var(--primary-wash);color:var(--primary-dark);
                 border:1px solid color-mix(in srgb,var(--primary) 35%,transparent);border-radius:999px;
                 padding:7px 14px;cursor:pointer;min-height:34px}
  .genbar button:hover{border-color:var(--primary)}
  .genbar button[disabled]{background:var(--surface-2);color:var(--text-muted);
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
  .genbar .wait{font-size:11.5px;color:var(--text-muted);display:none}
  .genbar.busy .wait{display:inline}

  /* --- sources under a generated claim */
  .cites{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;margin-top:5px}
  .cites .lb{font-family:var(--font-mono);font-size:11px;letter-spacing:.07em;
             text-transform:uppercase;color:var(--text-muted)}
  .cites a,.cites span.dead{font-family:var(--font-mono);font-size:11.5px;color:var(--primary-dark);
            text-decoration:none;border-bottom:1px dashed color-mix(in srgb,var(--primary) 40%,transparent)}
  .cites a:hover{color:var(--primary);border-bottom-style:solid}
  .cites span.dead{color:var(--text-muted);border-bottom-color:var(--border)}

  /* --- the news summary */
  .brief{margin:8px 0 0;display:flex;flex-direction:column;gap:11px}
  .brief p{margin:0;font-size:13px;line-height:1.65}

  /* --- ask a question */
  .askbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
  .askbox input{flex:1;min-width:220px;font-size:13px;background:var(--surface-2);color:var(--text);
                border:1px solid var(--border);border-radius:999px;padding:9px 14px;min-height:38px;
                font-family:var(--font-ui)}
  .askbox input::placeholder{color:var(--text-muted)}
  .askbox input:focus-visible{border-color:var(--primary)}
  .answer{margin-top:9px;padding:12px 14px;border-radius:10px;background:var(--surface-2);
          border:1px solid var(--border)}
  .answer .q{font-size:12.5px;font-weight:600;display:flex;gap:8px;align-items:baseline}
  .answer .q::before{content:"Q";font-family:var(--font-mono);font-size:11px;color:var(--primary);
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
  .bstats .topic{color:var(--text-muted)}
  .bstats .topic b{font-family:var(--font-mono);color:var(--text);margin-left:3px}

  /* Fullscreen is the browser's own, so there is no overlay to get wrong and
     Escape already works. The board drops its 16/9 and fills whatever shape
     the screen is -- the layout is percentages, so any shape is fine. */
  .board-wrap:fullscreen{background:var(--bg);padding:10px;display:flex;align-items:stretch}
  .board-wrap:fullscreen .board-scroll{flex:1;display:flex}
  .board-wrap:fullscreen .board{flex:1;width:auto;height:auto;aspect-ratio:auto;margin:0}

  /* ---------------- biggest movers ----------------
     A list, not a picture: these are ranked, five a side, and a ranking wants
     rows. The headlines sit inline rather than behind a hover -- the treemap
     hides them because a 2%-wide tile has nowhere to put them, and a list has
     no such excuse. */
  .mv-tabs{display:inline-flex;gap:2px;background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:2px}
  .secpick{display:flex;gap:6px;align-items:center;margin:0;scroll-margin-top:14px}
  .secpick select{font-family:var(--font-mono);font-size:12px;background:var(--surface-2);color:var(--text);
                  border:1px solid var(--border);border-radius:8px;padding:5px 10px;min-height:32px}
  .idxs{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 0}
  .idx{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-family:var(--font-mono);
       font-size:13px;font-variant-numeric:tabular-nums;background:var(--surface);border:1px solid var(--border);
       border-radius:10px;padding:9px 14px}
  .idx .nm{font-weight:600;color:var(--text)}
  .idx .px{color:var(--text)}
  .idx .k{font-size:11px;color:var(--text-muted);letter-spacing:.05em}
  .idx .faint{font-size:11.5px}
  .mv-tab{font-family:var(--font-mono);font-size:12px;text-decoration:none;color:var(--text-muted);
          border-radius:7px;padding:4px 10px;min-height:28px;display:inline-flex;align-items:center}
  .mv-tab:hover{color:var(--text)}
  .mv-tab.on{color:var(--text);background:var(--surface-3)}

  .mv-cols{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
  @media (max-width:760px){ .mv-cols{grid-template-columns:1fr} }
  .mv-side h4{margin:0 0 6px;font-family:var(--font-mono);font-size:11.5px;font-weight:600;
              letter-spacing:.09em;text-transform:uppercase;color:var(--text-muted)}
  .mv-side.up h4{color:var(--up)}
  .mv-side.dn h4{color:var(--down)}
  .mv-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .mv{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 11px}
  .mv-hd{display:flex;align-items:baseline;gap:8px}
  .mv-hd .rk{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);
             min-width:11px}
  .mv-hd .tick{font-family:var(--font-mono);font-size:12px;font-weight:600;
               color:var(--text);text-decoration:none}
  .mv-hd .tick:hover{color:var(--primary)}
  .mv-px{font-size:11px;color:var(--text-muted);margin-left:auto}
  .mv-ch{font-size:12px;font-weight:600}
  .mv-ch.pos{color:var(--up)} .mv-ch.neg{color:var(--down)}
  .on-note{color:var(--alert)}
  .mv-nm{margin:2px 0 0 19px;font-size:11.5px;color:var(--text-muted);line-height:1.35}
  .mv-notes{list-style:none;margin:7px 0 0 19px;padding:7px 0 0;
            border-top:1px solid var(--border);display:grid;gap:6px}
  .mv-notes li{font-size:11.5px;line-height:1.35;display:flex;gap:8px;align-items:baseline;min-width:0}
  .mv-notes .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
               color:var(--text);text-decoration:none;padding:4px 0}
  .mv-notes a.t:hover{text-decoration:underline}
  .mv-notes .k{flex:none;font-family:var(--font-mono);font-size:11px;color:var(--text-muted);
               letter-spacing:.05em;text-transform:uppercase}
  .mv-notes .t.pos{color:var(--up)} .mv-notes .t.neg{color:var(--down)}
  .mv-none{margin:7px 0 0 19px;padding-top:7px;border-top:1px solid var(--border);
           font-size:11.5px;color:var(--text-muted);line-height:1.35}

  .scale{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px;
         font-family:var(--font-mono);font-size:11.5px;color:var(--text-muted)}
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
  // Three views, one question each: what is coming and being said about my
  // names (Agenda), what the whole market just did (Market), one company in
  // depth (Company). A single day is a drill-down, not a destination.
  const tabs: [string, string, string][] = [
    ["agenda", `/${w}`, "Agenda"],
    ["market", `/market${w}`, "Market"],
    ["ticker", `/ticker${w ? `${w}&` : "?"}symbol=${watchlist[0] ?? "BBCA"}`, "Company"],
  ];
  return `<nav class="tabs" aria-label="Views">${tabs
    .map(
      ([id, href, label]) =>
        `<a class="tab" href="${esc(href)}"${id === active ? ' aria-current="page" aria-selected="true"' : ""}>${esc(label)}</a>`
    )
    .join("")}</nav>`;
}

/**
 * An ⓘ beside a heading, and the explanation it opens.
 *
 * The page used to print every one of these inline, under every block, so
 * the method competed with the answer for the same attention. It is still all
 * here -- trust is the product -- one click away rather than in front.
 * Native popover: no script, Escape and click-outside close it, and a
 * browser without popover support renders the text inline instead.
 */
export function info(id: string, title: string, body: string, cls = ""): string {
  return `<button type="button" class="info" popovertarget="${esc(id)}" aria-label="About: ${esc(title)}" title="How to read this">i</button>
    <div class="pop-card${cls ? ` ${cls}` : ""}" id="${esc(id)}" popover>
      <button type="button" class="ghost x" popovertarget="${esc(id)}" popovertargetaction="hide">Close</button>
      <h3>${esc(title)}</h3>${body}</div>`;
}

/** A section heading: the title, a mono sub-line for its range, an optional
 * ⓘ, and anything that belongs at its right edge (a download, a switcher). */
function head(title: string, o: { id?: string; sub?: string; info?: string; end?: string } = {}): string {
  return `<div class="sh"${o.id ? ` id="${esc(o.id)}"` : ""}><h2>${esc(title)}</h2>${
    o.sub ? `<span class="sub">${o.sub}</span>` : ""
  }${o.info ?? ""}${o.end ? `<span class="end">${o.end}</span>` : ""}</div>`;
}

export interface Shell {
  title: string;
  active: string;
  watchlist: string[];
  body: string;
  mock: boolean;
  asOf: string | null;
  credits: string | null;
  /** The page's filter bar (filterBar), straight under the header. A page
   * nothing narrows -- Market -- has none, and that absence is the promise. */
  filters?: string;
  /**
   * Opt in to the dashboard shell: a wider column on a big screen, and the
   * body laid out in two tracks instead of one.
   *
   * The agenda, the market and a company ask for it: each has a second track
   * to put in the width. A day is one list, and a list set 1300px wide is
   * harder to read, not easier.
   */
  wide?: boolean;
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
${s.mock ? `<div class="mock"><b>MOCK_MODE</b> · fixture data, no API key, no network · every number on this page is fabricated</div>` : ""}
<div class="wrap${s.wide ? " wide" : ""}">
  <header class="top">
    <a class="brand" href="/${qs(s.watchlist)}"><span class="dot"></span>NewsIDX</a>
    ${nav(s.active, s.watchlist)}
    <span class="sp"></span>
    <button class="ghost" type="button" popovertarget="about">About</button>
    <button class="ghost" id="theme" type="button">Light</button>
  </header>
  ${s.filters ?? ""}
  ${s.body}
  <div class="pop-card drawer" id="about" popover>
    <button type="button" class="ghost x" popovertarget="about" popovertargetaction="hide">Close</button>
    <h3>How to read NewsIDX</h3>
    ${legend(true)}
    <h4>Colour</h4>
    <p><b class="pos">Green</b> and <b class="neg">red</b> are a price move and nothing else.
    <span class="bull">▲</span> / <span class="bear">▼</span> is Sectors' Bullish / Bearish tag on a
    headline: their label, not ours, and a description of coverage rather than a forecast.
    <b style="color:var(--alert)">Amber</b> means soon: under a week to go, or the top-ranked story.</p>
    <h4>Where things are</h4>
    <p><b>Agenda</b> is your companies: what is coming on the left, what is being said on the
    right. <b>Market</b> is the whole exchange and takes no filter. <b>Company</b> is one name in
    depth. Every <b>i</b> beside a heading explains that block.</p>
    <p>Research tooling, not investment advice.</p>
  </div>
  <footer>
    <span>${s.mock ? "fixtures" : "Sectors API"}${s.asOf ? ` as of ${esc(s.asOf)}` : ""}</span>
    ${s.credits ? `<span>${esc(s.credits)}</span>` : ""}
    <span>research tooling, not investment advice</span>
  </footer>
</div>
<script>
  // The only script on the page. Navigation is real links -- the calendar
  // below only shortcuts one of them; this is the theme
  // the design system already ships (plan.md §4d).
  // With script on, a select submits itself and its Show button goes; with
  // it off, the button is the way and nothing is lost.
  document.documentElement.classList.add('js');
  document.querySelectorAll('select[data-auto]').forEach(function (s) {
    s.addEventListener('change', function () { s.form.requestSubmit(); });
  });
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

  // A calendar date opens in the headlines column instead of leaving the page.
  // The cell stays a real link to /day, so a modified click, a middle click
  // and a page with no script all still get the full day. The panel is the
  // day page's own #day-panel, so there is one renderer for a day, not two.
  (function () {
    var col = document.querySelector('.dash-headlines');
    var grid = document.querySelector('.dash-month .grid');
    if (!col || !grid || !window.fetch || !window.DOMParser) return;
    var month = null, from = null, seq = 0;
    var close = function () {
      if (month === null) return;
      col.innerHTML = month;
      month = null;
      var a = grid.querySelector('a.picked');
      if (a) a.classList.remove('picked');
      if (from) from.focus();
    };
    var plain = function (e) { return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey; };
    // Load a day (or one page of its facts) into the column. The cell is the
    // grid date it belongs to; paging keeps the same one.
    var open = function (href, cell) {
      var mine = ++seq;
      fetch(href, { headers: { Accept: 'text/html' } })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (html) {
          if (mine !== seq) return; // a later click won
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var panel = doc.getElementById('day-panel');
          if (!panel) throw new Error('no panel');
          var title = (doc.querySelector('h2.mtitle') || {}).textContent || '';
          if (month === null) month = col.innerHTML;
          var old = grid.querySelector('a.picked');
          if (old) old.classList.remove('picked');
          cell.classList.add('picked');
          from = cell;
          col.innerHTML = '<p class="kicker">This day · everything on it</p>' +
            '<div class="dayhead"><h3 tabindex="-1"></h3><div class="acts">' +
            '<a data-full>Open full day ↗</a>' +
            '<button type="button" class="ghost" data-close>Close · back to the month</button></div></div>';
          col.querySelector('h3').textContent = title;
          col.querySelector('[data-full]').setAttribute('href', href);
          col.appendChild(panel);
          col.querySelector('[data-close]').addEventListener('click', close);
          var h = col.querySelector('h3');
          var top = col.getBoundingClientRect().top;
          if (top < 0 || top > innerHeight - 80) col.scrollIntoView({ block: 'start' });
          h.focus({ preventScroll: true });
        })
        .catch(function () { location.href = href; });
    };
    grid.addEventListener('click', function (e) {
      var a = e.target.closest('.cellwrap > a');
      if (!a || !plain(e)) return;
      e.preventDefault();
      open(a.href, a);
    });
    // The facts pager inside the panel: Newer / Older page in place too. Still
    // real links to /day, so a modified click opens that page in full.
    col.addEventListener('click', function (e) {
      var a = e.target.closest('#day-panel .pager a[href]');
      if (!a || month === null || !from || !plain(e)) return;
      e.preventDefault();
      open(a.href, from);
    });
  })();

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
 * is never the message: `tone` puts a ▲ or ▼ in front of it (and "Bullish" /
 * "Bearish" for a screen reader), because the board card, the movers and the
 * calendar hover card print a headline with no tag list beside it.
 */
export function sentClass(item: Item): string {
  const s = sentimentOf(item);
  return s === "positive" ? "pos tone" : s === "negative" ? "neg tone" : "";
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

/**
 * The key to the three shapes. Compact under a list; in full inside About.
 * Provenance is the product, so the short key is never dropped -- only the
 * sentences explaining it moved behind a click.
 */
function legend(full = false): string {
  const rows: [string, string, string][] = [
    ["sw", "Fact", "it happened, with the source it came from"],
    ["sw s", "Scheduled", "the issuer dated it"],
    ["sw p", "Predicted", "fitted from the company's own history: a window, never a date, with the hit rate beside it"],
  ];
  return `<div class="key${full ? " full" : ""}">${rows
    .map(([c, k, d]) => `<span><i class="${c}"></i>${full ? `<span><b>${k}</b> — ${d}</span>` : k}</span>`)
    .join("")}${
    full ? "" : `<span><span class="bull">▲</span><span class="bear">▼</span> Sectors' Bullish / Bearish tag</span>`
  }</div>`;
}

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

/**
 * The filter bar: the ONE filter pattern in the product.
 *
 * It replaces three scattered rows -- a companies bar, a topic bar of 14
 * chips, and per-block chip rows -- with a single GET form under the header.
 * Fields read left to right, Apply submits, and Clear exists only while
 * something is narrowed, so a page showing less than it has always says so.
 *
 * Companies are added ONE at a time. A browser matches a <datalist> against
 * the whole field, so a box holding "BBCA,TLKM" stops suggesting exactly when
 * you have most use for it; an empty box always suggests. The selection lives
 * in the pills, each a link that removes it.
 *
 * Topics are checkboxes in a popover. Checked boxes submit as repeated `tag`
 * params, which the server joins into the same comma list parseTags reads.
 * The counts are taken BEFORE the filter applies, so an option never vanishes
 * the moment you use it. Several topics are OR: a second pick shows more.
 *
 * `company` swaps the companies field for a one-company picker: a company
 * page is about exactly one name, and a multi-select there would be a filter
 * that cannot do what it looks like it does.
 */
export function filterBar(o: {
  action: string;
  watchlist: string[];
  known?: string[];
  /** Everything else the page's URL carries, so filtering keeps it. */
  keep?: Record<string, string | undefined>;
  topics?: { label: string; n: number }[];
  tag?: string;
  /** What the right-hand side says the filter is doing, in this page's terms. */
  count?: string;
  company?: string;
}): string {
  const known = o.known ?? [];
  const topics = o.topics ?? [];
  const selected = parseTags(o.tag ?? "");
  const kept = Object.entries(o.keep ?? {}).filter(([, v]) => v) as [string, string][];
  const url = (w: string, tag: string) =>
    `${o.action}?${[["w", w], ...kept, ["tag", tag]]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&")}`.replace(/\?$/, "");
  const wl = o.watchlist;
  const tagStr = selected.join(",");

  let companies: string;
  if (o.company) {
    const opts = [...new Set([o.company, ...known])].sort();
    companies = `<label class="f-field"><span class="f-lab">Company</span>
      <select name="symbol" aria-label="Company">${opts
        .map((c) => `<option value="${esc(c)}"${c === o.company ? " selected" : ""}>${esc(c)}</option>`)
        .join("")}</select></label>`;
  } else {
    // Only what can still be added: an option you already picked is noise.
    const options = known.filter((x) => !wl.includes(x));
    companies = `<div class="f-field" role="group" aria-labelledby="f-co">
      <span class="f-lab" id="f-co">Companies</span>
      ${
        wl.length
          ? wl
              .map(
                (x) =>
                  `<a class="pill on" href="${esc(url(wl.filter((y) => y !== x).join(","), tagStr))}"
                      title="Stop showing ${esc(x)}" aria-label="Remove ${esc(x)}">${esc(x)} <span aria-hidden="true">×</span></a>`
              )
              .join("")
          : `<span class="pill all">All companies</span>`
      }
      <input type="text" name="add" list="wl-known" value=""
             aria-label="Add a company by ticker — pick from the list or type one"
             placeholder="${wl.length ? "Add another…" : "Add a company…"}"
             spellcheck="false" autocomplete="off" enterkeyhint="done">
      <datalist id="wl-known">${options.map((x) => `<option value="${esc(x)}"></option>`).join("")}</datalist>
    </div>`;
  }

  const offered = [
    ...topics,
    // A topic typed into a URL and not on record still shows, checked, so it
    // can be unticked rather than lingering invisibly in the query.
    ...selected
      .filter((t) => !topics.some((x) => x.label.toLowerCase() === t.toLowerCase()))
      .map((label) => ({ label, n: 0 })),
  ];
  const isOn = (label: string) => selected.some((t) => t.toLowerCase() === label.toLowerCase());
  const topicField = offered.length
    ? `<div class="f-field"><span class="f-lab" id="f-tp">Topics</span>
        <button type="button" class="f-drop${selected.length ? " on" : ""}" popovertarget="f-topics"
                aria-describedby="f-tp">${
                  selected.length
                    ? selected.length === 1
                      ? esc(selected[0]!)
                      : `${selected.length} topics`
                    : `All ${topics.length} topics`
                }</button>
        <div class="pop-card f-pop" id="f-topics" popover>
          <button type="button" class="ghost x" popovertarget="f-topics" popovertargetaction="hide">Close</button>
          <h3>Topics</h3>
          <p>Sectors' own tags. None ticked shows every topic; several show any of them.
          Counts are before filtering.</p>
          <div class="opts">${offered
            .map(
              (t) => `<label><input type="checkbox" name="tag" value="${esc(t.label)}"${
                isOn(t.label) ? " checked" : ""
              }>${esc(t.label)}<span class="n">${t.n}</span></label>`
            )
            .join("")}</div>
          <div class="acts"><button type="submit" class="f-apply">Apply</button>${
            selected.length ? `<a class="f-clear" href="${esc(url(wl.join(","), ""))}">Clear topics</a>` : ""
          }</div>
        </div></div>`
    : "";

  // A name we hold no rows for filters the page to nothing, which looks like
  // a broken product unless we say what happened.
  const unknown = known.length && !o.company ? wl.filter((x) => !known.includes(x)) : [];
  const narrowed = (!o.company && wl.length) || selected.length;
  const count =
    o.count ??
    (wl.length
      ? `${wl.length} of ${known.length} ${known.length === 1 ? "company" : "companies"}`
      : `All ${known.length || ""} ${known.length === 1 ? "company" : "companies"}`.replace("  ", " "));

  return `<form class="fbar" method="get" action="${esc(o.action)}">
    ${kept.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
    ${o.company ? (wl.length ? `<input type="hidden" name="w" value="${esc(wl.join(","))}">` : "") : `<input type="hidden" name="w" value="${esc(wl.join(","))}">`}
    ${companies}
    ${topicField}
    <button type="submit" class="f-apply">Apply</button>
    ${narrowed ? `<a class="f-clear" href="${esc(url(o.company ? wl.join(",") : "", ""))}">${o.company ? "Clear topics" : "Clear filters"}</a>` : ""}
    <span class="f-count mono">${esc(count)}</span>
    ${
      unknown.length
        ? `<p class="f-warn">No rows on record for <b>${unknown.map((x) => esc(x)).join("</b>, <b>")}</b> —
             check the ticker, or run the backfill to fetch it.</p>`
        : ""
    }
  </form>`;
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
/** The board's own filter: one sector, or all of them. A select, not a row
 * of eleven chips: the sector moves those chips carried are already printed
 * on the treemap's own headings. A GET form, so the result is a URL you can
 * send, and it carries everything else the page holds. */
function sectorPicker(b: Board, keep: Record<string, string | undefined>): string {
  const kept = Object.entries(keep).filter(([k, v]) => v && k !== "sector") as [string, string][];
  const opt = (v: string, label: string) =>
    `<option value="${esc(v)}"${v === b.sector ? " selected" : ""}>${esc(label)}</option>`;
  return `<form class="secpick" method="get" action="/market#board">
    ${kept.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
    <label class="sr" for="secpick">Sector</label>
    <select id="secpick" name="sector" data-auto>${opt("", "All sectors")}${b.choices
      .map((c) => opt(c.sector, `${c.sector}${c.change == null ? "" : ` ${pct(c.change)}`}`))
      .join("")}</select>
    <button type="submit" class="ghost autobtn">Show</button>
  </form>`;
}

/** The indices' day, week, month and year, one line each, over the board. */
function indexStrip(xs: IndexReturn[]): string {
  if (!xs.length) return "";
  const cell = (k: string, v: number | null) =>
    `<span class="k">${k}</span> ${
      v == null
        ? `<span class="faint" title="No close on record near that date">—</span>`
        : `<b class="${posneg(v)}">${esc(pct(v))}</b>`
    }`;
  return `<div class="idxs">${xs
    .map(
      (x) => `<div class="idx"><span class="nm">${esc(x.symbol)}</span>
        <span class="px">${esc(x.close.toLocaleString("en-US", { maximumFractionDigits: 2 }))}</span>
        ${cell("1D", x.d)}${cell("1W", x.w)}${cell("1M", x.m)}${cell("1Y", x.y)}
        <span class="faint">close ${esc(fmtShort(x.date))}</span></div>`
    )
    .join("")}</div>`;
}

export function renderBoard(
  b: Board | null,
  keep: Record<string, string | undefined> = {},
  indices: IndexReturn[] = []
): string {
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
        .join(", ")}`
    : "";

  return `${indexStrip(indices)}
    ${head("The board", {
      id: "board",
      sub: `${b.sector ? `${esc(b.sector)} · ${esc(b.drawn)} names by industry` : `${esc(b.drawn)} largest names`} · ${esc(
        fmtShort(b.date)
      )}`,
      info: info("i-board", "The board", boardAbout(b)),
      end: `${sectorPicker(b, keep)}<button class="ghost fsbtn" type="button" data-fs="board-wrap" hidden>Fullscreen</button>`,
    })}
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
`;
}

/** What the board is, and what it is not. Behind the ⓘ. */
function boardAbout(b: Board): string {
  return `<p>Colour is the last closed session's move, as the Sectors API reported it when we
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
      ${esc(b.drawn)} companies drawn here.</p>`;
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
    return `${head("Needs attention")}
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
          `<a class="flag e${r.near.cls === "predicted" ? " w" : ""}" href="/day?date=${esc(
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
          <details><summary>Why #${i + 1}${t.members.length > 1 ? ` · ${t.members.length} headlines` : ""}</summary>
          <div class="why">${parts
            .slice(0, 4)
            .map((c) => `<span><b>${esc(ATTENTION_LABEL[c.key] ?? c.key)}</b> ${c.value.toFixed(1)}</span>`)
            .join("")}<span>= ${r.score.toFixed(1)}</span></div>
          ${
            t.members.length > 1
              ? `<ul>${t.members
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
                    .join("")}</ul>`
              : ""
          }</details>
        </div></article>`;
    })
    .join("");

  return `${head("Needs attention", {
      sub: `${esc(fmtShort(a.from))}–${esc(fmtShort(a.to))} · ${a.rows.length} of ${a.considered}`,
      info: info(
        "i-attention",
        "Needs attention",
        `<p><b>${a.rows.length}</b> of ${a.considered} stor${a.considered === 1 ? "y" : "ies"} cleared the
        floor — carried by a second source, or landing within ${ATTENTION_NEAR_DAYS} days of a dated
        event.</p><p>Sources are counted by publisher, and only the ones in this feed, so the number is a
        floor on attention paid and never a measure of how many people read anything.</p><p>The ordering
        is a sort, not a claim: open <b>Why</b> on any row for the parts its score is made of.</p>`
      ),
    })}
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
    return `${head(label, { id: "headlines" })}
      <div class="empty">${
        future
          ? "This month has not started — no news on record."
          : "No news on record for this month. Run the backfill to fill it in."
      }</div>`;
  }

  const counted = (s: "positive" | "negative" | "neutral") =>
    p.headlines.filter((h) => sentimentOf(h) === s).length;

  return `${head(label, { id: "headlines", sub: `${esc(fmtShort(p.from))}–${esc(fmtShort(p.to))}` })}
  <div class="pulse">
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

// ---------------------------------------------------------------- the movers

/** A close, in whole rupiah with thousands separated. IDX prices run from 65
 * to 16,450, so this is a plain integer and never a T/B abbreviation. */
function rupiah(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `Rp${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * One mover, its move, and what was on the record while it moved.
 *
 * The headlines are shown INLINE rather than on hover, which is the one place
 * this deliberately parts company with the board. On the treemap a panel is
 * the only option: the smallest tiles are two percent wide and there is
 * nowhere to print a headline. A list has the room, and hiding text behind a
 * hover in a list is an interaction that costs a reader something for nothing.
 */
function moverRow(m: Mover, newsFrom: string, newsTo: string, w: string, recordFrom: string | null = null): string {
  const notes = m.notes.length
    ? `<ul class="mv-notes">${m.notes
        .map((n) => {
          // One line per note: the headline, linked to its source when the
          // source is a web page, then when and where. The kind is named only
          // when it is not news -- a filing among headlines is the one worth
          // flagging. domainOf() doubles as the gate: no http(s), no link.
          const host = domainOf(n.sourceUrl);
          const title = host
            ? `<a class="t ${sentClass(n)}" href="${esc(n.sourceUrl)}" target="_blank" rel="noopener noreferrer"
                 title="${esc(n.title)}">${esc(n.title)}</a>`
            : `<span class="t ${sentClass(n)}" title="${esc(n.title)}">${esc(n.title)}</span>`;
          return `<li>${title}<span class="k">${n.kind === "news" ? "" : `${esc(kindLabel(n.kind))} · `}${esc(
            fmtShort(n.date!)
          )}${host ? ` · ${esc(host)}` : ""}</span></li>`;
        })
        .join("")}</ul>`
    : recordFrom && recordFrom > newsTo
      ? `<p class="mv-none">No news record for ${esc(m.symbol)} between ${esc(fmtShort(newsFrom))} and ${esc(
          fmtShort(newsTo)
        )} — our headlines start ${esc(fmtShort(recordFrom))}, so this is unknown, not quiet.</p>`
      : `<p class="mv-none">Nothing on the record for ${esc(m.symbol)} between ${esc(
          fmtShort(recordFrom ?? newsFrom)
        )} and ${esc(fmtShort(newsTo))}${
          recordFrom ? ` — our headlines start ${esc(fmtShort(recordFrom))}; earlier days are unknown` : ""
        }.</p>`;

  return `<li class="mv">
    <div class="mv-hd">
      <span class="rk">${esc(m.rank)}</span>
      <a class="tick" href="/ticker?symbol=${esc(m.symbol)}${w}">${esc(m.symbol)}</a>
      <span class="mv-px mono">${esc(rupiah(m.lastClose))}</span>
      <span class="mv-ch mono ${posneg(m.change)}">${m.change == null ? "—" : esc(pct(m.change))}</span>
    </div>
    <p class="mv-nm">${esc(m.name)}</p>
    ${notes}
  </li>`;
}

/**
 * The biggest gainers and losers over one period, side by side.
 *
 * Every period the switcher offers came back in the SAME call, so changing it
 * is a database read and never a purchase. That is why there are five of them:
 * "was this a one-day spike or a year-long climb?" is the question a single
 * period cannot answer, and under a per-period price it would have gone
 * unasked to save four credits.
 */
export function renderMovers(
  m: Movers | null,
  watchlist: string[],
  keep: Record<string, string | undefined> = {}
): string {
  if (!m) {
    return `<p class="kicker">Biggest movers</p>
      <div class="empty">No movers on record yet. They are one API call — run the backfill,
      or start the server with a key set, and the next visit lists them.</div>`;
  }
  const w = watchlist.length ? `&w=${encodeURIComponent(watchlist.join(","))}` : "";

  // The switcher anchors itself: you should land looking at the list you just
  // changed, not at the top of a page four blocks above it.
  const link = (p: MoverPeriod) =>
    `/market?${Object.entries({ ...keep, movers: p })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&")}#movers`;

  const tabs = MOVER_PERIODS.map((p) =>
    p === m.period
      ? `<span class="mv-tab on" aria-current="true">${esc(MOVER_LABEL[p])}</span>`
      : `<a class="mv-tab" href="${esc(link(p))}">${esc(MOVER_LABEL[p])}</a>`
  ).join("");

  const side = (label: string, rows: Mover[], cls: string) =>
    `<div class="mv-side ${cls}">
      <h4>${esc(label)}</h4>
      ${
        rows.length
          ? `<ol class="mv-list">${rows.map((r) => moverRow(r, m.newsFrom, m.newsTo, w, m.recordFrom)).join("")}</ol>`
          : `<div class="empty">Nothing on record for this period.</div>`
      }
    </div>`;

  const total = m.gainers.length + m.losers.length;
  return `${head("Biggest movers", {
      id: "movers",
      sub: `${esc(MOVER_LABEL[m.period])} to ${esc(fmtShort(m.newsTo))}`,
      info: info("i-movers", "Biggest movers", moversAbout(m, total)),
      end: `<span class="mv-tabs" role="group" aria-label="Period">${tabs}</span>`,
    })}
    <div class="bstats"><span class="n">${esc(m.withNotes)}</span> of ${esc(
      total
    )} have something on the record — what was said while it moved, not why<span class="sep">·</span>headlines from ${esc(
      fmtShort(m.newsFrom)
    )}–${esc(fmtShort(m.newsTo))}${
      m.recordFrom
        ? `<span class="sep">·</span><span class="on-note">our news record starts ${esc(fmtShort(m.recordFrom))} — earlier days are unknown, not quiet</span>`
        : m.clamped
          ? `<span class="sep">·</span><span class="faint">the news record does not reach a full year back</span>`
          : ""
    }</div>
    <div class="mv-cols">
      ${side("Gainers", m.gainers, "up")}
      ${side("Losers", m.losers, "dn")}
    </div>
`;
}

/** What the movers are, and what they are not. Behind the ⓘ. */
function moversAbout(m: Movers, total: number): string {
  return `<p>Sectors' own top-gainers and top-losers list, five a side, ranked by the move over
      the period — its ranking, printed, not a second one computed here. The close and the
      date beside each name are the API's: <b>the session the move ends on</b>, which for a
      thinly traded name can trail the day we asked.</p>
      <p><b>The headlines under a name are what was on the record while it moved, not the
      reason it moved.</b> That disclaimer matters more here than anywhere else on this
      page: a headline printed under the word "gainer" will be read as the cause of the
      gain unless it is refused out loud. ${esc(m.withNotes)} of these ${esc(
        total
      )} names have anything at all — these are often small companies that no outlet covered
      — and the rest say so rather than reaching further back for something to print.</p>
      ${
        m.clamped
          ? `<p>A year is longer than this product's news record, so the year view reads
             headlines from ${esc(fmtShort(m.newsFrom))} onwards rather than from a year
             ago. The move is still the full year's; the coverage is not.</p>`
          : ""
      }`;
}

/** Rows the table shows before it points at the ticker pages for the rest. */
const UP_NEXT_ROWS = 10;

/**
 * The selected names' next 90 days, as four counts and one sorted table.
 *
 * Dated and predicted are counted apart in every tile: "4 events" that mixes
 * a published date with a fitted window is a number nobody can act on. The
 * names with nothing ahead are listed by name, because an empty calendar
 * for a holding is a finding, not a gap in the page.
 */
export function upNext(items: Item[], watchlist: string[], today: string): string {
  const within = (n: number) => items.filter((i) => daysBetween(today, i.date!) < n);
  const split = (xs: Item[]) => {
    const p = xs.filter((i) => i.cls === "predicted").length;
    return `${xs.length - p} dated${p ? ` · ${p} predicted` : ""}`;
  };
  const ahead = (d: number) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
  const when = (i: Item) =>
    i.cls === "predicted" && i.window ? fmtRange(i.window.from, i.window.to) : fmtWithDay(i.date!);

  const first = items[0];
  const week = within(7);
  const month = within(30);
  const divs = items.filter((i) => i.kind === "exdiv");
  const biggest = divs
    .filter((i) => i.drop)
    .sort((a, b) => a.drop!.pct - b.drop!.pct)[0];
  const quiet = watchlist.filter((s) => !items.some((i) => i.symbol === s));

  const tile = (k: string, v: string, s: string, lead = false) =>
    `<div class="kpi${lead ? " lead" : ""}"><div class="k">${esc(k)}</div><div class="v">${v}</div>
     <div class="s">${esc(s)}</div></div>`;
  const kpis = `<div class="kpis">
    ${
      first
        ? tile(
            "Next up",
            `${esc(first.symbol)} <small>${esc(kindLabel(first.kind).toLowerCase())}</small>`,
            `${first.cls === "predicted" ? "window opens " : ""}${ahead(daysBetween(today, first.date!))} · ${when(first)}`,
            true
          )
        : tile("Next up", "—", "nothing dated or predicted", true)
    }
    ${tile("Next 7 days", String(week.length), split(week))}
    ${tile("Next 30 days", String(month.length), split(month))}
    ${tile(
      "Ex-dividend",
      String(divs.length),
      biggest ? `largest drop ${fmtPct(biggest.drop!.pct)} · ${biggest.symbol}` : divs.length ? split(divs) : "none in 90 days"
    )}
  </div>`;

  const row = (i: Item) => {
    const d = Math.max(0, daysBetween(today, i.date!));
    const pred = i.cls === "predicted";
    const cert = pred
      ? `<span class="cert"><i class="sw p"></i>Predicted${i.fit ? ` · ${esc(hitRateLabel(i.fit))}` : ""}</span>`
      : `<span class="cert"><i class="sw s"></i>Dated by issuer</span>`;
    const impact = i.drop
      ? `<span class="drop">${esc(fmtPct(i.drop.pct))}</span>`
      : `<span class="faint">—</span>`;
    return `<tr class="${pred ? "pred" : "sched"}">
      <td class="when">${esc(when(i))}</td>
      <td class="r${d < 7 ? " soon" : ""}">${pred && i.window && i.window.from <= today ? "open" : `${d}d`}</td>
      <td>${tickerCell(i, watchlist)}</td>
      <td title="${esc(i.title)}">${esc(kindLabel(i.kind))}</td>
      <td>${cert}</td>
      <td class="r" title="Ex-dividend only: dividend ÷ last close">${impact}</td>
    </tr>`;
  };
  const shown = items.slice(0, UP_NEXT_ROWS);
  const table = items.length
    ? `<div class="nx-scroll"><table class="nx">
      <thead><tr><th>When</th><th class="r">In</th><th>Ticker</th><th>Event</th>
        <th>Certainty</th><th class="r">Exp. drop</th></tr></thead>
      <tbody>${shown.map(row).join("")}${
        items.length > shown.length
          ? `<tr class="more"><td colspan="6">+${items.length - shown.length} more in the 90 days — each ticker page carries its full list</td></tr>`
          : ""
      }</tbody></table></div>`
    : `<div class="empty">Nothing dated or predicted for ${watchlist.length ? "these companies" : "the market"} in the next 90 days.</div>`;

  const csv = `/upnext.csv${watchlist.length ? `?w=${encodeURIComponent(watchlist.join(","))}` : ""}`;
  return `${head("Up next", {
      sub: `${watchlist.length ? `your ${watchlist.length} compan${watchlist.length === 1 ? "y" : "ies"}` : "every company on record"} · ${esc(
        fmtShort(today)
      )}–${esc(fmtShort(shift(today, 90)))}`,
      end: items.length ? `<a class="nx-csv" href="${esc(csv)}" download>Download CSV</a>` : "",
    })}
    ${kpis}
    ${table}
    ${
      quiet.length
        ? `<p class="note">Nothing on the calendar for <b>${quiet.map(esc).join(", ")}</b> — no date published and no rhythm we could fit.</p>`
        : ""
    }${watchlist.length ? "" : `<p class="note">Add companies in the bar above to see predicted windows for them too.</p>`}`;
}

/**
 * The same rows as a CSV, for the spreadsheet an analyst keeps anyway.
 *
 * Titles come from the API, so a cell that opens with = + - @ (or a tab or
 * carriage return) is prefixed with an apostrophe: Excel and Sheets would
 * otherwise run it as a formula.
 */
export function upNextCsv(items: Item[], today: string): string {
  const cell = (v: unknown) => {
    let t = v == null ? "" : String(v);
    // Text only: a negative drop is a number, and quoting it would stop a
    // spreadsheet summing the column.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ["date", "window_from", "window_to", "days_to_go", "ticker", "event", "title",
    "certainty", "hit_rate", "expected_drop_pct", "last_close", "source_url"];
  const rows = items.map((i) => {
    const pred = i.cls === "predicted";
    return [
      pred ? "" : i.date,
      pred ? i.window?.from : "",
      pred ? i.window?.to : "",
      Math.max(0, daysBetween(today, i.date!)),
      i.symbol,
      kindLabel(i.kind),
      i.title,
      pred ? "predicted" : "dated by issuer",
      pred && i.fit && i.fit.trials >= 2 ? `${i.fit.hits}/${i.fit.trials}` : "",
      i.drop ? Number((i.drop.pct * 100).toFixed(2)) : "",
      i.drop ? i.drop.close : "",
      i.sourceUrl ?? "",
    ].map(cell).join(",");
  });
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
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
    /** The selected names' next 90 days. Absent renders nothing: the tests
     * that build a bare month have no database to ask. */
    upcoming?: Item[];
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
      <label for="pricepick">Priced by</label>
      <select id="pricepick" name="price" data-auto>
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
      <button type="submit" class="autobtn">Show</button>
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

  const tag = opts.pulse.tag;
  return page({
    title: "NewsIDX Agenda",
    active: "agenda",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    filters: filterBar({
      action: "/",
      watchlist,
      known: opts.known,
      keep: { month: ym, price: opts.priceSymbol ?? undefined, who: opts.pulse.who || undefined },
      topics: opts.pulse.topics,
      tag,
      count: `${
        watchlist.length ? `${watchlist.length} of ${(opts.known ?? []).length} companies` : `All ${(opts.known ?? []).length} companies`
      } · ${tag ? `${opts.pulse.total} headline${opts.pulse.total === 1 ? "" : "s"} tagged ${tagPhrase(tag)}` : "every topic"}`,
    }),
    wide: true,
    // Left track: what is coming. Right track: what is being said. The
    // market-wide board and movers moved to /market -- they take none of
    // these filters, and a block drawn under a filter it ignores looks broken.
    body: `<div class="dash"><div class="dash-col">
    ${opts.upcoming ? `<section class="dash-next">${upNext(opts.upcoming, watchlist, todayIso())}</section>` : ""}
    <section class="dash-month">
    ${head(monthLabel(ym), {
      id: "month",
      info: info(
        "i-month",
        "The month",
        `<p>${
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
        }</p>
        <p>Hover a date for what is on it; click to open it beside the grid. Any date from today on
        also carries a Google Calendar link, so an empty one is somewhere to park your own reminder.</p>
        <p>Weekend cells are dimmed — IDX does not trade, and an empty weekend is information. On a
        phone the cells collapse to one dot per class: the grid is the pattern view, Up next is the list.</p>`
      ),
      end: priceFilter,
    })}
    <nav class="pager" aria-label="Month">
      ${step("prev", `/?month=${prev}${w}`, "Previous", monthLabel(prev))}
      ${step("next", `/?month=${next}${w}`, "Next", monthLabel(next))}
    </nav>
    <div class="dow">${dow}</div>
    <div class="grid">${grid}</div>
    ${legend()}
    </section>
    </div><div class="dash-col">
    <section class="dash-attention">${attentionSection(opts.attention, watchlist)}</section>
    <section class="dash-headlines">${pulseSection(opts.pulse, watchlist, { month: ym, price: opts.priceSymbol ?? undefined })}</section>
    </div></div>`,
  });
}

/**
 * The market: what the whole exchange just did. Index strip, the board, and
 * the movers under it.
 *
 * Its own view because none of it takes the page filters -- it is the market,
 * not your names -- and on the agenda it sat over the filter bar and pushed
 * the question the product exists to answer below the fold. No filter bar
 * here at all: the board's sector picker and the movers' period switch are the
 * only controls, and each sits on the block it controls.
 */
export function renderMarket(
  watchlist: string[],
  opts: {
    mock: boolean;
    asOf: string | null;
    credits: string | null;
    board: Board | null;
    movers: Movers | null;
    indexReturns: IndexReturn[];
    keep: Record<string, string | undefined>;
  }
): string {
  return page({
    title: "NewsIDX Market",
    active: "market",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    wide: true,
    body: `<section class="mk-board">${renderBoard(opts.board, { ...opts.keep, movers: opts.movers?.period }, opts.indexReturns)}</section>
      <section class="mk-movers">${renderMovers(opts.movers, watchlist, opts.keep)}</section>`,
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
    filters: filterBar({ action: "/day", watchlist, known: opts.known, keep: { date: d.date } }),
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
      <div id="day-panel">
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
      </div>
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
  if (!t.news.total) return `<span class="co-stat">No headlines on record for this name yet.</span>`;
  // One line, not three coloured pills: these are the provider's tags on
  // coverage, so they wear the sentiment glyphs and no price colour.
  return `<span class="co-stat"><b>${t.news.total}</b> headline${t.news.total === 1 ? "" : "s"} on record ·
      <span class="bull">▲</span> <b>${t.news.positive}</b> bullish ·
      <span class="bear">▼</span> <b>${t.news.negative}</b> bearish ·
      <b>${t.news.neutral}</b> untagged</span>`;
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
    return `${head("Briefing", { sub: "generated" })}
      <div class="empty">Could not generate: ${esc(faq.error)}</div>
      ${control}`;
  }
  if (!faq.row) {
    return `${head("Briefing", { sub: "generated" })}
      <div class="empty">${
        faq.available
          ? "Nothing generated for this company yet. Write a summary and five questions from the rows on this page."
          : `Generation is off — ${esc(faq.why ?? "no model configured")}.`
      }</div>
      ${control}`;
  }

  return `${head("News summary", { sub: "generated" })}
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
    title: `NewsIDX ${t.symbol}`,
    active: "ticker",
    watchlist,
    mock: opts.mock,
    asOf: opts.asOf,
    credits: opts.credits,
    wide: true,
    filters: filterBar({
      action: "/ticker",
      watchlist,
      known: opts.known,
      company: t.symbol,
      topics: t.tags,
      tag,
      count: tag
        ? `${shown} headline${shown === 1 ? "" : "s"} tagged ${tagPhrase(tag)}`
        : `${t.tags.length} tag${t.tags.length === 1 ? "" : "s"} on record`,
    }),
    // Main track: the record, ahead then behind. Side track: the generated
    // briefing and the ask box -- derived from the record, so beside it,
    // never above it. One column on a phone, in that order.
    body: `<div class="co-head"><h1>${esc(t.symbol)}</h1>${newsSplit(t)}</div>
      ${
        watchlist.length > 1
          ? `<p class="note">Your other companies: ${watchlist
              .filter((s) => s !== t.symbol)
              .map((s) => `<a class="tickerlink" href="/ticker?symbol=${esc(s)}&w=${esc(watchlist.join(","))}">${esc(s)}</a>`)
              .join(" · ")}</p>`
          : ""
      }
      <div class="dash"><section class="dash-col">
      ${head("Ahead")}
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
      ${legend()}
      </section>
      <section class="dash-col">${faqSection(t, watchlist, opts.faq)}</section>
      </div>`,
  });
}
