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
    for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      assert.ok(href.startsWith('/my-paper/'), `${href} in ${f} is under the base path`);
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
  assert.match(front, /href="\/my-paper\/section\/atom\/"/, 'section still linked in the nav');

  // Feeds sharing a name form one section with one nav link.
  const local = fs.readFileSync(path.join(out, 'section/local/index.html'), 'utf8');
  assert.match(local, /Council Approves/);
  assert.match(local, /Caf\u00e9 opens downtown/);
  assert.equal((front.match(/section\/local\//g) || []).length, 1, 'one nav link for the merged section');
  assert.ok(!fs.existsSync(path.join(out, 'section/local-cafe')), 'no separate section for the merged feed');
  for (const f of fronts) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /Caf\u00e9 opens/, 'frontPage: false applies per feed');
  assert.match(front, /Edit feeds/);
  assert.match(front, /Printed /);
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
