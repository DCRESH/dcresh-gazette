'use strict';
// Renders the whole newspaper to static HTML for GitHub Pages (or any static
// host). Run on a schedule by .github/workflows/pages.yml.
//
//   node build.js                  -> ./_site
//   BASE_PATH=/my-repo node build.js
//
// Environment:
//   OUT_DIR           output directory (default _site)
//   BASE_PATH         URL prefix the site is served under. Defaults to
//                     "/<repo>" from GITHUB_REPOSITORY, or "" for <user>.github.io repos.
//   EDIT_URL          link shown as "Edit feeds" in the footer
//   REBUILD_MINUTES   shown in the footer ("New edition every N minutes")
//   TZ                time zone for datelines

const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const feeds = require('./lib/feeds');
const render = require('./lib/render');

const SIZE = 'm';
const OUT = path.resolve(process.env.OUT_DIR || '_site');

function basePath() {
  if (process.env.BASE_PATH !== undefined) return process.env.BASE_PATH.replace(/\/+$/, '');
  const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1];
  return repo && !/\.github\.io$/i.test(repo) ? `/${repo}` : '';
}

function editUrl() {
  if (process.env.EDIT_URL !== undefined) return process.env.EDIT_URL || null;
  const repo = process.env.GITHUB_REPOSITORY;
  return repo ? `https://github.com/${repo}/edit/${process.env.GITHUB_REF_NAME || 'main'}/config.json` : null;
}

// GitHub Actions shows these as annotations on the run's page.
function annotate(level, message, { title, file, line, col } = {}) {
  if (!process.env.GITHUB_ACTIONS) return;
  const props = Object.entries({ title, file, line, col }).filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v).replace(/[,:\r\n%]/g, ' ')}`).join(',');
  console.log(`::${level}${props ? ` ${props}` : ''}::${String(message).replace(/\r?\n/g, ' ')}`);
}

function writeSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}

async function build() {
  const B = basePath();
  const pageDir = (prefix, p) => (p > 1 ? `${prefix}${p}/` : prefix);
  render.configure({
    static: true,
    home: (p) => (p > 1 ? `${B}/page/${p}/` : `${B}/`),
    section: (id, p) => pageDir(`${B}/section/${id}/`, p),
    article: (id, p) => pageDir(`${B}/article/${id}/`, p),
    image: (url) => url, // no image proxy on a static host
    editFeeds: editUrl(),
    rebuildMinutes: parseInt(process.env.REBUILD_MINUTES, 10) || null,
    builtAt: Date.now(),
  });

  const cfg = config.load({ strict: true });
  const sections = await feeds.getEdition(cfg);
  const now = Date.now();
  const summary = ['| Feed | Result |', '| --- | --- |'];
  for (const section of sections) {
    for (const s of section.sources) {
      const label = s.feed.label || (section.sources.length > 1 ? `${section.name} (${s.feed.url})` : section.name);
      const strip = s.latest;
      const result = s.error || (s.feed.type === 'comic'
        ? (strip ? `strip for ${new Date(strip.date || now).toLocaleDateString('en-US', { timeZone: process.env.TZ || 'UTC', month: 'short', day: 'numeric' })}${strip.image ? ` (${strip.image})` : ' \u2014 NO IMAGE FOUND'}` : 'no strips in feed')
        : `${s.count} stories`);
      console.log(`${s.error ? 'FAIL' : ' ok '} ${label.padEnd(24)} ${result}`);
      summary.push(`| ${label} | ${s.error ? `\u274c ${s.error}` : `\u2705 ${result}`} |`);
      if (s.error) annotate('warning', `${label}: ${s.error} (${s.feed.url})`, { title: 'Feed failed' });
      else if (s.feed.type === 'comic' && !(strip && strip.image)) annotate('warning', `${label}: ${result} (${s.feed.url})`, { title: 'Comic has no image' });
      else annotate('notice', `${label}: ${result}`, { title: 'Feed loaded' });
    }
  }
  writeSummary(`### Edition feeds\n\n${summary.join('\n')}\n`);
  const total = sections.reduce((n, s) => n + s.stories.length, 0);
  if (total === 0) {
    // Leave the previous deployment in place rather than publishing an empty paper.
    throw new Error(cfg.feeds.some((f) => f.enabled) ? 'Every feed failed; not publishing.' : 'No feeds are enabled in config.json; not publishing.');
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  let files = 0;
  const write = (url, html) => {
    const rel = url.slice(B.length).replace(/^\/+/, '');
    const file = path.join(OUT, rel.endsWith('/') || rel === '' ? `${rel}index.html` : rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    files++;
  };
  const pagesFor = (n) => Math.max(1, Math.ceil(n / cfg.storiesPerPage));

  const frontPages = pagesFor(render.frontPageStories(sections).length);
  for (let p = 1; p <= frontPages; p++) {
    write(render.site.home(p), render.frontPage({ config: cfg, sections, page: p, size: SIZE, now }));
  }

  for (const section of sections) {
    for (let p = 1; p <= render.sectionPageCount(cfg, section); p++) {
      write(render.site.section(section.id, p), render.sectionPage({ config: cfg, sections, section, page: p, size: SIZE, now }));
    }
    for (const story of section.stories) {
      const n = render.articleChunks(cfg, story, SIZE).length;
      for (let p = 1; p <= n; p++) {
        write(render.site.article(story.id, p), render.articlePage({ config: cfg, story, section, page: p, size: SIZE, now }));
      }
    }
  }

  write(`${B}/404.html`, render.notFound({ config: cfg, size: SIZE, message: 'That story is no longer in this edition.' }));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log(`Wrote ${files} pages (${total} stories) to ${OUT} for base path "${B || '/'}"`);
  const ed = render.editionNumber(cfg.founded, now);
  const tz = process.env.TZ || 'UTC';
  const printed = new Date(now).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
  const edition = `${ed ? `Vol. ${ed.volume}, No. ${ed.issue} · ` : ''}printed ${printed} (${tz}) · ${total} stories`;
  annotate('notice', edition, { title: 'Edition published' });
  writeSummary(`\n**${edition}**\n`);
}

if (require.main === module) {
  build().catch((e) => {
    console.error(e.message);
    annotate('error', e.message, { title: 'Edition not published', file: e.line ? 'config.json' : undefined, line: e.line, col: e.col });
    writeSummary(`### \u274c Edition not published\n\n${e.message}\n\nThe previous edition is still online.\n`);
    process.exit(1);
  });
}

module.exports = { build };
