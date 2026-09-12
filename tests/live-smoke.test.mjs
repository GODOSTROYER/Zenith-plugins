import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { smoke } from '../scripts/live-smoke.mjs';
import { writeProfile, configuredClient } from '../packages/bridge/config.mjs';
const firstToken = `za_${'E'.repeat(43)}`, secondToken = `za_${'F'.repeat(43)}`;
async function fixture(t) {
  const calls = []; let expectedToken = firstToken;
  const server = createServer(async (req, res) => {
    calls.push(req.headers.authorization);
    if (req.headers.authorization !== `Bearer ${expectedToken}` || req.headers['x-zenith-workspace'] !== 'ws') { res.writeHead(401); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const m = JSON.parse(Buffer.concat(chunks));
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    let result = {};
    if (m.method === 'initialize') result = { protocolVersion: '2025-11-25', serverInfo: { name: 'HTTP fixture, not Zenith', version: '1' }, capabilities: { tools: {} } };
    if (m.method === 'tools/list') result = { tools: ['zenith_get_context', 'zenith_get_capabilities'].map(name => ({ name, inputSchema: { type: 'object' } })) };
    if (m.method === 'tools/call') {
      const data = m.params.name === 'zenith_get_context' ? { selected: { workspaceId: 'ws' }, mode: 'read-only' } : { contractVersion: 1, mode: 'read-only' };
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { data, contractVersion: 1, mode: 'read-only' } };
    }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('ZENITH_')) delete env[key];
  Object.assign(env, { ZENITH_LIVE_TEST: '1', ZENITH_URL: `http://127.0.0.1:${server.address().port}`, ZENITH_ALLOW_LOOPBACK_HTTP: '1', ZENITH_WORKSPACE_ID: 'ws', ZENITH_TOKEN: firstToken });
  return { env, calls, rotate: () => { expectedToken = secondToken; } };
}
test('live smoke refuses absent opt-in instead of reporting a skipped pass', async () => {
  await assert.rejects(smoke({}), /opt in/);
});
test('smoke command exercises standalone and copied doctors against an HTTP FIXTURE', { timeout: 10_000 }, async t => {
  const f = await fixture(t), result = await smoke(f.env);
  assert.equal(result.ok, true); assert.equal(result.packages.codex.scopeVerified, true); assert.equal(result.packages['claude-code'].scopeVerified, true);
  assert.equal(f.calls.length, 15); // initialize, notification, catalog, context, capabilities for three paths.
  assert.equal(JSON.stringify(result).includes(firstToken), false); assert.equal(result.evidence.includes('Not Codex/Claude binary'), true);
});
test('private profile reloads rotated tokens and refuses a deleted token', { timeout: 10_000, skip: process.platform === 'win32' ? 'Private-file ACL validation not implemented on Windows.' : false }, async t => {
  const f = await fixture(t), dir = await mkdtemp(path.join(tmpdir(), 'zenith rotation ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, 'client.token'), config = path.join(dir, 'profile.json');
  await writeFile(tokenFile, firstToken, { mode: 0o600 });
  await writeProfile(config, { version: 1, origin: f.env.ZENITH_URL, allowLoopbackHttp: true, association: { version: 1, workspaceId: 'ws' }, tokenFile });
  const client = await configuredClient({ ZENITH_CONFIG_FILE: config });
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  await client.request(ping); f.rotate(); await writeFile(tokenFile, secondToken); await client.request({ ...ping, id: 2 });
  assert.deepEqual(f.calls, [`Bearer ${firstToken}`, `Bearer ${secondToken}`]);
  await rm(tokenFile); await assert.rejects(client.request({ ...ping, id: 3 })); assert.equal(f.calls.length, 2);
});
