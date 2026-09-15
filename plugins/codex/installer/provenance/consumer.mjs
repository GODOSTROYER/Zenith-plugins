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
import { verifyPackageDirectory, ProvenanceError } from './index.mjs';

const consumerFile = fileURLToPath(import.meta.url);
const packageRoot = () => path.resolve(path.dirname(consumerFile), '../..');

// The generated runtime is copied below <package>/runtime/provenance. This
// immutable module-location distinction keeps deleting or changing package
// metadata from turning off the activation gate. The source checkout lives
// below packages/provenance and remains available for development commands.
const isInstalledRuntime = path.basename(path.dirname(path.dirname(consumerFile))) === 'runtime';

const requiredPath = (value, label) => {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new ProvenanceError('provenance_required', `${label} must be an absolute path supplied by the trusted launcher.`);
  return value;
};

async function jsonFile(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new ProvenanceError('provenance_required', `The ${label} could not be read from the trusted launcher path.`); }
}

/**
 * Verify an installed package before activation. Development checkouts remain
 * usable without a release envelope; generated plugin packages always require
 * one, even if a caller sets ZENITH_REQUIRE_PROVENANCE=0.
 */
export async function enforceInstalledProvenance(options = {}) {
  const required = isInstalledRuntime || options.required === true || process.env.ZENITH_REQUIRE_PROVENANCE === '1';
  if (!required) return { required: false };
  const manifestPath = requiredPath(options.manifestPath ?? process.env.ZENITH_PROVENANCE_MANIFEST, 'ZENITH_PROVENANCE_MANIFEST');
  const trustPath = requiredPath(options.trustPath ?? process.env.ZENITH_PROVENANCE_TRUST, 'ZENITH_PROVENANCE_TRUST');
  const envelope = await jsonFile(manifestPath, 'publisher manifest');
  const trustedKeys = await jsonFile(trustPath, 'publisher trust allowlist');
  const result = await verifyPackageDirectory(options.packageDir ?? packageRoot(), envelope, {
    trustedKeys,
    now: options.now,
  });
  return { required: true, ...result };
}
