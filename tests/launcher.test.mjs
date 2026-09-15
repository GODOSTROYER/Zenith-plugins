import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { signedPackageEnvironment } from './provenance-fixture.mjs';
import { createPackageManifest, signReleaseManifest } from '../packages/provenance/index.mjs';
import { assertDescriptorBinding, normalizeEntry, stagePackage } from '../packages/launcher/cli.mjs';
import { STATE_FILENAME, readLastGood, recordLastGood, statePath } from '../packages/launcher/state.mjs';

const launcher = path.resolve('packages/launcher/cli.mjs');
const posixOnly = { skip: process.platform === 'win32' ? 'POSIX file modes; Windows ACLs are reported unverified instead.' : false };

function runAt(binary, args, env, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [binary, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
const run = (args, env) => runAt(launcher, args, env, undefined);

/**
 * A minimal signed package: a descriptor registering the launcher, one entry
 * and a package.json version. Used where the test needs two versions of the
 * same subject, which the committed development packages cannot provide.
 */
async function miniPackage(t, version, { entry = 'entry.mjs', descriptorEntry = 'entry.mjs' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith mini package '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'zenith-launcher-fixture', version }));
  await writeFile(path.join(dir, '.mcp.json'), JSON.stringify({
    zenith: { command: 'zenith-plugin-launcher', args: ['--package-dir', '${PLUGIN_ROOT}', '--entry', descriptorEntry, 'stdio'] },
  }));
  await writeFile(path.join(dir, entry), 'process.stdout.write(`entry ${process.cwd()}\\n`);\n');
  await writeFile(path.join(dir, 'other.mjs'), 'process.stdout.write("other\\n");\n');
  return dir;
}

async function signedEnvironment(t, packageDir, control) {
  const dir = control ?? await mkdtemp(path.join(tmpdir(), 'zenith mini control '));
  if (!control) t.after(() => rm(dir, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const envelope = signReleaseManifest(await createPackageManifest(packageDir), {
    keyId: 'test-publisher', privateKey,
    signedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const manifestPath = path.join(dir, 'publisher-manifest.json');
  const trustPath = path.join(dir, 'trusted-keys.json');
  await writeFile(manifestPath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  await writeFile(trustPath, `${JSON.stringify({ version: 1, keys: [{ id: 'test-publisher', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }] })}\n`, { mode: 0o600 });
  return { dir, manifestPath, trustPath, env: { ...process.env, ZENITH_PROVENANCE_MANIFEST: manifestPath, ZENITH_PROVENANCE_TRUST: trustPath } };
}

test('trusted launcher verifies before importing a package-owned runtime', { timeout: 20000 }, async t => {
  const packageDir = await mkdtemp(path.join(tmpdir(), 'zenith launcher package '));
  t.after(() => rm(packageDir, { recursive: true, force: true }));
  await cp(path.resolve('plugins/codex'), packageDir, { recursive: true });
  const provenance = await signedPackageEnvironment(packageDir);
  t.after(provenance.cleanup);
  const env = { ...process.env, ...provenance.env };
  const normal = await run(['--package-dir', packageDir, '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.equal(normal.code, 0, normal.stderr);

  const consumer = path.join(packageDir, 'runtime/provenance/consumer.mjs');
  const original = await readFile(consumer, 'utf8');
  await writeFile(consumer, `${original}\nexport const tampered = true;\n`);
  const tampered = await run(['--package-dir', packageDir, '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.notEqual(tampered.code, 0);
  assert.match(tampered.stderr, /artifact_mismatch/);
});

test('trusted launcher rejects a relative package directory', { timeout: 10000 }, async () => {
  const result = await run(['--package-dir', '.', '--entry', 'runtime/bridge/cli.mjs', '--help'], { ...process.env });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /absolute path/);
});

test('the launcher spawns only the entry the signed descriptor registers', { timeout: 20000 }, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const registered = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env);
  assert.equal(registered.code, 0, registered.stderr);
  assert.match(registered.stdout, /^entry /);

  // other.mjs is signed package content, so package verification passes; only
  // the descriptor binding refuses it.
  const unregistered = await run(['--package-dir', packageDir, '--entry', 'other.mjs'], signed.env);
  assert.notEqual(unregistered.code, 0);
  assert.match(unregistered.stderr, /descriptor_mismatch/);
  assert.doesNotMatch(unregistered.stdout, /other/);
});

test('the launcher refuses a package whose descriptor does not register the launcher', { timeout: 20000 }, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  await writeFile(path.join(packageDir, '.mcp.json'), JSON.stringify({ zenith: { command: 'node', args: ['entry.mjs'] } }));
  const signed = await signedEnvironment(t, packageDir);
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /descriptor_mismatch/);
});

test('verified bytes are the executed bytes: the child runs from a private staged copy', { timeout: 20000 }, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env);
  assert.equal(result.code, 0, result.stderr);
  const reportedCwd = result.stdout.trim().slice('entry '.length);
  assert.notEqual(path.resolve(reportedCwd), path.resolve(packageDir), 'the child must not execute from the mutable installed directory');
  assert.match(path.basename(reportedCwd), /^zenith-plugin-/);
  await assert.rejects(stat(reportedCwd), 'the staged copy must be removed after the child exits');
});

test('staging isolates the verified tree from later writes to the installed directory', { timeout: 20000 }, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  const staged = await stagePackage(packageDir);
  t.after(staged.cleanup);
  assert.equal(await readFile(path.join(staged.dir, 'entry.mjs'), 'utf8'), await readFile(path.join(packageDir, 'entry.mjs'), 'utf8'));
  await writeFile(path.join(packageDir, 'entry.mjs'), 'process.exit(3);\n');
  assert.doesNotMatch(await readFile(path.join(staged.dir, 'entry.mjs'), 'utf8'), /process\.exit\(3\)/);
  if (process.platform !== 'win32') assert.equal((await stat(staged.dir)).mode & 0o077, 0);
  await staged.cleanup();
  await assert.rejects(stat(staged.dir));
});

test('a signed but older package is refused against the recorded rollback floor', { timeout: 30000 }, async t => {
  const control = await mkdtemp(path.join(tmpdir(), 'zenith rollback control '));
  t.after(() => rm(control, { recursive: true, force: true }));

  const current = await miniPackage(t, '2.0.0');
  const signedCurrent = await signedEnvironment(t, current, control);
  const first = await run(['--package-dir', current, '--entry', 'entry.mjs'], signedCurrent.env);
  assert.equal(first.code, 0, first.stderr);
  const recorded = JSON.parse(await readFile(path.join(control, STATE_FILENAME), 'utf8'));
  assert.equal(recorded.version, 1);
  assert.equal(recorded.subjects['zenith-launcher-fixture'].version, '2.0.0');

  const older = await miniPackage(t, '1.9.9');
  await rm(path.join(control, 'publisher-manifest.json'));
  await rm(path.join(control, 'trusted-keys.json'));
  const signedOlder = await signedEnvironment(t, older, control);
  const downgrade = await run(['--package-dir', older, '--entry', 'entry.mjs'], signedOlder.env);
  assert.notEqual(downgrade.code, 0);
  assert.match(downgrade.stderr, /version_rollback/);
  assert.match(downgrade.stderr, /1\.9\.9/);
});

test('the recorded rollback floor never moves backwards', async t => {
  const control = await mkdtemp(path.join(tmpdir(), 'zenith rollback state '));
  t.after(() => rm(control, { recursive: true, force: true }));
  const file = path.join(control, STATE_FILENAME);
  const manifest = version => ({ manifestVersion: 1, subject: { kind: 'zenith-plugin-package', name: 'zenith', version } });
  assert.equal(await readLastGood(file, 'zenith'), undefined);
  assert.equal((await recordLastGood(file, { manifest: manifest('1.2.0'), keyId: 'k', signedAt: 'now' })).recorded, true);
  assert.equal((await recordLastGood(file, { manifest: manifest('1.1.0'), keyId: 'k', signedAt: 'now' })).recorded, false);
  assert.equal((await readLastGood(file, 'zenith')).version, '1.2.0');
  assert.equal((await recordLastGood(file, { manifest: manifest('1.3.0-rc.1'), keyId: 'k', signedAt: 'now' })).recorded, true);
  assert.equal((await readLastGood(file, 'zenith')).version, '1.3.0-rc.1');
  assert.equal((await statePath(path.join(control, 'trusted-keys.json'), { env: {} })).path, file);
});

/**
 * An unreadable state file is not a first activation. Treating it as one unset
 * the rollback floor, so a genuinely signed older package was accepted with
 * exit 0 and no warning. ENOENT is the only error that means "not recorded yet".
 *
 * Both branches are pinned through the injected stat, because a path under a
 * regular file — the obvious real-world case — reports ENOTDIR on POSIX and
 * ENOENT on Windows, which is precisely the confusion under test. The POSIX
 * test below then runs the real thing end to end.
 */
test('an unreadable rollback floor fails closed instead of resetting itself', async t => {
  const control = await mkdtemp(path.join(tmpdir(), 'zenith state unreadable '));
  t.after(() => rm(control, { recursive: true, force: true }));
  const file = path.join(control, STATE_FILENAME);
  const manifest = { manifestVersion: 1, subject: { kind: 'zenith-plugin-package', name: 'zenith', version: '2.0.0' } };
  const fails = code => async () => { throw Object.assign(new Error(`stat refused: ${code}`), { code }); };
  const result = { manifest, keyId: 'k', signedAt: 'now' };

  // ENOENT means "no floor recorded yet" on both paths.
  assert.equal(await readLastGood(file, 'zenith', { stat: fails('ENOENT') }), undefined);
  assert.equal((await recordLastGood(file, result, { stat: fails('ENOENT') })).recorded, true);
  assert.equal((await readLastGood(file, 'zenith')).version, '2.0.0');

  // Every other error refuses, including on the best-effort record path: the
  // write is best effort, reading the floor it could lower is not.
  for (const code of ['EACCES', 'ENOTDIR', 'EIO', 'EPERM']) {
    await assert.rejects(readLastGood(file, 'zenith', { stat: fails(code) }),
      error => error.code === 'state_unreadable' && error.message.includes(code), code);
    await assert.rejects(recordLastGood(file, result, { stat: fails(code) }),
      error => error.code === 'state_unreadable', `record must not swallow ${code}`);
  }
  await assert.rejects(recordLastGood(file, result, { required: true, stat: fails('EACCES') }),
    error => error.code === 'state_unreadable');
});

test('an unreadable rollback floor refuses activation instead of running the package', {
  timeout: 20000, ...posixOnly,
}, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const stateDir = await mkdtemp(path.join(tmpdir(), 'zenith state blocked '));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  await writeFile(path.join(stateDir, 'blocker'), 'a regular file, not a directory\n');
  // ENOTDIR, not ENOENT: the floor cannot be read, so it is not "unrecorded".
  const env = { ...signed.env, ZENITH_PROVENANCE_STATE: path.join(stateDir, 'blocker', STATE_FILENAME) };
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /state_unreadable/);
  assert.doesNotMatch(result.stdout, /^entry /m, 'the package must not run behind an unreadable floor');
});

test('ZENITH_PROVENANCE_STATE is checked like the other trust inputs', async t => {
  const control = await mkdtemp(path.join(tmpdir(), 'zenith state override path '));
  t.after(() => rm(control, { recursive: true, force: true }));
  const trustPath = path.join(control, 'trusted-keys.json');
  await assert.rejects(
    statePath(trustPath, { env: { ZENITH_PROVENANCE_STATE: 'relative/floor.json' } }),
    error => error.code === 'provenance_required'
  );
  await assert.rejects(
    statePath(trustPath, { env: { ZENITH_PROVENANCE_STATE: path.join(control, 'missing', 'floor.json') } }),
    error => error.code === 'provenance_required'
  );
  const accepted = await statePath(trustPath, { env: { ZENITH_PROVENANCE_STATE: path.join(control, 'floor.json') } });
  assert.equal(accepted.path, path.join(control, 'floor.json'));
  assert.equal(accepted.overridden, true);
  // Windows reports the check as unverified rather than passing it, exactly as
  // assertTrustInputPath does for the trust file itself.
  assert.equal(accepted.permissionsChecked, process.platform !== 'win32');
});

test('an override in a world-writable directory is refused', posixOnly, async t => {
  const open = await mkdtemp(path.join(tmpdir(), 'zenith open state '));
  t.after(() => rm(open, { recursive: true, force: true }));
  await chmod(open, 0o777);
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const env = { ...signed.env, ZENITH_PROVENANCE_STATE: path.join(open, STATE_FILENAME) };
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsafe_trust_path/);
  assert.match(result.stderr, /ZENITH_PROVENANCE_STATE/);
});

test('a world-writable trust file is refused', posixOnly, async t => {
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  await chmod(signed.trustPath, 0o666);
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsafe_trust_path/);
});

test('a trust file in a world-writable directory without the sticky bit is refused', posixOnly, async t => {
  const open = await mkdtemp(path.join(tmpdir(), 'zenith open trust '));
  t.after(() => rm(open, { recursive: true, force: true }));
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir, open);
  await chmod(open, 0o777);
  const result = await run(['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsafe_trust_path/);
});

test('the repository publishes the launcher as the bin the descriptors name', { timeout: 20000 }, async t => {
  const { bin } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  assert.deepEqual(Object.keys(bin), ['zenith-plugin-launcher']);
  assert.equal(path.resolve(bin['zenith-plugin-launcher']), launcher);
  const descriptor = JSON.parse(await readFile(path.resolve('plugins/codex/.mcp.json'), 'utf8'));
  assert.equal(descriptor.zenith.command, 'zenith-plugin-launcher');

  // An installed bin runs from a working directory unrelated to the repository.
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const elsewhere = await mkdtemp(path.join(tmpdir(), 'zenith foreign cwd '));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  const result = await runAt(launcher, ['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env, elsewhere);
  assert.equal(result.code, 0, result.stderr);
});

test('the launcher resolves its verifier through an npm-style bin symlink', {
  timeout: 20000, skip: process.platform === 'win32' ? 'npm writes a .cmd shim on Windows; creating symlinks needs extra privileges.' : false,
}, async t => {
  const { symlink } = await import('node:fs/promises');
  const shimDir = await mkdtemp(path.join(tmpdir(), 'zenith bin '));
  t.after(() => rm(shimDir, { recursive: true, force: true }));
  const shim = path.join(shimDir, 'zenith-plugin-launcher');
  await symlink(launcher, shim);
  const packageDir = await miniPackage(t, '1.0.0');
  const signed = await signedEnvironment(t, packageDir);
  const result = await runAt(shim, ['--package-dir', packageDir, '--entry', 'entry.mjs'], signed.env, shimDir);
  assert.equal(result.code, 0, result.stderr);
});

test('descriptor binding accepts either descriptor wrapper and normalises entry spellings', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith descriptor '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'runtime'), { recursive: true });
  const wrapped = { mcpServers: { zenith: { command: 'zenith-plugin-launcher', args: ['--package-dir', '${CLAUDE_PLUGIN_ROOT}', '--entry', 'runtime/bridge/cli.mjs', 'stdio'] } } };
  await writeFile(path.join(dir, '.mcp.json'), JSON.stringify(wrapped));
  assert.deepEqual(await assertDescriptorBinding(dir, 'runtime/bridge/cli.mjs'), { entry: 'runtime/bridge/cli.mjs' });
  await assert.rejects(assertDescriptorBinding(dir, 'runtime/control/cli.mjs'), error => error.code === 'descriptor_mismatch');
  assert.equal(normalizeEntry('./runtime\\bridge/cli.mjs'), 'runtime/bridge/cli.mjs');
  await rm(path.join(dir, '.mcp.json'));
  await assert.rejects(assertDescriptorBinding(dir, 'runtime/bridge/cli.mjs'), error => error.code === 'descriptor_missing');
});
