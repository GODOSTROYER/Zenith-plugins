/**
 * `zenith login` / `zenith logout`.
 *
 * This is the only file that knows about all three credential stores, and it
 * invents no fourth one: each platform keeps the destination it already had.
 * The issued bearer is written to its store before anything is printed, and it
 * is never printed at all — not in human output, not under `--json`, not in a
 * diagnostic record.
 *
 * Every platform now ends in a named profile that becomes the active one, so a
 * running stdio server follows a re-link on its next call (reload.ts). Windows
 * keeps its DPAPI vault as the credential and references it from an
 * ACL-checked `%APPDATA%\zenith\profiles.json`; `--print-env` still prints the
 * older environment block instead.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, rm, unlink } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { ClientError } from '../client/dist/index.js';
import { VERSION } from '../bridge/doctor.mjs';
import { DEFAULT_REQUESTED_SCOPES, SCOPE_NAMES, WORKSPACE_NAME_HINT, linkOrigin, openBrowser, pollLink, startLink, type IssuedCredential } from './link.js';
import { defaultProfilesFile, loadProfiles, resolveProfilesFile, updateProfiles, writeProfile, type Profiles } from './profiles.js';
import { storeKeychain } from './keychain.js';
import { storeVault } from './vault.js';
import { PREVIEW_NOTICE, isPreview, withVerification, type Activation } from './activation.js';

export const DEFAULT_ORIGIN = 'https://tryzenith.cloud';
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/;
const VALUE_FLAGS = new Set(['--url', '--name', '--profiles', '--project', '--label', '--loopback', '--vault', '--keychain-service', '--keychain-account', '--scopes', '--workspace', '--new-workspace']);
const BOOLEAN_FLAGS = new Set(['--no-browser', '--json', '--keychain', '--revoke', '--print-env']);
const RELOAD_NOTE = 'A running Zenith MCP server switches to this profile on its next tool call. If your agent host ignores tool-list changes, reconnect the Zenith server once.';

export interface LoginIo {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  out?: (line: string) => void;
  err?: (line: string) => void;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  open?: (url: string) => boolean;
  /** Reported by the provenance gate in packages/bridge/cli.mjs; never inferred here. */
  activation?: Activation;
}
interface Flags { values: Record<string, string>; booleans: Set<string> }

function parseFlags(args: string[]): Flags {
  const values: Record<string, string> = {}, booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (BOOLEAN_FLAGS.has(key)) { if (booleans.has(key)) throw new ClientError('usage', `Repeat no flag: ${key}.`); booleans.add(key); continue; }
    if (!VALUE_FLAGS.has(key) || key in values) throw new ClientError('usage', `Unknown or repeated option: ${key}. Run \`zenith --help\` for the supported flags.`);
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new ClientError('usage', `${key} needs an explicit value.`);
    values[key] = value;
  }
  return { values, booleans };
}

/** The client identity is detected from the host agent, never asked for in chat. */
export function clientName(env: NodeJS.ProcessEnv): string {
  if (env.CLAUDE_PLUGIN_ROOT) return 'Claude Code';
  if (env.PLUGIN_ROOT || env.CODEX_HOME) return 'Codex';
  return 'Zenith CLI';
}
/** A label the user will recognise on the approval page, or nothing at all. */
export function hostLabel(raw = hostname()): string | undefined {
  const value = raw.trim().slice(0, 40);
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined;
}
export function defaultProfileName(origin: string): string {
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const first = host.split('.')[0] ?? '';
  const cleaned = first.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return PROFILE_NAME.test(cleaned) ? cleaned : 'zenith';
}
/** The name a new link is saved under: the workspace slug when the server named one. */
export function preferredProfileName(origin: string, credential: Pick<IssuedCredential, 'workspaceSlug'>): string {
  return credential.workspaceSlug !== undefined && PROFILE_NAME.test(credential.workspaceSlug) ? credential.workspaceSlug : defaultProfileName(origin);
}
export { defaultProfilesFile };
export function defaultVaultPath(env: NodeJS.ProcessEnv, name: string, home = homedir()): string {
  const base = env.LOCALAPPDATA && /^[A-Za-z]:\\/.test(env.LOCALAPPDATA) ? env.LOCALAPPDATA : path.win32.join(home, 'AppData', 'Local');
  return path.win32.join(base, 'ZenithPrivate', `${name}.dpapi`);
}
const days = (expiresAt: string, now: number): number => Math.max(0, Math.round((Date.parse(expiresAt) - now) / 86_400_000));
const exists = async (file: string): Promise<boolean> => { try { await lstat(file); return true; } catch { return false; } };

/** A browser approval that named the workspace, the projects and the scopes is the explicit
 *  write opt-in the local flag stood in for. The server still hides write tools when its own
 *  capability is off, and execution still needs a browser-approved digest. */
export const allowWritesFor = (scopes: readonly string[]): boolean => scopes.includes('write') || scopes.includes('publish');

async function writeTokenFile(file: string, token: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ClientError('credential_exists', `A credential file already exists at ${file}. Pass --name for a new link, or remove the old file after revoking it in Zenith.`);
    throw new ClientError('credential_write', 'Could not create the private credential file. Check the directory owner and permissions.');
  }
  try { await handle.writeFile(token); await handle.sync(); } finally { await handle.close(); }
}

/**
 * An explicit --name is used as given and refused later if taken. A derived name
 * steps to `name-2`, `name-3`, … past an existing profile or a leftover
 * credential file, so re-linking the same workspace never needs a flag.
 */
async function chooseName(explicit: string | undefined, preferred: string, taken: (name: string) => Promise<boolean>): Promise<string> {
  if (explicit !== undefined) return explicit;
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? preferred : `${preferred.slice(0, 36)}-${n}`;
    if (!await taken(candidate)) return candidate;
  }
  throw new ClientError('profile_exists', `Twenty profiles named after ${preferred} already exist. Pass --name, or remove old ones with \`zenith logout --name NAME\`.`);
}
async function profileNames(file: string, platform: NodeJS.Platform): Promise<Set<string>> {
  try { return new Set(Object.keys((await loadProfiles(file, platform)).profiles)); } catch { return new Set(); }
}

export async function loginCommand(args: string[], io: LoginIo = {}): Promise<void> {
  const env = io.env ?? process.env, platform = io.platform ?? process.platform;
  const out = io.out ?? (line => console.log(line)), err = io.err ?? (line => console.error(line));
  const { values, booleans } = parseFlags(args);
  const json = booleans.has('--json');
  const say = json ? err : out;
  // The first line of a login is what the person reads before they approve
  // anything, so an unverified build says so there rather than in a footer.
  if (isPreview(io.activation)) say(`Zenith connector: ${PREVIEW_NOTICE}\n`);
  if (values['--loopback'] !== undefined && !['0', '1'].includes(values['--loopback'])) throw new ClientError('usage', 'Boolean connection flags accept only 0 or 1.');
  const allowLoopbackHttp = values['--loopback'] === '1' || env.ZENITH_ALLOW_LOOPBACK_HTTP === '1';
  const origin = linkOrigin(values['--url'] ?? env.ZENITH_URL ?? DEFAULT_ORIGIN, allowLoopbackHttp);
  const explicitName = values['--name'];
  if (explicitName !== undefined && !PROFILE_NAME.test(explicitName)) throw new ClientError('usage', 'Use a 1-40 character profile name of letters, digits, underscore or hyphen.');
  const requestedScopes = values['--scopes'] ? values['--scopes'].split(',').map(scope => scope.trim()).filter(Boolean) : [...DEFAULT_REQUESTED_SCOPES];
  if (requestedScopes.some(scope => !SCOPE_NAMES.includes(scope))) throw new ClientError('usage', `Requested scopes must come from: ${SCOPE_NAMES.join(', ')}.`);
  const workspaceHint = values['--workspace'], workspaceNameHint = values['--new-workspace']?.trim();
  if (workspaceHint !== undefined && workspaceNameHint !== undefined) throw new ClientError('usage', 'Use --workspace for an existing workspace or --new-workspace for a new one, not both.');
  if (workspaceHint !== undefined && !IDENTIFIER.test(workspaceHint)) throw new ClientError('usage', '--workspace takes a Zenith workspace ID (letters, digits, underscore or hyphen).');
  if (workspaceNameHint !== undefined && !WORKSPACE_NAME_HINT.test(workspaceNameHint)) throw new ClientError('usage', '--new-workspace takes a 1-60 character name of letters, digits, spaces, dots, apostrophes, underscores or hyphens.');
  if (values['--project'] !== undefined && !IDENTIFIER.test(values['--project'])) throw new ClientError('usage', '--project takes a Zenith project ID.');
  const printEnv = booleans.has('--print-env');
  if (printEnv && platform !== 'win32') throw new ClientError('usage', '--print-env is the Windows environment-block mode; POSIX logins always write a named profile.');
  if (printEnv && booleans.has('--keychain')) throw new ClientError('usage', 'Choose --print-env or --keychain, not both.');
  const label = values['--label'] ?? hostLabel();

  const controller = new AbortController();
  const stop = () => controller.abort();
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const external = io.signal;
  if (external) { if (external.aborted) stop(); else external.addEventListener('abort', stop, { once: true }); }
  else for (const received of signals) process.once(received, stop);
  let credential: IssuedCredential;
  try {
    const transport = {
      origin, allowLoopbackHttp, signal: controller.signal,
      ...(io.fetch ? { fetch: io.fetch } : {}),
      ...(env.ZENITH_DIAGNOSTICS === '1' ? { diagnostic: (record: Record<string, unknown>) => err(JSON.stringify(record)) } : {}),
    };
    const start = await startLink({
      ...transport, clientName: withVerification(clientName(env), io.activation), clientVersion: VERSION, ...(label === undefined ? {} : { label }), requestedScopes,
      ...(workspaceHint === undefined ? {} : { workspaceHint }), ...(workspaceNameHint === undefined ? {} : { workspaceNameHint }),
    });
    say('Zenith link\n');
    say(`  1. Open   ${start.verificationUriComplete}`);
    say(`  2. Check the code shown there matches:   ${start.userCode}`);
    if (workspaceNameHint !== undefined && start.hintsDelivered) {
      say(`  3. Sign in. Under "Create a new workspace", check the name (${workspaceNameHint}) and click Create.`);
      say('  4. With the new workspace selected, choose Whole workspace, pick the scopes and approve.\n');
    } else say('  3. Sign in, choose the workspace and its projects (or Whole workspace), and approve.\n');
    if ((workspaceHint !== undefined || workspaceNameHint !== undefined) && !start.hintsDelivered)
      say(`This Zenith instance speaks link protocol 1, so the workspace hint was not sent.${workspaceNameHint !== undefined ? ` Create the workspace first at ${origin}/onboarding, then choose it on the page.` : ' Choose the workspace on the page.'}\n`);
    say(`Waiting for approval (expires in ${Math.round(start.expiresIn / 60)} minutes). Press Ctrl-C to stop.`);
    if (!booleans.has('--no-browser')) (io.open ?? (url => openBrowser(url, platform, env)))(start.verificationUriComplete);
    credential = await pollLink({
      ...transport, deviceCode: start.deviceCode, interval: start.interval, expiresIn: start.expiresIn, protocolVersion: start.protocolVersion,
      ...(io.sleep ? { sleep: io.sleep } : {}),
    });
  } finally {
    if (external) external.removeEventListener('abort', stop);
    else for (const received of signals) process.off(received, stop);
  }

  const allowWrites = allowWritesFor(credential.scopes);
  // A whole-workspace grant is never pinned implicitly: a pin would hide every
  // project created later and refuse workspace-level changes. An explicit
  // --project still narrows, exactly as the server treats the header.
  const projectId = values['--project'] ?? (!credential.allProjects && credential.projectIds.length === 1 ? credential.projectIds[0] : undefined);
  if (projectId !== undefined && !credential.allProjects && !credential.projectIds.includes(projectId))
    throw new ClientError('scope_denied', 'The approval did not include that project. The credential is not stored; run `zenith login` again and approve it.');
  const scope = { version: 1 as const, workspaceId: credential.workspaceId, ...(projectId === undefined ? {} : { projectId }) };
  const scopeMode = credential.allProjects ? 'workspace' : 'projects';
  const report: Record<string, unknown> = {
    linked: true, origin, credentialId: credential.credentialId, ...(credential.label === undefined ? {} : { label: credential.label }),
    workspaceId: credential.workspaceId, scopeMode, allProjects: credential.allProjects, projectIds: credential.projectIds, environmentIds: credential.environmentIds,
    scopes: credential.scopes, expiresAt: credential.expiresAt, allowWrites,
    ...(projectId === undefined ? {} : { pinnedProject: projectId }),
    ...(workspaceHint !== undefined && workspaceHint !== credential.workspaceId ? { note: `The browser approved workspace ${credential.workspaceId}, not the hinted ${workspaceHint}.` } : {}),
    ...(io.activation === undefined ? {} : { activation: io.activation }),
    ...(isPreview(io.activation) ? { verification: PREVIEW_NOTICE } : {}),
  };
  const preferred = preferredProfileName(origin, credential);
  const file = values['--profiles'] ?? env.ZENITH_PROFILES_FILE ?? defaultProfilesFile(env, homedir(), platform);
  const finish = (lines: string[]) => {
    if (json) { out(JSON.stringify(report, null, 2)); return; }
    printGranted(out, origin, allowWrites, credential, projectId);
    for (const line of lines) out(line);
  };

  if (platform === 'win32') {
    const names = printEnv ? new Set<string>() : await profileNames(file, platform);
    const name = await chooseName(explicitName, preferred, async candidate => names.has(candidate) || (values['--vault'] === undefined && await exists(defaultVaultPath(env, candidate))));
    const vault = values['--vault'] ?? defaultVaultPath(env, name);
    if (printEnv) {
      await storeVault(vault, credential.token);
      const environment = {
        ZENITH_API_VERSION: '2', ZENITH_URL: origin, ZENITH_WORKSPACE_ID: credential.workspaceId,
        ...(projectId === undefined ? {} : { ZENITH_PROJECT_ID: projectId }),
        ZENITH_TOKEN_VAULT: vault, ...(allowWrites ? { ZENITH_ALLOW_WRITES: '1' } : {}),
        ...(allowLoopbackHttp ? { ZENITH_ALLOW_LOOPBACK_HTTP: '1' } : {}),
      };
      Object.assign(report, { credential: { kind: 'dpapi', path: vault }, profile: null, environment });
      finish(['\nCredential stored (Windows CurrentUser DPAPI):', `  ${vault}`,
        '\nSet these for the agent process, then restart it (explicit variables turn the named-profile lookup off):',
        ...Object.entries(environment).map(([key, value]) => `  ${key}=${value}`)]);
      return;
    }
    await refuseExistingProfile(file, name, platform);
    await storeVault(vault, credential.token);
    await persistProfile(file, name, { origin, scope, allowLoopbackHttp, allowWrites, credentialKind: 'opaque', credential: { kind: 'dpapi', path: vault } },
      () => rm(vault, { force: true }), platform);
    Object.assign(report, { credential: { kind: 'dpapi', path: vault }, profile: { name, file, active: true } });
    finish([`\n  Profile     ${name}  (${file}, now active)`, `  Credential  ${vault}  (Windows CurrentUser DPAPI)`, ...nextSteps(env, file, platform)]);
    return;
  }

  if (booleans.has('--keychain')) {
    if (platform !== 'darwin') throw new ClientError('keychain_platform', 'macOS Keychain credentials require macOS; use the private token file on other POSIX hosts.');
    const names = await profileNames(file, platform);
    const name = await chooseName(explicitName, preferred, async candidate => names.has(candidate));
    const service = values['--keychain-service'] ?? `zenith:${new URL(origin).hostname}`;
    const account = values['--keychain-account'] ?? name;
    await refuseExistingProfile(file, name, platform);
    await storeKeychain(service, account, credential.token);
    await persistProfile(file, name, { origin, scope, allowLoopbackHttp, allowWrites, credentialKind: 'opaque', credential: { kind: 'keychain', service, account } }, async () => {}, platform);
    Object.assign(report, { credential: { kind: 'keychain', service, account }, profile: { name, file, active: true } });
    finish([`\n  Profile     ${name}  (${file}, now active)`, `  Credential  macOS Keychain ${service} / ${account}`, ...nextSteps(env, file, platform)]);
    return;
  }

  const names = await profileNames(file, platform);
  const tokenFor = (candidate: string) => path.join(path.dirname(file), `${candidate}.token`);
  const name = await chooseName(explicitName, preferred, async candidate => names.has(candidate) || await exists(tokenFor(candidate)));
  const tokenFile = tokenFor(name);
  await refuseExistingProfile(file, name, platform);
  await writeTokenFile(tokenFile, credential.token);
  await persistProfile(file, name, { origin, scope, allowLoopbackHttp, allowWrites, credentialKind: 'opaque', credential: { kind: 'file', path: tokenFile } },
    () => unlink(tokenFile).catch(() => {}), platform);
  Object.assign(report, { credential: { kind: 'file', path: tokenFile }, profile: { name, file, active: true } });
  finish([`\n  Profile     ${name}  (${file}, now active)`, `  Credential  ${tokenFile}  (0600)`, ...nextSteps(env, file, platform)]);
}

/** A best-effort pre-check so a refusal does not leave an orphan credential behind.
 *  The authoritative, race-free check is inside writeProfile's locked update. */
async function refuseExistingProfile(file: string, name: string, platform: NodeJS.Platform): Promise<void> {
  let document: Profiles;
  try { document = await loadProfiles(file, platform); } catch { return; }
  if (Object.hasOwn(document.profiles, name))
    throw new ClientError('profile_exists', `A profile named ${name} already exists in ${file}. Pass --name for a new one, or run \`zenith logout --name ${name}\` first.`);
}
async function persistProfile(file: string, name: string, definition: unknown, rollback: () => Promise<void>, platform: NodeJS.Platform): Promise<void> {
  try { await writeProfile(file, name, definition, { activate: true, platform }); }
  catch (error) { await rollback(); throw error; }
}
function printGranted(out: (line: string) => void, origin: string, allowWrites: boolean, credential: IssuedCredential, pinned: string | undefined): void {
  out(`\nLinked to ${origin}${credential.label ? ` as ${credential.label}` : ''}.`);
  out(`  Workspace   ${credential.workspaceId}`);
  out(`  Projects    ${credential.allProjects ? 'Whole workspace: every current and future project, plus workspace settings' : credential.projectIds.join(', ')}`);
  if (pinned !== undefined) out(`  Pinned      ${pinned}`);
  out(`  Scopes      ${credential.scopes.join(', ')}`);
  out(`  Expires     ${credential.expiresAt}  (${days(credential.expiresAt, Date.now())} days)`);
  out(`  Writes      ${allowWrites ? 'enabled by the browser approval' : 'not granted'}`);
}
/** The server finds the default file by itself; any other file must be named for it. */
function nextSteps(env: NodeJS.ProcessEnv, file: string, platform: NodeJS.Platform): string[] {
  if (file === defaultProfilesFile(env, homedir(), platform) || env.ZENITH_PROFILES_FILE === file) return [`\n${RELOAD_NOTE}`];
  return ['\nThis is not the default profiles file. Set these for the agent process, then restart it once:', '  ZENITH_API_VERSION=2', `  ZENITH_PROFILES_FILE=${file}`, `After that: ${RELOAD_NOTE}`];
}

export async function logoutCommand(args: string[], io: LoginIo = {}): Promise<void> {
  const env = io.env ?? process.env, platform = io.platform ?? process.platform;
  const out = io.out ?? (line => console.log(line));
  const { values, booleans } = parseFlags(args);
  const origin = values['--url'] ?? env.ZENITH_URL ?? DEFAULT_ORIGIN;
  const removed: string[] = [];

  if (platform === 'win32' && values['--vault'] !== undefined) {
    // The `--print-env` layout: a vault with no profile referencing it.
    await rm(values['--vault'], { force: true });
    removed.push(values['--vault']);
  } else {
    const file = values['--profiles'] ?? env.ZENITH_PROFILES_FILE ?? defaultProfilesFile(env, homedir(), platform);
    let document: Profiles;
    try { document = await loadProfiles(file, platform); }
    catch { throw new ClientError('profile_missing', `No named profiles were found at ${file}. Nothing was removed.${platform === 'win32' ? ' A --print-env login is removed with --vault PATH.' : ''}`); }
    const name = values['--name'] ?? document.active;
    const profile = Object.hasOwn(document.profiles, name) ? document.profiles[name] : undefined;
    if (!profile) throw new ClientError('profile_missing', `No profile named ${name} exists in ${file}. Nothing was removed.`);
    const remaining = Object.keys(document.profiles).filter(other => other !== name);
    if (remaining.length) {
      await updateProfiles(file, current => {
        if (!current || !Object.hasOwn(current.profiles, name)) throw new ClientError('profile_missing', 'The profile changed while it was being removed. Nothing was written.');
        const profiles = { ...current.profiles }; delete profiles[name];
        const active = current.active === name ? Object.keys(profiles)[0]! : current.active;
        return { ...current, active, profiles };
      }, platform);
      const next = (await loadProfiles(file, platform)).active;
      out(`Removed profile ${name}. The active profile is now ${next}; a running Zenith MCP server switches on its next call.`);
    } else {
      // A profile document must name an existing active profile, so the last
      // profile cannot be represented as an empty one. Remove the file under
      // the same lock convention `updateProfiles` uses.
      const lock = await open(`${file}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
        .catch(() => { throw new ClientError('profile_busy', 'Another profile edit may be active. Do not remove its lock without checking.'); });
      try { await rm(file, { force: true }); } finally { await lock.close(); await unlink(`${file}.lock`).catch(() => {}); }
      out(`Removed profile ${name} and the profiles file ${file}; it held no other profile.`);
    }
    // Only unlink a credential this profile alone referenced.
    if (profile.credential.kind === 'file' || profile.credential.kind === 'dpapi') {
      const target = profile.credential.path;
      const shared = remaining.some(other => {
        const entry = document.profiles[other];
        return entry !== undefined && (entry.credential.kind === 'file' || entry.credential.kind === 'dpapi') && entry.credential.path === target;
      });
      if (!shared) { await rm(target, { force: true }); removed.push(target); }
    } else if (profile.credential.kind === 'keychain') {
      out(`The macOS Keychain item ${profile.credential.service} / ${profile.credential.account} was left in place. Remove it with \`security delete-generic-password -s ${profile.credential.service} -a ${profile.credential.account}\` once it is revoked.`);
    }
  }

  for (const file of removed) out(`Removed local credential ${file}.`);
  out('Removing a credential locally does not revoke it: it stays valid in Zenith until it expires.');
  out(`Revoke it now at ${new URL(origin).origin}/integrations  ->  Linked agents.`);
  if (booleans.has('--revoke')) {
    // The revoke endpoint is browser-only by design: it refuses any request
    // carrying an authorization header, so a credential can never revoke
    // itself. All this flag can honestly do is open the page.
    (io.open ?? (url => openBrowser(url, platform, env)))(`${new URL(origin).origin}/integrations`);
  }
}

/** Reader used by `status` so it does not reimplement profile selection. */
export async function selectedProfile(env: NodeJS.ProcessEnv): Promise<{ file: string; name: string; active: boolean; credentialSource: string; allowWrites: boolean } | undefined> {
  const file = await resolveProfilesFile(env);
  if (!file) return undefined;
  const document = await loadProfiles(file);
  const name = env.ZENITH_PROFILE ?? document.active;
  const profile = Object.hasOwn(document.profiles, name) ? document.profiles[name] : undefined;
  if (!profile) throw new ClientError('profile_missing', 'Select an existing named connection.');
  return { file, name, active: document.active === name, credentialSource: profile.credential.kind, allowWrites: profile.allowWrites };
}
