// storage.js — data model + persistence. UMD like paymath.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Store = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY = 'ce-timesheets';

  function emptyData() { return { version: 1, pin: null, workers: [], entries: {} }; }

  function isMinutes(v) { return Number.isInteger(v) && v >= 0 && v <= 1439; }

  // Optional top-level lunch-length setting. Missing (legacy data, or a fresh
  // install that never touched Settings) reads as 30 — the long-standing
  // default — so old and new installs behave identically until the owner
  // explicitly changes it.
  function lunchDefault(data) {
    return Number.isInteger(data.lunchMinutes) ? data.lunchMinutes : 30;
  }

  // Fail-closed validation: returns the parsed data only if every level of the
  // shape checks out; returns null for anything else. Must NEVER throw — this
  // guards both file imports and every app boot via load().
  function validateImport(text) {
    let d;
    try { d = JSON.parse(text); } catch { return null; }
    try {
      if (!d || typeof d !== 'object' || Array.isArray(d) || d.version !== 1) return null;
      if (d.pin !== null && !(typeof d.pin === 'string' && /^\d{4}$/.test(d.pin))) return null;
      if (!Array.isArray(d.workers)) return null;
      if (typeof d.entries !== 'object' || d.entries === null || Array.isArray(d.entries)) return null;
      if (d.lunchMinutes !== undefined && !(Number.isInteger(d.lunchMinutes) && d.lunchMinutes >= 0 && d.lunchMinutes <= 240)) return null;
      const ids = new Set();
      for (const w of d.workers) {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
        if (typeof w.id !== 'string' || w.id === '' || typeof w.name !== 'string') return null;
        if (ids.has(w.id)) return null;
        ids.add(w.id);
        if (w.rate != null && !(typeof w.rate === 'number' && isFinite(w.rate) && w.rate >= 0)) return null;
        if (w.usualStart != null && !isMinutes(w.usualStart)) return null;
      }
      for (const [workerId, days] of Object.entries(d.entries)) {
        if (!ids.has(workerId)) return null;
        if (!days || typeof days !== 'object' || Array.isArray(days)) return null;
        for (const [date, e] of Object.entries(days)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
          if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
          if (!isMinutes(e.start) || !isMinutes(e.end) || e.end <= e.start) return null;
          if (e.lunch !== undefined && !(Number.isInteger(e.lunch) && e.lunch >= 0 && e.lunch <= 240)) return null;
        }
      }
      return d;
    } catch { return null; }
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
      if (e && e.end > e.start) total += Math.max(0, (e.end - e.start) - (e.lunch || 0));
    }
    return total;
  }

  // Ascending list of `weeksBack` Mondays ending with the Monday of refIso
  // (i.e. mondayOf(refIso) going back weeksBack-1 more weeks). Shared by
  // lateDays/missedDays so both walk the exact same window.
  function weeksBackList(refIso, weeksBack) {
    const lastMonday = mondayOf(refIso);
    const out = [];
    for (let i = weeksBack - 1; i >= 0; i--) {
      const dt = new Date(lastMonday + 'T12:00:00');
      dt.setDate(dt.getDate() - i * 7);
      out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  }

  // Days in the last `weeksBack` full weeks (Mon..Sun, ending with the week
  // containing refIso) where the worker's entry started more than graceMin
  // minutes after usualStart. Returns [{date, start}] sorted ascending.
  // usualStart null -> [].
  function lateDays(data, workerId, usualStart, refIso, weeksBack, graceMin) {
    if (usualStart == null) return [];
    const days = data.entries[workerId] || {};
    const out = [];
    weeksBackList(refIso, weeksBack).forEach((monday) => {
      weekDates(monday).forEach((date) => {
        const e = days[date];
        if (e && e.start > usualStart + graceMin) out.push({ date, start: e.start });
      });
    });
    return out;
  }

  // Weekdays (Mon-Fri) in the last `weeksBack` full weeks up to the week of
  // refIso where this worker has NO entry but at least one OTHER worker has
  // an entry that day. Days after refIso (future) are excluded. Returns
  // [date, ...] ascending.
  //
  // Floored at the worker's own earliest recorded entry: a day before the
  // worker's first recorded entry is unknowable (new hire, or the app was
  // adopted mid-employment), not missed. A worker with no entries at all has
  // no floor to compute from, so nothing can ever be flagged for them.
  function missedDays(data, workerId, refIso, weeksBack) {
    const own = data.entries[workerId] || {};
    const ownDates = Object.keys(own);
    if (ownDates.length === 0) return [];
    const firstDate = ownDates.reduce((min, d) => (d < min ? d : min));

    const out = [];
    weeksBackList(refIso, weeksBack).forEach((monday) => {
      const dates = weekDates(monday);
      for (let i = 0; i < 5; i++) {
        const date = dates[i];
        if (date > refIso) continue;
        if (date < firstDate) continue;
        if (own[date]) continue;
        const othersWorked = Object.keys(data.entries).some(
          (id) => id !== workerId && data.entries[id] && data.entries[id][date]
        );
        if (othersWorked) out.push(date);
      }
    });
    return out;
  }

  // browser-only persistence (skipped under Node)
  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
      return raw ? (validateImport(raw) || emptyData()) : emptyData();
    } catch { return emptyData(); }
  }
  function save(data) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // localStorage full or unavailable (e.g. private browsing) — swallow so
      // the app keeps running on its in-memory state instead of crashing.
    }
  }

  return { emptyData, validateImport, lunchDefault, mondayOf, weekDates, weekMinutes, lateDays, missedDays, load, save, KEY };
});
