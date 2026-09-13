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

  // Paid minutes for one day: worked minutes minus unpaid lunch, floored at 0.
  // lunch may be undefined on legacy entries -> treated as 0.
  function paidMinutes(start, end, lunch) {
    const w = workedMinutes(start, end);
    if (w === null) return null;
    return Math.max(0, w - (lunch || 0));
  }

  // Same hour-extraction as parseTimeDigits (length<=2 -> whole digits, else
  // slice(0,-2)). Paper sheets say "6:30" meaning AM and "3:00" meaning PM,
  // so hours 5-11 guess AM and hours 12 and 1-4 guess PM. Hours outside
  // 1-12 (13-23, or unparseable/empty digits) are 24h territory or nonsense
  // — no guess, caller keeps neither AM nor PM selected.
  function guessMeridiem(digits) {
    if (!/^\d{1,4}$/.test(digits)) return null;
    const h = digits.length <= 2 ? parseInt(digits, 10) : parseInt(digits.slice(0, -2), 10);
    if (h >= 5 && h <= 11) return 'AM';
    if (h === 12 || (h >= 1 && h <= 4)) return 'PM';
    return null;
  }

  // The one predicate the storage contract hinges on: a pair may be written
  // to entries only when both sides are set, in-range minutes-since-midnight
  // and end is strictly after start.
  function isValidPair(start, end) {
    const isMinutes = (v) => Number.isInteger(v) && v >= 0 && v <= 1439;
    return isMinutes(start) && isMinutes(end) && end > start;
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
    const regHunHours = Math.round(toDecimal(regMin) * 100);  // hours in hundredths
    const otHunHours = Math.round(toDecimal(otMin) * 100);
    const rateCents = Math.round(rate * 100);
    const totalCents = Math.round((regHunHours * rateCents + otHunHours * rateCents * 1.5) / 100);
    return totalCents / 100;
  }

  // Cash pay: exact minutes times the rate, overtime past 40 at time and a
  // half, rounded to the cent once at the end. This is the number the owner
  // works out by hand for a worker he pays in cash (total hours to the minute
  // times the rate), so it is NOT the ADP-mirroring grossEstimate above: that
  // one rounds the hours first because ADP does. Integer cents throughout.
  function exactPay(regMin, otMin, rate) {
    if (rate == null) return null;
    const rateCents = Math.round(rate * 100);
    const cents = Math.round((regMin * rateCents + otMin * rateCents * 1.5) / 60);
    return cents / 100;
  }

  // "8 hr 8 min" / "8 hr" / "45 min" — low-emphasis sub-display of paid time
  // next to the prominent decimal hours. Pure minutes-in, phrase-out; no
  // rounding involved (paidMinutes is already a whole-minute integer).
  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return m + ' min';
    if (m === 0) return h + ' hr';
    return h + ' hr ' + m + ' min';
  }

  function formatTime(minutes) {
    let h = Math.floor(minutes / 60), m = minutes % 60;
    const mer = h < 12 ? 'AM' : 'PM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + mer;
  }

  return { parseTimeDigits, workedMinutes, paidMinutes, toDecimal, splitOvertime, grossEstimate, exactPay, formatTime, formatDuration, guessMeridiem, isValidPair };
});
