/**
 * Prepare local review artifacts only. Never publishes or creates a GitHub release.
 *
 * Signing is an explicit, gated step. `npm run release:prepare` produces
 * unsigned review archives; `npm run release:sign -- --key-id ID --private-key
 * FILE --trust FILE` additionally signs them and immediately verifies the
 * result through the same gate an operator runs. The private key is never
 * generated, stored or discovered here: it must be an absolute path outside the
 * repository, and an automated environment is refused outright.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../packages/bridge/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { inventory } from './package-files.mjs';
import {
  ProvenanceError, createPackageManifest, createReleaseManifest, signReleaseManifest,
  verifyArtifactDirectory, verifyPackageDirectory,
} from '../packages/provenance/index.mjs';
import { expiryFor } from './provenance.mjs';
const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));

/** Environments that must never hold a publisher key. CI builds artifacts; an operator signs them. */
const automated = (env = process.env) => Boolean(env.CI || env.GITHUB_ACTIONS || env.BUILD_BUILDID || env.GITLAB_CI);

export function signingOptions(args = [], env = process.env) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--sign') { values.sign = true; continue; }
    if (!arg.startsWith('--') || index + 1 >= args.length) throw new ProvenanceError('usage', 'Use: release.mjs [--sign --key-id ID --private-key FILE --trust FILE [--expires ISO]].');
    values[arg.slice(2)] = args[++index];
  }
  const requested = values.sign || values['private-key'] !== undefined || values['key-id'] !== undefined;
  if (!requested) return { sign: false };
  if (automated(env)) throw new ProvenanceError('signing_refused', 'Release signing is an operator step. This automated environment must not hold a publisher key; build artifacts here and sign them elsewhere.');
  for (const name of ['key-id', 'private-key', 'trust']) {
    if (!values[name]) throw new ProvenanceError('signing_key_required', `Signing requires --${name}. Nothing was signed.`);
  }
  const privateKey = path.resolve(values['private-key']);
  if (!path.isAbsolute(values['private-key'])) throw new ProvenanceError('signing_key_required', 'Pass an absolute --private-key path outside this repository.');
  const relative = path.relative(root, privateKey);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) throw new ProvenanceError('signing_key_required', 'The publisher key must live outside the repository. Refusing to read a key from the checkout.');
  return { sign: true, keyId: values['key-id'], privateKey, trust: path.resolve(values.trust), expires: values.expires };
}

async function privateKeyFrom(file) {
  const { createPrivateKey } = await import('node:crypto');
  try { return createPrivateKey(await readFile(file)); }
  catch { throw new ProvenanceError('signing_key_required', 'Could not read an Ed25519 private key from the supplied external path.'); }
}

/**
 * Sign the release report and every package directory the archives were built
 * from, then re-verify both through the operator gate. Operators need the
 * package envelope for the runtime activation gate; the release envelope alone
 * is refused there with subject_mismatch.
 */
async function signArtifacts(destination, version, options) {
  const trustedKeys = JSON.parse(await readFile(options.trust, 'utf8'));
  const privateKey = await privateKeyFrom(options.privateKey);
  const expiresAt = expiryFor(options.expires);
  const outputs = {};

  const releaseEnvelope = signReleaseManifest(await createReleaseManifest(destination), { keyId: options.keyId, privateKey, expiresAt });
  const releaseManifest = path.join(destination, 'release-manifest.json');
  await writeFile(releaseManifest, `${JSON.stringify(releaseEnvelope, null, 2)}\n`, { mode: 0o600 });
  await verifyArtifactDirectory(destination, JSON.parse(await readFile(releaseManifest, 'utf8')), { trustedKeys });
  outputs.release = path.basename(releaseManifest);

  outputs.packages = {};
  for (const kind of ['codex', 'claude-code']) {
    const packageRoot = path.join(root, 'plugins', kind);
    const envelope = signReleaseManifest(await createPackageManifest(packageRoot, { client: kind }), { keyId: options.keyId, privateKey, expiresAt });
    const file = path.join(destination, `zenith-${kind}-${version}.package-manifest.json`);
    await writeFile(file, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    await verifyPackageDirectory(packageRoot, JSON.parse(await readFile(file, 'utf8')), { trustedKeys });
    outputs.packages[kind] = path.basename(file);
  }
  return { keyId: options.keyId, expiresAt, verified: true, ...outputs };
}

export async function prepareRelease(destination = path.join(root, 'artifacts'), args = [], env = process.env) {
  const signing = signingOptions(args, env);
  const npm = process.env.npm_execpath;
  if (!npm || !path.isAbsolute(npm)) throw Error('Run release preparation through npm run release:prepare so the installed npm CLI is explicit.');
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const staging = await mkdtemp(path.join(tmpdir(), 'zenith release ')), entries = [];
  try {
    for (const kind of ['codex', 'claude-code']) {
      const packageRoot = path.join(root, 'plugins', kind);
      const recorded = JSON.parse(await readFile(path.join(packageRoot, 'integrity.json'), 'utf8'));
      if (JSON.stringify(recorded.files) !== JSON.stringify(await inventory(packageRoot))) throw Error('Package integrity differs from the generated inventory. Rebuild and verify.');
      const { stdout } = await run(process.execPath, [npm, 'pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', staging],
        { cwd: packageRoot, timeout: 30_000, maxBuffer: 262_144 });
      const [packed] = JSON.parse(stdout);
      if (!packed || !/^[A-Za-z0-9_.-]+\.tgz$/.test(packed.filename)) throw Error('npm returned an invalid archive name.');
      const expected = [...Object.keys(recorded.files), 'integrity.json'].sort();
      if (JSON.stringify(packed.files.map(f => f.path).sort()) !== JSON.stringify(expected)) throw Error('Archive omitted or added a file. Refusing an incomplete distribution.');
      const filename = `zenith-${kind}-${version}.tgz`, source = path.join(staging, packed.filename);
      const bytes = await readFile(source), sha256 = createHash('sha256').update(bytes).digest('hex');
      await rename(source, path.join(staging, filename));
      entries.push({ client: kind, filename, bytes: bytes.length, sha256 });
    }
    await mkdir(destination, { recursive: true });
    for (const entry of entries) await writeFile(path.join(destination, entry.filename), await readFile(path.join(staging, entry.filename)));
    await writeFile(path.join(destination, 'SHA256SUMS'), entries.map(e => `${e.sha256}  ${e.filename}\n`).join(''));
    const report = { version, status: 'development-review-only', nativeClientVerified: false, artifacts: entries };
    await writeFile(path.join(destination, 'release.json'), `${JSON.stringify(report, null, 2)}\n`);
    const provenance = signing.sign
      ? await signArtifacts(destination, version, signing)
      : { signed: false, note: 'Unsigned review archives. Hash inventories are not publisher authentication; run npm run release:sign before distributing.' };
    return { ...report, provenance };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) prepareRelease(undefined, process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  const code = error instanceof ProvenanceError ? error.code : 'release_failed';
  console.error(JSON.stringify({ status: 'rejected', code, message: error instanceof ProvenanceError ? error.message : 'Release preparation failed. Rebuild and verify locally; nothing was published.' }));
  process.exitCode = 1;
});
