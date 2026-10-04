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
    feeds: [{ id: 'local', name: 'Local', url: `${base}/rss.xml` }, { id: 'atom', name: 'Atom', url: `${base}/atom.xml` }],
  });

  await build();
  const out = process.env.OUT_DIR;
  for (const f of ['index.html', 'page/2/index.html', 'section/local/index.html', 'section/atom/index.html', '404.html', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} exists`);
  }

  // Every internal link resolves to a generated file.
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
    (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') && files.push(path.join(d, e.name))));
  walk(out);
  assert.ok(files.length >= 10);
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
