import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import { serve } from '../packages/bridge/cli.mjs';
const init = id => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
const rpc = (id, method = 'ping') => ({ jsonrpc: '2.0', id, method });
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
const response = request => request.id === undefined ? undefined : { jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? { serverInfo: { name: 'unit fixture' } } : {} };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness(t, request = async message => response(message)) {
  const input = new PassThrough(), output = new PassThrough();
  const lines = createInterface({ input: output })[Symbol.asyncIterator]();
  const work = serve({ request }, { input, output });
  t.after(async () => { input.end(); await work; output.end(); });
  return { input, output, work, send: m => input.write(`${JSON.stringify(m)}\n`), next: async () => { const item = await lines.next(); assert.equal(item.done, false); return JSON.parse(item.value); } };
}
test('pre-initialize tools are refused without forwarding', { timeout: 2000 }, async t => {
  const h = harness(t, () => assert.fail('forwarded')); h.send(rpc(1, 'tools/list')); assert.equal((await h.next()).error.code, -32002);
});
test('concurrent initialization is serialized rather than racing', { timeout: 2000 }, async t => {
  const gate = deferred(); let calls = 0;
  const h = harness(t, async m => { calls++; await gate.promise; return response(m); });
  h.send(init(1)); h.send(init(2)); const denied = await h.next(); assert.equal(denied.id, 2); assert.equal(denied.error.code, -32600);
  gate.resolve(); assert.equal((await h.next()).id, 1); assert.equal(calls, 1);
});
test('a failed initialized acknowledgement never grants readiness', { timeout: 2000 }, async t => {
  const h = harness(t, async m => { if (m.method === 'notifications/initialized') throw Error('refused'); return response(m); });
  h.send(init(1)); await h.next(); h.send(initialized); h.send(rpc(2, 'tools/list')); assert.equal((await h.next()).error.code, -32002);
});
test('initialized notification must not carry a request id', { timeout: 2000 }, async t => {
  const h = harness(t); h.send({ ...initialized, id: 1 }); assert.equal((await h.next()).error.code, -32600);
});
test('initialization cancellation is ignored', { timeout: 2000 }, async t => {
  const gate = deferred(), called = deferred(); let aborted = false;
  const h = harness(t, async (m, signal) => { if (m.method === 'initialize') { signal.addEventListener('abort', () => { aborted = true; }); called.resolve(); await gate.promise; } return response(m); });
  h.send(init(1)); await called.promise; h.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  h.send(rpc(2)); assert.equal((await h.next()).id, 2);
  gate.resolve(); assert.equal((await h.next()).id, 1); assert.equal(aborted, false);
});
test('invalid JSON, invalid envelopes and invalid UTF-8 are distinct and recoverable', { timeout: 2000 }, async t => {
  const h = harness(t); h.input.write('{\n{}\n');
  assert.equal((await h.next()).error.code, -32700); assert.equal((await h.next()).error.code, -32600);
  h.input.write(Buffer.from([0xff, 0x0a])); assert.equal((await h.next()).error.code, -32700);
  h.send(rpc(7)); assert.equal((await h.next()).id, 7);
});
test('oversized frames are discarded once and the next frame survives', { timeout: 2000 }, async t => {
  const h = harness(t); h.input.write('x'.repeat(65537)); h.input.write('\n'); h.send(rpc(2));
  assert.equal((await h.next()).error.code, -32600); assert.equal((await h.next()).id, 2);
});
test('duplicate zero ids do not overwrite an active request', { timeout: 2000 }, async t => {
  const gate = deferred(); let calls = 0;
  const h = harness(t, async m => { calls++; await gate.promise; return response(m); });
  h.send(rpc(0)); h.send(rpc(0)); assert.equal((await h.next()).id, null);
  gate.resolve(); assert.equal((await h.next()).id, 0); assert.equal(calls, 1);
});
test('only eight operations can be in flight', { timeout: 2000 }, async t => {
  const gate = deferred(); let calls = 0;
  const h = harness(t, async m => { calls++; await gate.promise; return response(m); });
  for (let i = 1; i <= 9; i++) h.send(rpc(i));
  const denied = await h.next(); assert.equal(denied.id, 9); assert.equal(denied.error.code, -32000); assert.equal(calls, 8);
  gate.resolve(); for (let i = 0; i < 8; i++) await h.next();
});
test('cancellation aborts a read and suppresses its response', { timeout: 2000 }, async t => {
  let aborted = false; const called = deferred();
  const h = harness(t, (m, signal) => {
    if (m.id !== 1) return Promise.resolve(response(m));
    called.resolve(); return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('cancelled')); }, { once: true }));
  });
  h.send(rpc(1)); await called.promise; h.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }); h.send(rpc(2));
  assert.equal((await h.next()).id, 2); assert.equal(aborted, true);
});
test('EOF aborts outstanding reads rather than waiting indefinitely', { timeout: 2000 }, async t => {
  const called = deferred(); let aborted = false;
  const h = harness(t, (_, signal) => { called.resolve(); return new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('closed')); }, { once: true })); });
  h.send(rpc(1)); await called.promise; h.input.end(); await h.work; assert.equal(aborted, true);
});
test('split multibyte UTF-8 input is decoded only after a complete frame', { timeout: 2000 }, async t => {
  const h = harness(t, async m => { assert.equal(m.params.note, 'नमस्ते'); return response(m); });
  const bytes = Buffer.from(JSON.stringify({ ...rpc(1), params: { note: 'नमस्ते' } }) + '\n');
  const offset = bytes.indexOf(Buffer.from('न')) + 1; h.input.write(bytes.subarray(0, offset)); h.input.write(bytes.subarray(offset));
  assert.equal((await h.next()).id, 1);
});
test('explicit shutdown stops an idle iterator without a spurious error', { timeout: 2000 }, async () => {
  const input = new PassThrough(), output = new PassThrough(), controller = new AbortController();
  const work = serve({ request: async m => response(m) }, { input, output, signal: controller.signal });
  controller.abort(); await work; output.end(); assert.equal(input.destroyed, true);
});
