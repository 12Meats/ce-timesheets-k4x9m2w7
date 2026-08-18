// tests/paymath.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../paymath.js');

test('parseTimeDigits: "630" + AM = 390', () => {
  assert.strictEqual(P.parseTimeDigits('630', 'AM'), 390);
});
test('parseTimeDigits: "1230" + PM = 750, "12" + AM = 0 (midnight)', () => {
  assert.strictEqual(P.parseTimeDigits('1230', 'PM'), 750);
  assert.strictEqual(P.parseTimeDigits('12', 'AM'), 0);
});
test('parseTimeDigits: "3" + PM = 900 (bare hour)', () => {
  assert.strictEqual(P.parseTimeDigits('3', 'PM'), 900);
});
test('parseTimeDigits: 24h entry "1400" (no meridiem) = 840', () => {
  assert.strictEqual(P.parseTimeDigits('1400', null), 840);
});
test('parseTimeDigits: invalid -> null', () => {
  assert.strictEqual(P.parseTimeDigits('99', 'AM'), null);   // hour 99
  assert.strictEqual(P.parseTimeDigits('675', 'AM'), null);  // minute 75
  assert.strictEqual(P.parseTimeDigits('', 'AM'), null);
});
test('workedMinutes: 390..900 = 510; end<=start -> null', () => {
  assert.strictEqual(P.workedMinutes(390, 900), 510);
  assert.strictEqual(P.workedMinutes(900, 390), null);
});
test('toDecimal: 518 min = 8.63, 15 min = 0.25', () => {
  assert.strictEqual(P.toDecimal(518), 8.63);
  assert.strictEqual(P.toDecimal(15), 0.25);
});
test('splitOvertime: 46.5h week -> 40.00 reg / 6.50 ot', () => {
  const s = P.splitOvertime(2790);
  assert.deepStrictEqual(s, { regMin: 2400, otMin: 390 });
});
test('splitOvertime: under 40 -> no OT', () => {
  assert.deepStrictEqual(P.splitOvertime(2000), { regMin: 2000, otMin: 0 });
});
test('grossEstimate: 40 reg + 6.5 ot at $20 = 995.00', () => {
  assert.strictEqual(P.grossEstimate(2400, 390, 20), 995);
});
test('formatTime: 390 = "6:30 AM", 0 = "12:00 AM", 750 = "12:30 PM"', () => {
  assert.strictEqual(P.formatTime(390), '6:30 AM');
  assert.strictEqual(P.formatTime(0), '12:00 AM');
  assert.strictEqual(P.formatTime(750), '12:30 PM');
});
test('grossEstimate mirrors ADP: rounded decimal hours x rate (ugly minutes)', () => {
  // 518 min -> 8.63 decimal hours keyed into ADP; ADP pays 8.63 * 18.50 = 159.655 -> 159.66
  assert.strictEqual(P.grossEstimate(518, 0, 18.5), 159.66);
  // 7 min -> 0.12 h; 0.12 * 10 = 1.20 (matches ADP, NOT exact-minutes 1.17)
  assert.strictEqual(P.grossEstimate(7, 0, 10), 1.2);
});
test('splitOvertime: exactly 40h -> all regular, zero OT', () => {
  assert.deepStrictEqual(P.splitOvertime(2400), { regMin: 2400, otMin: 0 });
});
test('formatTime: noon = "12:00 PM"', () => {
  assert.strictEqual(P.formatTime(720), '12:00 PM');
});
test('parseTimeDigits: bad meridiem values -> null', () => {
  assert.strictEqual(P.parseTimeDigits('630', 'am'), null);
  assert.strictEqual(P.parseTimeDigits('630', undefined), null);
});
test('grossEstimate: integer-cents math avoids 1-cent float errors', () => {
  assert.strictEqual(P.grossEstimate(311, 0, 15.75), 81.59);   // 5.18h x 15.75
  assert.strictEqual(P.grossEstimate(999, 0, 18.5), 308.03);   // 16.65h x 18.50
  assert.strictEqual(P.grossEstimate(1310, 0, 18.5), 403.86);  // 21.83h x 18.50
});
test('guessMeridiem: paper-sheet defaults', () => {
  assert.strictEqual(P.guessMeridiem('630'), 'AM');   // 6 -> AM
  assert.strictEqual(P.guessMeridiem('11'), 'AM');
  assert.strictEqual(P.guessMeridiem('308'), 'PM');   // 3 -> PM
  assert.strictEqual(P.guessMeridiem('12'), 'PM');    // noon
  assert.strictEqual(P.guessMeridiem('1'), 'PM');
  assert.strictEqual(P.guessMeridiem(''), null);
  assert.strictEqual(P.guessMeridiem('1400'), null);  // 24h territory, no guess
});
test('isValidPair: contract predicate', () => {
  assert.strictEqual(P.isValidPair(390, 900), true);
  assert.strictEqual(P.isValidPair(900, 390), false);
  assert.strictEqual(P.isValidPair(390, 390), false);
  assert.strictEqual(P.isValidPair(null, 900), false);
  assert.strictEqual(P.isValidPair(0, 1439), true);
  assert.strictEqual(P.isValidPair(390, 1440), false);
});
