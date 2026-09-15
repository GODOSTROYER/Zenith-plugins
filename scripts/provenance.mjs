#!/usr/bin/env node
/** Explicit operator tool for signing and verifying plugin provenance. */
import { createPrivateKey } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isMain } from '../packages/bridge/entrypoint.mjs';
import {
  createPackageManifest, createReleaseManifest, signReleaseManifest,
  verifyPackageDirectory, verifyArtifactDirectory, ProvenanceError,
} from '../packages/provenance/index.mjs';

export const DEFAULT_EXPIRY_DAYS = 90;

const usage = `Usage:
  node scripts/provenance.mjs sign-package --package DIR --key-id ID --private-key FILE --output FILE [--client codex|claude-code] [--expires ISO]
  node scripts/provenance.mjs sign-release --artifacts DIR --key-id ID --private-key FILE --output FILE [--expires ISO]
  node scripts/provenance.mjs verify-package --package DIR --manifest FILE --trust FILE
  node scripts/provenance.mjs verify-release --artifacts DIR --manifest FILE --trust FILE

Every envelope carries an expiry. Without --expires the signature expires ${DEFAULT_EXPIRY_DAYS} days after signing.`;

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

async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const values = options(rest);
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
