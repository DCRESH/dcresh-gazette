'use strict';
// Turns arbitrary feed HTML into a small, safe subset that renders well on an
// e-ink browser: no scripts, no styles, no iframes, no inline layout.

const { decodeEntities } = require('./xml');

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Elements whose *content* is dropped entirely.
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math',
  'form', 'button', 'select', 'textarea', 'input', 'video', 'audio', 'canvas', 'head', 'title', 'template', 'picture']);

// Allowed elements (others are unwrapped, keeping their text).
const ALLOW = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'blockquote', 'q', 'cite',
  'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'img', 'hr', 'pre', 'code', 'sub', 'sup',
  'table', 'tr', 'td', 'th', 'tbody', 'thead', 'dl', 'dt', 'dd', 'small', 'figure', 'figcaption']);

const VOID = new Set(['br', 'img', 'hr']);
const REMAP = { h1: 'h2', h5: 'h4', h6: 'h4', div: 'p', section: 'p', article: 'p', main: 'p', header: 'p', footer: 'p', aside: 'blockquote' };

const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)|(<)/g;
const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function attrsOf(src) {
  const out = {};
  if (!src) return out;
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(src))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function safeUrl(url, base) {
  if (!url) return null;
  try {
    const u = new URL(url.trim(), base || undefined);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

// Tracking pixels and social-share buttons are noise on paper.
function isJunkImage(a) {
  const w = parseInt(a.width, 10), h = parseInt(a.height, 10);
  if ((w && w < 40) || (h && h < 40)) return true;
  return /feedburner|doubleclick|pixel|tracking|share|gravatar|emoji|\.gif(\?|$)/i.test(a.src || '');
}

/**
 * @param {string} html
 * @param {{base?: string, images?: boolean, imageUrl?: (src:string)=>string}} opts
 */
function sanitize(html, opts = {}) {
  if (!html) return '';
  const out = [];
  const open = [];
  let dropDepth = 0, dropTag = null;
  let m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1] !== undefined) { if (!dropDepth) out.push(escapeHtml(m[1])); continue; }
    if (m[5] !== undefined || m[6] !== undefined) {
      if (!dropDepth) out.push(escapeHtml(decodeEntities(m[5] ?? m[6])));
      continue;
    }
    const closing = m[2] === '/';
    let tag = m[3].toLowerCase();

    if (dropDepth) {
      if (tag === dropTag) dropDepth += closing ? -1 : (/\/>$/.test(m[0]) ? 0 : 1);
      continue;
    }
    if (DROP.has(tag)) {
      if (!closing && !/\/>$/.test(m[0])) { dropDepth = 1; dropTag = tag; }
      continue;
    }
    tag = REMAP[tag] || tag;
    if (!ALLOW.has(tag)) continue;

    if (closing) {
      if (VOID.has(tag)) continue;
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue;
      while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }

    const a = attrsOf(m[4]);
    if (tag === 'a') {
      const href = safeUrl(a.href, opts.base);
      out.push(href ? `<a href="${escapeHtml(href)}">` : '<a>');
      open.push('a');
    } else if (tag === 'img') {
      const src = safeUrl(a.src || a['data-src'], opts.base);
      if (opts.images && src && !isJunkImage({ ...a, src })) {
        const shown = opts.imageUrl ? opts.imageUrl(src) : src;
        out.push(`<img src="${escapeHtml(shown)}" alt="${escapeHtml(a.alt || '')}">`);
      }
    } else if (VOID.has(tag)) {
      out.push(`<${tag}>`);
    } else {
      // Don't nest paragraphs: close an open <p> before starting a new one.
      if (tag === 'p' && open[open.length - 1] === 'p') out.push(`</${open.pop()}>`);
      out.push(`<${tag}>`);
      open.push(tag);
    }
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('')
    .replace(/<p>\s*(?:<br>\s*)*<\/p>/g, '')
    .replace(/(?:<br>\s*){3,}/g, '<br><br>')
    .trim();
}

/** Plain text, whitespace-collapsed. */
function toText(html) {
  if (!html) return '';
  const s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|iframe|noscript|svg|figcaption)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<\/?(p|div|br|li|h\d|blockquote|tr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.—-]+$/, '') + '…';
}

/** Wrap plain text (no tags) into paragraphs. */
function textToHtml(text) {
  return String(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

module.exports = { sanitize, toText, truncate, escapeHtml, safeUrl, textToHtml };
