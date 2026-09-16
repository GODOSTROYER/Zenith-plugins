import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPackageManifest, signReleaseManifest } from '../packages/provenance/index.mjs';
import { PROVENANCE_MODE_FILE, SIGNED_RELEASE, mcpDescriptor, provenanceModeDocument } from '../scripts/package-mode.mjs';

/**
 * Turn a copy of a committed (unsigned-preview) package into the signed-release
 * shape a publisher signs: the descriptor that names `zenith-plugin-launcher`,
 * which the launcher binds its own invocation to, and the matching marker.
 * `npm run build -- --signed` writes exactly these two files.
 */
export async function asSignedReleasePackage(packageDir, client = 'codex') {
  const { version } = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
  await writeFile(path.join(packageDir, '.mcp.json'), `${JSON.stringify(mcpDescriptor(client, SIGNED_RELEASE), null, 2)}\n`);
  await writeFile(path.join(packageDir, PROVENANCE_MODE_FILE), `${JSON.stringify(provenanceModeDocument(client, version, SIGNED_RELEASE), null, 2)}\n`);
  return packageDir;
}

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
