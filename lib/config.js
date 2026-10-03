'use strict';
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
  c.maxPerFeed = clampInt(c.maxPerFeed, 1, 200, DEFAULTS.maxPerFeed);
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
    };
  });
  return c;
}

function load() {
  try {
    current = normalize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (e) {
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

module.exports = { get, load, save, slug, normalize, CONFIG_PATH };
