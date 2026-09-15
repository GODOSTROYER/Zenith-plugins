import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { prepareRelease, signingOptions } from '../scripts/release.mjs';
import { verifyArtifactDirectory, verifyPackageDirectory } from '../packages/provenance/index.mjs';
// Inspect generated npm tar headers without extracting or trusting their paths.
function tarEntries(bytes) {
  const tar = gunzipSync(bytes), entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(v => v === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0); assert.equal(header[156], 48);
    assert.ok(name.startsWith('package/') && !name.split('/').includes('..')); assert.ok(!entries.has(name));
    entries.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
test('release archives include hidden manifests and reproduce byte-for-byte', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith artifact test ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await prepareRelease(path.join(dir, 'first')), second = await prepareRelease(path.join(dir, 'second'));
  assert.deepEqual(first, second); assert.equal(first.nativeClientVerified, false);
  for (const artifact of first.artifacts) {
    const bytes = await readFile(path.join(dir, 'first', artifact.filename));
    assert.deepEqual(bytes, await readFile(path.join(dir, 'second', artifact.filename)));
    const entries = tarEntries(bytes), integrity = JSON.parse(entries.get('integrity.json'));
    const manifest = artifact.client === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
    assert.ok(entries.has(manifest)); assert.ok(entries.has('.mcp.json'));
    assert.deepEqual([...entries.keys()].sort(), [...Object.keys(integrity.files), 'integrity.json'].sort());
    for (const [name, expected] of Object.entries(integrity.files)) assert.equal(createHash('sha256').update(entries.get(name)).digest('hex'), expected);
  }
  assert.equal(first.provenance.signed, false);
});

test('release signing is gated on an operator key and refused in automation', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith signing gate ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const key = path.join(dir, 'publisher.private.pem'), trust = path.join(dir, 'trusted-keys.json');
  const complete = ['--sign', '--key-id', 'publisher-test', '--private-key', key, '--trust', trust];
  assert.deepEqual(signingOptions([], {}), { sign: false });
  assert.throws(() => signingOptions(complete, { CI: 'true' }), error => error.code === 'signing_refused');
  assert.throws(() => signingOptions(complete, { GITHUB_ACTIONS: 'true' }), error => error.code === 'signing_refused');
  assert.throws(() => signingOptions(['--sign'], {}), error => error.code === 'signing_key_required');
  assert.throws(() => signingOptions(['--sign', '--key-id', 'k', '--private-key', key], {}), error => error.code === 'signing_key_required');
  assert.throws(
    () => signingOptions(['--sign', '--key-id', 'k', '--private-key', path.resolve('packages/publisher.pem'), '--trust', trust], {}),
    error => error.code === 'signing_key_required'
  );
  assert.equal(signingOptions(complete, {}).keyId, 'publisher-test');
});

test('a gated signed release produces package and release envelopes that verify', { timeout: 60_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith signed release ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = path.join(dir, 'publisher.private.pem'), trust = path.join(dir, 'trusted-keys.json');
  await writeFile(key, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const trustedKeys = { version: 1, keys: [{ id: 'publisher-test', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), status: 'active' }] };
  await writeFile(trust, `${JSON.stringify(trustedKeys)}\n`, { mode: 0o600 });

  const destination = path.join(dir, 'artifacts');
  const result = await prepareRelease(destination, ['--sign', '--key-id', 'publisher-test', '--private-key', key, '--trust', trust],
    { npm_execpath: process.env.npm_execpath });
  assert.equal(result.provenance.verified, true);
  assert.equal(result.provenance.keyId, 'publisher-test');
  assert.ok(Date.parse(result.provenance.expiresAt) > Date.now());

  const release = JSON.parse(await readFile(path.join(destination, result.provenance.release), 'utf8'));
  await verifyArtifactDirectory(destination, release, { trustedKeys });
  for (const [client, file] of Object.entries(result.provenance.packages)) {
    const envelope = JSON.parse(await readFile(path.join(destination, file), 'utf8'));
    // The activation gate needs a package envelope; the release envelope is refused there.
    await verifyPackageDirectory(path.resolve('plugins', client), envelope, { trustedKeys });
    await assert.rejects(verifyPackageDirectory(path.resolve('plugins', client), release, { trustedKeys }), error => error.code === 'subject_mismatch');
  }
});
