#!/usr/bin/env node
/** Thin stdio boundary: no Zenith storage, shell evaluation, or model calls. */
import { fileURLToPath } from 'node:url';
import { ClientError, validateRequest, errorResponse, MAX_REQUEST_BYTES } from '../client/dist/index.js';
import { configuredClient, setup } from './config.mjs';
import { inspectConnection } from './doctor.mjs';
export { readCredential } from './config.mjs';

export async function serve(client, { input = process.stdin, output = process.stdout, signal } = {}) {
  const active = new Map(); let buffer = Buffer.alloc(0), discarding = false, state = 'new';
  const stop = () => { state = 'closed'; for (const entry of active.values()) entry.controller.abort(); input.destroy(); };
  const write = message => new Promise((resolve, reject) => {
    if (state === 'closed' || output.destroyed) return resolve();
    output.write(`${JSON.stringify(message)}\n`, error => error ? reject(error) : resolve());
  });
  output.on('error', stop); signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const processLine = async line => {
    let raw, request;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
    catch { await write(errorResponse(null, -32700, 'Invalid UTF-8 JSON. Send one bounded object per line.')); return; }
    try { request = validateRequest(raw); }
    catch { await write(errorResponse(null, -32600, 'Invalid JSON-RPC request envelope.')); return; }
    const hasId = request.id !== undefined;
    if (request.method === 'notifications/cancelled') {
      if (hasId) { await write(errorResponse(request.id, -32600, 'Cancellation is a notification, not a request.')); return; }
      const entry = active.get(request.params?.requestId);
      if (entry && entry.method !== 'initialize') entry.controller.abort();
      return;
    }
    if (request.method === 'notifications/initialized') {
      if (hasId) { await write(errorResponse(request.id, -32600, 'Initialized notifications must not have an id.')); return; }
      if (state === 'initialized') {
        try { await client.request(request, signal); if (state !== 'closed') state = 'ready'; }
        catch { /* Never become ready after a failed acknowledgement. Reconnect. */ }
      }
      return;
    }
    if (!hasId) return;
    if (request.method === 'initialize' && state !== 'new') {
      await write(errorResponse(request.id, -32600, 'Initialization is already in progress or complete.')); return;
    }
    if (request.method !== 'initialize' && request.method !== 'ping' && state !== 'ready') {
      await write(errorResponse(request.id, -32002, 'Initialize the MCP connection before requesting tools.')); return;
    }
    if (active.has(request.id)) { await write(errorResponse(null, -32600, 'Request ID is already in flight.')); return; }
    if (active.size >= 8) { await write(errorResponse(request.id, -32000, 'Eight reads are already in flight. Retry later with a new ID.')); return; }
    if (request.method === 'initialize') state = 'initializing';
    const controller = new AbortController();
    const entry = { controller, method: request.method, work: undefined };
    active.set(request.id, entry); // Reserve before any asynchronous work can finish.
    entry.work = Promise.resolve().then(async () => {
      try {
        const response = await client.request(request, controller.signal);
        if (request.method === 'initialize' && state !== 'closed') state = response?.result ? 'initialized' : 'new';
        if (response && !controller.signal.aborted) await write(response);
      } catch (error) {
        if (request.method === 'initialize' && state !== 'closed') state = 'new';
        if (!controller.signal.aborted) await write(errorResponse(request.id, error instanceof ClientError && error.code === 'invalid_request' ? -32602 : -32000,
          error instanceof ClientError ? `${error.code}: ${error.message}` : 'Read failed. Check server diagnostics; no write was requested.'));
      } finally { active.delete(request.id); }
    }).catch(() => stop());
  };
  try {
    for await (const chunk of input) {
      if (state === 'closed') break;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); let start = 0;
      for (let i = 0; i < data.length; i++) if (data[i] === 10) {
        const piece = data.subarray(start, i); start = i + 1;
        if (!discarding && buffer.length + piece.length <= MAX_REQUEST_BYTES) {
          const line = Buffer.concat([buffer, piece]);
          if (line.length) await processLine(line); // Backpressure for refusals; active reads remain concurrent.
        } else if (!discarding) await write(errorResponse(null, -32600, 'Frame exceeds 64 KiB.'));
        buffer = Buffer.alloc(0); discarding = false;
      }
      const tail = data.subarray(start);
      if (!discarding) {
        if (buffer.length + tail.length > MAX_REQUEST_BYTES) {
          buffer = Buffer.alloc(0); discarding = true; await write(errorResponse(null, -32600, 'Frame exceeds 64 KiB.'));
        } else buffer = Buffer.concat([buffer, tail]);
      }
    }
    if (buffer.length && !discarding) await write(errorResponse(null, -32700, 'Incomplete frame at end of input; terminate each message with a newline.'));
  } catch (error) {
    if (state !== 'closed') throw error; // An explicit shutdown may close an active iterator.
  } finally {
    state = 'closed'; for (const entry of active.values()) entry.controller.abort();
    await Promise.allSettled([...active.values()].map(entry => entry.work));
    output.off('error', stop); signal?.removeEventListener('abort', stop);
  }
}
export async function main(args = process.argv.slice(2)) {
  if (['--help', 'help'].includes(args[0])) {
    console.log('Zenith connector: stdio | doctor | setup\nUse ZENITH_CONFIG_FILE, or explicit ZENITH_URL / ZENITH_WORKSPACE_ID / ZENITH_TOKEN_FILE (or ZENITH_TOKEN).\nSetup: setup --output ABSOLUTE_PATH --url TRUSTED_ORIGIN --workspace ID --token-file ABSOLUTE_PATH [--project ID] [--environment ID] [--allow-loopback-http]\nSetup creates a new private profile, never a credential or deployment. No implicit repository configuration.\nLocal HTTP requires explicit opt-in. See docs/configuration.md.'); return;
  }
  if (args[0] === 'setup') { console.log(JSON.stringify(await setup(args.slice(1)), null, 2)); return; }
  if (args.length > 1 || args[0] && !['stdio', 'doctor'].includes(args[0])) throw new ClientError('usage', 'Use stdio, doctor, setup, or --help.');
  const client = await configuredClient();
  if (args[0] === 'doctor') { console.log(JSON.stringify(await inspectConnection(client), null, 2)); return; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await serve(client, { signal: controller.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ level: 'error', code: error instanceof ClientError ? error.code : 'startup_failed',
    message: error instanceof ClientError ? error.message : 'Could not load configuration or credential. Check paths, ownership, and JSON; secret values are not logged.' }));
  process.exitCode = 1;
});
