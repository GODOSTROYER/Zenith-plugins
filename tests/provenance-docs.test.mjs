/**
 * The documentation is an executable claim. These tests run the commands
 * docs/provenance.md prescribes, end to end, against a throwaway Ed25519 key
 * generated inside the test's own temporary directory, and refuse the
 * documentation shapes that are known to fail closed on every activation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selftest } from '../scripts/provenance.mjs';
import { createReleaseManifest, signReleaseManifest } from '../packages/provenance/index.mjs';

const docs = path.resolve('docs/provenance.md');
const launcher = path.resolve('packages/launcher/cli.mjs');
const provenanceCli = path.resolve('scripts/provenance.mjs');

function run(binary, args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [binary, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

async function throwawayKey(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith documented flow '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyFile = path.join(dir, 'publisher-test.private.pem');
  const trustFile = path.join(dir, 'trusted-keys.json');
  await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const trust = { version: 1, keys: [{ id: 'publisher-test', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), status: 'active' }] };
  await writeFile(trustFile, `${JSON.stringify(trust, null, 2)}\n`, { mode: 0o600 });
  return { dir, keyFile, trustFile, trust, privateKey };
}

test('the documented sign, verify and activate sequence works as written', { timeout: 60_000 }, async t => {
  const key = await throwawayKey(t);
  const packageDir = path.resolve('plugins/codex');
  const manifestFile = path.join(key.dir, 'zenith-codex.package-manifest.json');

  // docs/provenance.md, "Runtime activation gate": sign-package.
  const signed = await run(provenanceCli, ['sign-package', '--package', packageDir, '--client', 'codex',
    '--key-id', 'publisher-test', '--private-key', key.keyFile, '--output', manifestFile], { ...process.env });
  assert.equal(signed.code, 0, signed.stderr);
  const report = JSON.parse(signed.stdout);
  assert.equal(report.subject.kind, 'zenith-plugin-package');
  assert.ok(Date.parse(report.expiresAt) > Date.now(), 'every envelope must carry a future expiry');

  // docs/provenance.md, "Runtime activation gate": verify-package.
  const verified = await run(provenanceCli, ['verify-package', '--package', packageDir,
    '--manifest', manifestFile, '--trust', key.trustFile], { ...process.env });
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).keyId, 'publisher-test');

  // docs/provenance.md, "Runtime activation gate": the two exported variables.
  const env = { ...process.env, ZENITH_PROVENANCE_MANIFEST: manifestFile, ZENITH_PROVENANCE_TRUST: key.trustFile };
  const activated = await run(launcher, ['--package-dir', packageDir, '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.equal(activated.code, 0, activated.stderr);
  assert.match(activated.stdout, /Zenith connector/);
});

test('a release manifest is refused as an activation manifest, as the documentation now says', { timeout: 60_000 }, async t => {
  const key = await throwawayKey(t);
  const artifacts = path.join(key.dir, 'artifacts');
  await import('node:fs/promises').then(fs => fs.mkdir(artifacts, { recursive: true }));
  const archive = Buffer.from('review archive bytes\n');
  const { createHash } = await import('node:crypto');
  await writeFile(path.join(artifacts, 'zenith-codex-9.9.9.tgz'), archive);
  await writeFile(path.join(artifacts, 'release.json'), `${JSON.stringify({
    version: '9.9.9', status: 'development-review-only',
    artifacts: [{ client: 'codex', filename: 'zenith-codex-9.9.9.tgz', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }],
  })}\n`);
  const releaseManifest = path.join(key.dir, 'release-manifest.json');
  await writeFile(releaseManifest, `${JSON.stringify(signReleaseManifest(await createReleaseManifest(artifacts), {
    keyId: 'publisher-test', privateKey: key.privateKey, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }), null, 2)}\n`, { mode: 0o600 });

  // The pre-fix documentation told operators to export this file. It fails
  // closed on every activation; keep proving that so the wording cannot return.
  const env = { ...process.env, ZENITH_PROVENANCE_MANIFEST: releaseManifest, ZENITH_PROVENANCE_TRUST: key.trustFile };
  const activated = await run(launcher, ['--package-dir', path.resolve('plugins/codex'), '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.notEqual(activated.code, 0);
  assert.match(activated.stderr, /subject_mismatch/);
});

test('the activation section documents a package envelope, not a release manifest', async () => {
  const text = await readFile(docs, 'utf8');
  const activation = text.slice(text.indexOf('## Runtime activation gate'), text.indexOf('### Verified bytes'));
  assert.ok(activation.length > 0, 'the runtime activation section must exist');
  assert.match(activation, /ZENITH_PROVENANCE_MANIFEST=\S*package-manifest\.json/);
  assert.doesNotMatch(activation, /ZENITH_PROVENANCE_MANIFEST=\S*release-manifest\.json/);
  assert.match(activation, /subject_mismatch/);
  for (const required of ['## Key custody', '## Rotation', '## Revocation, and what it does not cover', 'no freshness requirement', '## Install the trusted launcher', 'zenith-provenance-state.json']) {
    assert.ok(text.includes(required), `docs/provenance.md must document: ${required}`);
  }
});

test('the provenance selftest reports every documented step', { timeout: 60_000 }, async () => {
  const result = await selftest();
  assert.equal(result.status, 'selftest-passed');
  assert.deepEqual(result.steps.map(step => step.step),
    ['sign-package', 'verify-package', 'launch', 'release-gate-rejects-package-envelope']);
  assert.equal(result.steps.find(step => step.step === 'launch').exitCode, 0);
});
