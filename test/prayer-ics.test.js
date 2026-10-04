const test = require('node:test');
const assert = require('node:assert');
const adhan = require('../vendor/adhan.umd.min.js');
const P = require('../prayer-ics.js');

const dubai = {
  latitude: 25.2048,
  longitude: 55.2708,
  method: 'Dubai',
  madhab: 'shafi',
  startDate: '2026-10-01',
  endDate: '2026-10-07',
};

function hhmm(d, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

test('dateRange is inclusive and crosses month ends', () => {
  const r = P.dateRange('2026-01-30', '2026-02-02');
  assert.deepStrictEqual(r.map((d) => `${d.m}-${d.d}`), ['1-30', '1-31', '2-1', '2-2']);
});

test('computeSchedule gives ordered prayer times on the right local day', () => {
  const s = P.computeSchedule(adhan, dubai);
  assert.strictEqual(s.length, 7);
  for (const day of s) {
    const t = day.times;
    assert.ok(t.fajr < t.sunrise && t.sunrise < t.dhuhr && t.dhuhr < t.asr && t.asr < t.maghrib && t.maghrib < t.isha, day.date);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(t.dhuhr);
    assert.strictEqual(local, day.date);
  }
  // Dubai in early October: Dhuhr around 12:10, Maghrib around 18:10 local.
  assert.match(hhmm(s[0].times.dhuhr, 'Asia/Dubai'), /^12:(0|1)\d$/);
  assert.match(hhmm(s[0].times.maghrib, 'Asia/Dubai'), /^18:(0|1)\d$/);
});

test('Hanafi Asr is later than standard Asr', () => {
  const std = P.computeSchedule(adhan, dubai)[0].times.asr;
  const han = P.computeSchedule(adhan, { ...dubai, madhab: 'hanafi' })[0].times.asr;
  assert.ok(han > std);
});

test('buildEvents applies selection, duration, offset and Jumuah', () => {
  const s = P.computeSchedule(adhan, dubai);
  const ev = P.buildEvents(s, {
    prayers: ['dhuhr', 'maghrib'],
    durationMinutes: 20,
    offsetMinutes: 5,
    jumuah: { enabled: true, durationMinutes: 60 },
  });
  assert.strictEqual(ev.length, 14);
  const fri = ev.find((e) => e.date === '2026-10-02' && e.prayer === 'dhuhr'); // 2 Oct 2026 is a Friday
  assert.strictEqual(fri.name, "Jumu'ah");
  assert.strictEqual(fri.end - fri.start, 60 * 60000);
  const mag = ev.find((e) => e.prayer === 'maghrib');
  assert.strictEqual(mag.start - mag.adhan, 5 * 60000);
  assert.strictEqual(mag.end - mag.start, 20 * 60000);
});

test('toICS produces valid, Outlook-friendly iCalendar', async () => {
  const ICAL = (await import('ical.js')).default;
  const s = P.computeSchedule(adhan, dubai);
  const ev = P.buildEvents(s, { durationMinutes: 15, jumuah: { enabled: true } });
  const ics = P.toICS(ev, {
    calendarName: 'Prayer Times · Dubai, United Arab Emirates',
    locationName: 'Dubai, United Arab Emirates',
    timeZone: 'Asia/Dubai',
    reminderMinutes: 10,
    now: new Date('2026-10-01T00:00:00Z'),
    displayTime: (d) => hhmm(d, 'Asia/Dubai') + ' Asia/Dubai',
  });

  // CRLF line endings and no line over 75 octets.
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF found');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);

  const cal = new ICAL.Component(ICAL.parse(ics));
  assert.strictEqual(cal.getFirstPropertyValue('version'), '2.0');
  assert.strictEqual(cal.getFirstPropertyValue('method'), 'PUBLISH');
  const vevents = cal.getAllSubcomponents('vevent');
  assert.strictEqual(vevents.length, 35);
  const uids = new Set(vevents.map((v) => v.getFirstPropertyValue('uid')));
  assert.strictEqual(uids.size, 35);

  const first = vevents[0];
  assert.strictEqual(first.getFirstPropertyValue('transp'), 'OPAQUE');
  assert.strictEqual(first.getFirstPropertyValue('x-microsoft-cdo-busystatus'), 'BUSY');
  assert.strictEqual(first.getFirstPropertyValue('summary'), 'Fajr prayer');
  assert.strictEqual(first.getFirstPropertyValue('location'), 'Dubai, United Arab Emirates');
  const start = first.getFirstPropertyValue('dtstart').toJSDate();
  assert.strictEqual(start.getTime(), s[0].times.fajr.getTime() - (s[0].times.fajr.getTime() % 1000));
  const alarm = first.getFirstSubcomponent('valarm');
  assert.strictEqual(alarm.getFirstPropertyValue('action'), 'DISPLAY');
  assert.strictEqual(alarm.getFirstPropertyValue('trigger').toICALString(), '-PT10M');

  const jumuah = vevents.find((v) => v.getFirstPropertyValue('summary') === "Jumu'ah prayer");
  assert.ok(jumuah);
});

test('toICS omits the alarm when reminder is 0 and escapes text', () => {
  const s = P.computeSchedule(adhan, { ...dubai, endDate: dubai.startDate });
  const ev = P.buildEvents(s, { prayers: ['fajr'] });
  const ics = P.toICS(ev, { locationName: 'Test; place, with\\chars', reminderMinutes: 0 });
  assert.ok(!ics.includes('BEGIN:VALARM'));
  assert.ok(ics.includes('LOCATION:Test\\; place\\, with\\\\chars'));
});

test('foldLine keeps multi-byte characters intact', () => {
  const line = 'SUMMARY:' + 'صلاة الفجر '.repeat(10);
  const folded = P._internal.foldLine(line);
  for (const part of folded.split('\r\n')) assert.ok(Buffer.byteLength(part) <= 75);
  assert.strictEqual(folded.replace(/\r\n /g, ''), line);
});
