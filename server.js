'use strict';
const http = require('http');
const crypto = require('crypto');
const config = require('./lib/config');
const feeds = require('./lib/feeds');
const render = require('./lib/render');
const xml = require('./lib/xml');
const { safeUrl, toText } = require('./lib/sanitize');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// ---- small http helpers --------------------------------------------------

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-cache', ...headers });
  res.end(buf);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, 'Content-Length': 0, ...headers });
  res.end();
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Only allow local redirects (prevents open-redirects via ?back=).
function localPath(p, fallback = '/') {
  return typeof p === 'string' && /^\/(?!\/)/.test(p) && !/[\r\n\\]/.test(p) ? p : fallback;
}

function authorized(req) {
  if (!ADMIN_PASSWORD) return true;
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- feed management -----------------------------------------------------

// Fetch a URL; if it is an HTML page rather than a feed, look for an
// advertised <link rel="alternate" type="application/rss+xml">.
async function resolveFeed(url) {
  const src = await feeds.fetchText(url);
  try {
    return { url, feed: feeds.parseFeed(src, url) };
  } catch (e) {
    const links = [...src.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
      .filter((tag) => /rel\s*=\s*["']?alternate/i.test(tag) && /type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag));
    for (const tag of links) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      const found = href && safeUrl(xml.decodeEntities(href[1]), url);
      if (found) return { url: found, feed: feeds.parseFeed(await feeds.fetchText(found), found) };
    }
    throw new Error(`No RSS or Atom feed found at that address (${e.message})`);
  }
}

function parseImport(data) {
  const out = [];
  if (/<opml/i.test(data)) {
    const walk = (n) => {
      for (const c of xml.elements(n)) {
        if (c.name === 'outline' && (c.attrs.xmlurl)) out.push({ url: c.attrs.xmlurl, name: c.attrs.title || c.attrs.text || '' });
        walk(c);
      }
    };
    walk(xml.parse(data));
  } else {
    for (const line of data.split(/\r?\n/)) {
      const url = safeUrl(line.trim());
      if (url) out.push({ url, name: '' });
    }
  }
  return out;
}

async function handleSettingsPost(req, res) {
  const form = new URLSearchParams(await readBody(req));
  const c = JSON.parse(JSON.stringify(config.get()));
  const action = form.get('action');
  let message = '', error = '';

  if (action === 'add') {
    const url = safeUrl(form.get('url') || '');
    if (!url) {
      error = 'Please enter a full http:// or https:// address.';
    } else {
      try {
        const found = await resolveFeed(url);
        if (c.feeds.some((f) => f.url === found.url)) {
          error = 'That feed is already in the paper.';
        } else {
          const name = (form.get('name') || '').trim() || found.feed.title || new URL(found.url).hostname;
          c.feeds.push({ name, url: found.url, enabled: true });
          message = `Added “${name}” with ${found.feed.items.length} stories.`;
        }
      } catch (e) {
        error = `Could not add feed: ${e.message}`;
      }
    }
  } else if (action === 'feed') {
    const i = c.feeds.findIndex((f) => config.slug(f.id) === form.get('id'));
    const op = form.get('op');
    if (i === -1) error = 'Feed not found.';
    else if (op === 'delete') { message = `Removed “${c.feeds[i].name}”.`; c.feeds.splice(i, 1); }
    else if (op === 'up' && i > 0) [c.feeds[i - 1], c.feeds[i]] = [c.feeds[i], c.feeds[i - 1]];
    else if (op === 'down' && i < c.feeds.length - 1) [c.feeds[i + 1], c.feeds[i]] = [c.feeds[i], c.feeds[i + 1]];
    else if (op === 'save') {
      const url = safeUrl(form.get('url') || '');
      if (!url) error = 'Please enter a full http:// or https:// address.';
      else {
        c.feeds[i] = { ...c.feeds[i], name: (form.get('name') || '').trim() || c.feeds[i].name, url, enabled: form.has('enabled') };
        message = 'Saved.';
      }
    }
  } else if (action === 'general') {
    for (const k of ['title', 'motto', 'columns', 'storiesPerPage', 'summaryLength', 'refreshMinutes', 'maxPerFeed']) {
      if (form.has(k)) c[k] = form.get(k);
    }
    c.showImages = form.has('showImages');
    message = 'Newspaper settings saved.';
  } else if (action === 'import') {
    const list = parseImport(form.get('data') || '');
    let added = 0;
    for (const f of list) {
      if (c.feeds.some((x) => x.url === f.url)) continue;
      c.feeds.push({ name: f.name || new URL(f.url).hostname, url: f.url, enabled: true });
      added++;
    }
    message = `Imported ${added} feed${added === 1 ? '' : 's'}.`;
  }

  if (!error) config.save(c);
  const q = new URLSearchParams();
  if (message) q.set('msg', message);
  if (error) q.set('err', error);
  redirect(res, `/settings?${q}`);
}

// ---- image proxy ---------------------------------------------------------
// Pictures are fetched by the server so the Kindle only talks to one host
// (old Kindle browsers fail TLS handshakes with many modern CDNs).

async function proxyImage(res, url) {
  if (!url || !feeds.imageAllowed(url)) return send(res, 404, 'Not found', 'text/plain');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'KindleGazette/1.0' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(jpeg|png|gif|webp|bmp)/.test(type)) throw new Error('bad image');
    const len = parseInt(r.headers.get('content-length'), 10);
    if (len > MAX_IMAGE_BYTES) throw new Error('too large');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('too large');
    send(res, 200, buf, type, { 'Cache-Control': 'public, max-age=86400' });
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  } finally {
    clearTimeout(timer);
  }
}

// ---- routing -------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const cfg = config.get();
  const ck = cookies(req);
  const size = render.SIZES[ck.size] ? ck.size : 'm';
  const page = parseInt(url.searchParams.get('page'), 10) || 1;

  if (path === '/settings' || path === '/opml') {
    if (!authorized(req)) {
      return send(res, 401, 'Password required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Newspaper settings"' });
    }
  }

  if (req.method === 'POST' && path === '/settings') return handleSettingsPost(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

  if (path === '/') {
    const sections = await feeds.getEdition(cfg);
    return send(res, 200, render.frontPage({ config: cfg, sections, page, size }));
  }

  let m;
  if ((m = /^\/section\/([a-z0-9-]+)$/.exec(path))) {
    const sections = await feeds.getEdition(cfg);
    const section = sections.find((s) => s.feed.id === m[1]);
    if (!section) return send(res, 404, render.notFound({ config: cfg, size, message: 'No such section.' }));
    return send(res, 200, render.sectionPage({ config: cfg, sections, section, page, size }));
  }

  if ((m = /^\/article\/([a-f0-9]{12})$/.exec(path))) {
    let story = feeds.getStory(m[1]);
    const sections = await feeds.getEdition(cfg); // refreshes the index if stale
    story = feeds.getStory(m[1]) || story;
    if (!story) return send(res, 404, render.notFound({ config: cfg, size }));
    const section = sections.find((s) => s.feed.id === story.feedId);
    return send(res, 200, render.articlePage({ config: cfg, story, section, page, size }));
  }

  if (path === '/settings') {
    const sections = await feeds.getEdition(cfg);
    return send(res, 200, render.settingsPage({
      config: cfg, sections, size,
      message: url.searchParams.get('msg'), error: url.searchParams.get('err'),
    }));
  }

  if (path === '/prefs') {
    const s = url.searchParams.get('size');
    const cookie = render.SIZES[s] ? [`size=${s}; Path=/; Max-Age=31536000; SameSite=Lax`] : [];
    return redirect(res, localPath(url.searchParams.get('back')), { 'Set-Cookie': cookie });
  }

  if (path === '/refresh') {
    feeds.clearCache();
    await feeds.getEdition(cfg, { force: true });
    return redirect(res, localPath(url.searchParams.get('back')));
  }

  if (path === '/img') return proxyImage(res, url.searchParams.get('u'));

  if (path === '/opml') {
    return send(res, 200, render.opml(cfg), 'text/x-opml; charset=utf-8', { 'Content-Disposition': 'attachment; filename="feeds.opml"' });
  }

  if (path === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (path === '/favicon.ico') return send(res, 204, '', 'image/x-icon');

  return send(res, 404, render.notFound({ config: cfg, size, message: 'Page not found.' }));
}

function start(port = PORT, host = HOST) {
  config.load();
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, `Something went wrong: ${toText(e.message)}`, 'text/plain');
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (require.main === module) {
  start().then((s) => {
    const { port } = s.address();
    console.log(`Kindle Gazette is on the press at http://localhost:${port}/`);
    console.log(`Config: ${config.CONFIG_PATH}${ADMIN_PASSWORD ? ' (settings are password-protected)' : ''}`);
  });
}

module.exports = { start, handle, parseImport };
