#!/usr/bin/env node
/**
 * Trusted activation launcher for installed Zenith plugin packages.
 *
 * This file is installed outside the plugin directory — as the
 * `zenith-plugin-launcher` bin of a verified checkout or archive, or copied to
 * an absolute operator-owned path by a trusted installer. It verifies the
 * package before Node imports any package-owned runtime module, so the package
 * cannot replace the provenance checker that protects its own activation.
 *
 * What this cannot prove: an MCP client reads its own server configuration
 * before any of this runs. If that configuration does not name this launcher,
 * nothing here is reached. The host MCP configuration is therefore the trust
 * root and must be written by a trusted installer, not by the package. See
 * docs/provenance.md.
 */
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { cp, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProvenanceError, assertTrustInputPath, verifyPackageDirectory, versionFloorKey } from '../provenance/index.mjs';
import { readLastGood, recordLastGood, statePath } from './state.mjs';

export const LAUNCHER_COMMAND = 'zenith-plugin-launcher';
const DESCRIPTOR = '.mcp.json';

async function jsonFile(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new ProvenanceError('provenance_required', `The ${label} could not be read from the trusted installer path.`); }
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Compare descriptor entries and command-line entries in one spelling. */
export function normalizeEntry(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const posix = path.posix.normalize(value.split('\\').join('/'));
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

function parseArgs(input = process.argv.slice(2)) {
  const packageFlag = input.indexOf('--package-dir');
  const entryFlag = input.indexOf('--entry');
  if (packageFlag < 0 || entryFlag < 0 || !input[packageFlag + 1] || !input[entryFlag + 1])
    throw new ProvenanceError('usage', `Use: ${LAUNCHER_COMMAND} --package-dir PACKAGE_DIR --entry RELATIVE_ENTRY [args…].`);
  const packageDir = input[packageFlag + 1];
  if (!path.isAbsolute(packageDir))
    throw new ProvenanceError('provenance_required', 'PACKAGE_DIR must be an absolute path supplied by the trusted installer.');
  const entryRelative = normalizeEntry(input[entryFlag + 1]);
  if (!entryRelative || path.isAbsolute(input[entryFlag + 1]) || !within(packageDir, path.resolve(packageDir, entryRelative)))
    throw new ProvenanceError('usage', 'The package entry must be a relative path inside the package directory.');
  const skip = new Set([packageFlag, packageFlag + 1, entryFlag, entryFlag + 1]);
  return { packageDir: path.resolve(packageDir), entryRelative, childArgs: input.filter((_, index) => !skip.has(index)) };
}

/**
 * Copy the package into a directory only this process can write, so the bytes
 * that are hashed are the bytes Node later imports. Verifying the installed
 * directory and then spawning from it leaves a window in which anyone who can
 * write that directory swaps a file between the two steps.
 *
 * Symlinks are copied verbatim rather than followed, so a link cannot become an
 * innocent regular file in the copy; the inventory then refuses it outright.
 */
export async function stagePackage(packageDir, { platform = process.platform } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'zenith-plugin-'));
  const cleanup = () => rm(root, { recursive: true, force: true }).catch(() => {});
  try {
    if (platform !== 'win32') {
      const info = await lstat(root);
      if ((info.mode & 0o077) !== 0)
        throw new ProvenanceError('unsafe_staging', 'The staging directory is not private to this user; refusing to verify bytes another user can change.');
    }
    await cp(packageDir, root, { recursive: true, verbatimSymlinks: true });
  } catch (error) {
    await cleanup();
    if (error instanceof ProvenanceError) throw error;
    throw new ProvenanceError('staging_failed', `The package could not be staged for verification: ${error.message}`);
  }
  return { dir: root, cleanup };
}

/**
 * Bind the spawned entry to the descriptor the publisher signed. Package bytes
 * are already verified, so `.mcp.json` here is publisher content; this refuses
 * a host registration that points the launcher at some other signed file in the
 * package, such as a different CLI, instead of the registered bridge entry.
 */
export async function assertDescriptorBinding(verifiedDir, entryRelative) {
  let descriptor;
  try { descriptor = JSON.parse(await readFile(path.join(verifiedDir, DESCRIPTOR), 'utf8')); }
  catch { throw new ProvenanceError('descriptor_missing', `The signed package has no readable ${DESCRIPTOR} to bind this invocation to.`); }
  const servers = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)
    ? (descriptor.mcpServers && typeof descriptor.mcpServers === 'object' && !Array.isArray(descriptor.mcpServers) ? descriptor.mcpServers : descriptor)
    : undefined;
  const declared = Object.values(servers ?? {}).filter(entry => entry && typeof entry === 'object' && Array.isArray(entry.args));
  if (!declared.length) throw new ProvenanceError('descriptor_mismatch', `The signed ${DESCRIPTOR} declares no launcher invocation.`);
  const matched = declared.some(entry => {
    if (entry.command !== LAUNCHER_COMMAND) return false;
    const index = entry.args.indexOf('--entry');
    return index >= 0 && normalizeEntry(entry.args[index + 1]) === entryRelative;
  });
  if (!matched) throw new ProvenanceError('descriptor_mismatch',
    `The signed ${DESCRIPTOR} does not register ${LAUNCHER_COMMAND} with entry ${entryRelative}. Refusing an entry the publisher did not register.`);
  return { entry: entryRelative };
}

const warn = (code, message) => console.error(JSON.stringify({ level: 'warn', code, message }));

async function main() {
  const { packageDir, entryRelative, childArgs } = parseArgs();
  const manifestPath = (await assertTrustInputPath(process.env.ZENITH_PROVENANCE_MANIFEST, 'ZENITH_PROVENANCE_MANIFEST')).path;
  const trust = await assertTrustInputPath(process.env.ZENITH_PROVENANCE_TRUST, 'ZENITH_PROVENANCE_TRUST');
  if (!trust.permissionsChecked) warn('trust_permissions_unverified', trust.reason);
  const envelope = await jsonFile(manifestPath, 'publisher manifest');
  const trustedKeys = await jsonFile(trust.path, 'publisher trust allowlist');

  const state = await statePath(trust.path);
  // The default location is the trust directory, already reported above; only
  // an override adds a second unchecked directory worth naming.
  if (state.overridden && !state.permissionsChecked) warn('state_permissions_unverified', state.reason);
  const stateFile = state.path;
  // The subject name is read from the unverified envelope only to select the
  // recorded floor. It is signed, so a changed subject fails verification.
  const lastGood = await readLastGood(stateFile, versionFloorKey(envelope?.manifest));

  const staging = await stagePackage(packageDir);
  try {
    const result = await verifyPackageDirectory(staging.dir, envelope, { trustedKeys, minimumVersion: lastGood?.version });
    await assertDescriptorBinding(staging.dir, entryRelative);
    const recorded = await recordLastGood(stateFile, result, { required: process.env.ZENITH_PROVENANCE_STATE_REQUIRED === '1' });
    if (!recorded.recorded && recorded.reason.startsWith('The rollback floor could not be written'))
      warn('rollback_floor_not_recorded', `${recorded.reason} Set ZENITH_PROVENANCE_STATE to a writable operator path, or pin minimumVersions in the trust file.`);

    const child = spawn(process.execPath, [path.join(staging.dir, entryRelative), ...childArgs], {
      cwd: staging.dir,
      env: { ...process.env, ZENITH_PROVENANCE_EXTERNAL_VERIFIED: '1' },
      stdio: 'inherit',
    });
    const forward = signal => () => child.kill(signal);
    const onInterrupt = forward('SIGINT'), onTerminate = forward('SIGTERM');
    process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
    try {
      const { code, signal } = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
      });
      await staging.cleanup();
      if (signal) process.kill(process.pid, signal);
      process.exitCode = code ?? 1;
    } finally {
      process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate);
    }
  } finally { await staging.cleanup(); }
}

/** Node resolves module paths through symlinks — npm's bin shim is one — while argv keeps the
 * invoked path. Compare real paths so the bin entry still recognises itself as the program. */
function isMain(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl)); }
  catch { return false; }
}

if (isMain(import.meta.url)) main().catch(error => {
  const code = error instanceof ProvenanceError ? error.code : 'launcher_failed';
  console.error(JSON.stringify({ level: 'error', code, message: error.message }));
  process.exitCode = 1;
});
