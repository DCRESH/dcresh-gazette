'use strict';
// Minimal image file headers for tests: just enough bytes for each format's size fields.

const be16 = (n) => [(n >> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >> 8) & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

const png = (w, h) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
const gif = (w, h) => Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(w), ...le16(h), 0, 0, 0]);
const jpeg = (w, h) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...new Array(14).fill(0), 0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, ...new Array(9).fill(0)]);
const webpX = (w, h) => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0,
  (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255]);

module.exports = { png, gif, jpeg, webpX };
