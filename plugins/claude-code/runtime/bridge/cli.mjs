#!/usr/bin/env node
/** Thin stdio boundary: no Zenith database access, shell evaluation, or model calls. */
import { constants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ZenithClient, ClientError, association, validateRequest, errorResponse, MAX_REQUEST_BYTES } from '../client/dist/index.js';

export async function readCredential(path) {
  if (!isAbsolute(path)) throw new ClientError('credential_path', 'ZENITH_TOKEN_FILE must be an absolute path outside your repository.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())))
      throw new ClientError('credential_permissions', 'Use an owned regular token file with mode 0600, at most 256 bytes.');
    return (await file.readFile('utf8')).trim();
  } finally { await file.close(); }
}
async function configuredClient() {
  if (!process.env.ZENITH_URL) throw new ClientError('configuration', 'Set ZENITH_URL to a trusted origin in your own environment, never in a repository file.');
  let scope = { version: 1, workspaceId: process.env.ZENITH_WORKSPACE_ID };
  if (process.env.ZENITH_PROJECT_ID) scope.projectId = process.env.ZENITH_PROJECT_ID;
  if (process.env.ZENITH_ENVIRONMENT_ID) scope.environmentId = process.env.ZENITH_ENVIRONMENT_ID;
  if (process.env.ZENITH_ASSOCIATION_FILE) {
    if (!isAbsolute(process.env.ZENITH_ASSOCIATION_FILE)) throw new ClientError('configuration', 'Use an absolute association file path; no automatic repository discovery occurs.');
    const data = await readFile(process.env.ZENITH_ASSOCIATION_FILE);
    if (data.byteLength > 4096) throw new ClientError('configuration', 'Association exceeds 4 KiB. Store identifiers only.');
    scope = JSON.parse(data.toString('utf8'));
  }
  if (process.env.ZENITH_TOKEN && process.env.ZENITH_TOKEN_FILE) throw new ClientError('configuration', 'Choose ZENITH_TOKEN or ZENITH_TOKEN_FILE, not both.');
  if (!process.env.ZENITH_TOKEN && !process.env.ZENITH_TOKEN_FILE) throw new ClientError('configuration', 'Set ZENITH_TOKEN_FILE to a scoped credential file. There is no demo-admin fallback.');
  const token = async () => process.env.ZENITH_TOKEN_FILE ? readCredential(process.env.ZENITH_TOKEN_FILE) : process.env.ZENITH_TOKEN;
  return new ZenithClient({ origin: process.env.ZENITH_URL, association: association(scope), token,
    allowLoopbackHttp: process.env.ZENITH_ALLOW_LOOPBACK_HTTP === '1' });
}
async function write(message) {
  if (!process.stdout.write(`${JSON.stringify(message)}\n`)) await once(process.stdout, 'drain');
}
export async function serve(client) {
  const active = new Map(); let buffer = Buffer.alloc(0); let discarding = false;
  let ready = false; let initialized = false;
  const processLine = async (line) => {
    let request;
    try { request = validateRequest(JSON.parse(line.toString('utf8'))); }
    catch { await write(errorResponse(null, -32700, 'Invalid JSON-RPC frame. Send one bounded object per line.')); return; }
    const hasId = request.id !== undefined;
    if (request.method === 'notifications/cancelled') { active.get(request.params?.requestId)?.controller.abort(); return; }
    if (!hasId && request.method !== 'notifications/initialized') return;
    if (request.method === 'notifications/initialized') {
      if (initialized) { ready = true; await client.request(request); } return;
    }
    if (request.method !== 'initialize' && request.method !== 'ping' && !ready) {
      await write(errorResponse(request.id, -32002, 'Initialize the MCP connection before requesting tools.')); return;
    }
    if (request.method === 'initialize' && initialized) { await write(errorResponse(request.id, -32600, 'This connection is already initialized.')); return; }
    if (active.has(request.id) || active.size >= 8) { await write(errorResponse(request.id, -32000, 'Duplicate ID or eight reads already in flight. Wait, then retry with a new ID.')); return; }
    const controller = new AbortController();
    const work = (async () => {
      try {
        const response = await client.request(request, controller.signal);
        if (request.method === 'initialize' && response?.result) initialized = true;
        if (response) await write(response);
      } catch (error) {
        await write(errorResponse(request.id, -32000, error instanceof ClientError ? `${error.code}: ${error.message}` : 'Read failed. Check server diagnostics; no write was requested.'));
      } finally { active.delete(request.id); }
    })();
    active.set(request.id, { controller, work });
  };
  for await (const data of process.stdin) {
    // Chunking protects against a single input chunk containing many short frames.
    let start = 0;
    for (let i = 0; i < data.length; i++) if (data[i] === 10) {
      const piece = data.subarray(start, i); start = i + 1;
      if (!discarding && buffer.length + piece.length <= MAX_REQUEST_BYTES) {
        const line = Buffer.concat([buffer, piece]);
        if (line.length) void processLine(line).catch(() => { process.exitCode = 1; });
      } else if (!discarding) await write(errorResponse(null, -32600, 'Frame exceeds 64 KiB.'));
      buffer = Buffer.alloc(0); discarding = false;
    }
    const tail = data.subarray(start);
    if (!discarding) {
      if (buffer.length + tail.length > MAX_REQUEST_BYTES) {
        buffer = Buffer.alloc(0); discarding = true;
        await write(errorResponse(null, -32600, 'Frame exceeds 64 KiB.'));
      } else buffer = Buffer.concat([buffer, tail]);
    }
  }
  if (buffer.length && !discarding) await processLine(buffer);
  await Promise.allSettled([...active.values()].map(x => x.work));
}
export async function main() {
  if (['--help', 'help'].includes(process.argv[2])) {
    console.log('Zenith connector: stdio | doctor\nRequired: ZENITH_URL, ZENITH_WORKSPACE_ID, ZENITH_TOKEN_FILE (or ZENITH_TOKEN).\nOptional: ZENITH_PROJECT_ID, ZENITH_ENVIRONMENT_ID, ZENITH_ASSOCIATION_FILE.\nLocal HTTP requires ZENITH_ALLOW_LOOPBACK_HTTP=1. See docs/configuration.md.'); return;
  }
  if (process.argv[2] && !['stdio', 'doctor'].includes(process.argv[2])) throw new ClientError('usage', 'Use stdio, doctor, or --help.');
  const client = await configuredClient();
  if (process.argv[2] === 'doctor') {
    const result = await client.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'zenith-doctor', version: '0.1.0-dev.1' } } });
    if (result?.error) throw new ClientError('server_refused', 'The server refused initialization. Check server configuration.');
    await client.request({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools = await client.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if (!Array.isArray(tools?.result?.tools)) throw new ClientError('invalid_catalog', 'The endpoint did not return a tool catalog.');
    console.log(JSON.stringify({ ok: true, mode: 'read-only', tools: tools.result.tools.map(t => t.name),
      evidence: 'Authenticated endpoint and catalog only; not a provider-health or deployment verification.' }, null, 2)); return;
  }
  await serve(client);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ level: 'error', code: error instanceof ClientError ? error.code : 'startup_failed',
    message: error instanceof ClientError ? error.message : 'Could not load configuration or credential. Check paths, ownership, and JSON; secret values are not logged.' }));
  process.exitCode = 1;
});
