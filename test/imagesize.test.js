'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { parseSize, imageSize } = require('../lib/imagesize');

const { png, gif, jpeg, webpX } = require('./images');

test('reads image sizes from file headers', () => {
  assert.deepEqual(parseSize(png(1400, 450)), { width: 1400, height: 450 });
  assert.deepEqual(parseSize(gif(600, 800)), { width: 600, height: 800 });
  assert.deepEqual(parseSize(jpeg(900, 1100)), { width: 900, height: 1100 });
  assert.deepEqual(parseSize(webpX(1200, 1000)), { width: 1200, height: 1000 });
  assert.equal(parseSize(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])), null);
  assert.equal(parseSize(jpeg(900, 1100).slice(0, 20)), null, 'truncated JPEG needs more bytes');
});

test('imageSize fetches only what it needs and never throws', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/a.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from(jpeg(800, 1000))); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await imageSize(`${base}/a.jpg`), { width: 800, height: 1000 });
  assert.equal(await imageSize(`${base}/missing.png`), null);
  assert.equal(await imageSize('http://127.0.0.1:9/nothing.png'), null);
});

