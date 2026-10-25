import assert from 'node:assert/strict';
import test from 'node:test';
import { withFoodCalories } from '../src/food-calories.ts';
import { getFood } from '../src/xunji.ts';
const enrich = record => withFoodCalories({ days: [{ foods: { records: [record] } }] }).days[0].foods.records[0];

test('food totals use per-100g calories and preserve original fields, totals and abnormal nutrition', () => {
 const records = [
  { amount: 200, unit: 'g', ntr: { cal: 37, foodUnit: [] }, cals: '37' },
  { amount: 120, unit: 'g', ntr: { cal: 276 }, cals: '' },
  { amount: 130, unit: 'g', ntr: { cal: 134 } },
  { amount: 5, unit: 'g', ntr: { cal: 942, fat: 104.6 } },
 ];
 const original = { days: [{ foods: { records, extra: true }, totals: { totalCal: 999 } }], schema: 'synthetic' };
 const snapshot = structuredClone(original);
 const result = withFoodCalories(original);
 assert.deepEqual(result.days[0].foods.records.map(r => r.totalCal), [74, 331.2, 174.2, 47.1]);
 assert.deepEqual(original, snapshot);
 assert.deepEqual(result.days[0].totals, original.days[0].totals);
 for (let i=0; i<records.length; i++) {
  const { totalCal, ...rest } = result.days[0].foods.records[i];
  assert.deepEqual(rest, records[i]);
 }
 assert.equal(enrich({ ...records[0], totalCal: 123 }).totalCal, 123);
 assert.equal(enrich({ ...records[0], totalCal: null }).totalCal, null);
});

test('food totals accept decimal numeric strings and reliable exact unit conversion', () => {
 assert.equal(enrich({ amount: '120', unit: 'g', ntr: { cal: '276' } }).totalCal, 331.2);
 assert.equal(enrich({ amount: 2, unit: '个(大)', ntr: { cal: 134, foodUnit: [{ unit: '个(大)', gram: 65 }] } }).totalCal, 174.2);
 assert.equal(enrich({ amount: '2', unit: '份', ntr: { cal: 100, foodUnit: [{ unit: '份', gram: '110', count: '1' }] } }).totalCal, 220);
 assert.equal(enrich({ amount: 100, unit: '克', ntr: { cal: 0 } }).totalCal, 0);
 assert.equal(enrich({ amount: 0, unit: 'g', ntr: { cal: 100 } }).totalCal, 0);
 assert.equal(enrich({ amount: 1, unit: 'g', ntr: { cal: 123.456 } }).totalCal, 1.23);
});

test('food totals never guess missing nutrition, legacy cals, malformed input or ambiguous units', () => {
 const base = { amount: 100, unit: 'g', ntr: { cal: 100 }, cals: '999' };
 const invalid = [
  { ...base, ntr: {} }, { ...base, ntr: null }, { ...base, unit: '杯' },
  ...['', ' ', '0x10', 'NaN', 'Infinity', -1, Infinity, null, true, {}, []].flatMap(value => [
   { ...base, amount: value }, { ...base, ntr: { cal: value } },
  ]),
  { ...base, amount: 1e308, ntr: { cal: 1e308 } },
  ...[[], [{ unit: '份', gram: 0 }], [{ unit: '份', gram: -1 }],
   [{ unit: '份', gram: 100, count: '2' }],
   [{ unit: '份', gram: 100 }, { unit: '份', gram: 200 }],
   [{ unit: '份', gram: 'bad' }], [null]].map(foodUnit => ({ ...base, unit: '份', ntr: { cal: 100, foodUnit } })),
 ];
 for (const record of invalid) assert.equal(enrich(record).totalCal, null);
 for (const res of [null, [], {}, { days: null }, { days: [null, { foods: [] }] }]) {
  assert.deepEqual(withFoodCalories(res), res);
 }
});

test('food query enriches the actual nested response while preserving daily totals', async () => {
 const result = await getFood({ XUNJI_FOOD_API_KEY: 'synthetic-key' }, { start_date: '2026-10-25', end_date: '2026-10-25' },
  async () => Response.json({ success: true, res: { days: [{ foods: { records: [{ amount: 120, unit: 'g', ntr: { cal: 276, foodUnit: [] }, cals: '' }] }, totals: { totalCal: 999 } }] } }),
  new Date('2026-10-25T00:00:00Z'));
 const day = JSON.parse(result.content[0].text).res.days[0];
 assert.equal(day.foods.records[0].totalCal, 331.2);
 assert.equal(day.totals.totalCal, 999);
});
