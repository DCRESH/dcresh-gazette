'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gazette-build-'));
process.env.CONFIG_PATH = path.join(tmp, 'config.json');
process.env.OUT_DIR = path.join(tmp, 'site');
process.env.BASE_PATH = '/my-paper';
process.env.EDIT_URL = 'https://github.com/someone/my-paper/edit/main/config.json';

const config = require('../lib/config');
const { build } = require('../build');

test('static build: every page exists and links stay under the base path', async (t) => {
  const feedServer = http.createServer((req, res) => {
    const file = path.join(__dirname, 'fixtures', path.basename(req.url));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  t.after(() => feedServer.close());
  const base = `http://127.0.0.1:${feedServer.address().port}`;
  config.save({
    storiesPerPage: 3,
    feeds: [{ id: 'local', name: 'Local', url: `${base}/rss.xml` }, { id: 'atom', name: 'Atom', url: `${base}/atom.xml`, frontPage: false },
      // Same name as the first feed: merged into the Local section, but kept off the front page.
      { id: 'local-cafe', name: 'local', url: `${base}/rdf.xml`, frontPage: false }],
  });

  await build();
  const out = process.env.OUT_DIR;
  for (const f of ['index.html', 'section/local/index.html', 'section/atom/index.html', '404.html', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
  }

  // Every internal link resolves to a generated file.
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
    (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') && files.push(path.join(d, e.name))));
  walk(out);
  assert.ok(files.length >= 8);
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(html, /<script|\/refresh|\/settings|\/prefs|\/img\?/, `${f} has no server-only features`);
    for (const [, link] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      assert.ok(link.startsWith('/my-paper/'), `${link} in ${f} is under the base path`);
      assert.match(link, /\?e=[0-9a-z]+$/, `${link} in ${f} carries the edition stamp`);
      const href = link.split('?')[0];
      const target = path.join(out, href.slice('/my-paper/'.length));
      assert.ok(fs.existsSync(href.endsWith('/') ? path.join(target, 'index.html') : target), `${href} in ${f} exists`);
    }
  }

  const front = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  // A feed with frontPage: false keeps its section page but stays off the front page.
  const fronts = files.filter((f) => /^(index\.html|page\/\d+\/index\.html)$/.test(path.relative(out, f)));
  assert.ok(fronts.length >= 1);
  for (const f of fronts) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Markets Rally|Plain Entry/, `${f} omits the Atom feed`);
  assert.match(fs.readFileSync(path.join(out, 'section/atom/index.html'), 'utf8'), /Markets Rally/);
  assert.match(front, /href="\/my-paper\/section\/atom\/\?e=/, 'section still linked in the nav');
  assert.match(front, /http-equiv="Cache-Control" content="no-cache/);
  assert.match(front, /Latest edition<\/a>/);

  // Feeds sharing a name form one section with one nav link.
  const local = fs.readFileSync(path.join(out, 'section/local/index.html'), 'utf8');
  assert.match(local, /Council Approves/);
  assert.match(local, /Caf\u00e9 opens downtown/);
  assert.equal((front.match(/section\/local\//g) || []).length, 1, 'one nav link for the merged section');
  assert.ok(!fs.existsSync(path.join(out, 'section/local-cafe')), 'no separate section for the merged feed');
  for (const f of fronts) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Caf\u00e9 opens/, 'frontPage: false applies per feed');
  assert.match(front, /Edit feeds/);
  assert.match(front, /Printed /);
  // Each story lists its source (the feed's title) in its byline.
  assert.match(front, /class="byline">By Jane Reporter · [^<]* · The Daily Fixture<\/div>/);
  assert.match(local, /class="byline">[^<]*RDF Times<\/div>/, 'merged sections show each story\'s own source');
});

test('static build refuses to publish when every feed fails', async () => {
  config.save({ feeds: [{ id: 'gone', name: 'Gone', url: 'http://127.0.0.1:9/nothing.xml' }] });
  require('../lib/feeds').clearCache();
  await assert.rejects(build(), /Every feed failed/);
});

test('static build refuses to publish a config.json with a JSON typo', async () => {
  fs.writeFileSync(process.env.CONFIG_PATH, '{ "feeds": [ { "url": "http://a" } { "url": "http://b" } ] }');
  await assert.rejects(build(), (e) => /not valid JSON/.test(e.message) && e.line === 1);
});

test('comic feeds: latest strip only, laid out as a funny pages in config order', async (t) => {
  const feedServer = http.createServer((req, res) => {
    const file = path.join(__dirname, 'fixtures', path.basename(req.url));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  t.after(() => feedServer.close());
  const base = `http://127.0.0.1:${feedServer.address().port}`;
  config.save({
    showImages: false, // comics show their strips regardless
    feeds: [
      { id: 'local', name: 'Local', url: `${base}/rss.xml` },
      { id: 'owls', name: 'Funny Pages', url: `${base}/comic2.xml`, type: 'comic', label: 'Night Owls', frontPage: false, showText: true },
      { id: 'doodle', name: 'Funny Pages', url: `${base}/comic.xml`, type: 'comic', frontPage: false },
      // Two panels on the same day, listed oldest first: the higher-numbered one wins.
      { id: 'panels', name: 'Funny Pages', url: `${base}/panels.xml`, type: 'comic', frontPage: false },
    ],
  });
  require('../lib/feeds').clearCache();
  await build();
  const out = process.env.OUT_DIR;
  const funnies = fs.readFileSync(path.join(out, 'section/funny-pages/index.html'), 'utf8');
  // Only the newest strip of each comic.
  assert.match(funnies, /owls-1003\.png/);
  assert.match(funnies, /doodle-1003\.png/);
  assert.doesNotMatch(funnies, /-100[12]\.png/);
  assert.match(funnies, /panels\.example\/p2\.png/);
  assert.doesNotMatch(funnies, /panels\.example\/p[01]\.png/);
  // Config order (Night Owls first), labels from config or the cleaned feed title.
  assert.ok(funnies.indexOf('Night Owls') < funnies.indexOf('Daily Doodle'));
  assert.doesNotMatch(funnies, /ComicCaster/);
  assert.match(funnies, /by Lee Ink/);
  assert.match(funnies, /class="comic" style="max-height:440px;max-height:55vh" src="https:\/\/comics\.example\/strips\/owls-1003\.png"/);
  // showText prints the feed's text under the strip; without it there's no caption.
  assert.match(funnies, /<div class="strip-text"><p>Owls discuss the moon\.<\/p><\/div>/);
  assert.doesNotMatch(funnies, /Doodle discusses/);
  // Not on the front page, and no news-style summaries.
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), /comics\.example/);
  assert.doesNotMatch(funnies, /Continued/);
  assert.doesNotMatch(funnies, /class="byline"/, 'comics have no news bylines');
});

test('maxAgeHours limits the front page; section pages show everything', async (t) => {
  const item = (title, hoursAgo) => `<item><title>${title}</title><link>https://fresh.example/${encodeURIComponent(title)}</link><pubDate>${new Date(Date.now() - hoursAgo * 3600e3).toUTCString()}</pubDate><description>${title} text</description></item>`;
  const feedServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    const items = req.url === '/old' ? item('Thirty Hours Old', 30)
      : `${item('Two Hours Old', 2)}${item('Thirty Hours Old', 30)}<item><title>Undated Item</title><link>https://fresh.example/u</link></item>`;
    res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>Fresh</title><link>https://fresh.example/</link>${items}</channel></rss>`);
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  t.after(() => feedServer.close());
  const url = `http://127.0.0.1:${feedServer.address().port}/feed`;
  config.save({ maxAgeHours: 24, feeds: [{ id: 'fresh', name: 'Fresh', url }] });
  require('../lib/feeds').clearCache();
  await build();
  const front = fs.readFileSync(path.join(process.env.OUT_DIR, 'index.html'), 'utf8');
  assert.match(front, /Two Hours Old/);
  assert.doesNotMatch(front, /Thirty Hours Old/);
  assert.match(front, /Undated Item/, 'undated stories are kept');
  const section = fs.readFileSync(path.join(process.env.OUT_DIR, 'section/fresh/index.html'), 'utf8');
  assert.match(section, /Two Hours Old/);
  assert.match(section, /Thirty Hours Old/, 'the section page is not limited');

  // Nothing recent: the front page says so instead of looking broken.
  config.save({ maxAgeHours: 1, feeds: [{ id: 'fresh', name: 'Fresh', url: url.replace('/feed', '/old') }] });
  require('../lib/feeds').clearCache();
  await build();
  assert.match(fs.readFileSync(path.join(process.env.OUT_DIR, 'index.html'), 'utf8'), /Nothing new in the last 1 hour\./);
  assert.match(fs.readFileSync(path.join(process.env.OUT_DIR, 'section/fresh/index.html'), 'utf8'), /Thirty Hours Old/);
});

test('funny pages: compact panels share a row sized to equal heights; wide strips get their own', async (t) => {
  const { png } = require('./images');
  const sizes = { wide1: [1400, 450], panel1: [900, 1100], wide2: [1400, 430], panel2: [1000, 1000] };
  const server = http.createServer((req, res) => {
    const name = path.basename(req.url).replace(/\.(png|xml)$/, '');
    if (req.url.endsWith('.png') && sizes[name]) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from(png(...sizes[name]))); }
    if (req.url.endsWith('.xml') && sizes[name]) {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>${name}</title><link>https://x.example/</link><item><title>${name} - 2026-10-05</title><link>https://x.example/${name}</link><pubDate>Mon, 05 Oct 2026 00:00:00 GMT</pubDate><description><![CDATA[<img src="http://127.0.0.1:${server.address().port}/${name}.png">]]></description></item></channel></rss>`);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  config.save({
    feeds: Object.keys(sizes).map((id) => ({ id, name: 'Funny Pages', url: `${base}/${id}.xml`, type: 'comic', label: id, frontPage: false })),
  });
  require('../lib/feeds').clearCache();
  await build();
  const html = fs.readFileSync(path.join(process.env.OUT_DIR, 'section/funny-pages/index.html'), 'utf8');
  const rows = html.split('<div class="strip-row').slice(1);
  assert.equal(rows.length, 3, 'wide1 | panel1 + panel2 | wide2');
  assert.match(rows[0], /wide1\.png/);
  assert.doesNotMatch(rows[0], /table class="pair"/);
  assert.match(rows[1], /table class="pair"/);
  assert.ok(rows[1].indexOf('panel1') < rows[1].indexOf('panel2'));
  // 900x1100 (0.818) beside 1000x1000 (1.0): widths 45%/55% give equal heights.
  assert.match(rows[1], /class="pl" style="width:45\.00%"/);
  assert.match(rows[1], /class="pr" style="width:55\.00%"/);
  assert.match(rows[2], /wide2\.png/);
  assert.match(rows[2], /^ end"/, 'last row has no rule under it');
});

test('feeds that refuse unknown clients are retried as a browser, with a clear error if that fails', async (t) => {
  const rss = fs.readFileSync(path.join(__dirname, 'fixtures', 'rss.xml'));
  const seen = [];
  const server = http.createServer((req, res) => {
    const browser = /Mozilla/.test(req.headers['user-agent'] || '');
    seen.push(`${req.url} ${browser ? 'browser' : 'app'}`);
    if (req.url === '/picky') { res.writeHead(200, { 'Content-Type': 'text/xml' }); return res.end(browser ? rss : ''); }
    if (req.url === '/forbidden') { res.writeHead(browser ? 200 : 403); return res.end(browser ? rss : 'no'); }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><body>Access Denied</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const feeds = require('../lib/feeds');
  feeds.clearCache();
  const sections = await feeds.getEdition(config.normalize({ feeds: [
    { id: 'picky', name: 'Picky', url: `${base}/picky` },
    { id: 'forbidden', name: 'Forbidden', url: `${base}/forbidden` },
    { id: 'html', name: 'Html', url: `${base}/html` },
  ] }));
  const by = Object.fromEntries(sections.map((s) => [s.id, s]));
  assert.equal(by.picky.stories.length, 3, 'empty reply retried as a browser');
  assert.equal(by.forbidden.stories.length, 3, '403 retried as a browser');
  assert.match(by.html.sources[0].error, /Not an RSS or Atom feed.*starting “<html><body>Access Denied/);
  assert.ok(seen.includes('/picky app') && seen.includes('/picky browser'));
});
