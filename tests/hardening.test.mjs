import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZenithClient, READ_TOOLS, validateResponse } from '../packages/client/dist/index.js';
import { scanForSecrets } from '../scripts/package-files.mjs';
const token = `za_${'C'.repeat(43)}`;
const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
const initialize = { ...ping, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
const call = { ...ping, method: 'tools/call', params: { name: 'zenith_get_context', arguments: {} } };
const initResult = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
const toolResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data, mode: 'read-only', contractVersion: 1 } });
const reply = result => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } });
const client = (fetch, more = {}) => new ZenithClient({ origin: 'https://zenith.example', association: { version: 1, workspaceId: 'ws' }, token: async () => token, fetch, ...more });
async function within(work, ms = 1000) {
  let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('test deadline exceeded')), ms); })]); }
  finally { clearTimeout(timer); }
}
test('endpoint URL and selected scope cannot be changed after validation', async () => {
  const scope = { version: 1, workspaceId: 'ws' };
  const c = client(async (url, options) => { assert.equal(url.host, 'zenith.example'); assert.equal(options.headers['x-zenith-workspace'], 'ws'); return reply({}); }, { association: scope });
  scope.workspaceId = 'other'; c.url.hostname = 'attacker.example'; assert.throws(() => { c.scope.workspaceId = 'other'; }); await c.request(ping);
});
test('mutating the exported tool-set copy cannot enable writes', async () => {
  READ_TOOLS.add('zenith_execute_plan');
  try { const result = await client(() => assert.fail('network reached')).request({ ...call, params: { name: 'zenith_execute_plan', arguments: {} } }); assert.equal(result.result.isError, true); }
  finally { READ_TOOLS.delete('zenith_execute_plan'); }
});
test('request is snapshotted before asynchronous credential lookup', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const raw = { ...ping }; const c = client(async (_, options) => { assert.equal(JSON.parse(options.body).id, 1); return reply({}); }, { token: async () => { await gate; return token; } });
  const result = c.request(raw); raw.id = 999; release(); assert.equal((await result).id, 1);
});
test('credentials are reread per request and never sent as cookies', async () => {
  let count = 0; const tokens = [token, `za_${'D'.repeat(43)}`];
  const c = client(async (_, options) => { assert.equal(options.headers.authorization, `Bearer ${tokens[count - 1]}`); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); return reply({}); }, { token: async () => tokens[count++] });
  await c.request(ping); await c.request(ping); assert.equal(count, 2);
});
test('an already cancelled read never accesses credentials', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client(() => assert.fail('network'), { token: () => assert.fail('credential') }).request(ping, controller.signal), { code: 'request_aborted' });
});
test('credential lookup is covered by the request deadline', async () => {
  await within(assert.rejects(client(() => assert.fail('network'), { token: () => new Promise(() => {}), timeoutMs: 20 }).request(ping), { code: 'request_aborted' }));
});
test('a stalled response body is cancelled at the deadline', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  await within(assert.rejects(client(async () => new Response(stream, { headers: { 'content-type': 'application/json' } }), { timeoutMs: 20 }).request(ping), { code: 'request_aborted' }));
  assert.equal(cancelled, true);
});
test('refused HTTP response cannot stall error handling through cancel()', async () => {
  const stream = new ReadableStream({ cancel() { return new Promise(() => {}); } });
  await within(assert.rejects(client(async () => new Response(stream, { status: 401 })).request(ping), { code: 'http_401' }));
});
for (const type of ['application/jsonp', 'application/json+untrusted', 'text/html']) test(`reject ambiguous media type ${type}`, async () => {
  await assert.rejects(client(async () => new Response('{}', { headers: { 'content-type': type } })).request(ping), { code: 'unsupported_transport' });
});
test('malformed initialization is rejected before credentials or network', async () => {
  await assert.rejects(client(() => assert.fail('network'), { token: () => assert.fail('credential') }).request({ ...ping, method: 'initialize' }), { code: 'invalid_request' });
});
test('initialization cannot claim unsupported server-initiated features', async () => {
  await assert.rejects(client(async () => reply({ ...initResult, capabilities: { tools: { listChanged: true } } })).request(initialize), { code: 'unsupported_transport' });
});
test('negotiated protocol version is used on subsequent requests', async () => {
  let n = 0;
  const c = client(async (_, options) => { if (n++ === 0) return reply({ ...initResult, protocolVersion: '2025-06-18' }); assert.equal(options.headers['mcp-protocol-version'], '2025-06-18'); return reply({}); });
  await c.request(initialize); await c.request(ping); assert.equal(c.protocolVersion, '2025-06-18');
});
for (const error of [null, { message: 'missing code' }, { code: 'wrong', message: 'error' }, { code: 1 }]) test(`reject malformed RPC error ${JSON.stringify(error)}`, () => {
  assert.throws(() => validateResponse(ping, { jsonrpc: '2.0', id: 1, error }), { code: 'invalid_response' });
});
test('raw RPC error bodies are not reflected', () => {
  const result = validateResponse(ping, { jsonrpc: '2.0', id: 1, error: { code: -32603, message: `secret ${token}` } });
  assert.equal(result.error.code, -32603); assert.equal(JSON.stringify(result).includes(token), false);
});
for (const bad of [
  { tools: [{ name: 'zenith_get_context' }] },
  { tools: [{ name: 'zenith_get_context', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }] },
  { tools: [{ name: 'zenith_get_context', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } }] },
  { tools: Array(2).fill({ name: 'zenith_get_context', inputSchema: { type: 'object' } }) },
  { tools: [], nextCursor: 123 },
]) test(`reject invalid catalog ${JSON.stringify(bad)}`, () => {
  assert.throws(() => validateResponse({ ...ping, method: 'tools/list' }, { jsonrpc: '2.0', id: 1, result: bad }), { code: 'invalid_catalog' });
});
for (const data of [{ contractVersion: 2, mode: 'read-only', data: {} }, { contractVersion: 1, mode: 'execute', data: {} }, { contractVersion: 1, mode: 'read-only' }]) test(`reject incompatible tool contract ${JSON.stringify(data)}`, async () => {
  await assert.rejects(client(async () => reply({ content: [], structuredContent: data })).request(call), { code: 'contract_mismatch' });
});
test('tool errors remain errors without requiring successful data', async () => {
  const result = await client(async () => reply({ isError: true, content: [{ type: 'text', text: 'provider_unavailable' }] })).request(call);
  assert.equal(result.result.isError, true);
});
test('exact active credential is redacted even if an endpoint echoes it', async () => {
  const result = await client(async () => reply(toolResult({ message: token }))).request(call);
  assert.equal(JSON.stringify(result).includes(token), false); assert.equal(result.result.structuredContent.data.message, '[REDACTED]');
});
test('diagnostics are bounded metadata and a failing sink does not change results', async () => {
  const records = []; const c = client(async () => reply({}), { onDiagnostic: record => { records.push(record); throw Error('sink failed'); } });
  await c.request(ping); assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), ['component', 'durationMs', 'method', 'outcome', 'requestId', 'responseBytes', 'status']);
  assert.equal(JSON.stringify(records).includes(token), false); assert.equal(records[0].outcome, 'success');
});
test('no generated package file carries a credential, a device code or a token environment block', async () => {
  const packages = fileURLToPath(new URL('../plugins/', import.meta.url));
  assert.deepEqual(await scanForSecrets(packages), []);
});
test('the generated-package secret scan actually catches each shape it claims to', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith-secret-scan-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'clean.md'), `Set ZENITH_TOKEN_FILE to an absolute path.\nif (!!env.ZENITH_TOKEN === !!env.ZENITH_TOKEN_FILE) fail();\n`);
  assert.deepEqual(await scanForSecrets(dir), [], 'a comparison against ZENITH_TOKEN in shipped runtime code is not an inlined secret');
  for (const [name, content] of [
    ['bearer.json', `{ "token": "za_${'A'.repeat(43)}" }`],
    ['device.txt', `deviceCode=zl_${'B'.repeat(43)}`],
    ['env.sh', 'ZENITH_TOKEN=whatever'],
    ['mcp.json', '{ "env": { "ZENITH_TOKEN": "value" } }'],
  ]) {
    const file = path.join(dir, name);
    await writeFile(file, content);
    assert.equal((await scanForSecrets(dir)).length, 1, `${name} must be caught`);
    await rm(file);
  }
});
test('requests disguised as notifications are not forwarded', async () => {
  const c = client(() => assert.fail('network reached'));
  assert.equal(await c.request({ jsonrpc: '2.0', method: 'tools/call', params: call.params }), undefined);
  assert.equal((await c.request({ ...ping, method: 'notifications/initialized' })).error.code, -32600);
});
