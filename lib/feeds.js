'use strict';
// Fetching, parsing (RSS 2.0 / RSS 1.0 RDF / Atom) and caching of feeds.

const crypto = require('crypto');
const xml = require('./xml');
const { toText, safeUrl } = require('./sanitize');
const { sectionsFor } = require('./config');

const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = 'KindleGazette/1.0 (+RSS reader)';

// ---- parsing -------------------------------------------------------------

// HTML content of a node: escaped/CDATA HTML is in .text; raw (unescaped)
// HTML embedded in the XML shows up as child elements instead.
function htmlOf(node) {
  if (!node) return '';
  if (node.attrs && node.attrs.type === 'xhtml') return xml.innerXml(node);
  const els = xml.elements(node);
  if (els.length && !node.text.trim().startsWith('<')) return xml.innerXml(node);
  if (node.attrs && node.attrs.type === 'text') {
    return node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n\s*\n/g, '<br><br>');
  }
  return node.text;
}

function parseDate(s) {
  if (!s) return null;
  let t = Date.parse(s.trim());
  // Some feeds use non-standard zone abbreviations ("EST", "CEST"...).
  if (Number.isNaN(t)) t = Date.parse(s.trim().replace(/\s+[A-Z]{2,5}$/, ' GMT'));
  return Number.isNaN(t) ? null : t;
}

function firstImg(html, base) {
  const m = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html || '');
  return m ? safeUrl(xml.decodeEntities(m[1]), base) : null;
}

function mediaImage(node, base) {
  for (const name of ['media:thumbnail', 'media:content', 'enclosure', 'itunes:image', 'image']) {
    for (const n of xml.childrenNamed(node, name)) {
      const url = n.attrs.url || n.attrs.href || xml.text(xml.child(n, 'url'));
      const type = n.attrs.type || n.attrs.medium || '';
      if (url && (name !== 'enclosure' && name !== 'media:content' || /image/.test(type) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url))) {
        return safeUrl(url, base);
      }
    }
  }
  const group = xml.child(node, 'media:group');
  return group ? mediaImage(group, base) : null;
}

function atomLink(node) {
  const links = xml.childrenNamed(node, 'link');
  const alt = links.find((l) => !l.attrs.rel || l.attrs.rel === 'alternate') || links[0];
  return alt ? (alt.attrs.href || xml.text(alt)) : '';
}

function parseFeed(source, feedUrl) {
  const doc = xml.parse(source);
  const root = xml.elements(doc)[0];
  if (!root) throw new Error('Empty or unreadable feed');

  let channel, itemNodes, isAtom = false;
  if (root.name === 'feed') {
    isAtom = true; channel = root; itemNodes = xml.childrenNamed(root, 'entry');
  } else if (root.name === 'rss') {
    channel = xml.child(root, 'channel') || root;
    itemNodes = xml.childrenNamed(channel, 'item');
  } else if (root.name === 'rdf:rdf' || root.name.endsWith(':rdf')) {
    channel = xml.child(root, 'channel') || root;
    itemNodes = xml.childrenNamed(root, 'item');
    if (!itemNodes.length) itemNodes = xml.childrenNamed(channel, 'item');
  } else {
    throw new Error(`Not an RSS or Atom feed (root element <${root.name}>)`);
  }

  const siteLink = safeUrl(isAtom ? atomLink(channel) : xml.text(xml.child(channel, 'link')), feedUrl) || feedUrl;

  const items = itemNodes.map((n) => {
    const link = safeUrl(isAtom ? atomLink(n) : (xml.text(xml.child(n, 'link')) ||
      (xml.child(n, 'guid') && /^https?:/.test(xml.text(xml.child(n, 'guid'))) ? xml.text(xml.child(n, 'guid')) : '')), siteLink);
    const content = htmlOf(xml.child(n, 'content:encoded', 'content', 'xhtml:body'));
    const summary = htmlOf(xml.child(n, 'description', 'summary', 'media:description', 'itunes:summary'));
    const authorNode = xml.child(n, 'dc:creator', 'author', 'itunes:author');
    const author = authorNode ? (xml.text(xml.child(authorNode, 'name')) || toText(authorNode.text)) : '';
    const title = toText(htmlOf(xml.child(n, 'title'))) || toText(summary).slice(0, 80) || '(untitled)';
    const date = parseDate(xml.text(xml.child(n, 'pubdate', 'published', 'dc:date', 'updated', 'issued', 'modified')));
    return {
      title,
      link,
      author: author.replace(/^[^(]*\(([^)]+)\)$/, '$1').slice(0, 80), // "a@b.c (Name)" -> "Name"
      date,
      summary,
      content: content && toText(content).length > toText(summary).length ? content : summary,
      image: mediaImage(n, link || siteLink) || firstImg(content || summary, link || siteLink),
      guid: xml.text(xml.child(n, 'guid', 'id')) || link || title,
    };
  });

  return {
    title: toText(htmlOf(xml.child(channel, 'title'))),
    link: siteLink,
    items,
  };
}

// ---- fetching ------------------------------------------------------------

function charsetFrom(contentType, bytes) {
  const m = /charset\s*=\s*["']?([\w.-]+)/i.exec(contentType || '');
  if (m) return m[1];
  const head = Buffer.from(bytes.slice(0, 200)).toString('latin1');
  const x = /<\?xml[^>]*encoding\s*=\s*["']([\w.-]+)["']/i.exec(head);
  return x ? x[1] : 'utf-8';
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Feed is too large');
    let decoder;
    try { decoder = new TextDecoder(charsetFrom(res.headers.get('content-type'), buf)); } catch { decoder = new TextDecoder('utf-8'); }
    return decoder.decode(buf).replace(/^﻿/, '');
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out');
    throw new Error(e.cause && e.cause.message ? `${e.message}: ${e.cause.message}` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// ---- cache & index -------------------------------------------------------

const cache = new Map();   // url -> { fetchedAt, data, error, pending }
let articleIndex = new Map(); // id -> story
let imageAllow = new Set();   // image URLs that the /img proxy may fetch

// "Peanuts - ComicCaster" -> "Peanuts": a fallback strip name when no label is set.
function comicName(title) {
  return String(title || '').replace(/\s*(?:[-|:\u2013\u2014]\s*(?:comic\s*caster|gocomics|rss|feed)[^-|]*|\s+(?:rss|feed))$/i, '').trim();
}

// Comic strips are dated by calendar day ("Peanuts - 2026-10-03"), usually
// stamped midnight UTC, which is the previous evening in the Americas. Pin the
// strip to noon UTC of its day so it shows as that date in any time zone.
function comicDay(item) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(item.title || '');
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
  const d = item.date && new Date(item.date);
  if (d && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
  return item.date;
}

// Ask image servers that resize on the fly (e.g. "?width=2800") for something
// closer to an e-reader screen: big strips are slow and memory-hungry on a Kindle.
const MAX_STRIP_WIDTH = 1400;
function screenSizedImage(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const w = parseInt(u.searchParams.get('width'), 10);
    if (w > MAX_STRIP_WIDTH) { u.searchParams.set('width', String(MAX_STRIP_WIDTH)); return u.href; }
  } catch { /* leave it alone */ }
  return url;
}

const newestFirst = (a, b) => (b.date || 0) - (a.date || 0) || a.order - b.order;
const idFor = (feedId, guid) => crypto.createHash('sha1').update(feedId + '\n' + guid).digest('hex').slice(0, 12);

async function loadFeed(feed, ttlMs, force) {
  let entry = cache.get(feed.url);
  const fresh = entry && entry.fetchedAt && Date.now() - entry.fetchedAt < ttlMs;
  if (entry && entry.pending) return entry.pending;
  if (fresh && !force) return entry;
  entry = entry || {};
  cache.set(feed.url, entry);
  entry.pending = fetchText(feed.url)
    .then((src) => { entry.data = parseFeed(src, feed.url); entry.error = null; })
    .catch((e) => { entry.error = e.message; }) // keep any stale data we already had
    .then(() => { entry.fetchedAt = Date.now(); entry.pending = null; return entry; });
  return entry.pending;
}

/**
 * Every section with its stories, newest first. Feeds that share a name are
 * merged into one section; each feed is listed in `sources` with its own
 * fetch result.
 * [{ id, name, fetchedAt, sources: [{ feed, title, link, error, fetchedAt, count }], stories: [...] }]
 */
async function getEdition(config, { force = false } = {}) {
  const ttl = config.refreshMinutes * 60 * 1000;
  const groups = sectionsFor(config);
  const entries = new Map(await Promise.all(groups.flatMap((g) => g.feeds)
    .map(async (f) => [f.id, await loadFeed(f, ttl, force)])));
  const index = new Map();
  const images = new Set();
  const sections = groups.map((group) => {
    const sources = [];
    const stories = [];
    // A section made only of comic feeds is laid out as a funny pages.
    const comics = group.feeds.every((f) => f.type === 'comic');
    group.feeds.forEach((feed, feedIndex) => {
      const e = entries.get(feed.id);
      const comic = feed.type === 'comic';
      const items = (e.data ? e.data.items : [])
        .map((it, n) => ({
          ...it, id: idFor(feed.id, it.guid), feedId: feed.id, sectionId: group.id, section: group.name,
          frontPage: feed.frontPage !== false, order: n, feedIndex,
          comic, label: comic ? feed.label || comicName(e.data && e.data.title) || feed.name : '',
          ...(comic ? { date: comicDay(it), image: screenSizedImage(it.image) } : {}),
        }))
        .sort(newestFirst)
        // A comic feed contributes only its latest strip.
        .slice(0, comic ? 1 : config.maxPerFeed);
      stories.push(...items);
      sources.push({ feed, title: e.data ? e.data.title : '', link: e.data ? e.data.link : '', error: e.error, fetchedAt: e.fetchedAt, count: items.length, latest: items[0] || null });
    });
    // Comics keep the order they're listed in config.json, like a printed page.
    stories.sort(comics ? (a, b) => a.feedIndex - b.feedIndex : newestFirst);
    stories.forEach((s) => {
      index.set(s.id, s);
      if (s.image) images.add(s.image);
    });
    return { id: group.id, name: group.name, comics, sources, stories, fetchedAt: Math.max(0, ...sources.map((x) => x.fetchedAt || 0)) };
  });
  articleIndex = index;
  imageAllow = images;
  return sections;
}

function getStory(id) { return articleIndex.get(id) || null; }
function imageAllowed(url) { return imageAllow.has(url); }
function allowImage(url) { imageAllow.add(url); }
function clearCache() { cache.clear(); }

module.exports = { comicDay, screenSizedImage, sectionsFor, parseFeed, fetchText, getEdition, getStory, imageAllowed, allowImage, clearCache, MAX_BYTES };
