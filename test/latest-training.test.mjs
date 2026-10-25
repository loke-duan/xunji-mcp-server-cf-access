import assert from 'node:assert/strict';
import test from 'node:test';
import { getLatestTraining, registerXunjiTools } from '../src/xunji.ts';
const env = { XUNJI_TRAIN_API_KEY: 'synthetic-training-key' };
const input = { as_of_date: '2026-03-03' };
const value = result => JSON.parse(result.content[0].text);

test('latest training stops on first nonempty day, forwards full-data option and returns all same-day records', async () => {
 const dates = [];
 const trains = [{ title: 'A' }, { title: 'B' }];
 const result = await getLatestTraining(env, { ...input, include_full_data: true }, async (_, init) => {
  const body = JSON.parse(init.body);
  dates.push(body.datestr);
  assert.equal(init.headers.Authorization, 'Bearer synthetic-training-key');
  assert.equal(body.include_full_data, true);
  return Response.json({ res: { trains: dates.length === 3 ? trains : [], extra: 'preserved' } });
 });
 assert.deepEqual(dates, ['2026-03-03', '2026-03-02', '2026-03-01']);
 assert.deepEqual(value(result), { start_date: '2026-02-25', end_date: '2026-03-03', checked_dates: dates,
  search_complete: true, found: true, matched_date: '2026-03-01', res: { trains, extra: 'preserved' } });
});

test('latest training finds today in one request and the seventh day in exactly seven', async () => {
 for (const target of [1, 7]) {
  let calls = 0;
  const result = await getLatestTraining(env, input, async (_, init) => {
   calls++;
   assert.equal(JSON.parse(init.body).include_full_data, false);
   return Response.json({ res: { trains: calls === target ? [{}] : [] } });
  });
  assert.equal(calls, target);
  assert.equal(value(result).matched_date, target === 1 ? '2026-03-03' : '2026-02-25');
 }
});

test('latest training returns bounded no-result and handles leap/year boundaries', async () => {
 for (const [as_of_date, first] of [['2024-03-01', '2024-02-24'], ['2026-01-02', '2025-12-27']]) {
  let calls = 0;
  const result = await getLatestTraining(env, { as_of_date }, async () => { calls++; return Response.json({ res: { trains: [] } }); });
  assert.equal(calls, 7);
  assert.equal(value(result).start_date, first);
  assert.equal(value(result).found, false);
  assert.equal(value(result).matched_date, null);
  assert.equal(value(result).search_complete, true);
 }
});

test('latest training stops at upstream errors without retries, leaks or claiming no data', async () => {
 for (const fail of [
  () => new Response(null, { status: 429, headers: { 'Retry-After': '30' } }),
  () => new Response(null, { status: 401 }),
  () => Response.json({ success: false, message: 'apikey invalid' }),
  () => { throw new Error(env.XUNJI_TRAIN_API_KEY); },
  () => new Response('invalid JSON'),
 ]) {
  let calls = 0;
  const result = await getLatestTraining(env, input, async () => ++calls === 1 ? Response.json({ res: { trains: [] } }) : fail());
  assert.equal(calls, 2);
  assert.equal(result.isError, true);
  assert.equal(value(result).search_complete, false);
  assert.equal(value(result).failed_date, '2026-03-02');
  assert.equal(value(result).found, undefined);
  assert.ok(!JSON.stringify(result).includes(env.XUNJI_TRAIN_API_KEY));
 }
});

test('latest training invalid input, missing keys and authentication do not reach the API', async () => {
 const never = () => assert.fail('must not fetch');
 for (const invalid of [{}, { as_of_date: '2026-02-30' }, { ...input, include_full_data: 'true' }]) {
  assert.equal((await getLatestTraining(env, invalid, never)).isError, true);
 }
 assert.equal((await getLatestTraining({}, input, never)).isError, true);
 const registered = {};
 registerXunjiTools({ registerTool: (name, config, callback) => { registered[name] = { config, callback }; } }, env, false);
 assert.equal((await registered.xunji_get_latest_training.callback(input)).isError, true);
 assert.equal(registered.xunji_get_latest_training.config.annotations.readOnlyHint, true);
});
