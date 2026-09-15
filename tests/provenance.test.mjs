import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createPackageManifest, createReleaseManifest, signReleaseManifest,
  verifyPackageDirectory, verifyArtifactDirectory, ProvenanceError,
} from '../packages/provenance/index.mjs';
import { enforceInstalledProvenance } from '../packages/provenance/consumer.mjs';

const signedAt = '2026-09-14T00:00:00.000Z';
function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    pair,
    trust: { version: 1, keys: [{ id: 'publisher-2026', publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }] },
  };
}
const code = error => error instanceof ProvenanceError ? error.code : error?.code;
const run = promisify(execFile);

async function packageFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith provenance package '));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'zenith', version: '0.0.0-fixture' }));
  await writeFile(path.join(dir, 'runtime.txt'), 'fixture only\n');
  const payload = await createPackageManifest(dir, { client: 'codex' });
  const { pair, trust } = keys();
  return { dir, trust, envelope: signReleaseManifest(payload, { keyId: 'publisher-2026', privateKey: pair.privateKey, signedAt, expiresAt: '2026-10-01T00:00:00.000Z' }) };
}

test('valid signed package manifest verifies with an explicit active key', async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const result = await verifyPackageDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt });
  assert.equal(result.keyId, 'publisher-2026');
  assert.equal(result.manifest.subject.client, 'codex');
});

test('the installed-package execution gate fails closed when required inputs are absent', async () => {
  await assert.rejects(
    enforceInstalledProvenance({ required: true, packageDir: path.resolve('.') }),
    error => code(error) === 'provenance_required'
  );
});

test('the installed-package execution gate verifies the exact package bytes', async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const control = await mkdtemp(path.join(tmpdir(), 'zenith provenance control '));
  t.after(() => rm(control, { recursive: true, force: true }));
  const manifestPath = path.join(control, 'publisher-manifest.json');
  const trustPath = path.join(control, 'trusted-keys.json');
  await writeFile(manifestPath, JSON.stringify(f.envelope));
  await writeFile(trustPath, JSON.stringify(f.trust));
  const result = await enforceInstalledProvenance({
    required: true, packageDir: f.dir, manifestPath, trustPath, now: signedAt,
  });
  assert.equal(result.keyId, 'publisher-2026');
  await writeFile(path.join(f.dir, 'runtime.txt'), 'tampered after install\n');
  await assert.rejects(
    enforceInstalledProvenance({ required: true, packageDir: f.dir, manifestPath, trustPath, now: signedAt }),
    error => code(error) === 'artifact_mismatch'
  );
});

test('a generated plugin cannot disable its activation gate with the environment', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith provenance activation '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(path.resolve('plugins/codex'), dir, { recursive: true });
  await assert.rejects(
    run(process.execPath, [path.join(dir, 'runtime/bridge/cli.mjs'), '--help'], {
      env: { ...process.env, ZENITH_REQUIRE_PROVENANCE: '0', ZENITH_URL: 'https://zenith.example', ZENITH_WORKSPACE_ID: 'ws', ZENITH_TOKEN: `za_${'X'.repeat(43)}` },
    }),
    error => error.code === 1 && error.stdout === '' && /startup_failed/.test(error.stderr)
  );
});

for (const [label, mutate, expected] of [
  ['manifest', envelope => { envelope.manifest.subject.client = 'claude-code'; }, 'signature_invalid'],
  ['signed timestamp', envelope => { envelope.signedAt = '2020-01-01T00:00:00.000Z'; }, 'signature_invalid'],
  ['expiry', envelope => { delete envelope.expiresAt; }, 'signature_invalid'],
]) test(`tampered ${label} fails closed`, async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const tampered = structuredClone(f.envelope); mutate(tampered);
  await assert.rejects(verifyPackageDirectory(f.dir, tampered, { trustedKeys: f.trust, now: signedAt }), error => code(error) === expected);
});

test('unsigned and unknown-key envelopes are refused', async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const unsigned = structuredClone(f.envelope); delete unsigned.signature;
  await assert.rejects(verifyPackageDirectory(f.dir, unsigned, { trustedKeys: f.trust }), error => code(error) === 'unsigned');
  const unknown = { ...f.envelope, keyId: 'other-publisher' };
  await assert.rejects(verifyPackageDirectory(f.dir, unknown, { trustedKeys: f.trust }), error => code(error) === 'unknown_key');
  await assert.rejects(verifyPackageDirectory(f.dir, f.envelope), error => code(error) === 'trust_required');
});

test('malformed trust validity data fails as invalid trust', async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const trust = structuredClone(f.trust);
  trust.keys[0].notBefore = 123;
  await assert.rejects(verifyPackageDirectory(f.dir, f.envelope, { trustedKeys: trust }), error => code(error) === 'invalid_trust');
});

test('revoked key and changed package bytes are refused', async t => {
  const f = await packageFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await assert.rejects(verifyPackageDirectory(f.dir, f.envelope, { trustedKeys: { version: 1, keys: [{ ...f.trust.keys[0], status: 'revoked' }] } }), error => code(error) === 'revoked_key');
  await writeFile(path.join(f.dir, 'runtime.txt'), 'tampered\n');
  await assert.rejects(verifyPackageDirectory(f.dir, f.envelope, { trustedKeys: f.trust }), error => code(error) === 'artifact_mismatch');
});

async function releaseFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith provenance release '));
  const archive = Buffer.from('archive bytes\n');
  await writeFile(path.join(dir, 'zenith-codex-1.0.0.tgz'), archive);
  await writeFile(path.join(dir, 'release.json'), JSON.stringify({ version: '1.0.0', status: 'development-review-only', artifacts: [{ client: 'codex', filename: 'zenith-codex-1.0.0.tgz', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }] }));
  const payload = await createReleaseManifest(dir), { pair, trust } = keys();
  return { dir, trust, envelope: signReleaseManifest(payload, { keyId: 'publisher-2026', privateKey: pair.privateKey, signedAt }) };
}

test('release verification binds release report and rejects unsigned extra archives', async t => {
  const f = await releaseFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await verifyArtifactDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt });
  await writeFile(path.join(f.dir, 'zenith-rogue-1.0.0.tgz'), 'rogue bytes\n');
  await assert.rejects(verifyArtifactDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt }), error => code(error) === 'artifact_mismatch');
});

test('release verification rejects unsafe extra archive entries', async t => {
  const f = await releaseFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await symlink('zenith-codex-1.0.0.tgz', path.join(f.dir, 'zenith-rogue-1.0.0.tgz'));
  await assert.rejects(verifyArtifactDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt }), error => code(error) === 'artifact_mismatch');
});

test('release verification rejects report drift and archive tampering', async t => {
  const f = await releaseFixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await writeFile(path.join(f.dir, 'release.json'), JSON.stringify({ version: '9.9.9', artifacts: [{ filename: 'zenith-codex-1.0.0.tgz' }] }));
  await assert.rejects(verifyArtifactDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt }), error => code(error) === 'artifact_mismatch');
  const archive = Buffer.from('archive bytes\n');
  await writeFile(path.join(f.dir, 'release.json'), JSON.stringify({ version: '1.0.0', artifacts: [{ client: 'codex', filename: 'zenith-codex-1.0.0.tgz', bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }] }));
  await writeFile(path.join(f.dir, 'zenith-codex-1.0.0.tgz'), 'tampered\n');
  await assert.rejects(verifyArtifactDirectory(f.dir, f.envelope, { trustedKeys: f.trust, now: signedAt }), error => code(error) === 'artifact_mismatch');
});

test('signing rejects an expiry before the signing time', () => {
  const { pair } = keys();
  assert.throws(() => signReleaseManifest({ manifestVersion: 1 }, {
    keyId: 'publisher-2026', privateKey: pair.privateKey, signedAt, expiresAt: '2026-09-01T00:00:00.000Z',
  }), error => code(error) === 'invalid_envelope');
});
