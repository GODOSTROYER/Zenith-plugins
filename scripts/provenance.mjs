#!/usr/bin/env node
/** Explicit operator tool for signing and verifying plugin provenance. */
import { spawn } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../packages/bridge/entrypoint.mjs';
import {
  createPackageManifest, createReleaseManifest, signReleaseManifest,
  verifyPackageDirectory, verifyArtifactDirectory, ProvenanceError,
} from '../packages/provenance/index.mjs';
import { PROVENANCE_MODE_FILE, SIGNED_RELEASE, mcpDescriptor, provenanceModeDocument } from './package-mode.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

export const DEFAULT_EXPIRY_DAYS = 90;

const usage = `Usage:
  node scripts/provenance.mjs sign-package --package DIR --key-id ID --private-key FILE --output FILE [--client codex|claude-code] [--expires ISO]
  node scripts/provenance.mjs sign-release --artifacts DIR --key-id ID --private-key FILE --output FILE [--expires ISO]
  node scripts/provenance.mjs verify-package --package DIR --manifest FILE --trust FILE
  node scripts/provenance.mjs verify-release --artifacts DIR --manifest FILE --trust FILE
  node scripts/provenance.mjs selftest [--package DIR]

Every envelope carries an expiry. Without --expires the signature expires ${DEFAULT_EXPIRY_DAYS} days after signing.
selftest runs sign-package, verify-package and a launcher activation with a throwaway key created inside a
temporary directory and deleted afterwards. It never touches an operator key and never publishes.`;

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--') || index + 1 >= args.length || args[index + 1].startsWith('--')) throw new ProvenanceError('usage', usage);
    const name = arg.slice(2);
    if (result[name] !== undefined) throw new ProvenanceError('usage', `Repeated --${name}.\n${usage}`);
    result[name] = args[++index];
  }
  return result;
}

function required(values, ...names) {
  for (const name of names) if (!values[name]) throw new ProvenanceError('usage', `Missing --${name}.\n${usage}`);
}

async function readPrivateKey(file) {
  try { return createPrivateKey(await readFile(path.resolve(file))); }
  catch { throw new ProvenanceError('signing_key_required', 'Could not read an Ed25519 private key from the supplied external path.'); }
}

/** Signatures always expire. An omitted --expires becomes an explicit bounded default, never "never". */
export function expiryFor(value, signedAt = new Date()) {
  if (value !== undefined) return value;
  return new Date(signedAt.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString();
}

async function signTo(output, payload, values) {
  const expiresAt = expiryFor(values.expires);
  const envelope = signReleaseManifest(payload, { keyId: values['key-id'], privateKey: await readPrivateKey(values['private-key']), expiresAt });
  await writeFile(path.resolve(output), `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const result = { status: 'signed', subject: payload.subject, expiresAt, defaultedExpiry: values.expires === undefined, output: path.resolve(output) };
  console.log(JSON.stringify(result));
  return result;
}

function launch(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, 'packages/launcher/cli.mjs'), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', code => resolve({ code, stdout, stderr }));
  });
}

/**
 * Run the documented operator flow end to end — sign-package, verify-package,
 * then activation through the trusted launcher — against a throwaway Ed25519
 * key generated inside a temporary directory that is deleted afterwards. This
 * is the provenance check the offline verify lane can actually run: the real
 * `provenance:verify` needs release artifacts and the operator's own trust
 * file, neither of which exists in a checkout or in CI.
 */
export async function selftest({ packageDir = path.join(repositoryRoot, 'plugins/codex'), entry = 'runtime/bridge/cli.mjs', client = 'codex' } = {}) {
  const work = await mkdtemp(path.join(tmpdir(), 'zenith provenance selftest '));
  const steps = [];
  try {
    // The launcher binds its invocation to the descriptor the publisher signed,
    // so this runs against the signed-release shape of the generated package —
    // the same bytes plus the release descriptor and marker that
    // `npm run build -- --signed` writes. The committed package is the
    // unsigned-preview shape, which is activated by the in-process gate
    // instead and is covered by tests/activation.test.mjs.
    const source = path.resolve(packageDir);
    const release = path.join(work, 'package');
    await cp(packageDir, release, { recursive: true, verbatimSymlinks: true });
    const { version } = JSON.parse(await readFile(path.join(release, 'package.json'), 'utf8'));
    await writeFile(path.join(release, '.mcp.json'), `${JSON.stringify(mcpDescriptor(client, SIGNED_RELEASE), null, 2)}\n`);
    await writeFile(path.join(release, PROVENANCE_MODE_FILE), `${JSON.stringify(provenanceModeDocument(client, version, SIGNED_RELEASE), null, 2)}\n`);
    packageDir = release;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const keyFile = path.join(work, 'throwaway.private.pem');
    const trustFile = path.join(work, 'trusted-keys.json');
    const manifestFile = path.join(work, 'package-manifest.json');
    await writeFile(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    await writeFile(trustFile, `${JSON.stringify({ version: 1, keys: [{ id: 'selftest', publicKey: publicKey.export({ type: 'spki', format: 'pem' }), status: 'active' }] }, null, 2)}\n`, { mode: 0o600 });

    const signed = await main(['sign-package', '--package', packageDir, '--key-id', 'selftest', '--private-key', keyFile, '--output', manifestFile]);
    steps.push({ step: 'sign-package', subject: signed.subject, expiresAt: signed.expiresAt });
    const verified = await main(['verify-package', '--package', packageDir, '--manifest', manifestFile, '--trust', trustFile]);
    steps.push({ step: 'verify-package', keyId: verified.keyId });

    const activation = await launch(['--package-dir', path.resolve(packageDir), '--entry', entry, '--help'], {
      ...process.env, ZENITH_PROVENANCE_MANIFEST: manifestFile, ZENITH_PROVENANCE_TRUST: trustFile,
    });
    if (activation.code !== 0) throw new ProvenanceError('selftest_failed', `Launcher activation failed with exit ${activation.code}: ${activation.stderr.trim()}`);
    steps.push({ step: 'launch', exitCode: activation.code });

    const refused = await main(['verify-release', '--artifacts', work, '--manifest', manifestFile, '--trust', trustFile]).then(() => undefined, error => error);
    if (!(refused instanceof ProvenanceError) || refused.code !== 'subject_mismatch')
      throw new ProvenanceError('selftest_failed', 'A package envelope must be refused with subject_mismatch by the release gate.');
    steps.push({ step: 'release-gate-rejects-package-envelope', code: refused.code });
    return { status: 'selftest-passed', packageDir: source, activationMode: SIGNED_RELEASE, steps };
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const values = options(rest);
  if (command === 'selftest') {
    const result = await selftest(values.package ? { packageDir: values.package } : {});
    console.log(JSON.stringify(result));
    return result;
  }
  if (command === 'sign-package') {
    required(values, 'package', 'key-id', 'private-key', 'output');
    return signTo(values.output, await createPackageManifest(values.package, { client: values.client }), values);
  }
  if (command === 'sign-release') {
    required(values, 'artifacts', 'key-id', 'private-key', 'output');
    return signTo(values.output, await createReleaseManifest(values.artifacts), values);
  }
  if (command === 'verify-package' || command === 'verify-release') {
    required(values, command === 'verify-package' ? 'package' : 'artifacts', 'manifest', 'trust');
    const envelope = JSON.parse(await readFile(path.resolve(values.manifest), 'utf8'));
    const trustedKeys = JSON.parse(await readFile(path.resolve(values.trust), 'utf8'));
    const result = command === 'verify-package'
      ? await verifyPackageDirectory(values.package, envelope, { trustedKeys })
      : await verifyArtifactDirectory(values.artifacts, envelope, { trustedKeys });
    const summary = { status: 'verified', keyId: result.keyId, subject: result.manifest.subject, expiresAt: result.expiresAt };
    console.log(JSON.stringify(summary));
    return summary;
  }
  throw new ProvenanceError('usage', usage);
}

if (isMain(import.meta.url)) main().catch(error => {
  const code = error instanceof ProvenanceError ? error.code : 'verification_failed';
  console.error(JSON.stringify({ status: 'rejected', code, message: error instanceof ProvenanceError ? error.message : 'Provenance operation failed.' }));
  process.exitCode = 1;
});

export { main };
