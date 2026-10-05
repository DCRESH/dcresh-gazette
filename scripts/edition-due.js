'use strict';
// Used by the scheduled workflow: prints publish=true|false for $GITHUB_OUTPUT.
// Reads when the live paper was last printed from its edition.json and
// compares it with the most recent edition time (EDITION_HOURS in TZ).
//
//   EDITION_HOURS='hourly' (or '6 18') TZ=America/New_York GITHUB_REPOSITORY=owner/repo node scripts/edition-due.js
//   PAGES_URL overrides the site address (default https://<owner>.github.io/<repo>/).

const { editionDue, parseEditionHours } = require('../lib/schedule');

async function lastPrinted(url) {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const t = Date.parse((await res.json()).printedAt);
    return Number.isNaN(t) ? null : t;
  } catch {
    return null; // can't tell: publish, which is the safe choice
  }
}

(async () => {
  const hours = parseEditionHours(process.env.EDITION_HOURS) || parseEditionHours('hourly');
  const timeZone = process.env.TZ || 'UTC';
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');
  const site = process.env.PAGES_URL || (/\.github\.io$/i.test(repo) ? `https://${owner.toLowerCase()}.github.io/` : `https://${owner.toLowerCase()}.github.io/${repo}/`);
  const printed = await lastPrinted(new URL('edition.json', site).href);
  const { due, slot } = editionDue({ hours, timeZone, lastPrinted: printed });
  const fmt = (t) => (t ? new Date(t).toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  console.error(`Last printed: ${fmt(printed)}; most recent edition time: ${fmt(slot)} (${timeZone}) -> ${due ? 'publish' : 'up to date'}`);
  console.log(`publish=${due}`);
})();
