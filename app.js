(function () {
  'use strict';

  var P = window.PrayerICS;
  var MAX_DAYS = 400;
  var STORAGE_KEY = 'pray-settings-v1';

  // Common default calculation method by country (ISO 3166-1 alpha-2).
  var METHOD_BY_COUNTRY = {
    AE: 'Dubai', SA: 'UmmAlQura', EG: 'Egyptian', PK: 'Karachi', IN: 'Karachi',
    BD: 'Karachi', AF: 'Karachi', US: 'NorthAmerica', CA: 'NorthAmerica',
    KW: 'Kuwait', QA: 'Qatar', SG: 'Singapore', MY: 'Singapore', ID: 'Singapore',
    BN: 'Singapore', TR: 'Turkey', IR: 'Tehran', GB: 'MoonsightingCommittee',
  };

  var $ = function (id) { return document.getElementById(id); };
  var state = { placeName: '' };

  function init() {
    P.METHODS.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.key;
      o.textContent = m.label;
      $('method').appendChild(o);
    });

    P.PRAYERS.forEach(function (p) {
      var l = document.createElement('label');
      l.className = 'check';
      l.innerHTML = '<input type="checkbox" name="prayer" checked> ';
      l.firstChild.value = p.key;
      l.appendChild(document.createTextNode(p.name));
      $('prayers').appendChild(l);
    });

    if (Intl.supportedValuesOf) {
      Intl.supportedValuesOf('timeZone').forEach(function (z) {
        var o = document.createElement('option');
        o.value = z;
        $('tz-list').appendChild(o);
      });
    }

    var today = new Date();
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 29);
    $('start').value = localISO(today);
    $('end').value = localISO(end);
    $('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    restore();

    $('search').addEventListener('click', searchCity);
    $('city').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); searchCity(); }
    });
    $('geolocate').addEventListener('click', geolocate);
    $('form').addEventListener('submit', function (e) { e.preventDefault(); download(); });
    $('form').addEventListener('input', debounce(refreshPreview, 250));
    $('form').addEventListener('change', debounce(refreshPreview, 50));

    refreshPreview();
  }

  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ---- Location ----

  function searchCity() {
    var q = $('city').value.trim();
    if (!q) return;
    var list = $('results');
    list.hidden = false;
    list.innerHTML = '<li class="hint">Searching…</li>';
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' + encodeURIComponent(q))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        list.innerHTML = '';
        var results = data.results || [];
        if (!results.length) {
          list.innerHTML = '<li class="hint">No matches. Try another spelling or enter coordinates below.</li>';
          return;
        }
        results.forEach(function (r) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
          b.addEventListener('click', function () { pickPlace(r); });
          li.appendChild(b);
          list.appendChild(li);
        });
      })
      .catch(function (err) {
        list.innerHTML = '<li class="error">City search failed (' + err.message + '). Enter latitude, longitude and time zone instead.</li>';
      });
  }

  function pickPlace(r) {
    $('lat').value = round(r.latitude);
    $('lon').value = round(r.longitude);
    if (r.timezone) $('tz').value = r.timezone;
    if (r.country_code && METHOD_BY_COUNTRY[r.country_code]) $('method').value = METHOD_BY_COUNTRY[r.country_code];
    state.placeName = [r.name, r.country].filter(Boolean).join(', ');
    $('city').value = state.placeName;
    $('results').hidden = true;
    refreshPreview();
  }

  function geolocate() {
    if (!navigator.geolocation) { showError('Your browser cannot share its location. Enter coordinates instead.'); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      $('lat').value = round(pos.coords.latitude);
      $('lon').value = round(pos.coords.longitude);
      $('tz').value = Intl.DateTimeFormat().resolvedOptions().timeZone || $('tz').value;
      state.placeName = 'My location';
      $('city').value = '';
      refreshPreview();
    }, function (err) {
      showError('Could not get your location: ' + err.message);
    });
  }

  function round(x) { return Math.round(x * 10000) / 10000; }

  // ---- Reading the form ----

  function readOptions() {
    var lat = parseFloat($('lat').value);
    var lon = parseFloat($('lon').value);
    var tz = $('tz').value.trim();
    if (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lon) || lon < -180 || lon > 180) {
      throw new Error('Choose a city or enter a valid latitude and longitude.');
    }
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch (e) {
      throw new Error('"' + tz + '" is not a recognised time zone, for example Asia/Dubai.');
    }
    var start = $('start').value;
    var end = $('end').value;
    if (!start || !end) throw new Error('Choose a start and end date.');
    if (end < start) throw new Error('The end date is before the start date.');
    var days = P.dateRange(start, end).length;
    if (days > MAX_DAYS) throw new Error('Pick a range of ' + MAX_DAYS + ' days or fewer (you picked ' + days + ').');

    var prayers = Array.prototype.filter.call(document.querySelectorAll('input[name=prayer]'), function (c) { return c.checked; })
      .map(function (c) { return c.value; });

    return {
      latitude: lat,
      longitude: lon,
      timeZone: tz,
      method: $('method').value,
      madhab: $('madhab').value,
      highLatitudeRule: $('hlr').value,
      startDate: start,
      endDate: end,
      prayers: prayers,
      durationMinutes: num('duration', 15),
      offsetMinutes: num('offset', 0),
      reminderMinutes: num('reminder', 0),
      jumuah: { enabled: $('jumuah').checked, durationMinutes: num('jumuahDuration', 60) },
      placeName: state.placeName || $('city').value.trim() || (lat + ', ' + lon),
    };
  }

  function num(id, fallback) {
    var v = parseInt($(id).value, 10);
    return isNaN(v) ? fallback : Math.max(0, v);
  }

  function timeFormatter(tz) {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  }

  // ---- Preview and download ----

  function refreshPreview() {
    hideError();
    var opts;
    try { opts = readOptions(); } catch (e) {
      $('preview-section').hidden = true;
      $('summary').textContent = '';
      return;
    }
    save();
    var schedule = P.computeSchedule(adhan, opts);
    var fmt = timeFormatter(opts.timeZone);
    var t = function (d) { return d && !isNaN(d.getTime()) ? fmt.format(d) : '—'; };
    var rows = schedule.slice(0, 31).map(function (day) {
      var x = day.times;
      return '<tr><td>' + day.date + '</td><td>' + [x.fajr, x.sunrise, x.dhuhr, x.asr, x.maghrib, x.isha].map(t).join('</td><td>') + '</td></tr>';
    });
    if (schedule.length > 31) rows.push('<tr><td colspan="7" class="hint">…and ' + (schedule.length - 31) + ' more days</td></tr>');
    document.querySelector('#preview tbody').innerHTML = rows.join('');
    $('place').textContent = opts.placeName + ' · times shown in ' + opts.timeZone;
    $('preview-section').hidden = false;

    var count = P.buildEvents(schedule, opts).length;
    $('summary').textContent = count + ' events over ' + schedule.length + ' days';
  }

  function download() {
    hideError();
    var opts;
    try { opts = readOptions(); } catch (e) { showError(e.message); return; }
    if (!opts.prayers.length) { showError('Select at least one prayer.'); return; }

    var schedule = P.computeSchedule(adhan, opts);
    var events = P.buildEvents(schedule, opts);
    var fmt = timeFormatter(opts.timeZone);
    var ics = P.toICS(events, {
      calendarName: 'Prayer Times · ' + opts.placeName,
      locationName: opts.placeName,
      latitude: opts.latitude,
      longitude: opts.longitude,
      timeZone: opts.timeZone,
      reminderMinutes: opts.reminderMinutes,
      displayTime: function (d) { return fmt.format(d) + ' ' + opts.timeZone; },
    });

    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prayer-times-' + slug(opts.placeName) + '-' + opts.startDate + '-to-' + opts.endDate + '.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'location';
  }

  function showError(msg) { $('error').textContent = msg; $('error').hidden = false; }
  function hideError() { $('error').hidden = true; }

  // ---- Remember settings between visits ----

  var SAVED_FIELDS = ['lat', 'lon', 'tz', 'method', 'madhab', 'hlr', 'duration', 'offset', 'reminder', 'jumuahDuration'];

  function save() {
    try {
      var data = { placeName: state.placeName, city: $('city').value, jumuah: $('jumuah').checked, prayers: {} };
      SAVED_FIELDS.forEach(function (id) { data[id] = $(id).value; });
      document.querySelectorAll('input[name=prayer]').forEach(function (c) { data.prayers[c.value] = c.checked; });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable */ }
  }

  function restore() {
    var data;
    try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return; }
    if (!data) return;
    SAVED_FIELDS.forEach(function (id) { if (data[id] != null && data[id] !== '') $(id).value = data[id]; });
    $('city').value = data.city || '';
    $('jumuah').checked = data.jumuah !== false;
    state.placeName = data.placeName || '';
    document.querySelectorAll('input[name=prayer]').forEach(function (c) {
      if (data.prayers && c.value in data.prayers) c.checked = data.prayers[c.value];
    });
  }

  init();
})();
