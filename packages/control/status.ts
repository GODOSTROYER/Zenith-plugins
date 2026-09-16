/**
 * `zenith status` — origin, linked account, scopes, expiry and the backend's
 * own capability report.
 *
 * `doctor` is a documented contract whose JSON shape is asserted by
 * tests/doctor.test.mjs and docs/configuration.md, so it is left exactly as it
 * is and this is a separate verb. Nothing here introduces an MCP tool: the
 * credential and capability facts come from `zenith_get_context` and
 * `zenith_get_capabilities`, which already exist, so the shared contract
 * snapshot and backend parity check are unaffected.
 */
import { ClientError, isObject } from '../client/dist/index.js';
import { controlClient, resolveProfilesFile } from './profiles.js';
import { selectedProfile } from './login.js';
import { PREVIEW_NOTICE, isPreview, type Activation } from './activation.js';
import type { ControlClient } from '../client/control.js';

export interface StatusIo {
  env?: NodeJS.ProcessEnv;
  out?: (line: string) => void;
  client?: ControlClient;
  now?: () => number;
  /** Reported by the provenance gate in packages/bridge/cli.mjs; never inferred here. */
  activation?: Activation;
}
const SCOPE_KEYS = ['workspaceId', 'projectId', 'environmentId'] as const;

function data(result: { isError?: boolean; structuredContent?: { data: unknown } }, tool: string): Record<string, unknown> {
  const value = result.structuredContent?.data;
  if (result.isError || !isObject(value))
    throw new ClientError('verification_failed', `${tool} did not return a usable result. The credential may be expired or revoked; run \`zenith login\` again.`);
  return value;
}
const text = (value: unknown, max = 200): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
function scopes(value: unknown): string[] | null {
  return Array.isArray(value) && value.length <= 20 && value.every(entry => typeof entry === 'string' && /^[a-z]{1,20}$/.test(entry)) ? (value as string[]) : null;
}
/** Pass through only bounded primitives: the capability block is the backend's to extend. */
function capabilities(value: unknown): Record<string, string | number | boolean> {
  const report: Record<string, string | number | boolean> = {};
  if (!isObject(value)) return report;
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(report).length >= 20 || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
    if (typeof entry === 'boolean' || typeof entry === 'number') report[key] = entry;
    else if (typeof entry === 'string' && entry.length <= 200) report[key] = entry;
  }
  return report;
}

export async function status(client: ControlClient, env: NodeJS.ProcessEnv, now = Date.now()): Promise<Record<string, unknown>> {
  const tools = await client.catalog();
  const context = data(await client.call('zenith_get_context', {}), 'zenith_get_context');
  const capability = data(await client.call('zenith_get_capabilities', {}), 'zenith_get_capabilities');
  const selected = isObject(context.selected) ? context.selected : {};
  const scopeVerified = SCOPE_KEYS.every(key => selected[key] === client.scope[key]);
  const profile = await selectedProfile(env);
  const expiresAt = text(context.expiresAt, 40);
  const expires = expiresAt !== null ? Date.parse(expiresAt) : Number.NaN;
  const granted = scopes(context.scopes);
  return {
    ok: scopeVerified,
    contractVersion: 2,
    origin: client.origin,
    profile: profile === undefined
      ? { name: null, active: true, credentialSource: credentialSource(env), allowWrites: client.allowWrites }
      : { name: profile.name, active: profile.active, credentialSource: profile.credentialSource, allowWrites: profile.allowWrites },
    selected: client.scope,
    credential: {
      id: text(context.integrationId, 100) ?? text(context.credentialId, 100),
      label: text(context.label, 40),
      scopes: granted,
      expiresAt,
      expiresInDays: Number.isFinite(expires) ? Math.max(0, Math.round((expires - now) / 86_400_000)) : null,
    },
    capabilities: capabilities(capability),
    tools: tools.map(tool => tool.name),
    evidence: scopeVerified
      ? 'Authenticated tools, scope and capability report only. No provider health, no deployment verification. Fields the backend did not return are null.'
      : 'The backend did not confirm the exact selected scope. Check the profile and the approved projects before relying on any other field here.',
  };
}
function credentialSource(env: NodeJS.ProcessEnv): string {
  if (env.ZENITH_TOKEN_VAULT) return 'dpapi';
  if (env.ZENITH_TOKEN_FILE) return 'file';
  if (env.ZENITH_TOKEN_KEYCHAIN_SERVICE) return 'keychain';
  if (env.ZENITH_TOKEN) return 'environment';
  return 'unknown';
}

export async function statusCommand(args: string[], io: StatusIo = {}): Promise<void> {
  const env = io.env ?? process.env, out = io.out ?? (line => console.log(line));
  let json = false;
  for (const arg of args) {
    if (arg === '--json') { json = true; continue; }
    throw new ClientError('usage', 'status accepts only --json.');
  }
  const preview = isPreview(io.activation);
  const activation: Record<string, unknown> = io.activation === undefined
    ? {} : { activation: io.activation, ...(preview ? { verification: PREVIEW_NOTICE } : {}) };
  if (!env.ZENITH_URL && !(await resolveProfilesFile(env))) {
    // Not configured is a state, not a failure.
    if (json) out(JSON.stringify({ ok: true, linked: false, ...activation, next: 'Run `zenith login`.' }, null, 2));
    else { if (preview) out(`Build       ${PREVIEW_NOTICE}`); out('Not linked. Run `zenith login`.'); }
    return;
  }
  const report: Record<string, unknown> = { ...await status(io.client ?? await controlClient(env), env, io.now?.() ?? Date.now()), ...activation };
  if (json) { out(JSON.stringify(report, null, 2)); }
  else {
    if (preview) out(`Build       ${PREVIEW_NOTICE}`);
    const profile = report.profile as { name: string | null; credentialSource: string; allowWrites: boolean };
    const credential = report.credential as { id: string | null; label: string | null; scopes: string[] | null; expiresAt: string | null; expiresInDays: number | null };
    out(`Origin      ${report.origin}`);
    out(`Profile     ${profile.name ?? 'explicit environment settings'}  (credential: ${profile.credentialSource})`);
    out(`Selected    ${JSON.stringify(report.selected)}`);
    out(`Account     ${credential.label ?? 'not reported'}  (${credential.id ?? 'no credential id reported'})`);
    out(`Scopes      ${credential.scopes?.join(', ') ?? 'not reported'}`);
    out(`Expires     ${credential.expiresAt ?? 'not reported'}${credential.expiresInDays === null ? '' : `  (${credential.expiresInDays} days)`}`);
    out(`Writes      ${profile.allowWrites ? 'enabled locally' : 'not enabled locally'}`);
    out(`Capabilities ${JSON.stringify(report.capabilities)}`);
    out(`Tools       ${(report.tools as string[]).join(', ')}`);
    out(`\n${report.evidence as string}`);
  }
  if (report.ok !== true) process.exitCode = 1;
}
