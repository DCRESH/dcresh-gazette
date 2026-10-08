'use strict';
// Loading, validating and saving config.json, and grouping feeds into
// sections by name.
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  title: 'The Kindle Gazette',
  motto: 'All the News That Fits on E-Ink',
  columns: 3,           // columns on the front page (wide screens)
  storiesPerPage: 10,   // stories per page (lead + secondary + briefs)
  summaryLength: 280,   // characters of summary shown on the front page
  refreshMinutes: 20,   // how long fetched feeds are cached
  maxPerFeed: 30,       // items kept per feed
  showImages: false,    // images cost a lot of time and memory on e-ink
  filterAds: true,      // drop promo-code, deals and sponsored items from news feeds
  exclude: [],          // extra headline phrases to drop ("text" or "/regex/")
  maxAgeHours: null,    // front page: only stories from the last N hours (null: no limit)
  comicMaxHeight: 55,   // comic strips: max height as % of the screen
  founded: null,        // YYYY-MM-DD: Vol. I, No. 1; new volume each anniversary
  feeds: [],
};

let current = null;

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'feed';
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function normalize(raw) {
  const c = { ...DEFAULTS, ...(raw || {}) };
  c.title = String(c.title || DEFAULTS.title).slice(0, 80);
  c.motto = String(c.motto || '').slice(0, 120);
  c.columns = clampInt(c.columns, 1, 4, DEFAULTS.columns);
  c.storiesPerPage = clampInt(c.storiesPerPage, 3, 40, DEFAULTS.storiesPerPage);
  c.summaryLength = clampInt(c.summaryLength, 0, 2000, DEFAULTS.summaryLength);
  c.refreshMinutes = clampInt(c.refreshMinutes, 1, 1440, DEFAULTS.refreshMinutes);
  c.maxAgeHours = c.maxAgeHours == null || c.maxAgeHours === '' ? null : clampInt(c.maxAgeHours, 1, 24 * 60, null);
  c.filterAds = c.filterAds !== false && c.filterAds !== 'false';
  c.exclude = (Array.isArray(c.exclude) ? c.exclude : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 100);
  c.comicMaxHeight = clampInt(c.comicMaxHeight, 20, 100, DEFAULTS.comicMaxHeight);
  c.maxPerFeed = clampInt(c.maxPerFeed, 1, 200, DEFAULTS.maxPerFeed);
  c.founded = /^\d{4}-\d{2}-\d{2}$/.test(String(c.founded || '').trim()) && !Number.isNaN(Date.parse(String(c.founded).trim()))
    ? String(c.founded).trim() : null;
  c.showImages = c.showImages === true || c.showImages === 'true' || c.showImages === 'on';
  const seen = new Set();
  c.feeds = (Array.isArray(c.feeds) ? c.feeds : []).filter((f) => f && f.url).map((f) => {
    let id = slug(f.id || f.name || f.url);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return {
      id,
      name: String(f.name || f.url).slice(0, 60),
      url: String(f.url).trim(),
      enabled: f.enabled !== false,
      frontPage: f.frontPage !== false, // false: only on its own section page
      type: f.type === 'comic' ? 'comic' : 'news', // comic: newest strip only, shown as an image
      label: String(f.label || '').trim().slice(0, 60), // comic: strip name, e.g. "Peanuts"
      showText: f.showText === true, // comic: print the feed's text (caption, alt text) under the strip
    };
  });
  return c;
}

// With { strict: true } a broken config.json throws instead of falling back
// to an empty paper (used by the static build, so a typo never gets published).
// Enabled feeds grouped into sections by name (case-insensitive), in the
// order each name first appears: [{ id, name, feeds: [feed, ...] }].
function sectionsFor(config) {
  const byKey = new Map();
  const ids = new Set();
  for (const feed of config.feeds.filter((f) => f.enabled)) {
    const key = feed.name.trim().toLowerCase();
    if (!byKey.has(key)) {
      let id = slug(feed.name);
      while (ids.has(id)) id += '-2';
      ids.add(id);
      byKey.set(key, { id, name: feed.name.trim(), feeds: [] });
    }
    byKey.get(key).feeds.push(feed);
  }
  return [...byKey.values()];
}

function load({ strict = false } = {}) {
  try {
    current = normalize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) {
    if (strict && e.code !== 'ENOENT') {
      const err = new Error(`${path.basename(CONFIG_PATH)} is not valid JSON: ${e.message}`);
      const m = /line (\d+) column (\d+)/.exec(e.message);
      if (m) { err.line = +m[1]; err.col = +m[2]; }
      throw err;
    }
    if (e.code !== 'ENOENT') console.error(`Could not read ${CONFIG_PATH}: ${e.message}`);
    current = normalize({});
  }
  return current;
}

function get() {
  return current || load();
}

function save(next) {
  current = normalize(next);
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_PATH);
  return current;
}

module.exports = { get, load, save, slug, sectionsFor, normalize, CONFIG_PATH };
