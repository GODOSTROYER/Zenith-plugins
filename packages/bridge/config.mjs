/** Explicit, private user configuration. Project files can select IDs, never destinations. */
import { constants } from 'node:fs';
import { open, lstat, mkdir, link, unlink } from 'node:fs/promises';
import { isAbsolute, dirname, basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZenithClient, ClientError, association, endpoint, isObject } from '../client/dist/index.js';

const fail = (code, message) => { throw new ClientError(code, message); };
/** Node 22's Windows path stat can expose a 64-bit volume serial while fstat exposes
 * its 32-bit counterpart. Compare that common serial width and the complete inode;
 * bigint prevents precision loss. POSIX still compares the full device identifier.
 * See nodejs/node v22.16.0 deps/uv/src/win/fs.c fs__stat_path/fs__stat_handle.
 */
export function sameFileIdentity(before, after, platform = process.platform) {
  const device = value => platform === 'win32' ? BigInt.asUintN(32, value) : value;
  return device(before.dev) === device(after.dev) && before.ino === after.ino;
}
/** Bound allocation and reads even if a file grows after stat; refuse FIFOs and final symlinks. */
/** `aclVerified`: Windows only, for a file whose directory and file ACLs the native
 * helper has just verified (named profiles). Such a volume may still report no
 * device identity; the file index must then be non-zero and match across the
 * path and handle stats. Every other caller keeps the zero-device refusal. */
export async function readBoundedFile(filePath, maxBytes, privateFile = false, aclVerified = false) {
  if (!isAbsolute(filePath)) fail('configuration_path', 'Use an explicit absolute file path. No repository discovery occurs.');
  if (privateFile && process.platform === 'win32') fail('file_acl_unverified', 'Private-file ACL validation is not implemented on Windows. Use the explicit environment credential configuration.');
  const before = await lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail('unsafe_file', 'Configuration and credentials must be regular files, not links or devices.');
  // Some Windows path-stat implementations report no device identity. Never
  // treat zero as a wildcard or compare only an inode across volumes.
  const noDevice = process.platform === 'win32' && before.dev === 0n;
  if (noDevice && !(aclVerified && before.ino !== 0n))
    fail('file_identity_unverified', 'This Windows runtime does not report a verifiable file device identity. Use explicit scope environment variables instead of an association file.');
  const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat({ bigint: true });
    const same = noDevice ? stat.ino === before.ino : sameFileIdentity(before, stat);
    if (!stat.isFile() || !same || stat.size > BigInt(maxBytes))
      fail('unsafe_file', 'The file changed identity or exceeds its size limit.');
    if (privateFile && ((stat.mode & 0o077n) !== 0n || stat.uid !== BigInt(process.getuid())))
      fail('credential_permissions', 'Use an owned private regular file with mode 0600.');
    const bytes = Buffer.alloc(maxBytes + 1); let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await file.read(bytes, used, bytes.length - used, used);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > maxBytes) fail('file_too_large', 'The file exceeds its bounded configuration size.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
  } finally { await file.close(); }
}
export async function readCredential(filePath) {
  const value = (await readBoundedFile(filePath, 256, true)).trim();
  if (!/^za_[A-Za-z0-9_-]{43}$/.test(value)) fail('invalid_credential', 'Use a Zenith agent credential, not a cookie, provider key, or arbitrary token.');
  return value;
}
export function profile(value) {
  if (!isObject(value) || value.version !== 1 || Object.keys(value).some(k => !['version', 'origin', 'allowLoopbackHttp', 'association', 'tokenFile'].includes(k))
    || typeof value.origin !== 'string' || typeof value.tokenFile !== 'string' || !isAbsolute(value.tokenFile)
    || value.allowLoopbackHttp !== undefined && typeof value.allowLoopbackHttp !== 'boolean')
    fail('invalid_profile', 'Use profile version 1 with origin, association, an absolute tokenFile, and optional allowLoopbackHttp. Raw credentials are forbidden.');
  const url = endpoint(value.origin, value.allowLoopbackHttp === true);
  return Object.freeze({ version: 1, origin: url.origin, allowLoopbackHttp: value.allowLoopbackHttp === true,
    association: association(value.association), tokenFile: value.tokenFile });
}
/** Publish a new profile atomically without replacing an existing file or following its symlink. */
export async function writeProfile(output, value) {
  if (!isAbsolute(output)) fail('configuration_path', 'Choose an absolute profile path in your private user configuration directory.');
  const checked = profile(value);
  if (resolve(output) === resolve(checked.tokenFile)) fail('configuration_path', 'Profile and credential must be different files.');
  await readCredential(checked.tokenFile); // Validate locally; no network or credential copying.
  const parent = dirname(output);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    fail('profile_directory', 'Choose an owned, non-symlink private directory with mode 0700. Existing directory permissions are not changed.');
  const temporary = join(parent, `.${basename(output)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await file.writeFile(`${JSON.stringify(checked, null, 2)}\n`); await file.sync(); await file.close(); file = undefined;
    await link(temporary, output); // Atomic create-if-absent, including for dangling destination symlinks.
  } catch (error) {
    if (error?.code === 'EEXIST') fail('profile_exists', 'The destination already exists. Choose a new profile path; setup never overwrites files.');
    throw error;
  } finally {
    await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return checked;
}
const configurationKeys = ['ZENITH_URL', 'ZENITH_TOKEN', 'ZENITH_TOKEN_FILE', 'ZENITH_WORKSPACE_ID', 'ZENITH_PROJECT_ID',
  'ZENITH_ENVIRONMENT_ID', 'ZENITH_ASSOCIATION_FILE', 'ZENITH_ALLOW_LOOPBACK_HTTP'];
export async function configuredClient(env = process.env) {
  let origin, scope, allowLoopbackHttp, token;
  if (env.ZENITH_CONFIG_FILE) {
    if (configurationKeys.some(k => env[k] !== undefined)) fail('ambiguous_configuration', 'Choose ZENITH_CONFIG_FILE or individual ZENITH connection variables, not both.');
    const selected = profile(JSON.parse(await readBoundedFile(env.ZENITH_CONFIG_FILE, 8192, true)));
    origin = selected.origin; scope = selected.association; allowLoopbackHttp = selected.allowLoopbackHttp;
    token = () => readCredential(selected.tokenFile);
  } else {
    if (!env.ZENITH_URL) fail('configuration', 'Set ZENITH_CONFIG_FILE or a trusted ZENITH_URL with explicit scope and credential configuration.');
    origin = env.ZENITH_URL;
    if (env.ZENITH_ALLOW_LOOPBACK_HTTP !== undefined && !['0', '1'].includes(env.ZENITH_ALLOW_LOOPBACK_HTTP))
      fail('configuration', 'ZENITH_ALLOW_LOOPBACK_HTTP accepts only 0 or 1.');
    allowLoopbackHttp = env.ZENITH_ALLOW_LOOPBACK_HTTP === '1';
    scope = { version: 1, workspaceId: env.ZENITH_WORKSPACE_ID };
    if (env.ZENITH_PROJECT_ID) scope.projectId = env.ZENITH_PROJECT_ID;
    if (env.ZENITH_ENVIRONMENT_ID) scope.environmentId = env.ZENITH_ENVIRONMENT_ID;
    if (env.ZENITH_ASSOCIATION_FILE) {
      if (['ZENITH_WORKSPACE_ID', 'ZENITH_PROJECT_ID', 'ZENITH_ENVIRONMENT_ID'].some(k => env[k] !== undefined))
        fail('ambiguous_configuration', 'Choose an association file or individual scope variables, not both.');
      scope = JSON.parse(await readBoundedFile(env.ZENITH_ASSOCIATION_FILE, 4096));
    }
    if (!!env.ZENITH_TOKEN === !!env.ZENITH_TOKEN_FILE) fail('configuration', 'Choose exactly one of ZENITH_TOKEN_FILE or ZENITH_TOKEN. There is no demo-admin fallback.');
    const tokenFile = env.ZENITH_TOKEN_FILE, tokenValue = env.ZENITH_TOKEN;
    token = tokenFile ? () => readCredential(tokenFile) : async () => tokenValue;
  }
  return new ZenithClient({ origin, association: association(scope), token, allowLoopbackHttp,
    ...(env.ZENITH_DIAGNOSTICS === '1' ? { onDiagnostic: record => console.error(JSON.stringify(record)) } : {}) });
}
export async function setup(args) {
  const values = {}; const flags = new Set(['--output', '--url', '--workspace', '--project', '--environment', '--token-file']);
  let allowLoopbackHttp = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--allow-loopback-http' && !allowLoopbackHttp) { allowLoopbackHttp = true; continue; }
    if (!flags.has(key) || key in values || !args[i + 1] || args[i + 1].startsWith('--'))
      fail('usage', 'Use setup --output ABSOLUTE_PATH --url TRUSTED_ORIGIN --workspace ID --token-file ABSOLUTE_PATH [--project ID] [--environment ID] [--allow-loopback-http]. Never pass a raw token.');
    values[key] = args[++i];
  }
  if (['--output', '--url', '--workspace', '--token-file'].some(k => !values[k])) fail('usage', 'Setup requires output, url, workspace, and token-file. Run --help for the complete syntax.');
  const scope = { version: 1, workspaceId: values['--workspace'] };
  if (values['--project']) scope.projectId = values['--project'];
  if (values['--environment']) scope.environmentId = values['--environment'];
  await writeProfile(values['--output'], { version: 1, origin: values['--url'], association: scope, tokenFile: values['--token-file'], allowLoopbackHttp });
  return { ok: true, mode: 'read-only', profileFile: values['--output'],
    evidence: 'Local configuration only; no authentication or provider verification performed.',
    next: 'Set ZENITH_CONFIG_FILE to this path in the agent environment, unset individual connection variables, then run doctor.' };
}
