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
test('paidMinutes: deducts lunch, floors at 0, legacy undefined = 0', () => {
  assert.strictEqual(P.paidMinutes(390, 908, 30), 488);
  assert.strictEqual(P.paidMinutes(390, 908, 0), 518);
  assert.strictEqual(P.paidMinutes(390, 908, undefined), 518);
  assert.strictEqual(P.paidMinutes(390, 410, 30), 0);      // 20min shift, floor at 0
  assert.strictEqual(P.paidMinutes(900, 390, 30), null);   // invalid pair stays null
});
test('formatDuration: hr/min phrasing', () => {
  assert.strictEqual(P.formatDuration(488), '8 hr 8 min');
  assert.strictEqual(P.formatDuration(480), '8 hr');
  assert.strictEqual(P.formatDuration(45), '45 min');
  assert.strictEqual(P.formatDuration(0), '0 min');
});
test('isValidPair: contract predicate', () => {
  assert.strictEqual(P.isValidPair(390, 900), true);
  assert.strictEqual(P.isValidPair(900, 390), false);
  assert.strictEqual(P.isValidPair(390, 390), false);
  assert.strictEqual(P.isValidPair(null, 900), false);
  assert.strictEqual(P.isValidPair(0, 1439), true);
  assert.strictEqual(P.isValidPair(390, 1440), false);
});

test('exactPay: exact minutes times the rate, rounded once to the cent', () => {
  // 8 hr 8 min at $30: 488 min -> $244.00 exactly.
  assert.strictEqual(P.exactPay(488, 0, 30), 244);
  // 40 hr + 2 hr 30 min OT at $30: 1200 + 112.50.
  assert.strictEqual(P.exactPay(2400, 150, 30), 1312.5);
  // 7 min at $30 is $3.50; 1 min at $30 is 50 cents; 1 min at $31 is 51.67 -> 0.52.
  assert.strictEqual(P.exactPay(7, 0, 30), 3.5);
  assert.strictEqual(P.exactPay(1, 0, 30), 0.5);
  assert.strictEqual(P.exactPay(1, 0, 31), 0.52);
  // It is not the rounded-hours figure: 8 hr 8 min is 8.13 h in ADP's world.
  assert.strictEqual(P.grossEstimate(488, 0, 30), 243.9);
  assert.strictEqual(P.exactPay(0, 0, 30), 0);
  assert.strictEqual(P.exactPay(480, 0, null), null);
});
