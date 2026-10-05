'use strict';
// Reads an image's pixel size from the start of the file (PNG, GIF, JPEG,
// WebP) without downloading the whole thing or decoding it. Used to lay out
// the funny pages.

function u16be(b, i) { return (b[i] << 8) | b[i + 1]; }
function u16le(b, i) { return b[i] | (b[i + 1] << 8); }
function u24le(b, i) { return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16); }
function u32be(b, i) { return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]; }

/**
 * @param {Uint8Array} b the first bytes of an image
 * @returns {{width:number, height:number}|null} null if unknown or more bytes are needed
 */
function parseSize(b) {
  if (!b || b.length < 10) return null;
  // PNG: signature, then the IHDR chunk.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return b.length >= 24 ? { width: u32be(b, 16), height: u32be(b, 20) } : null;
  }
  // GIF87a / GIF89a: logical screen size.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: u16le(b, 6), height: u16le(b, 8) };
  }
  // WebP: RIFF....WEBP then VP8 / VP8L / VP8X.
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
      }
      i += 2 + len;
    }
    return null; // need more bytes
  }
  return null;
}

const MAX_BYTES = 512 * 1024; // big EXIF blocks can push a JPEG's size past the first 64 KB
const cache = new Map();      // url -> Promise<{width,height}|null>

// Fetch just enough of the image to read its size. Never throws.
function imageSize(url, { timeoutMs = 10000 } = {}) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return cache.get(url);
  const result = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'KindleGazette/1.0', Range: 'bytes=0-65535' } });
      if (!res.ok || !res.body) return null;
      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (value) {
          const next = new Uint8Array(buf.length + value.length);
          next.set(buf); next.set(value, buf.length); buf = next;
          const size = parseSize(buf);
          if (size && size.width > 0 && size.height > 0) { ctrl.abort(); return size; }
        }
        if (done || buf.length >= MAX_BYTES) break;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(url, result);
  return result;
}

module.exports = { parseSize, imageSize };
