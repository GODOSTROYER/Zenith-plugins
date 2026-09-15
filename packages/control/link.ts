/**
 * Browser link (device) flow client, protocol version 1.
 *
 * Nothing here reads, writes or stores a credential: these endpoints exist
 * precisely because one does not exist yet, so they take no `authorization`
 * header and this module has no dependency on the profile/vault/Keychain
 * stores. The device code is a secret. It stays in memory, is never printed,
 * never written to a file, and never reaches a diagnostic record — the record
 * shape below carries transport metadata only, exactly like the authenticated
 * client's.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ClientError, isObject, endpoint, LINK_PROTOCOL_VERSION } from '../client/dist/index.js';

/** The six scope names the backend accepts. A link may be granted a subset. */
export const SCOPE_NAMES: readonly string[] = Object.freeze(['read', 'plan', 'write', 'logs', 'export', 'publish']);
export const DEFAULT_REQUESTED_SCOPES: readonly string[] = Object.freeze(['read', 'plan', 'write', 'logs']);
/** Crockford base32 without I, L, O and U, grouped 4-4. */
const USER_CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$/;
const DEVICE_CODE = /^zl_[A-Za-z0-9_-]{43}$/;
const BEARER = /^za_[A-Za-z0-9_-]{43}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/;
const LABEL = /^[A-Za-z0-9._-]{1,40}$/;
const CLIENT_NAME = /^[A-Za-z0-9 ._-]{1,60}$/;
const CLIENT_VERSION = /^[A-Za-z0-9 ._+-]{1,40}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,39}$/;
/** RFC 3986 unreserved + reserved + percent. Anything else is not a URL we print or open. */
const URL_CHARACTERS = /^[A-Za-z0-9:/?#[\]@!$&'()*+,;=._~%-]+$/;
const MIN_INTERVAL = 1, MAX_INTERVAL = 30, MIN_EXPIRES = 60, MAX_EXPIRES = 900;
const MAX_POLLS = 200, MAX_RESPONSE_BYTES = 16_384, MAX_EXPIRY_MS = 31 * 86_400_000;

export interface LinkStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
}
export interface IssuedCredential {
  token: string;
  credentialId: string;
  origin: string;
  workspaceId: string;
  projectIds: string[];
  environmentIds: string[] | null;
  scopes: string[];
  expiresAt: string;
  label?: string;
}
export interface LinkTransport {
  origin: string;
  allowLoopbackHttp?: boolean;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  diagnostic?: (record: Record<string, unknown>) => void;
  signal?: AbortSignal;
}
export interface StartOptions extends LinkTransport {
  clientName: string;
  clientVersion?: string;
  label?: string;
  requestedScopes?: readonly string[];
}
export interface PollOptions extends LinkTransport {
  deviceCode: string;
  interval: number;
  expiresIn: number;
  /** Injected in tests so a bounded state machine does not need real time. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  maxRequests?: number;
  /** Progress callback. It is given seconds only; the device code never leaves this module. */
  onWait?: (seconds: number) => void;
}

/** Validate the caller's origin exactly as every other Zenith destination is validated. */
export function linkOrigin(origin: string, allowLoopbackHttp = false): string {
  return endpoint(origin, allowLoopbackHttp).origin;
}
const clampInterval = (value: number): number => Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.trunc(value)));
/**
 * Server prose is shown to a person, so strip anything that could rewrite the
 * terminal (control characters, escape sequences) and bound the length. The
 * text is otherwise preserved: the trusted origin's own explanation of a
 * refusal is more useful than a generic one.
 */
function readable(value: string): string {
  const text = value.replace(/\p{C}/gu, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}
const FALLBACK: Record<number, string> = {
  400: 'Zenith refused the link request as malformed. Update the connector and Zenith together.',
  404: 'This link request is unknown. Run `zenith login` again.',
  415: 'Zenith refused the link request media type.',
  429: 'Zenith rate limited the link request.',
  503: 'Zenith has no credential authority configured for browser links right now.',
};
function linkError(status: number, value: unknown, retryAfter?: string | null): ClientError {
  const error = isObject(value) && isObject(value.error) ? value.error : undefined;
  const code = typeof error?.code === 'string' && ERROR_CODE.test(error.code) ? error.code : `http_${status}`;
  const base = typeof error?.message === 'string' && error.message.length <= 8192
    ? readable(error.message) : (FALLBACK[status] ?? `Zenith refused the link request (HTTP ${status}). No automatic retry was made.`);
  const after = status === 429 && retryAfter && /^[0-9]{1,6}$/.test(retryAfter.trim()) ? ` Retry after ${retryAfter.trim()} seconds.` : '';
  return new ClientError(code, `${base || FALLBACK[status] || 'Zenith refused the link request.'}${after}`);
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ClientError('invalid_response', 'Zenith returned an empty link response.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ClientError('response_too_large', 'The link endpoint returned an oversized response.');
      chunks.push(item.value);
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const buffer = Buffer.concat(chunks);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  finally { buffer.fill(0); }
}

/** One bounded JSON POST to a link endpoint. No credential is attached and none is expected. */
async function post(options: LinkTransport, route: string, body: Record<string, unknown>): Promise<{ status: number; value: unknown; retryAfter: string | null }> {
  const origin = linkOrigin(options.origin, options.allowLoopbackHttp === true);
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > 4096) throw new ClientError('invalid_request', 'The link request exceeds its 4 KiB limit.');
  const started = Date.now(), requestId = randomUUID();
  const abort = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 20_000), ...(options.signal ? [options.signal] : [])]);
  let status: number | undefined, responseBytes = 0;
  try {
    abort.throwIfAborted();
    const response = await (options.fetch ?? fetch)(new URL(route, origin), {
      method: 'POST', body: payload, signal: abort, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-request-id': requestId },
    });
    status = response.status;
    if ((response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      void response.body?.cancel().catch(() => {});
      throw linkError(status, undefined, null);
    }
    const text = await readBounded(response);
    responseBytes = Buffer.byteLength(text);
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new ClientError('invalid_response', 'Zenith returned a malformed link response.'); }
    return { status, value, retryAfter: response.headers.get('retry-after') };
  } catch (error) {
    if (error instanceof ClientError) throw error;
    if (options.signal?.aborted) throw new ClientError('link_cancelled', 'No credential was issued. Run `zenith login` again when you are ready.');
    if (abort.aborted) throw new ClientError('request_aborted', 'The link request timed out. No credential was issued.');
    throw new ClientError('transport_failed', 'Could not reach the Zenith link endpoint. Check connectivity and TLS; redirects and automatic retries are disabled.');
  } finally {
    // Transport metadata only. There is no field here that could hold the device code.
    try { options.diagnostic?.({ component: 'zenith-link', requestId, method: route, durationMs: Date.now() - started, status, responseBytes }); }
    catch { /* diagnostics never change a result */ }
  }
}

/** A server may only send the user to its own origin. */
function verification(value: unknown, origin: string, field: string): string {
  if (typeof value !== 'string' || value.length > 512 || !URL_CHARACTERS.test(value))
    throw new ClientError('invalid_response', `Zenith returned an unusable ${field}.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new ClientError('invalid_response', `Zenith returned an unusable ${field}.`); }
  if (url.origin !== origin || url.username || url.password)
    throw new ClientError('invalid_response', 'The link endpoint pointed at a different origin. Approve links only on the Zenith origin you configured.');
  return value;
}

export async function startLink(options: StartOptions): Promise<LinkStart> {
  const origin = linkOrigin(options.origin, options.allowLoopbackHttp === true);
  if (!CLIENT_NAME.test(options.clientName)) throw new ClientError('invalid_request', 'The client name must be 1-60 characters of letters, digits, space, dot, underscore or hyphen.');
  if (options.clientVersion !== undefined && !CLIENT_VERSION.test(options.clientVersion)) throw new ClientError('invalid_request', 'The client version must be 1-40 bounded characters.');
  if (options.label !== undefined && !LABEL.test(options.label)) throw new ClientError('invalid_request', 'A link label must be 1-40 characters of letters, digits, dot, underscore or hyphen.');
  const requested = [...new Set(options.requestedScopes ?? DEFAULT_REQUESTED_SCOPES)];
  if (!requested.length || requested.some(scope => !SCOPE_NAMES.includes(scope))) throw new ClientError('invalid_request', `Requested scopes must come from: ${SCOPE_NAMES.join(', ')}.`);
  const { status, value, retryAfter } = await post(options, '/api/agent/link/start', {
    clientName: options.clientName,
    ...(options.clientVersion === undefined ? {} : { clientVersion: options.clientVersion }),
    ...(options.label === undefined ? {} : { label: options.label }),
    requestedScopes: requested, protocolVersion: LINK_PROTOCOL_VERSION,
  });
  if (status !== 200 && status !== 201) throw linkError(status, value, retryAfter);
  if (!isObject(value)) throw new ClientError('invalid_response', 'Zenith returned a malformed link start response.');
  if (value.protocolVersion !== undefined && value.protocolVersion !== LINK_PROTOCOL_VERSION)
    throw new ClientError('protocol_mismatch', `This connector speaks link protocol ${LINK_PROTOCOL_VERSION}. Upgrade the connector and Zenith together.`);
  if (typeof value.deviceCode !== 'string' || !DEVICE_CODE.test(value.deviceCode))
    throw new ClientError('invalid_response', 'Zenith did not return a usable link device code.');
  if (typeof value.userCode !== 'string' || !USER_CODE.test(value.userCode))
    throw new ClientError('invalid_response', 'Zenith did not return a usable user code.');
  const complete = verification(value.verificationUriComplete, origin, 'verification URL');
  if (!complete.includes(value.userCode)) throw new ClientError('invalid_response', 'The verification URL does not carry the user code shown here.');
  return {
    deviceCode: value.deviceCode, userCode: value.userCode,
    verificationUri: verification(value.verificationUri, origin, 'verification URL'),
    verificationUriComplete: complete,
    interval: typeof value.interval === 'number' && Number.isFinite(value.interval) ? clampInterval(value.interval) : 5,
    expiresIn: typeof value.expiresIn === 'number' && Number.isFinite(value.expiresIn)
      ? Math.min(MAX_EXPIRES, Math.max(MIN_EXPIRES, Math.trunc(value.expiresIn))) : 600,
  };
}

function issued(value: Record<string, unknown>, origin: string, now: number): IssuedCredential {
  const ids = (input: unknown, field: string): string[] => {
    if (!Array.isArray(input) || !input.length || input.length > 500 || input.some(id => typeof id !== 'string' || !IDENTIFIER.test(id)))
      throw new ClientError('invalid_response', `Zenith returned unusable ${field}.`);
    return [...new Set(input as string[])];
  };
  if (typeof value.token !== 'string' || !BEARER.test(value.token))
    throw new ClientError('invalid_response', 'Zenith did not return a Zenith agent credential.');
  if (typeof value.credentialId !== 'string' || !IDENTIFIER.test(value.credentialId))
    throw new ClientError('invalid_response', 'Zenith did not identify the issued credential.');
  if (value.origin !== undefined && value.origin !== origin)
    throw new ClientError('invalid_response', 'Zenith issued a credential for a different origin than the one requested.');
  if (typeof value.workspaceId !== 'string' || !IDENTIFIER.test(value.workspaceId))
    throw new ClientError('invalid_response', 'Zenith did not name the approved workspace.');
  const scopes = ids(value.scopes, 'scopes').filter(scope => SCOPE_NAMES.includes(scope));
  if (!scopes.includes('read') || scopes.length !== (value.scopes as string[]).length)
    throw new ClientError('invalid_response', 'Zenith granted an unknown scope, or omitted the required read scope.');
  const expiresAt = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > MAX_EXPIRY_MS)
    throw new ClientError('invalid_response', 'Zenith returned an expiry that is absent, already past, or beyond the 30-day ceiling.');
  const label = typeof value.label === 'string' && LABEL.test(value.label) ? value.label : undefined;
  return {
    token: value.token, credentialId: value.credentialId, origin, workspaceId: value.workspaceId,
    projectIds: ids(value.projectIds, 'project ids'),
    environmentIds: value.environmentIds === null || value.environmentIds === undefined ? null : ids(value.environmentIds, 'environment ids'),
    scopes, expiresAt: new Date(expiresAt).toISOString(), ...(label === undefined ? {} : { label }),
  };
}

const wait = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
  const cancel = () => { clearTimeout(timer); reject(signal?.reason); };
  signal?.addEventListener('abort', cancel, { once: true });
});

/**
 * Poll until the browser approval is decided. The loop is bounded three ways:
 * the server-supplied expiry, a hard request cap, and the caller's signal.
 * `slow_down` may only slow the loop down: a server answer can never make this
 * client poll faster than it already is.
 */
export async function pollLink(options: PollOptions): Promise<IssuedCredential> {
  const origin = linkOrigin(options.origin, options.allowLoopbackHttp === true);
  if (!DEVICE_CODE.test(options.deviceCode)) throw new ClientError('invalid_request', 'The device code is not a Zenith link code.');
  const now = options.now ?? Date.now, sleep = options.sleep ?? wait;
  const limit = Math.min(MAX_POLLS, Math.max(1, Math.trunc(options.maxRequests ?? MAX_POLLS)));
  const deadline = now() + Math.min(MAX_EXPIRES, Math.max(MIN_EXPIRES, Math.trunc(options.expiresIn))) * 1000;
  let interval = clampInterval(options.interval);
  const expired = (): ClientError => new ClientError('expired_token', 'This link request expired before it was approved. Run `zenith login` again.');
  for (let attempt = 0; attempt < limit; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) throw expired();
    const pause = Math.min(interval * 1000, remaining);
    options.onWait?.(Math.round(pause / 1000));
    try { await sleep(pause, options.signal); }
    catch { throw new ClientError('link_cancelled', 'No credential was issued. Run `zenith login` again when you are ready.'); }
    const { status, value, retryAfter } = await post(options, '/api/agent/link/token', { deviceCode: options.deviceCode, protocolVersion: LINK_PROTOCOL_VERSION });
    if (status !== 200) throw linkError(status, value, retryAfter);
    if (!isObject(value)) throw new ClientError('invalid_response', 'Zenith returned a malformed link token response.');
    const returned = typeof value.interval === 'number' && Number.isFinite(value.interval) ? Math.trunc(value.interval) : undefined;
    if (value.status === 'authorization_pending') { if (returned !== undefined) interval = clampInterval(Math.max(returned, MIN_INTERVAL)); continue; }
    if (value.status === 'slow_down') { interval = clampInterval(Math.max(returned ?? interval + 5, interval + 1)); continue; }
    // The expiry is a wall-clock fact about the credential, not a fact about
    // this loop's timing, so it is checked against the real clock even when a
    // caller injects one for the poll deadline.
    if (value.status === 'issued') return issued(value, origin, Date.now());
    throw new ClientError('invalid_response', 'Zenith returned an unknown link status.');
  }
  throw new ClientError('link_poll_limit', `No decision after ${limit} checks. Nothing was stored. Run \`zenith login\` again.`);
}

/**
 * Best effort only. The URL was already printed, so a browser launcher is
 * never allowed to fail a login: every failure path returns false silently.
 * The URL is passed as a single argv element, with no shell.
 */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CI) return false;
  if (url.length > 512 || !URL_CHARACTERS.test(url)) return false;
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return false; } catch { return false; }
  let file: string, args: string[];
  if (platform === 'win32') {
    // `start` is a cmd builtin, so cmd parses this line: refuse any URL carrying
    // a character cmd would treat as syntax rather than data.
    if (/[&<>^|"%]/.test(url)) return false;
    const root = env.SystemRoot;
    if (!root || !/^[A-Za-z]:\\/.test(root)) return false;
    file = path.win32.join(root, 'System32', 'cmd.exe'); args = ['/c', 'start', '', url];
  } else if (platform === 'darwin') { file = '/usr/bin/open'; args = [url]; }
  else { file = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(file, args, { stdio: 'ignore', detached: true, shell: false, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}
