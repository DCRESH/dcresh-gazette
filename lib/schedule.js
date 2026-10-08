'use strict';
// When is an edition due? Editions are printed at set local hours: every hour
// by default, or chosen hours such as 6 AM and 6 PM (EDITION_HOURS).
// GitHub's scheduler can run hours late or skip runs, so instead of checking
// "is it the edition hour now?" we check "has the most recent edition time
// passed since the paper was last printed?".

// The UTC instant of a wall-clock time (y-m-d h:00) in a time zone.
function zonedTime(y, m, d, h, timeZone) {
  let t = Date.UTC(y, m - 1, d, h);
  // Correct for the zone's offset; twice to settle across DST changes.
  for (let i = 0; i < 2; i++) {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(t)) p[part.type] = +part.value;
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += Date.UTC(y, m - 1, d, h) - seen;
  }
  return t;
}

// The most recent scheduled edition time at or before `now`.
function lastEditionTime(hours, timeZone, now = Date.now()) {
  let best = null;
  for (let back = 0; back <= 2; back++) {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now - back * 86400000)) p[part.type] = +part.value;
    for (const h of hours) {
      const t = zonedTime(p.year, p.month, p.day, h, timeZone);
      if (t <= now && (best === null || t > best)) best = t;
    }
  }
  return best;
}

// Due when nothing has been printed since the most recent edition time.
function editionDue({ hours, timeZone, lastPrinted, now = Date.now() }) {
  const slot = lastEditionTime(hours, timeZone, now);
  return { due: !lastPrinted || (slot !== null && lastPrinted < slot), slot };
}

// EDITION_HOURS: "6 18" (local hours) or "hourly" (every hour).
function parseEditionHours(value) {
  if (/^\s*(hourly|every hour|\*)\s*$/i.test(value || '')) return Array.from({ length: 24 }, (_, h) => h);
  const hours = (value || '').match(/\d+/g);
  return hours ? [...new Set(hours.map(Number).filter((h) => h >= 0 && h < 24))].sort((a, b) => a - b) : null;
}

module.exports = { parseEditionHours, zonedTime, lastEditionTime, editionDue };
