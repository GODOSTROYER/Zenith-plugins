/**
 * Execution-boundary provenance gate for installed client packages.
 *
 * A package may be copied or registered by a native client without npm
 * running any repository script. The runtime therefore repeats the signed
 * package check immediately before it opens its MCP/control surface. The
 * manifest and trust file are explicit operator inputs; neither is discovered
 * from the package or a network location.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTrustInputPath, verifyPackageDirectory, ProvenanceError } from './index.mjs';

const consumerFile = fileURLToPath(import.meta.url);
const packageRoot = () => path.resolve(path.dirname(consumerFile), '../..');

// The generated runtime is copied below <package>/runtime/provenance. This
// immutable module-location distinction keeps deleting or changing package
// metadata from turning off the activation gate. The source checkout lives
// below packages/provenance and remains available for development commands.
const isInstalledRuntime = path.basename(path.dirname(path.dirname(consumerFile))) === 'runtime';

async function jsonFile(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new ProvenanceError('provenance_required', `The ${label} could not be read from the trusted launcher path.`); }
}

/** The file a generated package states its own activation mode in. */
export const PROVENANCE_MODE_FILE = 'provenance-mode.json';
export const UNSIGNED_PREVIEW = 'unsigned-preview';

/**
 * Read a package's `unsigned-preview` marker, or undefined for anything else —
 * a missing file, unreadable bytes, malformed JSON, an unknown document
 * version, another mode, or a marker whose own fields are not the bounded
 * strings this build writes. Undefined always means "fall through to the signed
 * requirement", so a damaged marker fails closed rather than opening the gate.
 */
export async function readPreviewMarker(packageDir) {
  let document;
  try { document = JSON.parse(await readFile(path.join(packageDir, PROVENANCE_MODE_FILE), 'utf8')); }
  catch { return undefined; }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return undefined;
  if (document.version !== 1 || document.mode !== UNSIGNED_PREVIEW) return undefined;
  const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  if (!bounded(document.packageVersion) || !bounded(document.generatedFrom)) return undefined;
  return { mode: UNSIGNED_PREVIEW, packageVersion: document.packageVersion, generatedFrom: document.generatedFrom,
    ...(typeof document.client === 'string' && document.client.length <= 40 ? { client: document.client } : {}) };
}

/**
 * Verify an installed package before activation. Development checkouts remain
 * usable without a release envelope; generated plugin packages require one
 * unless they declare themselves an unsigned preview, and then only while no
 * provenance input is configured at all.
 *
 * The preview marker sits inside the package, so it cannot authenticate
 * anything: it is a statement by the package about itself, and its whole effect
 * is to let a marketplace install activate while every user-facing command says
 * the build is not publisher-verified. It is therefore ignored the moment an
 * operator supplies a manifest, a trust file or ZENITH_REQUIRE_PROVENANCE=1 —
 * those inputs mean "verify this", and a package that answers "no need" is
 * exactly the answer that must not be believed. A package with neither a marker
 * nor provenance inputs still fails closed with `provenance_required`.
 */
export async function enforceInstalledProvenance(options = {}) {
  const manifestInput = options.manifestPath ?? process.env.ZENITH_PROVENANCE_MANIFEST;
  const trustInput = options.trustPath ?? process.env.ZENITH_PROVENANCE_TRUST;
  // Any supplied value counts, including an empty one: a broken operator input
  // must be reported, never silently downgraded to the preview path.
  const demanded = options.required === true || process.env.ZENITH_REQUIRE_PROVENANCE === '1'
    || manifestInput !== undefined || trustInput !== undefined;
  if (!isInstalledRuntime && !demanded) return { required: false, mode: 'development' };
  const packageDir = options.packageDir ?? packageRoot();
  if (!demanded) {
    const preview = await readPreviewMarker(packageDir);
    if (preview) return { required: false, mode: UNSIGNED_PREVIEW, preview };
  }
  const manifestPath = (await assertTrustInputPath(manifestInput, 'ZENITH_PROVENANCE_MANIFEST')).path;
  const trust = await assertTrustInputPath(trustInput, 'ZENITH_PROVENANCE_TRUST');
  const envelope = await jsonFile(manifestPath, 'publisher manifest');
  const trustedKeys = await jsonFile(trust.path, 'publisher trust allowlist');
  const result = await verifyPackageDirectory(packageDir, envelope, {
    trustedKeys,
    now: options.now,
    minimumVersion: options.minimumVersion,
  });
  return { required: true, mode: 'verified', trustPathPermissionsChecked: trust.permissionsChecked, ...result };
}
