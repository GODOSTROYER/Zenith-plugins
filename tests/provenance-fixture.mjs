import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackageManifest, signReleaseManifest } from '../packages/provenance/index.mjs';

export async function signedPackageEnvironment(packageDir) {
  const control = await mkdtemp(path.join(tmpdir(), 'zenith signed package fixture '));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const trust = {
    version: 1,
    keys: [{ id: 'test-publisher', publicKey: publicKey.export({ type: 'spki', format: 'pem' }) }],
  };
  const manifest = signReleaseManifest(await createPackageManifest(packageDir), {
    keyId: 'test-publisher', privateKey, signedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  const manifestPath = path.join(control, 'publisher-manifest.json');
  const trustPath = path.join(control, 'trusted-keys.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  await writeFile(trustPath, `${JSON.stringify(trust)}\n`, { mode: 0o600 });
  return {
    control,
    env: {
      ZENITH_REQUIRE_PROVENANCE: '1',
      ZENITH_PROVENANCE_MANIFEST: manifestPath,
      ZENITH_PROVENANCE_TRUST: trustPath,
    },
    cleanup: () => rm(control, { recursive: true, force: true }),
  };
}
