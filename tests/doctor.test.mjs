import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectConnection } from '../packages/bridge/doctor.mjs';
import { ZenithClient } from '../packages/client/dist/index.js';
const token = `za_${'D'.repeat(43)}`;
const tool = name => ({ name, inputSchema: { type: 'object' } });
function client(change = (_request, result) => result) {
  return new ZenithClient({ origin: 'https://fixture.invalid', association: { version: 1, workspaceId: 'ws' }, token: async () => token,
    fetch: async (_url, options) => {
      const m = JSON.parse(options.body);
      if (m.id === undefined) return new Response(null, { status: 202 });
      let result = {};
      if (m.method === 'initialize') result = { protocolVersion: '2025-11-25', serverInfo: { name: 'doctor-fixture', version: '1' }, capabilities: { tools: {} } };
      if (m.method === 'tools/list') result = { tools: [tool('zenith_get_context'), tool('zenith_get_capabilities')] };
      if (m.method === 'tools/call') {
        const data = m.params.name === 'zenith_get_context' ? { mode: 'read-only', selected: { workspaceId: 'ws' } } : { mode: 'read-only', contractVersion: 1 };
        result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { contractVersion: 1, mode: 'read-only', data } };
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: change(m, result) }), { headers: { 'content-type': 'application/json' } });
    } });
}
test('doctor checks context and capabilities, not only an initialization handshake', async () => {
  const report = await inspectConnection(client());
  assert.equal(report.ok, true); assert.equal(report.scopeVerified, true); assert.equal(report.protocolVersion, '2025-11-25');
  assert.equal(report.evidence.includes('no provider-health'), true); assert.equal(JSON.stringify(report).includes(token), false);
});
test('doctor rejects wrong workspace selection', async () => {
  await assert.rejects(inspectConnection(client((m, r) => { if (m.params?.name === 'zenith_get_context') r.structuredContent.data.selected.workspaceId = 'foreign'; return r; })), e => e.code === 'scope_mismatch');
});
test('doctor rejects capabilities claiming a different contract', async () => {
  await assert.rejects(inspectConnection(client((m, r) => { if (m.params?.name === 'zenith_get_capabilities') r.structuredContent.data.contractVersion = 2; return r; })), e => e.code === 'contract_mismatch');
});
test('doctor rejects missing verification tools and tool failures', async () => {
  await assert.rejects(inspectConnection(client((m, r) => m.method === 'tools/list' ? { tools: [] } : r)), e => e.code === 'capability_unavailable');
  await assert.rejects(inspectConnection(client((m, r) => m.method === 'tools/call' ? { isError: true, content: [{ type: 'text', text: 'fixture refusal' }] } : r)), e => e.code === 'verification_failed');
});
test('doctor refuses duplicate tools and cursor cycles across pages', async () => {
  await assert.rejects(inspectConnection(client((m, r) => m.method === 'tools/list' ? { ...r, nextCursor: 'next' } : r)), e => e.code === 'invalid_catalog');
  await assert.rejects(inspectConnection(client((m, r) => m.method === 'tools/list' ? { tools: [], nextCursor: 'cycle' } : r)), e => e.code === 'invalid_catalog');
});
