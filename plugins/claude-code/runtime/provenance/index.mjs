/**
 * Publisher provenance for Zenith plugin packages.
 *
 * integrity.json and SHA256SUMS are tamper-evident inventories, not publisher
 * authentication. This module adds a small, dependency-free Ed25519 envelope.
 * Private keys are accepted only from the caller; no key is discovered from a
 * package, repository, URL, or environment default.
 */
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const ENVELOPE_VERSION = 1;
export const MANIFEST_VERSION = 1;
export const ALGORITHM = 'ed25519';
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export class ProvenanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProvenanceError';
    this.code = code;
  }
}

function fail(code, message) { throw new ProvenanceError(code, message); }

/** Stable JSON encoding used as the Ed25519 signing bytes. */
export function canonicalize(value) {
  const encode = input => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input);
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('invalid_manifest', 'Manifest numbers must be finite.');
      return JSON.stringify(input);
    }
    if (Array.isArray(input)) return `[${input.map(encode).join(',')}]`;
    if (input && typeof input === 'object') {
      const keys = Object.keys(input).sort();
      return `{${keys.map(key => `${JSON.stringify(key)}:${encode(input[key])}`).join(',')}}`;
    }
    fail('invalid_manifest', 'Manifest values must be JSON values.');
  };
  return encode(value);
}

const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');

async function readRegularFile(file, failureCode, message) {
  let info;
  try { info = await lstat(file); } catch { fail(failureCode, message); }
  if (!info.isFile()) fail(failureCode, message);
  try { return await readFile(file); } catch { fail(failureCode, message); }
}

async function packageFiles(root, current = root, output = {}) {
  const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) fail('unsafe_package', 'Symlinks are not permitted in provenance subjects.');
    if (entry.isDirectory()) await packageFiles(root, full, output);
    else if (entry.isFile()) {
      const info = await lstat(full);
      if (!info.isFile()) fail('unsafe_package', 'Only regular files are permitted in provenance subjects.');
      output[path.relative(root, full).split(path.sep).join('/')] = bytesHash(await readFile(full));
    } else fail('unsafe_package', 'Only regular files are permitted in provenance subjects.');
  }
  return output;
}

export async function inventoryPackage(packageDir) {
  const root = path.resolve(packageDir);
  let info;
  try { info = await lstat(root); } catch { fail('invalid_subject', 'Provenance subject directory does not exist.'); }
  if (!info.isDirectory()) fail('unsafe_package', 'Provenance subject must be a directory.');
  return packageFiles(root);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('invalid_manifest', `${label} must be a lowercase SHA-256 digest.`);
}

function parseTimestamp(value, label, code = 'invalid_envelope') {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(code, `${label} must be an ISO timestamp.`);
  return Date.parse(value);
}

function assertTimestamp(value, label) {
  parseTimestamp(value, label);
}

function assertEnvelopeShape(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('invalid_envelope', 'Publisher envelope must be an object.');
  if (envelope.envelopeVersion !== ENVELOPE_VERSION) fail('unsupported_envelope', 'Unsupported publisher envelope version.');
  if (envelope.algorithm !== ALGORITHM) fail('unsupported_algorithm', 'Only Ed25519 publisher envelopes are supported.');
  if (!KEY_ID.test(envelope.keyId ?? '')) fail('invalid_envelope', 'Publisher envelope has an invalid key id.');
  if (typeof envelope.signature !== 'string' || !BASE64URL.test(envelope.signature)) fail('unsigned', 'Publisher envelope has no usable signature.');
  if (!envelope.manifest || typeof envelope.manifest !== 'object' || Array.isArray(envelope.manifest)) fail('invalid_manifest', 'Publisher envelope has no manifest object.');
  if (envelope.manifest.manifestVersion !== MANIFEST_VERSION) fail('unsupported_manifest', 'Unsupported publisher manifest version.');
  const signedAt = parseTimestamp(envelope.signedAt, 'signedAt');
  if (envelope.expiresAt !== undefined && parseTimestamp(envelope.expiresAt, 'expiresAt') <= signedAt) fail('invalid_envelope', 'expiresAt must be later than signedAt.');
}

function normalizeTrust(trustedKeys) {
  if (!trustedKeys || typeof trustedKeys !== 'object' || Array.isArray(trustedKeys) || trustedKeys.version !== 1 || !Array.isArray(trustedKeys.keys)) {
    fail('trust_required', 'An explicit version-1 publisher trust allowlist is required.');
  }
  const keys = new Map();
  for (const entry of trustedKeys.keys) {
    if (!entry || typeof entry !== 'object' || !KEY_ID.test(entry.id ?? '') || typeof entry.publicKey !== 'string') fail('invalid_trust', 'Trust entries require an id and publicKey.');
    if (keys.has(entry.id)) fail('invalid_trust', `Trust allowlist repeats key id ${entry.id}.`);
    const status = entry.status ?? 'active';
    if (status !== 'active' && status !== 'revoked') fail('invalid_trust', `Trust entry ${entry.id} has an invalid status.`);
    const notBefore = entry.notBefore === undefined ? undefined : parseTimestamp(entry.notBefore, `Trust entry ${entry.id} notBefore`, 'invalid_trust');
    const notAfter = entry.notAfter === undefined ? undefined : parseTimestamp(entry.notAfter, `Trust entry ${entry.id} notAfter`, 'invalid_trust');
    if (notBefore !== undefined && notAfter !== undefined && notBefore >= notAfter) {
      fail('invalid_trust', `Trust entry ${entry.id} has an invalid validity window.`);
    }
    keys.set(entry.id, { ...entry, status, notBefore, notAfter });
  }
  return keys;
}

function decodeSignature(value) {
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4), 'base64');
  if (bytes.length !== 64) fail('unsigned', 'Publisher envelope has no usable signature.');
  return bytes;
}

function keyObject(publicKey) {
  try {
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== 'ed25519') fail('invalid_trust', 'Trusted publisher key must be Ed25519.');
    return key;
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    fail('invalid_trust', 'Trusted publisher public key is invalid.');
  }
}

function signingPayload(envelope) {
  const { signature: _signature, ...payload } = envelope;
  return payload;
}

/** Verify the signed envelope and operator-selected key policy. */
export function verifyReleaseManifest(envelope, { trustedKeys, now = new Date() } = {}) {
  assertEnvelopeShape(envelope);
  const trust = normalizeTrust(trustedKeys);
  const trusted = trust.get(envelope.keyId);
  if (!trusted) fail('unknown_key', `Publisher key ${envelope.keyId} is not trusted by this operator.`);
  if (trusted.status === 'revoked' || trusted.revokedAt !== undefined) fail('revoked_key', `Publisher key ${envelope.keyId} is revoked.`);
  const signedAt = Date.parse(envelope.signedAt);
  let clock;
  try { clock = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : NaN; } catch { clock = NaN; }
  if (!Number.isFinite(clock)) fail('invalid_time', 'Verification time is invalid.');
  if (trusted.notBefore !== undefined && signedAt < trusted.notBefore) fail('key_not_valid', `Publisher key ${envelope.keyId} was not valid when the manifest was signed.`);
  if (trusted.notAfter !== undefined && signedAt >= trusted.notAfter) fail('key_not_valid', `Publisher key ${envelope.keyId} was expired when the manifest was signed.`);
  if (envelope.expiresAt !== undefined && clock >= Date.parse(envelope.expiresAt)) fail('expired_manifest', 'Publisher manifest has expired.');
  let valid = false;
  try { valid = verify(null, Buffer.from(canonicalize(signingPayload(envelope))), keyObject(trusted.publicKey), decodeSignature(envelope.signature)); }
  catch (error) { if (error instanceof ProvenanceError) throw error; }
  if (!valid) fail('signature_invalid', 'Publisher manifest signature is invalid.');
  return { keyId: envelope.keyId, manifest: envelope.manifest, signedAt: envelope.signedAt };
}

export function signReleaseManifest(manifest, { keyId, privateKey, signedAt = new Date().toISOString(), expiresAt } = {}) {
  if (!KEY_ID.test(keyId ?? '')) fail('invalid_envelope', 'A publisher key id is required.');
  if (!manifest || manifest.manifestVersion !== MANIFEST_VERSION) fail('invalid_manifest', 'Manifest must use version 1.');
  if (!privateKey) fail('signing_key_required', 'An external Ed25519 private key is required for signing.');
  assertTimestamp(signedAt, 'signedAt');
  if (expiresAt !== undefined) assertTimestamp(expiresAt, 'expiresAt');
  if (expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(signedAt)) fail('invalid_envelope', 'expiresAt must be later than signedAt.');
  const envelope = { envelopeVersion: ENVELOPE_VERSION, algorithm: ALGORITHM, keyId, signedAt, manifest };
  if (expiresAt !== undefined) envelope.expiresAt = expiresAt;
  try { envelope.signature = sign(null, Buffer.from(canonicalize(envelope)), privateKey).toString('base64url'); }
  catch { fail('signing_failed', 'Could not sign the publisher manifest with the supplied Ed25519 key.'); }
  return envelope;
}

export async function createPackageManifest(packageDir, { client } = {}) {
  const root = path.resolve(packageDir);
  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch { fail('invalid_subject', 'Package subject must contain package.json.'); }
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') fail('invalid_subject', 'Package package.json must contain name and version strings.');
  return { manifestVersion: MANIFEST_VERSION, subject: { kind: 'zenith-plugin-package', name: pkg.name, version: pkg.version, ...(client ? { client } : {}) }, files: await inventoryPackage(root) };
}

export async function createReleaseManifest(artifactDir) {
  const root = path.resolve(artifactDir);
  let release;
  try { release = JSON.parse((await readRegularFile(path.join(root, 'release.json'), 'invalid_subject', 'Artifact directory must contain release.json.')).toString('utf8')); }
  catch { fail('invalid_subject', 'Artifact directory must contain release.json.'); }
  if (typeof release.version !== 'string' || !Array.isArray(release.artifacts)) fail('invalid_subject', 'Release report must contain a version and artifacts array.');
  const artifacts = [], names = new Set();
  for (const artifact of release.artifacts) {
    if (!artifact || typeof artifact.filename !== 'string' || !/^[A-Za-z0-9_.-]+\.tgz$/.test(artifact.filename)) fail('invalid_manifest', 'Release contains an invalid archive name.');
    if (names.has(artifact.filename)) fail('invalid_manifest', `Release repeats archive ${artifact.filename}.`);
    names.add(artifact.filename);
    const bytes = await readRegularFile(path.join(root, artifact.filename), 'invalid_subject', `Release archive ${artifact.filename} is missing.`);
    const sha256 = bytesHash(bytes);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes !== bytes.length || artifact.sha256 !== sha256) fail('invalid_subject', `Release report entry ${artifact.filename} has incorrect bytes or sha256.`);
    if (artifact.client !== undefined && typeof artifact.client !== 'string') fail('invalid_manifest', `Release report entry ${artifact.filename} has an invalid client.`);
    artifacts.push({ filename: artifact.filename, bytes: bytes.length, sha256, ...(artifact.client === undefined ? {} : { client: artifact.client }) });
  }
  artifacts.sort((a, b) => a.filename.localeCompare(b.filename));
  return { manifestVersion: MANIFEST_VERSION, subject: { kind: 'zenith-plugin-release', version: release.version }, artifacts };
}

export async function verifyPackageDirectory(packageDir, envelope, options) {
  const result = verifyReleaseManifest(envelope, options);
  const manifest = result.manifest;
  if (manifest.subject?.kind !== 'zenith-plugin-package' || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) fail('subject_mismatch', 'Publisher manifest is not a plugin package manifest.');
  const actual = await inventoryPackage(packageDir);
  if (canonicalize(actual) !== canonicalize(manifest.files)) fail('artifact_mismatch', 'Package files do not match the signed publisher manifest.');
  return result;
}

export async function verifyArtifactDirectory(artifactDir, envelope, options) {
  const result = verifyReleaseManifest(envelope, options);
  if (result.manifest.subject?.kind !== 'zenith-plugin-release' || typeof result.manifest.subject.version !== 'string' || !Array.isArray(result.manifest.artifacts)) fail('subject_mismatch', 'Publisher manifest is not a release artifact manifest.');
  const root = path.resolve(artifactDir);
  let rootInfo;
  try { rootInfo = await lstat(root); } catch { fail('artifact_mismatch', 'Release artifact directory is missing.'); }
  if (!rootInfo.isDirectory()) fail('artifact_mismatch', 'Release artifact subject must be a directory.');
  let report;
  try { report = JSON.parse((await readRegularFile(path.join(root, 'release.json'), 'artifact_mismatch', 'Release report is missing or invalid.')).toString('utf8')); } catch { fail('artifact_mismatch', 'Release report is missing or invalid.'); }
  if (report.version !== result.manifest.subject.version || !Array.isArray(report.artifacts)) fail('artifact_mismatch', 'Release report does not match the signed release subject.');
  const signed = new Map(), reported = new Map();
  for (const artifact of result.manifest.artifacts) {
    if (!artifact || typeof artifact.filename !== 'string' || !/^[A-Za-z0-9_.-]+\.tgz$/.test(artifact.filename) || signed.has(artifact.filename)) fail('invalid_manifest', 'Signed release contains duplicate or invalid archives.');
    signed.set(artifact.filename, artifact);
  }
  for (const artifact of report.artifacts) {
    if (!artifact || typeof artifact.filename !== 'string' || reported.has(artifact.filename)) fail('artifact_mismatch', 'Release report contains duplicate or invalid archives.');
    reported.set(artifact.filename, artifact);
  }
  if (reported.size !== signed.size || [...signed.keys()].some(name => !reported.has(name))) fail('artifact_mismatch', 'Release report does not enumerate exactly the signed archives.');
  for (const artifact of result.manifest.artifacts) {
    const reportArtifact = reported.get(artifact.filename);
    if (canonicalize(reportArtifact) !== canonicalize(artifact)) fail('artifact_mismatch', `Release report entry ${artifact.filename} differs from the signed manifest.`);
    const bytes = await readRegularFile(path.join(root, artifact.filename), 'artifact_mismatch', `Signed artifact ${artifact.filename} is missing.`);
    assertSha256(artifact.sha256, `${artifact.filename} sha256`);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || bytes.length !== artifact.bytes || bytesHash(bytes) !== artifact.sha256) fail('artifact_mismatch', `Signed artifact ${artifact.filename} does not match its manifest.`);
  }
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { fail('artifact_mismatch', 'Release artifact directory cannot be read.'); }
  for (const entry of entries) if (entry.name.endsWith('.tgz') && (!entry.isFile() || !signed.has(entry.name))) fail('artifact_mismatch', `Unsigned or unsafe release archive ${entry.name} is present.`);
  return result;
}
