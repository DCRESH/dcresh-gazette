'use strict';
// When is an edition due? Editions are printed at fixed local hours (e.g. 6 AM
// and 6 PM). GitHub's scheduler can run hours late or skip runs, so instead of
// checking "is it 6 o'clock now?" we check "has the most recent edition time
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

module.exports = { zonedTime, lastEditionTime, editionDue };
