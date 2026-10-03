'use strict';
// A small, forgiving XML parser – enough for real-world RSS / Atom / RDF feeds,
// which are frequently not well-formed. No dependencies.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', bull: '\u2022',
  middot: '\u00b7', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  laquo: '\u00ab', raquo: '\u00bb', deg: '\u00b0', euro: '\u20ac',
  pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', sect: '\u00a7',
  para: '\u00b6', times: '\u00d7', divide: '\u00f7', frac12: '\u00bd',
  frac14: '\u00bc', frac34: '\u00be', eacute: '\u00e9', egrave: '\u00e8',
  aacute: '\u00e1', agrave: '\u00e0', iacute: '\u00ed', oacute: '\u00f3',
  uacute: '\u00fa', ntilde: '\u00f1', ccedil: '\u00e7', uuml: '\u00fc',
  ouml: '\u00f6', auml: '\u00e4', szlig: '\u00df', Eacute: '\u00c9',
  thinsp: '\u2009', ensp: '\u2002', emsp: '\u2003', shy: '\u00ad',
  zwj: '\u200d', zwnj: '\u200c', iexcl: '\u00a1', iquest: '\u00bf',
};

function decodeEntities(str) {
  if (!str || str.indexOf('&') === -1) return str || '';
  return str.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!code || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}

const TOKEN = new RegExp([
  '<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>',                 // 1 cdata
  '<!--[\\s\\S]*?-->',                                // comment
  '<\\?[\\s\\S]*?\\?>',                               // processing instruction
  '<!DOCTYPE(?:[^>\\[]|\\[[\\s\\S]*?\\])*>',          // doctype
  '<\\/\\s*([^\\s>]+)\\s*>',                          // 2 close tag
  '<([A-Za-z_][^\\s>\\/]*)((?:\\s+[^\\s=>\\/]+(?:\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s>]+))?)*)\\s*(\\/?)>', // 3 name 4 attrs 5 self-close
  '([^<]+)',                                          // 6 text
  '(<)',                                              // 7 stray "<"
].join('|'), 'g');

const ATTR = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src) {
  const attrs = {};
  if (!src) return attrs;
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(src))) {
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[m[1].toLowerCase()] = decodeEntities(v);
  }
  return attrs;
}

function makeNode(name, attrs) {
  return { name, attrs, children: [], text: '' };
}

function parse(xml) {
  const root = makeNode('#document', {});
  const stack = [root];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
      top.children.push({ name: '#text', text: m[1] });
    } else if (m[2] !== undefined) {
      const name = m[2].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
    } else if (m[3] !== undefined) {
      const node = makeNode(m[3].toLowerCase(), parseAttrs(m[4]));
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const t = decodeEntities(m[6] !== undefined ? m[6] : m[7]);
      top.text += t;
      top.children.push({ name: '#text', text: t });
    }
  }
  return root;
}

// ---- tree helpers -------------------------------------------------------

function elements(node) {
  return node && node.children ? node.children.filter((c) => c.name !== '#text') : [];
}

function child(node, ...names) {
  if (!node || !node.children) return null;
  for (const n of names) {
    const found = node.children.find((c) => c.name === n);
    if (found) return found;
  }
  return null;
}

function childrenNamed(node, name) {
  return node && node.children ? node.children.filter((c) => c.name === name) : [];
}

function text(node) {
  return node ? node.text.trim() : '';
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Re-serialise a node's children (used for Atom type="xhtml" content).
function innerXml(node) {
  if (!node || !node.children) return '';
  return node.children.map((c) => {
    if (c.name === '#text') return escapeXml(c.text);
    const name = c.name.replace(/^[a-z0-9]+:/, '');
    const attrs = Object.keys(c.attrs).map((k) => ` ${k}="${escapeXml(c.attrs[k])}"`).join('');
    return `<${name}${attrs}>${innerXml(c)}</${name}>`;
  }).join('');
}

module.exports = { parse, decodeEntities, elements, child, childrenNamed, text, innerXml };
