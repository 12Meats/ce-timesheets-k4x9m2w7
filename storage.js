// storage.js — data model + persistence. UMD like paymath.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'ce-timesheets';

  function emptyData() { return { version: 1, pin: null, workers: [], entries: {} }; }

  function validateImport(text) {
    let d;
    try { d = JSON.parse(text); } catch { return null; }
    if (!d || d.version !== 1) return null;
    if (!('pin' in d) || !Array.isArray(d.workers) || typeof d.entries !== 'object' || d.entries === null) return null;
    for (const w of d.workers) {
      if (typeof w.id !== 'string' || typeof w.name !== 'string') return null;
    }
    for (const days of Object.values(d.entries)) {
      for (const e of Object.values(days)) {
        if (typeof e.start !== 'number' || typeof e.end !== 'number') return null;
      }
    }
    return d;
  }

  // date math on ISO strings, timezone-safe (construct at noon to dodge DST edges)
  function mondayOf(iso) {
    const dt = new Date(iso + 'T12:00:00');
    const shift = (dt.getDay() + 6) % 7;          // Mon=0 .. Sun=6
    dt.setDate(dt.getDate() - shift);
    return dt.toISOString().slice(0, 10);
  }
  function weekDates(mondayIso) {
    const out = [];
    const dt = new Date(mondayIso + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      out.push(dt.toISOString().slice(0, 10));
      dt.setDate(dt.getDate() + 1);
    }
    return out;
  }
  function weekMinutes(data, workerId, mondayIso) {
    const days = data.entries[workerId] || {};
    let total = 0;
    for (const date of weekDates(mondayIso)) {
      const e = days[date];
      if (e && e.end > e.start) total += e.end - e.start;
    }
    return total;
  }

  // browser-only persistence (skipped under Node)
  function load() {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
    return raw ? (validateImport(raw) || emptyData()) : emptyData();
  }
  function save(data) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(data));
  }

  return { emptyData, validateImport, mondayOf, weekDates, weekMinutes, load, save, KEY };
});
