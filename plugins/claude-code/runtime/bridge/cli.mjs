#!/usr/bin/env node
/** Thin stdio boundary: no Zenith storage, shell evaluation, or model calls. */
import { isMain } from './entrypoint.mjs';
import { ClientError, validateRequest, errorResponse, MAX_REQUEST_BYTES } from '../client/dist/index.js';
import { configuredClient, setup } from './config.mjs';
import { inspectConnection, VERSION } from './doctor.mjs';
import { enforceInstalledProvenance } from '../provenance/consumer.mjs';
import { ProvenanceError } from '../provenance/index.mjs';
export { readCredential } from './config.mjs';

/**
 * Commands that print static text, open no connection, read no credential and
 * reach neither the MCP surface nor the control CLI's client. They run before
 * the activation gate so an operator can read an installed package's usage and
 * version while the trusted launcher's provenance inputs are still being
 * configured. Everything else stays behind the gate.
 *
 * Being ungated is not enough on its own: `main` must also answer these
 * commands before the environment-driven control routing, or an ungated
 * invocation still imports the gated module graph. `-h` is spelled here too,
 * so the common abbreviation cannot fall through to that routing.
 */
const HELP_COMMANDS = new Set(['--help', '-h', 'help']);
const VERSION_COMMANDS = new Set(['--version', 'version']);
const UNGATED_COMMANDS = new Set([...HELP_COMMANDS, ...VERSION_COMMANDS]);

const HELP_TEXT = 'Zenith connector: login | logout | status | stdio | doctor | setup | --help | --version\n'
  + 'Link a Zenith account in the browser: login [--url ORIGIN] [--name NAME] [--no-browser] [--json]. It prints a URL and a code, waits for the approval, then stores the issued credential. logout removes the local credential; revoke in the browser at ORIGIN/integrations.\n'
  + 'Use ZENITH_CONFIG_FILE, or explicit ZENITH_URL / ZENITH_WORKSPACE_ID / ZENITH_TOKEN_FILE (or ZENITH_TOKEN).\n'
  + 'Setup: setup --output ABSOLUTE_PATH --url TRUSTED_ORIGIN --workspace ID --token-file ABSOLUTE_PATH [--project ID] [--environment ID] [--allow-loopback-http]\n'
  + 'Setup creates a new private profile, never a credential or deployment. No implicit repository configuration.\n'
  + 'Local HTTP requires explicit opt-in. See docs/configuration.md.\n'
  + 'In an installed package only --help and --version run ungated; stdio, doctor, setup and the v2 control commands require the trusted launcher\'s absolute ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST paths and fail closed with provenance_required. See docs/provenance.md.';

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
  const command = args[0] ?? '';
  // Static text first, unconditionally. The control routing below keys off
  // inherited environment (ZENITH_API_VERSION=2, ZENITH_PROFILES_FILE), so
  // while help was printed after it, an operator running --help on a machine
  // where either variable happened to be set pulled the whole control module
  // graph — profiles, vault, keychain, remote — into a process the activation
  // gate had deliberately not verified. Nothing above this line reads a
  // credential, a profile or a provenance input.
  if (HELP_COMMANDS.has(command)) { console.log(HELP_TEXT); return; }
  if (!UNGATED_COMMANDS.has(command)) await enforceInstalledProvenance();
  if (VERSION_COMMANDS.has(command)) { console.log(VERSION); return; }
  // login, logout and status join this list so they work on a machine with no
  // Zenith environment at all, which is the entire point of a browser link.
  if (process.env.ZENITH_API_VERSION === '2' || process.env.ZENITH_PROFILES_FILE || ['login','logout','status','profile','source','remote-config'].includes(args[0])) {
    const { main: controlMain } = await import('../control/cli.mjs'); await controlMain([...args]); return;
  }
  if (process.env.ZENITH_API_VERSION && process.env.ZENITH_API_VERSION !== '1') throw new ClientError('unsupported_version', 'Select API version 1 or 2 explicitly.');
  if (args[0] === 'setup') { console.log(JSON.stringify(await setup(args.slice(1)), null, 2)); return; }
  if (args.length > 1 || args[0] && !['stdio', 'doctor'].includes(args[0])) throw new ClientError('usage', 'Use stdio, doctor, setup, --help, or --version.');
  const client = await configuredClient();
  if (args[0] === 'doctor') { console.log(JSON.stringify(await inspectConnection(client), null, 2)); return; }
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await serve(client, { signal: controller.signal }); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
// A provenance refusal names the missing or rejected trust input. Masking it as
// a credential problem sent operators to debug the wrong file, so its code and
// message are preserved exactly like a ClientError's.
//
// The v2 control CLI is loaded from an esbuild bundle that carries its own copy
// of ClientError, so `instanceof` across that boundary is false even for a real,
// deliberate refusal: every control refusal — `usage`, `profile_exists`,
// `access_denied`, `vault_refused` — was reported as `startup_failed`, sending
// operators to debug a credential that was never the problem. Recognise the
// shape as well as the class, with both fields bounded because a code can
// originate in a refusal the server explained.
const REFUSAL_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const refusal = error => error instanceof ClientError || error instanceof ProvenanceError
  || (error?.name === 'ClientError' && typeof error.code === 'string' && REFUSAL_CODE.test(error.code) && typeof error.message === 'string');
if (isMain(import.meta.url)) main().catch(error => {
  const explicit = refusal(error);
  console.error(JSON.stringify({ level: 'error', code: explicit ? error.code : 'startup_failed',
    message: explicit ? String(error.message).slice(0, 1000) : 'Could not load configuration or credential. Check paths, ownership, and JSON; secret values are not logged.' }));
  process.exitCode = 1;
});
