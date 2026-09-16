import { ClientError, isObject, CONTRACT_VERSION, PROTOCOL_VERSIONS } from '../client/dist/index.js';
export const VERSION = '0.3.0-dev.1';
export async function inspectConnection(client) {
  let id = 1;
  const invoke = (method, params = {}) => client.request({ jsonrpc: '2.0', id: id++, method, params });
  const init = await invoke('initialize', { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: 'zenith-doctor', version: VERSION } });
  if (init?.error) throw new ClientError('server_refused', 'Initialization was refused. Check the scoped credential and server diagnostics.');
  await client.request({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const names = new Set(), cursors = new Set(); let cursor;
  for (let pages = 0; ; pages++) {
    if (pages === 4) throw new ClientError('invalid_catalog', 'Catalog pagination exceeded four pages. Check server compatibility.');
    const response = await invoke('tools/list', cursor ? { cursor } : {});
    if (response?.error || !Array.isArray(response?.result?.tools)) throw new ClientError('invalid_catalog', 'The endpoint did not return a valid tool catalog.');
    for (const tool of response.result.tools) {
      if (names.has(tool.name)) throw new ClientError('invalid_catalog', 'Catalog pagination repeated a tool.');
      names.add(tool.name);
    }
    cursor = response.result.nextCursor;
    if (!cursor) break;
    if (cursors.has(cursor)) throw new ClientError('invalid_catalog', 'Catalog pagination repeated a cursor.');
    cursors.add(cursor);
  }
  const data = async name => {
    if (!names.has(name)) throw new ClientError('capability_unavailable', 'This credential must expose context and capabilities for connection verification.');
    const reply = await invoke('tools/call', { name, arguments: {} });
    if (reply?.error || reply?.result?.isError || !isObject(reply?.result?.structuredContent?.data))
      throw new ClientError('verification_failed', 'A scoped verification read failed. Inspect Zenith; no provider operation was requested.');
    return reply.result.structuredContent.data;
  };
  const context = await data('zenith_get_context'), capabilities = await data('zenith_get_capabilities');
  if (!isObject(context.selected) || ['workspaceId', 'projectId', 'environmentId'].some(k => context.selected[k] !== client.scope[k]))
    throw new ClientError('scope_mismatch', 'The endpoint returned a different selection. Stop and check trusted connection configuration.');
  if (context.mode !== 'read-only' || capabilities.mode !== 'read-only' || capabilities.contractVersion !== CONTRACT_VERSION)
    throw new ClientError('contract_mismatch', 'The endpoint does not match the read-only Zenith contract.');
  return { ok: true, mode: 'read-only', contractVersion: CONTRACT_VERSION, protocolVersion: client.protocolVersion,
    server: init.result.serverInfo, tools: [...names].sort(), scopeVerified: true,
    evidence: 'Authenticated context, catalog, selection and capability contract only; no provider-health, deployment or native-client verification.' };
}
