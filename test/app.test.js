'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gazette-'));
process.env.CONFIG_PATH = path.join(tmp, 'config.json');

const { parseFeed } = require('../lib/feeds');
const { sanitize, toText, truncate } = require('../lib/sanitize');
const { paginateHtml } = require('../lib/render');
const config = require('../lib/config');
const app = require('../server');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('parses RSS 2.0', () => {
  const f = parseFeed(fixture('rss.xml'), 'https://example.com/rss');
  assert.equal(f.title, 'The Daily Fixture');
  assert.equal(f.items.length, 3);
  const [a, b, c] = f.items;
  assert.equal(a.title, 'Council Approves New Bridge & Tunnel');
  assert.equal(a.author, 'Jane Reporter');
  assert.equal(a.image, 'https://example.com/bridge.jpg');
  assert.match(a.content, /council voted/);
  assert.equal(a.date, Date.parse('2026-10-02T14:00:00Z'));
  assert.ok(b.date, 'non-standard zone still parses');
  assert.equal(c.link, 'https://example.com/untitled');
  assert.match(c.title, /^An untitled item/);
});

test('parses Atom including xhtml and text content', () => {
  const f = parseFeed(fixture('atom.xml'), 'https://atom.example/feed');
  assert.equal(f.title, 'Atom Herald');
  assert.equal(f.link, 'https://atom.example/');
  assert.equal(f.items[0].title, 'Markets Rally');
  assert.equal(f.items[0].author, 'Sam Ledger');
  assert.match(f.items[0].content, /<b>Friday<\/b>/);
  assert.equal(f.items[1].link, 'https://atom.example/plain');
  assert.match(f.items[1].content, /Line one &amp; more/);
});

test('parses RSS 1.0 / RDF', () => {
  const f = parseFeed(fixture('rdf.xml'), 'https://rdf.example/rss');
  assert.equal(f.title, 'RDF Times');
  assert.equal(f.items[0].title, 'Café opens downtown');
});

test('rejects non-feeds', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>', 'https://x'), /Not an RSS or Atom feed/);
});

test('sanitizer strips scripts, handlers, iframes and tracking pixels', () => {
  const html = parseFeed(fixture('rss.xml'), 'https://example.com/rss').items[0].content;
  const out = sanitize(html, { base: 'https://example.com/bridge', images: true });
  assert.doesNotMatch(out, /script|alert|onclick|iframe|pixel/);
  assert.match(out, /<a href="https:\/\/example.com\/schedule">next spring<\/a>/);
  assert.match(out, /<em>7-2<\/em>/);
  assert.equal(sanitize('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitize('<p>a<p>b'), '<p>a</p><p>b</p>');
});

test('text helpers', () => {
  assert.equal(toText('<p>Hello&nbsp;<b>world</b></p><p>again</p>'), 'Hello world again');
  assert.equal(truncate('one two three four five', 12), 'one two…');
});

test('article pagination splits on block boundaries', () => {
  const html = Array.from({ length: 10 }, (_, i) => `<p>${'word '.repeat(60)}${i}</p>`).join('');
  const pages = paginateHtml(html, 800);
  assert.ok(pages.length > 2);
  assert.equal(pages.join(''), html);
  pages.forEach((p) => assert.match(p, /^<p>[\s\S]*<\/p>$/));
});

// ---- end-to-end ----------------------------------------------------------

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

test('end to end: front page, section, article, settings', async (t) => {
  const feedServer = http.createServer((req, res) => {
    const files = { '/rss.xml': 'rss.xml', '/atom.xml': 'atom.xml', '/rdf.xml': 'rdf.xml' };
    if (files[req.url]) {
      res.writeHead(200, { 'Content-Type': req.url === '/rdf.xml' ? 'application/rdf+xml' : 'application/xml' });
      const body = fixture(files[req.url]);
      return res.end(req.url === '/rdf.xml' ? Buffer.from(body, 'latin1') : body);
    }
    if (req.url === '/site') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>');
    }
    res.writeHead(404); res.end();
  });
  const fport = await listen(feedServer);
  const base = `http://127.0.0.1:${fport}`;
  config.save({
    title: 'Test Times', columns: 3, storiesPerPage: 3,
    feeds: [{ id: 'local', name: 'Local', url: `${base}/rss.xml` }, { id: 'rdf', name: 'Cafe Society', url: `${base}/rdf.xml` }],
  });
  const server = await app.start(0, '127.0.0.1');
  const port = server.address().port;
  t.after(() => { server.close(); feedServer.close(); });
  const get = (p, opts) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', ...opts });

  let res = await get('/');
  let html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Test Times/);
  assert.match(html, /Council Approves New Bridge &amp; Tunnel/);
  assert.match(html, /Page 1 of 2/);
  assert.doesNotMatch(html, /<script/i, 'no JavaScript on any page');
  assert.doesNotMatch(html, /display:\s*(flex|grid)/, 'no flexbox/grid');

  res = await get('/?page=2');
  assert.match(await res.text(), /Page 2 of 2/);

  const id = /href="\/article\/([a-f0-9]{12})">Council/.exec(html)[1];
  res = await get(`/article/${id}`);
  html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /council voted/);
  assert.match(html, /Jane Reporter/);
  assert.doesNotMatch(html, /alert\(1\)/);

  res = await get('/section/cafe-society');
  html = await res.text();
  assert.match(html, /Café opens downtown/, 'ISO-8859-1 decoded');

  res = await get('/prefs?size=xl&back=/section/rdf');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/section/rdf');
  assert.match(res.headers.get('set-cookie'), /size=xl/);
  res = await get('/prefs?size=xl&back=//evil.example');
  assert.equal(res.headers.get('location'), '/');

  // Add a feed by its website address (autodiscovery).
  res = await get('/settings', { method: 'POST', body: new URLSearchParams({ action: 'add', url: `${base}/site` }) });
  assert.equal(res.status, 303);
  assert.match(new URL(res.headers.get('location'), 'http://x').searchParams.get('msg'), /Added .Atom Herald. with 2 stories/);
  assert.equal(config.get().feeds[2].url, `${base}/atom.xml`);

  res = await get('/settings', { method: 'POST', body: new URLSearchParams({ action: 'feed', id: 'atom-herald', op: 'up' }) });
  assert.equal(config.get().feeds[1].name, 'Atom Herald');

  res = await get('/settings', { method: 'POST', body: new URLSearchParams({ action: 'general', title: 'Renamed', columns: '9' }) });
  assert.equal(config.get().title, 'Renamed');
  assert.equal(config.get().columns, 4, 'clamped');

  res = await get('/settings', { method: 'POST', body: new URLSearchParams({ action: 'import', data: fixture('opml.xml').replace(/BASE/g, base) }) });
  assert.match(new URL(res.headers.get('location'), 'http://x').searchParams.get('msg'), /Imported 1 feed/);

  res = await get('/settings');
  html = await res.text();
  assert.match(html, /Atom Herald/);
  assert.match(html, /Error: HTTP 404/, 'broken feed reported');

  res = await get('/img?u=' + encodeURIComponent('https://not-in-feeds.example/x.jpg'));
  assert.equal(res.status, 404, 'image proxy is not an open proxy');
});

test('volume and issue count from the founding date', () => {
  const { editionNumber } = require('../lib/render');
  const at = (iso) => Date.parse(iso);
  const ny = 'America/New_York';
  assert.deepEqual(editionNumber('2026-10-04', at('2026-10-04T12:00:00Z'), ny), { volume: 1, issue: 1 });
  assert.deepEqual(editionNumber('2026-10-04', at('2026-10-05T12:00:00Z'), ny), { volume: 1, issue: 2 });
  assert.deepEqual(editionNumber('2026-10-04', at('2027-10-03T12:00:00Z'), ny), { volume: 1, issue: 365 });
  assert.deepEqual(editionNumber('2026-10-04', at('2027-10-04T12:00:00Z'), ny), { volume: 2, issue: 1 });
  assert.deepEqual(editionNumber('2026-10-04', at('2028-10-05T12:00:00Z'), ny), { volume: 3, issue: 2 });
  // The day turns over at midnight in the paper's time zone, not UTC.
  assert.deepEqual(editionNumber('2026-10-04', at('2026-10-05T02:00:00Z'), ny), { volume: 1, issue: 1 });
  assert.deepEqual(editionNumber('2026-10-04', at('2026-10-05T02:00:00Z'), 'UTC'), { volume: 1, issue: 2 });
  assert.equal(editionNumber(null), null);
  assert.equal(editionNumber('not a date'), null);
});

test('comic strips keep their calendar date in any time zone, and big images are scaled down', () => {
  const { comicDay, screenSizedImage } = require('../lib/feeds');
  const { editionNumber } = require('../lib/render');
  const day = (t, timeZone) => new Date(t).toLocaleDateString('en-CA', { timeZone });
  const fromTitle = comicDay({ title: 'Peanuts - 2026-10-03', date: Date.parse('2026-10-03T00:00:00Z') });
  assert.equal(day(fromTitle, 'America/New_York'), '2026-10-03');
  assert.equal(day(fromTitle, 'America/Los_Angeles'), '2026-10-03');
  assert.equal(day(fromTitle, 'Asia/Tokyo'), '2026-10-03');
  const midnight = comicDay({ title: 'Untitled', date: Date.parse('2026-10-03T00:00:00Z') });
  assert.equal(day(midnight, 'America/New_York'), '2026-10-03');
  const timed = Date.parse('2026-10-03T15:30:00Z');
  assert.equal(comicDay({ title: 'x', date: timed }), timed, 'real timestamps are left alone');
  assert.equal(screenSizedImage('https://img.example/a?optimizer=image&width=2800&quality=85'), 'https://img.example/a?optimizer=image&width=1400&quality=85');
  assert.equal(screenSizedImage('https://img.example/a?width=900'), 'https://img.example/a?width=900');
  assert.equal(screenSizedImage('https://img.example/a.png'), 'https://img.example/a.png');
  assert.ok(editionNumber);
});
