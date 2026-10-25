import assert from 'node:assert/strict';
import test from 'node:test';
import { McpServer } from '@modelcontextprotocol/server';
import { registerXunjiTools } from '../src/xunji.ts';
import { registerBodyTools } from '../src/xunji-body.ts';

test('tools/list exposes three self-contained tools and described parameter schemas without a skill', { timeout: 10000 }, async () => {
 const server = new McpServer({ name: 'discovery-test', version: '1' });
 registerXunjiTools(server, {}, false);
 registerBodyTools(server, {}, false);
 const pending = new Map();
 const transport = {
  start: async () => {}, close: async () => {},
  send: async message => { pending.get(message.id)?.(message); },
 };
 await server.connect(transport);
 let id = 0;
 const request = (method, params = {}) => new Promise(resolve => {
  const requestId = ++id;
  pending.set(requestId, resolve);
  transport.onmessage({ jsonrpc: '2.0', id: requestId, method, params });
 });
 try {
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.error, undefined);
  transport.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const response = await request('tools/list');
  assert.equal(response.error, undefined);
  const tools = Object.fromEntries(response.result.tools.map(tool => [tool.name, tool]));
  assert.deepEqual(Object.keys(tools).sort(), ['xunji_get_body', 'xunji_get_food', 'xunji_get_training']);
  for (const tool of Object.values(tools)) {
   assert.equal(tool.annotations.readOnlyHint, true);
   assert.equal(tool.annotations.destructiveHint, false);
   assert.match(tool.description, /凭据由服务端管理/);
   assert.match(tool.description, /限频/);
   assert.match(tool.description, /空记录/);
   for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
    assert.ok(property.description, `${tool.name}.${name} must explain its usage in tools/list`);
    assert.doesNotMatch(name, /key|token|secret/i);
   }
  }
  const training = tools.xunji_get_training;
  assert.match(training.description, /res.trains/);
  assert.match(training.description, /原始心率/);
  assert.match(training.inputSchema.properties.include_full_data.description, /RPE.*心率/);
  assert.equal(training.inputSchema.properties.include_full_data.default, false);
  const food = tools.xunji_get_food;
  assert.match(food.description, /不静默截断/);
  assert.match(food.description, /不将汇总和明细重复累计/);
  assert.equal(food.inputSchema.properties.include_detail.default, true);
  const body = tools.xunji_get_body;
  assert.match(body.description, /weist腰围/);
  assert.match(body.description, /未明确 latest/);
  assert.match(body.description, /不足 limit 或空页/);
  assert.equal(body.inputSchema.properties.limit.maximum, 500);
  assert.equal(body.inputSchema.properties.offset.default, 0);
  assert.ok(body.inputSchema.properties.types.items.enum.includes('weist'));
  assert.ok(!body.inputSchema.properties.types.items.enum.includes('waist'));
  // Protocol-level invocation must still enforce authentication.
  const denied = await request('tools/call', { name: 'xunji_get_training', arguments: { datestr: '2026-10-22' } });
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /Sign in/);
 } finally {
  await server.close();
 }
});
