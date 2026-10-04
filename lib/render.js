'use strict';
// HTML rendering. Every page is self-contained (inline CSS, no JavaScript)
// and uses table layout, because the Kindle "Experimental Browser" is an old,
// slow WebKit/Chromium build with patchy flexbox/grid support and an e-ink
// screen that ghosts on every repaint.

const { escapeHtml: esc, sanitize, toText, truncate, textToHtml } = require('./sanitize');
const { sectionsFor } = require('./config');

const SIZES = { s: 15, m: 18, l: 21, xl: 25 };
// Roughly how many characters of article text fit on one Kindle screen at each size.
const CHARS_PER_SCREEN = { s: 2600, m: 1900, l: 1400, xl: 1000 };

const TZ = process.env.TZ || undefined;

// A drop cap needs at least two full lines beside it. The lead summary spans
// the full page (up to ~130 characters a line); article text is narrower.
const DROPCAP_MIN_CHARS = 300;

// ---- helpers -------------------------------------------------------------

function fmtDate(t, opts) {
  try { return new Date(t).toLocaleString('en-US', { timeZone: TZ, ...opts }); } catch { return new Date(t).toUTCString(); }
}

function longDate(t) {
  return fmtDate(t, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function ago(t, now = Date.now()) {
  if (!t) return '';
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return fmtDate(t, { month: 'short', day: 'numeric' });
}

function toRoman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of map) while (n >= v) { out += r; n -= v; }
  return out;
}

// Calendar date (year, month, day) of an instant in the paper's time zone.
function localDate(t, timeZone = TZ) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(t)) {
    parts[p.type] = +p.value;
  }
  return { y: parts.year, m: parts.month, d: parts.day };
}

// Volume and issue number, counted from the founding date (YYYY-MM-DD) like a
// real paper: Vol. I, No. 1 on the founding day; the number goes up daily;
// each anniversary starts a new volume at No. 1.
function editionNumber(founded, now = Date.now(), timeZone = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(founded || '');
  if (!m) return null;
  const [fy, fm, fd] = [+m[1], +m[2], +m[3]];
  const t = localDate(now, timeZone);
  const day = (y, mo, d) => Date.UTC(y, mo - 1, d) / 86400000;
  if (day(t.y, t.m, t.d) < day(fy, fm, fd)) return { volume: 1, issue: 1 };
  const years = t.y - fy - (t.m < fm || (t.m === fm && t.d < fd) ? 1 : 0);
  return { volume: years + 1, issue: day(t.y, t.m, t.d) - day(fy + years, fm, fd) + 1 };
}

const qs = (params) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 1)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return s ? `?${s}` : '';
};

// URL scheme. The live server uses query strings; the static build (build.js)
// swaps in path-based URLs under the GitHub Pages base path.
const site = {
  static: false,
  home: (page) => `/${qs({ page })}`,
  section: (id, page) => `/section/${id}${qs({ page })}`,
  article: (id, page) => `/article/${id}${qs({ page })}`,
  image: (url) => `/img?u=${encodeURIComponent(url)}`,
  editFeeds: null, // static mode: where to edit config.json
  rebuildMinutes: null,
};

function configure(overrides) {
  Object.assign(site, overrides);
}

function imgSrc(url) {
  return site.image(url);
}

// ---- stylesheet ----------------------------------------------------------

function css(size) {
  const base = SIZES[size] || SIZES.m;
  return `
*{-webkit-tap-highlight-color:rgba(0,0,0,0)}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;padding:0;background:#fff;color:#000;font-family:Bookerly,Georgia,"Times New Roman",Times,serif;font-size:${base}px;line-height:1.38}
a{color:#000;text-decoration:none}
a.u,.body a{text-decoration:underline}
.page{max-width:1100px;margin:0 auto;padding:10px 14px 24px}
table.grid{width:100%;border-collapse:collapse;table-layout:fixed}
table.grid td{vertical-align:top;padding:0 12px}
table.grid td.first{padding-left:0}
table.grid td.last{padding-right:0}
table.grid td.rule{border-left:1px solid #000}
.ears td{font-size:.72em;text-transform:uppercase;letter-spacing:.06em;vertical-align:bottom}
.ear-r{text-align:right}
.masthead{text-align:center;margin:4px 0 0;font-size:2.7em;line-height:1.05;font-weight:bold;letter-spacing:.01em}
.masthead a{display:block}
.masthead.small{font-size:1.6em}
.motto{text-align:center;font-style:italic;font-size:.8em;margin:2px 0 4px}
.dateline{border-top:3px double #000;border-bottom:1px solid #000;margin:4px 0 0}
.dateline td{font-size:.74em;text-transform:uppercase;letter-spacing:.05em;padding:4px 0}
.c{text-align:center}.r{text-align:right}
.nav{border-bottom:3px double #000;text-align:center;padding:2px 0;font-size:.8em;line-height:2.4}
.nav a{display:inline-block;padding:0 8px;white-space:nowrap}
.nav a.on{font-weight:bold;text-decoration:underline}
.kicker{font-size:.66em;text-transform:uppercase;letter-spacing:.1em;font-weight:bold;margin:0 0 2px}
.byline{font-size:.72em;font-style:italic;margin:2px 0 6px}
h2,h3,h4{margin:0;font-weight:bold;line-height:1.12}
.lead{padding:12px 0 10px;border-bottom:1px solid #000}
.lead h2{font-size:2.05em;margin:2px 0 4px;letter-spacing:-.01em}
.lead .summary{font-size:1.02em}
.second{border-bottom:1px solid #000}
.second .story{padding:10px 0}
.second h3{font-size:1.35em;margin:2px 0 3px}
.brief{padding:10px 0 9px;border-bottom:1px solid #000}
.brief.end{border-bottom:0}
.brief h4{font-size:1.08em;margin:1px 0 3px}
.summary{margin:0;text-align:justify;-webkit-hyphens:auto;hyphens:auto}
.more{font-size:.72em;font-style:italic;white-space:nowrap}
/* Two-line drop cap: its top lines up with the first line's capitals and its
   baseline with the second line's. Sized from Times/Georgia metrics (cap height
   ~.66em) for a 1.38 line-height; the float stays shorter than two lines so the
   third line runs full width. */
.dropcap:first-letter,.body.dropcap>p:first-child:first-letter{float:left;font-size:3.08em;line-height:.8;padding:.043em .05em 0 0;margin:0;font-weight:bold}
/* Contain the floated drop cap so a short summary can't let it hang over the rule below. */
/* Raised initial for summaries too short for a drop cap: the letter sits on the
   first line's baseline and rises above it. */
.raisedcap:first-letter{font-size:3.08em;line-height:.9;font-weight:bold;padding-right:.02em}
.lead:after,.body:after{content:"";display:block;clear:both}
.pic{display:block;max-width:100%;height:auto;margin:6px auto;border:1px solid #000}
.lead .pic{max-height:360px}
.second .pic,.brief .pic{max-height:180px}
.pager{margin:14px 0 4px;text-align:center}
.btn{display:inline-block;border:2px solid #000;padding:9px 16px;margin:4px 6px;font-size:.9em;font-weight:bold;min-width:6em;text-align:center;background:#fff;color:#000}
.btn.off{border-style:dotted;font-weight:normal}
.pageno{display:inline-block;font-size:.78em;margin:0 6px;font-style:italic}
.foot{border-top:3px double #000;margin-top:14px;padding-top:6px;font-size:.72em;text-align:center;line-height:2.4}
.foot a{display:inline-block;padding:0 6px;text-decoration:underline}
.notice{border:2px solid #000;padding:8px 10px;margin:10px 0;font-size:.85em}
.empty{padding:30px 0;text-align:center;font-style:italic}
.article{max-width:42em;margin:0 auto}
.article h2.headline{font-size:1.9em;margin:14px 0 6px;text-align:left}
.article .byline{font-size:.8em;border-bottom:1px solid #000;padding-bottom:6px}
.body{text-align:justify;-webkit-hyphens:auto;hyphens:auto}
.body p{margin:0 0 .8em}
.body img{display:block;max-width:100%;height:auto;margin:8px auto;border:1px solid #000}
.body blockquote{margin:.6em 1.2em;font-style:italic}
.body h2,.body h3,.body h4{margin:1em 0 .4em;font-size:1.1em}
.body pre{white-space:pre-wrap;font-size:.8em}
.body table{border-collapse:collapse;font-size:.85em}
.body td,.body th{border:1px solid #000;padding:2px 4px}
.body figcaption{font-size:.75em;font-style:italic;text-align:center}
.strip{padding:10px 0 12px;border-bottom:1px solid #000}
.strip.end{border-bottom:0}
.strip-head{font-size:.8em;margin:0 0 5px}
.strip-head b{text-transform:uppercase;letter-spacing:.06em}
.strip-date{float:right;font-style:italic}
/* Strips fit the column and one screen: never wider than the page or 900px,
   never taller than ~80% of the screen (650px where vh is unsupported), and
   never enlarged beyond their real size. Tap a strip to see it full size. */
.comic{display:block;margin:0 auto;width:auto;height:auto;max-width:100%;max-height:650px;max-height:80vh;border:0}
.strip-art{max-width:900px;margin:0 auto}
.endmark{text-align:center;margin:10px 0;font-size:.9em}
.sizes a{display:inline-block;border:1px solid #000;padding:2px 8px;margin:0 2px;text-decoration:none!important}
.sizes a.on{border-width:3px;font-weight:bold}
form{margin:0}
.settings h2{font-size:1.3em;border-bottom:1px solid #000;margin:18px 0 8px;padding-bottom:2px}
.settings label{display:block;font-size:.8em;font-weight:bold;margin:8px 0 2px}
.settings input[type=text],.settings input[type=url],.settings input[type=number],.settings input[type=password],.settings select,.settings textarea{width:100%;box-sizing:border-box;font-size:16px;padding:7px;border:2px solid #000;background:#fff;color:#000;font-family:inherit;border-radius:0;-webkit-appearance:none}
.settings textarea{height:7em}
.settings .chk{font-weight:normal;font-size:.9em}
.settings .chk input{width:22px;height:22px;vertical-align:middle;margin-right:6px}
.settings button,.settings input[type=submit]{font-family:inherit;font-size:16px;font-weight:bold;border:2px solid #000;background:#fff;color:#000;padding:8px 14px;margin:8px 6px 0 0;border-radius:0;-webkit-appearance:none}
.feedrow{border:1px solid #000;padding:6px 10px 10px;margin:0 0 10px}
.feedrow .status{font-size:.75em;font-style:italic;margin-top:4px}
.half{width:50%}
@media (max-width:640px){
 .page{padding:6px 10px 18px}
 table.grid,table.grid tbody,table.grid tr{display:block;width:100%}
 table.grid td{display:block;width:auto!important;padding:0!important;border-left:0!important}
 table.ears td.ear-l,table.dateline td.dl-side{display:none}
 table.dateline td{text-align:center}
 .masthead{font-size:2em}
 .lead h2{font-size:1.6em}
 .second .story{border-bottom:1px solid #000}
 .second td.last .story{border-bottom:0}
 .col .brief.end{border-bottom:1px solid #000}
 .col.last .brief.end{border-bottom:0}
}
@media print{.nav,.pager,.foot{display:none}}
`;
}

// ---- page chrome ---------------------------------------------------------

function layout({ title, size, body, config }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title ? `${title} — ${config.title}` : config.title)}</title>
<style>${css(size)}</style>
</head>
<body><div class="page">${body}</div></body>
</html>`;
}

function masthead(config, { now, pageLabel, small }) {
  const d = new Date(now);
  const ed = editionNumber(config.founded, now);
  if (small) {
    return `<div class="masthead small"><a href="${esc(site.home(1))}">${esc(config.title)}</a></div>
<table class="grid dateline"><tr><td class="c">${esc(longDate(now))}</td></tr></table>`;
  }
  return `<table class="grid ears"><tr>
<td class="ear-l first">Late Edition</td>
<td class="ear-r last">${esc(pageLabel || '')}</td>
</tr></table>
<h1 class="masthead"><a href="${esc(site.home(1))}">${esc(config.title)}</a></h1>
${config.motto ? `<div class="motto">“${esc(config.motto)}”</div>` : ''}
<table class="grid dateline"><tr>
<td class="dl-side first">${ed ? `Vol. ${toRoman(ed.volume)} · No. ${ed.issue}` : ''}</td>
<td class="c">${esc(longDate(now))}</td>
<td class="dl-side r last">Free of Charge</td>
</tr></table>`;
}

function nav(config, active) {
  const links = [`<a href="${esc(site.home(1))}"${active === '' ? ' class="on"' : ''}>Front Page</a>`];
  for (const sec of sectionsFor(config)) {
    links.push(`<a href="${esc(site.section(sec.id, 1))}"${active === sec.id ? ' class="on"' : ''}>${esc(sec.name)}</a>`);
  }
  return `<div class="nav">${links.join(' · ')}</div>`;
}

function sizeLinks(size, back) {
  const label = { s: 'A', m: 'A', l: 'A', xl: 'A' };
  const px = { s: 12, m: 15, l: 18, xl: 22 };
  return `<span class="sizes">Text: ${Object.keys(SIZES).map((k) =>
    `<a href="/prefs?size=${k}&amp;back=${encodeURIComponent(back)}" style="font-size:${px[k]}px"${k === size ? ' class="on"' : ''}>${label[k]}</a>`).join('')}</span>`;
}

function footer(config, { size, back, sections }) {
  const latest = sections && sections.length ? Math.max(...sections.map((s) => s.fetchedAt || 0)) : 0;
  if (site.static) {
    const printed = fmtDate(site.builtAt || Date.now(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return `<div class="foot">
Printed ${esc(printed)}${site.rebuildMinutes ? ` \u00b7 New edition every ${site.rebuildMinutes} minutes` : ''}${site.editFeeds ? `<br><a href="${esc(site.editFeeds)}">Edit feeds</a>` : ''}
</div>`;
  }
  return `<div class="foot">
${latest ? `Updated ${esc(fmtDate(latest, { hour: 'numeric', minute: '2-digit' }))} · ` : ''}<a href="/refresh?back=${encodeURIComponent(back)}">Refresh now</a> · <a href="/settings">Settings</a><br>
${sizeLinks(size, back)}
</div>`;
}

function pager(link, page, pages) {
  if (pages <= 1) return '';
  const prev = page > 1 ? `<a class="btn" href="${esc(link(page - 1))}">‹ Previous</a>` : '<span class="btn off">‹ Previous</span>';
  const next = page < pages ? `<a class="btn" href="${esc(link(page + 1))}">Next ›</a>` : '<span class="btn off">Next ›</span>';
  return `<div class="pager">${prev}<span class="pageno">Page ${page} of ${pages}</span>${next}</div>`;
}

// ---- stories -------------------------------------------------------------

function storySummary(s, len) {
  if (!len) return '';
  return truncate(toText(s.summary || s.content), len);
}

function byline(s, now, { withSection = false } = {}) {
  const parts = [];
  if (withSection) parts.push(s.section);
  if (s.author) parts.push(`By ${s.author}`);
  if (s.date) parts.push(site.static ? fmtDate(s.date, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ago(s.date, now));
  return parts.length ? `<div class="byline">${esc(parts.join(' · '))}</div>` : '';
}

function storyBlock(s, kind, { config, now, showKicker, last }) {
  if (s.comic) return `<div class="${kind === 'brief' ? `brief${last ? ' end' : ''}` : kind === 'lead' ? 'lead' : 'story'}">${showKicker ? `<div class="kicker">${esc(s.section)}</div>` : ''}${comicStrip(s, now, { last: true })}</div>`;
  const href = esc(site.article(s.id, 1));
  const img = config.showImages && s.image && kind !== 'brief' ? `<a href="${href}"><img class="pic" src="${esc(imgSrc(s.image))}" alt=""></a>` : '';
  const len = kind === 'lead' ? Math.round(config.summaryLength * 2) : kind === 'second' ? Math.round(config.summaryLength * 1.2) : config.summaryLength;
  const sum = storySummary(s, len);
  const kicker = showKicker ? `<div class="kicker">${esc(s.section)}</div>` : '';
  const tag = kind === 'lead' ? 'h2' : kind === 'second' ? 'h3' : 'h4';
  const more = `<a class="more" href="${href}">Continued ›</a>`;
  const cls = kind === 'lead' ? 'lead' : kind === 'second' ? 'story' : `brief${last ? ' end' : ''}`;
  return `<div class="${cls}">${kicker}<${tag}><a href="${href}">${esc(s.title)}</a></${tag}>${byline(s, now)}${img}${sum ? `<p class="summary${kind === 'lead' ? (sum.length >= DROPCAP_MIN_CHARS ? ' dropcap' : ' raisedcap') : ''}">${esc(sum)} ${more}</p>` : `<div>${more}</div>`}</div>`;
}

function columnsTable(cells, cls) {
  const n = cells.length;
  const w = (100 / n).toFixed(3);
  return `<table class="grid ${cls}"><tr>${cells.map((c, i) => {
    const classes = [cls === 'cols' ? 'col' : '', i === 0 ? 'first' : 'rule', i === n - 1 ? 'last' : ''].filter(Boolean).join(' ');
    return `<td class="${classes}" style="width:${w}%">${c}</td>`;
  }).join('')}</tr></table>`;
}

// Interleave sections so one prolific feed can't take over the front page:
// round r contains the r-th newest story of each section, newest first.
function interleave(sections) {
  const out = [];
  const max = Math.max(0, ...sections.map((s) => s.stories.length));
  for (let r = 0; r < max; r++) {
    const round = sections.map((s) => s.stories[r]).filter(Boolean).sort((a, b) => (b.date || 0) - (a.date || 0));
    out.push(...round);
  }
  return out;
}

function edition({ config, sections, stories, page, size, now, active, link, heading, pageLetter }) {
  const per = config.storiesPerPage;
  const pages = Math.max(1, Math.ceil(stories.length / per));
  page = Math.min(Math.max(1, page), pages);
  const slice = stories.slice((page - 1) * per, page * per);
  const showKicker = active === '';
  const opts = { config, now, showKicker };
  const back = link(page);

  let html = masthead(config, { now, pageLabel: `Page ${pageLetter}${page}` });
  html += nav(config, active);

  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const errors = sections.flatMap((s) => s.sources.filter((x) => x.error).map((x) => ({ ...x, name: s.name, stale: x.count > 0 })));
  if (errors.length && page === 1) {
    html += `<div class="notice">Could not update: ${errors.map((x) => `<b>${esc(x.name)}</b> (${esc(host(x.feed.url))}: ${esc(x.error)})`).join('; ')}.${errors.some((x) => x.stale) ? ' Showing the last copy we have.' : ''}</div>`;
  }
  if (heading) html += heading;
  if (pages > 1 && page > 1) html += pager(link, page, pages);

  if (!slice.length) {
    const hasStories = sections.some((s) => s.stories.length);
    html += hasStories && active === ''
      ? '<div class="empty">No sections are set to appear on the front page.<br>Choose a section above.</div>'
      : config.feeds.length
      ? `<div class="empty">No stories to print.${site.static ? '' : ' Try <a class="u" href="/refresh">refreshing</a>.'}</div>`
      : `<div class="empty">This newspaper has no wire services yet.<br>${site.static
        ? (site.editFeeds ? `<a class="u" href="${esc(site.editFeeds)}">Add an RSS feed to config.json</a>.` : 'Add an RSS feed to config.json.')
        : '<a class="u" href="/settings">Add an RSS feed in Settings</a>.'}</div>`;
  } else {
    let rest = slice;
    if (page === 1) {
      html += storyBlock(rest[0], 'lead', opts);
      rest = rest.slice(1);
      const nSecond = Math.min(rest.length, config.columns > 1 ? 2 : 1, Math.max(0, rest.length - config.columns));
      if (nSecond > 0) {
        html += columnsTable(rest.slice(0, nSecond).map((s) => storyBlock(s, 'second', opts)), 'second');
        rest = rest.slice(nSecond);
      }
    }
    if (rest.length) {
      const cols = Math.min(config.columns, rest.length);
      const perCol = Math.ceil(rest.length / cols);
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const chunk = rest.slice(c * perCol, (c + 1) * perCol);
        cells.push(chunk.map((s, i) => storyBlock(s, 'brief', { ...opts, last: i === chunk.length - 1 })).join(''));
      }
      html += columnsTable(cells.filter(Boolean), 'cols');
    }
  }

  html += pager(link, page, pages);
  html += footer(config, { size, back, sections });
  return html;
}

// Stories for the front page: every section except those with frontPage: false.
function frontPageStories(sections) {
  return interleave(sections.map((s) => ({ ...s, stories: s.stories.filter((st) => st.frontPage !== false) })));
}

function frontPage({ config, sections, page, size, now = Date.now() }) {
  const body = edition({ config, sections, stories: frontPageStories(sections), page, size, now, active: '', link: (p) => site.home(p), pageLetter: 'A' });
  return layout({ title: '', size, body, config });
}

const COMICS_PER_PAGE = 4; // strips are big images; keep each Kindle page light

function sameLocalDay(a, b) {
  const x = localDate(a), y = localDate(b);
  return x.y === y.y && x.m === y.m && x.d === y.d;
}

// One comic strip, full width. Tapping it opens the image alone so it can be zoomed.
function comicStrip(s, now, { last } = {}) {
  const by = s.author ? ` <i>by ${esc(s.author)}</i>` : '';
  const when = s.date && !sameLocalDay(s.date, now)
    ? `<span class="strip-date">${esc(fmtDate(s.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>` : '';
  const src = s.image ? esc(imgSrc(s.image)) : '';
  const art = src
    ? `<div class="strip-art"><a href="${src}"><img class="comic" src="${src}" alt="${esc(s.label || s.title)}" referrerpolicy="no-referrer"></a></div>`
    : `<p><i>No strip image in this feed.</i>${s.link ? ` <a class="u" href="${esc(s.link)}">See it at the source \u203a</a>` : ''}</p>`;
  return `<div class="strip${last ? ' end' : ''}"><div class="strip-head">${when}<b>${esc(s.label || s.title)}</b>${by}</div>${art}</div>`;
}

function sectionPageCount(config, section) {
  return Math.max(1, Math.ceil(section.stories.length / (section.comics ? COMICS_PER_PAGE : config.storiesPerPage)));
}

function comicsPage({ config, section, page, size, now, heading, pageLetter }) {
  const pages = sectionPageCount(config, section);
  page = Math.min(Math.max(1, page), pages);
  const link = (p) => site.section(section.id, p);
  const strips = section.stories.slice((page - 1) * COMICS_PER_PAGE, page * COMICS_PER_PAGE);
  let html = masthead(config, { now, pageLabel: `Page ${pageLetter}${page}` });
  html += nav(config, section.id);
  html += heading;
  if (page > 1) html += pager(link, page, pages);
  html += strips.length
    ? strips.map((s, i) => comicStrip(s, now, { last: i === strips.length - 1 })).join('')
    : '<div class="empty">No strips today.</div>';
  html += pager(link, page, pages);
  html += footer(config, { size, back: link(page), sections: [section] });
  return layout({ title: section.name, size, body: html, config });
}

function sectionPage({ config, sections, section, page, size, now = Date.now() }) {
  const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  const idx = sectionsFor(config).findIndex((s) => s.id === section.id);
  const pageLetter = letters[idx % letters.length] || 'B';
  // Comic sources are listed on the strips themselves, so the heading is just the name.
  const sources = section.comics ? [] : section.sources.filter((x) => x.link).map((x) => `<a class="u" href="${esc(x.link)}">${esc(x.title || 'source')}</a>`);
  const heading = `<div class="kicker" style="margin-top:10px;font-size:.8em">${esc(section.name)}${sources.length ? ` \u00b7 ${sources.join(' \u00b7 ')}` : ''}</div>`;
  if (section.comics) return comicsPage({ config, section, page, size, now, heading, pageLetter });
  const body = edition({ config, sections: [section], stories: section.stories, page, size, now, active: section.id,
    link: (p) => site.section(section.id, p), heading, pageLetter });
  return layout({ title: section.name, size, body, config });
}

// Split sanitized HTML into screen-sized chunks at top-level block boundaries.
function paginateHtml(html, budget) {
  const pages = [];
  const re = /<(\/?)([a-z0-9]+)[^>]*>|[^<]+/g;
  let depth = 0, start = 0, textLen = 0, m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      if (/^(br|img|hr)$/.test(m[2])) {
        if (m[2] === 'img') textLen += 400;
      } else depth += m[1] ? -1 : 1;
    } else textLen += m[0].length;
    if (depth <= 0 && m[1] && textLen >= budget) {
      pages.push(html.slice(start, re.lastIndex));
      start = re.lastIndex; textLen = 0; depth = 0;
    }
  }
  const tail = html.slice(start).trim();
  if (tail) {
    // Fold a tiny last page into the previous one.
    if (pages.length && toText(tail).length < budget * 0.25) pages[pages.length - 1] += tail;
    else pages.push(tail);
  }
  return pages.length ? pages : [''];
}

function articleContent(config, story) {
  let content = sanitize(story.content || story.summary, {
    base: story.link, images: config.showImages, imageUrl: imgSrc,
  });
  if (!toText(content)) return '';
  if (!/<(p|ul|ol|blockquote|h\d|table|pre)\b/.test(content)) {
    // Feeds that send plain text or <br>-separated text.
    content = content.includes('<br>') ? `<p>${content}</p>` : textToHtml(content);
  }
  return content;
}

// Screen-sized pages of an article's body.
function articleChunks(config, story, size) {
  return paginateHtml(articleContent(config, story), CHARS_PER_SCREEN[size] || CHARS_PER_SCREEN.m);
}

function articlePage({ config, story, section, page, size, now = Date.now() }) {
  const chunks = articleChunks(config, story, size);
  const content = chunks.join('');
  const pages = chunks.length;
  page = Math.min(Math.max(1, page), pages);
  const link = (p) => site.article(story.id, p);

  const list = section ? section.stories : [];
  const pos = list.findIndex((s) => s.id === story.id);
  const prevStory = pos > 0 ? list[pos - 1] : null;
  const nextStory = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;

  let html = masthead(config, { now, small: true });
  html += nav(config, story.sectionId);
  html += '<div class="article">';
  if (page === 1) {
    html += `<div class="kicker" style="margin-top:12px"><a href="${esc(site.section(story.sectionId, 1))}">${esc(story.section)}</a></div>`;
    html += `<h2 class="headline">${esc(story.title)}</h2>`;
    const parts = [];
    if (story.author) parts.push(`By ${story.author}`);
    if (story.date) parts.push(fmtDate(story.date, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    html += `<div class="byline">${esc(parts.join(' · ')) || '&nbsp;'}</div>`;
    if (config.showImages && story.image && !content.includes(esc(imgSrc(story.image)))) {
      html += `<img class="pic" src="${esc(imgSrc(story.image))}" alt="">`;
    }
  } else {
    html += `<div class="kicker" style="margin-top:12px">${esc(story.section)} · continued</div><h3 style="margin:4px 0 10px">${esc(story.title)}</h3>`;
  }

  html += pager(link, page, pages);
  if (content) {
    const first = /^<p>([\s\S]*?)<\/p>/.exec(chunks[0]);
    const dropcap = page === 1 && first && toText(first[1]).length >= DROPCAP_MIN_CHARS / 1.5;
    html += `<div class="body${dropcap ? ' dropcap' : ''}">${chunks[page - 1]}</div>`;
  } else {
    html += '<div class="empty">This feed provides only a headline.</div>';
  }

  if (page === pages) {
    html += '<div class="endmark">■</div>';
    if (story.link) html += `<p class="c"><a class="u" href="${esc(story.link)}">Read the full story at the source ›</a></p>`;
  }
  html += pager(link, page, pages);

  html += '<div class="pager">';
  html += prevStory ? `<a class="btn" href="${esc(site.article(prevStory.id, 1))}">‹ Newer story</a>` : '';
  html += `<a class="btn" href="${esc(site.section(story.sectionId, 1))}">${esc(story.section)}</a>`;
  html += nextStory ? `<a class="btn" href="${esc(site.article(nextStory.id, 1))}">Older story ›</a>` : '';
  html += '</div></div>';
  html += footer(config, { size, back: link(page), sections: section ? [section] : [] });
  return layout({ title: story.title, size, body: html, config });
}

function notFound({ config, size, message }) {
  const body = `${masthead(config, { now: Date.now(), small: true })}${nav(config, null)}
<div class="empty">${esc(message || 'That story has gone to press without us.')}<br><br><a class="btn" href="${esc(site.home(1))}">Front Page</a></div>`;
  return layout({ title: 'Not found', size, body, config });
}

// ---- settings ------------------------------------------------------------

function settingsPage({ config, sections, size, message, error }) {
  const statusFor = (f) => {
    const s = sections.flatMap((x) => x.sources).find((x) => x.feed.id === f.id);
    if (!f.enabled) return 'Disabled';
    if (!s) return '';
    if (s.error) return `Error: ${s.error}`;
    return `${s.count} stories${s.title ? ` · “${s.title}”` : ''}`;
  };
  const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');

  const feedRows = config.feeds.map((f, i) => `
<div class="feedrow"><form method="post" action="/settings">
<input type="hidden" name="action" value="feed"><input type="hidden" name="id" value="${esc(f.id)}">
<label>Section name <small>(feeds with the same name share a section)</small></label><input type="text" name="name" value="${esc(f.name)}">
<label>Feed URL</label><input type="url" name="url" value="${esc(f.url)}">
<label class="chk"><input type="checkbox" name="enabled"${f.enabled ? ' checked' : ''}>Enabled</label>
<label class="chk"><input type="checkbox" name="frontPage"${f.frontPage !== false ? ' checked' : ''}>Show on front page</label>
<button name="op" value="save">Save</button>${i > 0 ? '<button name="op" value="up">↑ Up</button>' : ''}${i < config.feeds.length - 1 ? '<button name="op" value="down">↓ Down</button>' : ''}<button name="op" value="delete">Remove</button>
<div class="status">${esc(statusFor(f))}</div>
</form></div>`).join('');

  const body = `${masthead(config, { now: Date.now(), small: true })}${nav(config, null)}
<div class="settings article">
${message ? `<div class="notice">${esc(message)}</div>` : ''}${error ? `<div class="notice"><b>Problem:</b> ${esc(error)}</div>` : ''}

<h2>Add a feed</h2>
<form method="post" action="/settings">
<input type="hidden" name="action" value="add">
<label>Feed or website URL</label><input type="url" name="url" placeholder="https://example.com/feed.xml">
<label>Section name (optional)</label><input type="text" name="name" placeholder="Taken from the feed if blank">
<input type="submit" value="Add feed">
</form>

<h2>Sections (${config.feeds.length})</h2>
${feedRows || '<p><i>No feeds yet.</i></p>'}

<h2>Newspaper</h2>
<form method="post" action="/settings">
<input type="hidden" name="action" value="general">
<label>Name of the paper</label><input type="text" name="title" value="${esc(config.title)}">
<label>Motto</label><input type="text" name="motto" value="${esc(config.motto)}">
<label>Founded (YYYY-MM-DD) \u2014 Vol. I, No. 1; a new volume each anniversary</label><input type="text" name="founded" placeholder="2026-10-04" value="${esc(config.founded || '')}">
<table class="grid"><tr>
<td class="first half"><label>Columns</label><select name="columns">${[1, 2, 3, 4].map((n) => `<option${sel(n, config.columns)}>${n}</option>`).join('')}</select></td>
<td class="last half"><label>Stories per page</label><input type="number" name="storiesPerPage" min="3" max="40" value="${config.storiesPerPage}"></td>
</tr><tr>
<td class="first half"><label>Summary length (chars)</label><input type="number" name="summaryLength" min="0" max="2000" value="${config.summaryLength}"></td>
<td class="last half"><label>Refresh every (minutes)</label><input type="number" name="refreshMinutes" min="1" max="1440" value="${config.refreshMinutes}"></td>
</tr><tr>
<td class="first half"><label>Stories kept per feed</label><input type="number" name="maxPerFeed" min="1" max="200" value="${config.maxPerFeed}"></td>
<td class="last half"><label>&nbsp;</label><label class="chk"><input type="checkbox" name="showImages"${config.showImages ? ' checked' : ''}>Show pictures (slower)</label></td>
</tr></table>
<input type="submit" value="Save newspaper settings">
</form>

<h2>Import / export</h2>
<form method="post" action="/settings">
<input type="hidden" name="action" value="import">
<label>Paste OPML, or one feed URL per line</label><textarea name="data"></textarea>
<input type="submit" value="Import feeds">
</form>
<p><a class="u" href="/opml">Download feeds as OPML</a></p>
</div>
${footer(config, { size, back: '/settings', sections: [] })}`;
  return layout({ title: 'Settings', size, body, config });
}

function opml(config) {
  const x = (s) => esc(s);
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>${x(config.title)}</title><dateCreated>${new Date().toUTCString()}</dateCreated></head><body>
${config.feeds.map((f) => `<outline type="rss" text="${x(f.name)}" title="${x(f.name)}" xmlUrl="${x(f.url)}"/>`).join('\n')}
</body></opml>
`;
}

module.exports = { configure, site, editionNumber, frontPageStories, sectionPageCount, articleChunks, frontPage, sectionPage, articlePage, settingsPage, notFound, opml, paginateHtml, interleave, SIZES };
