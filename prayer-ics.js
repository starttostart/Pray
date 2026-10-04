/*
 * Prayer time computation and iCalendar (.ics) generation.
 *
 * Works as a plain browser script (exposes window.PrayerICS) and as a
 * CommonJS module for tests. Prayer times come from adhan-js, which is
 * passed in so this file has no hard dependency on how it was loaded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PrayerICS = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRAYERS = [
    { key: 'fajr', name: 'Fajr' },
    { key: 'dhuhr', name: 'Dhuhr' },
    { key: 'asr', name: 'Asr' },
    { key: 'maghrib', name: 'Maghrib' },
    { key: 'isha', name: 'Isha' },
  ];

  var METHODS = [
    { key: 'MuslimWorldLeague', label: 'Muslim World League' },
    { key: 'Egyptian', label: 'Egyptian General Authority of Survey' },
    { key: 'Karachi', label: 'University of Islamic Sciences, Karachi' },
    { key: 'UmmAlQura', label: 'Umm al-Qura University, Makkah' },
    { key: 'Dubai', label: 'Dubai' },
    { key: 'MoonsightingCommittee', label: 'Moonsighting Committee' },
    { key: 'NorthAmerica', label: 'ISNA (North America)' },
    { key: 'Kuwait', label: 'Kuwait' },
    { key: 'Qatar', label: 'Qatar' },
    { key: 'Singapore', label: 'Singapore' },
    { key: 'Tehran', label: 'Institute of Geophysics, Tehran' },
    { key: 'Turkey', label: 'Diyanet, Turkey' },
  ];

  // Parse "YYYY-MM-DD" into {y, m, d} without going through Date parsing,
  // which would treat the string as UTC and shift the day in some zones.
  function parseISODate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) throw new Error('Invalid date: ' + s);
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  // Calendar dates from start to end inclusive, as {y, m, d}.
  function dateRange(startISO, endISO) {
    var s = parseISODate(startISO);
    var e = parseISODate(endISO);
    var cur = Date.UTC(s.y, s.m - 1, s.d);
    var last = Date.UTC(e.y, e.m - 1, e.d);
    var out = [];
    while (cur <= last) {
      var dt = new Date(cur);
      out.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
      cur += 86400000;
    }
    return out;
  }

  function pad(n, w) {
    n = String(n);
    while (n.length < (w || 2)) n = '0' + n;
    return n;
  }

  function isoDay(day) {
    return day.y + '-' + pad(day.m) + '-' + pad(day.d);
  }

  // Day of week for a calendar date (0 = Sunday), independent of time zone.
  function weekday(day) {
    return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  }

  /*
   * Compute prayer times for every day in the range.
   * opts: { latitude, longitude, method, madhab, highLatitudeRule,
   *         startDate, endDate }
   * Returns [{ date: 'YYYY-MM-DD', weekday, times: { fajr: Date, ... } }]
   */
  function computeSchedule(adhan, opts) {
    var coords = new adhan.Coordinates(opts.latitude, opts.longitude);
    var params = adhan.CalculationMethod[opts.method || 'MuslimWorldLeague']();
    params.madhab = opts.madhab === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
    if (opts.highLatitudeRule && opts.highLatitudeRule !== 'auto') {
      params.highLatitudeRule = opts.highLatitudeRule;
    } else {
      params.highLatitudeRule = adhan.HighLatitudeRule.recommended(coords);
    }
    return dateRange(opts.startDate, opts.endDate).map(function (day) {
      // adhan reads the calendar day from the Date's local fields, so build it
      // from local components; the resulting prayer Dates are absolute instants.
      var pt = new adhan.PrayerTimes(coords, new Date(day.y, day.m - 1, day.d), params);
      var times = { sunrise: pt.sunrise };
      PRAYERS.forEach(function (p) {
        times[p.key] = pt[p.key];
      });
      return { date: isoDay(day), weekday: weekday(day), times: times };
    });
  }

  /*
   * Turn a schedule into a flat list of calendar events.
   * opts: { prayers: ['fajr', ...], durationMinutes, offsetMinutes,
   *         jumuah: { enabled, durationMinutes } }
   */
  function buildEvents(schedule, opts) {
    var selected = opts.prayers || PRAYERS.map(function (p) { return p.key; });
    var duration = opts.durationMinutes || 15;
    var offset = opts.offsetMinutes || 0;
    var jumuah = opts.jumuah || {};
    var events = [];
    schedule.forEach(function (day) {
      PRAYERS.forEach(function (p) {
        if (selected.indexOf(p.key) === -1) return;
        var t = day.times[p.key];
        if (!t || isNaN(t.getTime())) return;
        var name = p.name;
        var mins = duration;
        if (p.key === 'dhuhr' && day.weekday === 5 && jumuah.enabled) {
          name = "Jumu'ah";
          mins = jumuah.durationMinutes || 60;
        }
        var start = new Date(t.getTime() + offset * 60000);
        events.push({
          prayer: p.key,
          name: name,
          date: day.date,
          adhan: t,
          start: start,
          end: new Date(start.getTime() + mins * 60000),
        });
      });
    });
    return events;
  }

  // ---- iCalendar serialisation (RFC 5545) ----

  function icsDateTimeUTC(d) {
    return (
      d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
    );
  }

  function escapeText(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // Fold lines longer than 75 octets (UTF-8), continuation lines start with a space.
  function foldLine(line) {
    var bytes = 0;
    var out = '';
    var limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var code = line.charCodeAt(i);
      // Keep surrogate pairs together.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) {
        ch += line[++i];
      }
      var len = utf8Length(ch);
      if (bytes + len > limit) {
        out += '\r\n ';
        bytes = 1;
      }
      out += ch;
      bytes += len;
    }
    return out;
  }

  function utf8Length(ch) {
    var c = ch.codePointAt(0);
    if (c < 0x80) return 1;
    if (c < 0x800) return 2;
    if (c < 0x10000) return 3;
    return 4;
  }

  function slug(s) {
    return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /*
   * opts: { calendarName, locationName, latitude, longitude, timeZone,
   *         reminderMinutes, now, displayTime(date) -> string }
   */
  function toICS(events, opts) {
    var now = icsDateTimeUTC(opts.now || new Date());
    var calName = opts.calendarName || 'Prayer Times';
    var place = opts.locationName || (opts.latitude + ', ' + opts.longitude);
    var uidBase = slug(place) || 'location';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//starttostart//Pray//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapeText(calName),
    ];

    events.forEach(function (ev) {
      var adhanText = opts.displayTime ? opts.displayTime(ev.adhan) : ev.adhan.toISOString();
      var description = ev.name + ' prayer. Adhan at ' + adhanText + ' (' + place + ').';
      lines.push(
        'BEGIN:VEVENT',
        // Stable UID so re-importing the same day/prayer/place updates instead of duplicating.
        'UID:' + ev.date.replace(/-/g, '') + '-' + ev.prayer + '-' + uidBase + '@pray.starttostart',
        'DTSTAMP:' + now,
        'DTSTART:' + icsDateTimeUTC(ev.start),
        'DTEND:' + icsDateTimeUTC(ev.end),
        'SUMMARY:' + escapeText(ev.name + ' prayer'),
        'DESCRIPTION:' + escapeText(description),
        'LOCATION:' + escapeText(place),
        'CATEGORIES:Prayer',
        'CLASS:PUBLIC',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
        'X-MICROSOFT-CDO-INTENDEDSTATUS:BUSY'
      );
      if (opts.reminderMinutes > 0) {
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          'DESCRIPTION:' + escapeText(ev.name + ' prayer'),
          'TRIGGER:-PT' + Math.round(opts.reminderMinutes) + 'M',
          'END:VALARM'
        );
      }
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  return {
    PRAYERS: PRAYERS,
    METHODS: METHODS,
    dateRange: dateRange,
    computeSchedule: computeSchedule,
    buildEvents: buildEvents,
    toICS: toICS,
    _internal: { foldLine: foldLine, escapeText: escapeText, icsDateTimeUTC: icsDateTimeUTC },
  };
});
