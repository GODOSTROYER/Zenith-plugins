#!/usr/bin/env node
/**
 * Trusted activation launcher for installed Zenith plugin packages.
 *
 * This file is installed outside the plugin directory. It verifies the
 * package before Node imports any package-owned runtime module; the package
 * cannot replace the provenance checker that protects its own activation.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProvenanceError, verifyPackageDirectory } from '../provenance/index.mjs';

function requiredPath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new ProvenanceError('provenance_required', `${label} must be an absolute path supplied by the trusted installer.`);
  return value;
}

async function jsonFile(file, label) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new ProvenanceError('provenance_required', `The ${label} could not be read from the trusted installer path.`); }
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseArgs() {
  const input = process.argv.slice(2);
  const packageFlag = input.indexOf('--package-dir');
  const entryFlag = input.indexOf('--entry');
  if (packageFlag < 0 || entryFlag < 0 || !input[packageFlag + 1] || !input[entryFlag + 1])
    throw new ProvenanceError('usage', 'Use: zenith-plugin-launcher --package-dir PACKAGE_DIR --entry RELATIVE_ENTRY [args…].');
  const packageDir = requiredPath(input[packageFlag + 1], 'PACKAGE_DIR');
  const entry = path.resolve(packageDir, input[entryFlag + 1]);
  if (!within(packageDir, entry))
    throw new ProvenanceError('usage', 'The package entry must remain inside the package directory.');
  const skip = new Set([packageFlag, packageFlag + 1, entryFlag, entryFlag + 1]);
  return { packageDir, entry, childArgs: input.filter((_, index) => !skip.has(index)) };
}

async function main() {
  const { packageDir, entry, childArgs } = parseArgs();
  const manifestPath = requiredPath(process.env.ZENITH_PROVENANCE_MANIFEST, 'ZENITH_PROVENANCE_MANIFEST');
  const trustPath = requiredPath(process.env.ZENITH_PROVENANCE_TRUST, 'ZENITH_PROVENANCE_TRUST');
  const envelope = await jsonFile(manifestPath, 'publisher manifest');
  const trustedKeys = await jsonFile(trustPath, 'publisher trust allowlist');
  await verifyPackageDirectory(packageDir, envelope, { trustedKeys });

  const child = spawn(process.execPath, [entry, ...childArgs], {
    cwd: packageDir,
    env: { ...process.env, ZENITH_PROVENANCE_EXTERNAL_VERIFIED: '1' },
    stdio: 'inherit',
  });
  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  }).then(({ code, signal }) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

main().catch(error => {
  const code = error instanceof ProvenanceError ? error.code : 'launcher_failed';
  console.error(JSON.stringify({ level: 'error', code, message: error.message }));
  process.exitCode = 1;
});
