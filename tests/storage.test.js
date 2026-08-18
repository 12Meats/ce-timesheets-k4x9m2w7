// tests/storage.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const S = require('../storage.js');

test('emptyData has version 1, null pin, no workers', () => {
  const d = S.emptyData();
  assert.strictEqual(d.version, 1);
  assert.strictEqual(d.pin, null);
  assert.deepStrictEqual(d.workers, []);
  assert.deepStrictEqual(d.entries, {});
});
test('validateImport accepts a round-tripped export', () => {
  const d = S.emptyData();
  d.workers.push({ id: 'x1', name: 'Test', rate: 20, usualStart: 390 });
  d.entries['x1'] = { '2026-08-10': { start: 390, end: 900 } };
  const back = S.validateImport(JSON.stringify(d));
  assert.deepStrictEqual(back, d);
});
test('validateImport rejects garbage and wrong shapes', () => {
  assert.strictEqual(S.validateImport('not json'), null);
  assert.strictEqual(S.validateImport('{"version":1}'), null);      // missing keys
  assert.strictEqual(S.validateImport('{"version":2,"pin":null,"workers":[],"entries":{}}'), null); // future version
});
test('mondayOf returns the Monday of any date', () => {
  assert.strictEqual(S.mondayOf('2026-08-13'), '2026-08-10'); // Thu -> Mon
  assert.strictEqual(S.mondayOf('2026-08-10'), '2026-08-10'); // Mon -> itself
  assert.strictEqual(S.mondayOf('2026-08-16'), '2026-08-10'); // Sun -> previous Mon
});
test('weekDates lists Mon..Sun', () => {
  const w = S.weekDates('2026-08-10');
  assert.strictEqual(w.length, 7);
  assert.strictEqual(w[0], '2026-08-10');
  assert.strictEqual(w[6], '2026-08-16');
});
test('weekMinutes sums a worker week in minutes', () => {
  const d = S.emptyData();
  d.entries['x1'] = {
    '2026-08-10': { start: 390, end: 900 },  // 510
    '2026-08-11': { start: 390, end: 908 },  // 518
  };
  assert.strictEqual(S.weekMinutes(d, 'x1', '2026-08-10'), 1028);
});
test('validateImport never throws on malformed-but-valid JSON shapes', () => {
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[],"entries":{"x1":null}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[null],"entries":{}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A"}],"entries":{"a":{"2026-08-10":null}}}'), null);
});
test('validateImport rejects orphaned entries, bad types, bad ranges', () => {
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[],"entries":{"ghost":{"2026-08-10":{"start":1,"end":2}}}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A","rate":"oops","usualStart":null}],"entries":{}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":1234,"workers":[],"entries":{}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A"}],"entries":{"a":{"2026-08-10":{"start":-500,"end":99999}}}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A"},{"id":"a","name":"B"}],"entries":{}}'), null);
  assert.strictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A"}],"entries":{"a":{"garbage-key":{"start":390,"end":900}}}}'), null);
});
test('validateImport accepts null/missing rate and usualStart', () => {
  assert.notStrictEqual(S.validateImport('{"version":1,"pin":"1234","workers":[{"id":"a","name":"A","rate":null,"usualStart":null}],"entries":{}}'), null);
  assert.notStrictEqual(S.validateImport('{"version":1,"pin":null,"workers":[{"id":"a","name":"A"}],"entries":{}}'), null);
});
test('mondayOf is stable across DST-transition weeks', () => {
  assert.strictEqual(S.mondayOf('2026-03-08'), '2026-03-02'); // US spring-forward Sunday
  assert.strictEqual(S.mondayOf('2026-11-01'), '2026-10-26'); // US fall-back Sunday
});
