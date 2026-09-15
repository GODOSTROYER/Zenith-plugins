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

const packageRoot = () => fileURLToPath(new URL('../../', import.meta.url));

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
 * Verify an installed package when the launcher enables the gate.
 * Development checkouts remain usable without a release envelope; production
 * launchers set ZENITH_REQUIRE_PROVENANCE=1 and must provide both files.
 */
export async function enforceInstalledProvenance(options = {}) {
  const required = options.required ?? process.env.ZENITH_REQUIRE_PROVENANCE === '1';
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
