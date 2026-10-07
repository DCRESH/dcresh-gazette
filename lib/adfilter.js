'use strict';
// Spots feed items that are advertisements rather than news: sportsbook
// promo/bonus-code posts, shopping "deals" round-ups, coupons and anything
// labelled sponsored. Betting *coverage* (odds, picks, lines) is not treated
// as an ad; only promotions are.

const SPORTSBOOKS = 'draftkings|fanduel|bet365|betmgm|caesars(?: sportsbook)?|fanatics(?: sportsbook)?|espn ?bet|hard ?rock ?bet|bally ?bet|betrivers|borgata|prizepicks|underdog(?: fantasy)?|sleeper|dabble|betr|pointsbet|sporttrade|kalshi|novig|thescore ?bet';

const TITLE_PATTERNS = [
  /\b(promo(tion(al)?)?|bonus|referral|discount|coupon|offer) codes?\b/i,
  /\bsign-?up (bonus|offer|promo)\b/i,
  /\b(bet \$?\d+,? get|get \$?\d+ in bonus|first[- ]bet (safety net|offer|bonus|insurance)|no[- ]sweat (bet|first))\b/i,
  new RegExp(`\\b(${SPORTSBOOKS})\\b.*\\b(promo|bonus|offer|code|sign[- ]?up|new user|welcome)\\b`, 'i'),
  /\b(sportsbook|betting|casino|dfs) (promos?|bonus(es)?|offers?|apps? review)\b/i,
  // Shopping round-ups. Not "best deals" / "top deals": sports coverage uses
  // those for trades and contracts.
  /\b(daily|today'?s|amazon|early black friday|holiday) deals?\b/i,
  /\bdeals? (of|for) the (day|week)\b/i,
  /\bdeals? (alert|roundup|round-up)\b/i,
  /\b\d{1,2}% off\b/i,
  /\bcoupons?\b/i,
  // Labelled ads. Not a bare "sponsored" ("state-sponsored hackers") or
  // "presented by" ("evidence presented by prosecutors").
  /^\s*(sponsored|advertisement|ad)\s*[:|\-\u2013\u2014]|\bsponsored (content|post|article|story)\b|\b(advertorial|paid (post|content)|partner content)\b/i,
  /\b(shop|buy) (now|the sale)\b|\bon sale (now|today)\b/i,
  /\b(prime (big )?day|black friday|cyber monday)\b.*\b(deals?|sales?)\b/i,
];

const CATEGORY_PATTERN = /^(sponsored|sponsored content|advertorial|advertisement|ad|ads|deals?|shopping|coupons?|partner( content)?|paid( content)?|commerce|affiliate)$/i;
const LINK_PATTERN = /\/(sponsored|advertorial|deals|shopping|coupons|promo-codes?|bonus-codes?)(\/|$|-)/i;

// User phrases: plain text matches anywhere in the headline (any case);
// "/pattern/" is a regular expression.
function compileExtra(list) {
  return (Array.isArray(list) ? list : []).map((p) => String(p || '').trim()).filter(Boolean).map((p) => {
    const m = /^\/(.+)\/([a-z]*)$/.exec(p);
    if (m) { try { return new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`); } catch { /* fall through to text */ } }
    return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  });
}

/** @returns {string|null} why the item looks like an ad, or null */
function adReason(item, { builtIn = true, extra = [] } = {}) {
  const title = item.title || '';
  for (const re of extra) if (re.test(title)) return `matches "${re.source}"`;
  if (!builtIn) return null;
  for (const re of TITLE_PATTERNS) if (re.test(title)) return 'promotional headline';
  if ((item.categories || []).some((c) => CATEGORY_PATTERN.test(String(c).trim()))) return 'sponsored category';
  if (item.link && LINK_PATTERN.test(new URL(item.link, 'http://x').pathname)) return 'deals/sponsored link';
  return null;
}

module.exports = { adReason, compileExtra };
