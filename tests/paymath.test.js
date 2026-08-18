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
