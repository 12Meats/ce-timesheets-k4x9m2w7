// paymath.js — pure payroll math. UMD-style: browser global + node module.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // digits: what the user typed ("630", "3", "1400"); meridiem: "AM" | "PM" | null (null = 24h entry)
  function parseTimeDigits(digits, meridiem) {
    if (!/^\d{1,4}$/.test(digits)) return null;
    if (meridiem !== 'AM' && meridiem !== 'PM' && meridiem !== null) return null;
    let h, m;
    if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
    else { h = parseInt(digits.slice(0, -2), 10); m = parseInt(digits.slice(-2), 10); }
    if (m > 59) return null;
    if (meridiem === null) {                      // 24-hour entry
      if (h > 23) return null;
      return h * 60 + m;
    }
    if (h < 1 || h > 12) return null;
    if (meridiem === 'AM') { if (h === 12) h = 0; }
    else { if (h !== 12) h += 12; }
    return h * 60 + m;
  }

  function workedMinutes(start, end) {
    if (start == null || end == null || end <= start) return null;
    return end - start;
  }

  function toDecimal(minutes) { return Math.round((minutes / 60) * 100) / 100; }

  function splitOvertime(totalMinutes) {
    const regMin = Math.min(totalMinutes, 2400);
    return { regMin, otMin: totalMinutes - regMin };
  }

  // Deliberately multiplies the ROUNDED decimal hours (not exact minutes) by the
  // rate: the user keys those rounded decimals into ADP, and ADP pays from them.
  // The estimate must match ADP's arithmetic, so it mirrors that rounding order.
  function grossEstimate(regMin, otMin, rate) {
    if (rate == null) return null;
    return Math.round((toDecimal(regMin) * rate + toDecimal(otMin) * rate * 1.5) * 100) / 100;
  }

  function formatTime(minutes) {
    let h = Math.floor(minutes / 60), m = minutes % 60;
    const mer = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + mer;
  }

  return { parseTimeDigits, workedMinutes, toDecimal, splitOvertime, grossEstimate, formatTime };
});
