'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { zonedTime, lastEditionTime, editionDue } = require('../lib/schedule');

const NY = 'America/New_York';
const iso = (t) => new Date(t).toISOString();

test('zonedTime handles daylight saving', () => {
  assert.equal(iso(zonedTime(2026, 10, 5, 6, NY)), '2026-10-05T10:00:00.000Z'); // EDT
  assert.equal(iso(zonedTime(2026, 12, 5, 6, NY)), '2026-12-05T11:00:00.000Z'); // EST
  assert.equal(iso(zonedTime(2026, 11, 1, 18, NY)), '2026-11-01T23:00:00.000Z'); // the day DST ends
});

test('the most recent edition time', () => {
  const at = (s) => Date.parse(s);
  assert.equal(iso(lastEditionTime([6, 18], NY, at('2026-10-05T13:42:00Z'))), '2026-10-05T10:00:00.000Z'); // 9:42 AM -> 6 AM
  assert.equal(iso(lastEditionTime([6, 18], NY, at('2026-10-05T23:00:00Z'))), '2026-10-05T22:00:00.000Z'); // 7 PM -> 6 PM
  assert.equal(iso(lastEditionTime([6, 18], NY, at('2026-10-05T08:00:00Z'))), '2026-10-04T22:00:00.000Z'); // 4 AM -> yesterday 6 PM
});

test('an edition is due until the paper has been printed since the last edition time', () => {
  const now = Date.parse('2026-10-05T13:42:00Z'); // 9:42 AM New York
  const base = { hours: [6, 18], timeZone: NY, now };
  // Last printed 10:34 PM yesterday; the 6 AM edition is missing (the run was late or skipped).
  assert.equal(editionDue({ ...base, lastPrinted: Date.parse('2026-10-05T02:34:00Z') }).due, true);
  // Printed at 6:20 AM today: up to date until 6 PM.
  assert.equal(editionDue({ ...base, lastPrinted: Date.parse('2026-10-05T10:20:00Z') }).due, false);
  // Unknown (no edition.json yet): publish.
  assert.equal(editionDue({ ...base, lastPrinted: null }).due, true);
});

test('the masthead names the edition after the most recent edition time', () => {
  const { editionInfo } = require('../build');
  const saved = { h: process.env.EDITION_HOURS, tz: process.env.TZ };
  process.env.EDITION_HOURS = '6 18';
  process.env.TZ = NY;
  try {
    const name = (s) => editionInfo(Date.parse(s)).editionName;
    assert.equal(name('2026-10-05T13:44:00Z'), 'Morning Edition'); // 9:44 AM
    assert.equal(name('2026-10-05T18:00:00Z'), 'Morning Edition'); // 2 PM: still the morning edition
    assert.equal(name('2026-10-05T22:30:00Z'), 'Evening Edition'); // 6:30 PM
    assert.equal(name('2026-10-06T07:00:00Z'), 'Evening Edition'); // 3 AM: still last evening's
    assert.equal(editionInfo(Date.parse('2026-10-05T13:44:00Z')).scheduleNote, 'New editions at 6 AM and 6 PM');
  } finally {
    if (saved.h === undefined) delete process.env.EDITION_HOURS; else process.env.EDITION_HOURS = saved.h;
    if (saved.tz === undefined) delete process.env.TZ; else process.env.TZ = saved.tz;
  }
});
