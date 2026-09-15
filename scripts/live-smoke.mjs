/** Explicitly opt-in real endpoint checks; fixtures must not be presented as live evidence. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../packages/bridge/entrypoint.mjs';
import { configuredClient } from '../packages/bridge/config.mjs';
import { inspectConnection } from '../packages/bridge/doctor.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), run = promisify(execFile);
function packageProvenance(env, client) {
  const suffix = client.toUpperCase().replace('-', '_');
  const manifest = env[`ZENITH_PROVENANCE_MANIFEST_${suffix}`] ?? env.ZENITH_PROVENANCE_MANIFEST;
  const trust = env[`ZENITH_PROVENANCE_TRUST_${suffix}`] ?? env.ZENITH_PROVENANCE_TRUST;
  if (!manifest || !trust) throw Error(`Missing signed provenance inputs for copied ${client} package.`);
  return { ...env, ZENITH_REQUIRE_PROVENANCE: '1', ZENITH_PROVENANCE_MANIFEST: manifest, ZENITH_PROVENANCE_TRUST: trust };
}
export async function smoke(env = process.env) {
  if (env.ZENITH_LIVE_TEST !== '1') throw Error('Set ZENITH_LIVE_TEST=1 and explicit trusted connection configuration to opt in. Missing live prerequisites are not a passing test.');
  const standalone = await inspectConnection(await configuredClient(env));
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith live installed packages ')), packages = {};
  try {
    for (const kind of ['codex', 'claude-code']) {
      const target = path.join(dir, kind);
      await cp(path.join(root, 'plugins', kind), target, { recursive: true });
      const { stdout } = await run(process.execPath, [path.join(target, 'runtime/bridge/cli.mjs'), 'doctor'],
        { cwd: tmpdir(), env: packageProvenance(env, kind), timeout: 120_000, maxBuffer: 262_144 });
      const report = JSON.parse(stdout);
      if (report.ok !== true || report.scopeVerified !== true || report.mode !== 'read-only') throw Error('A packaged connection check failed.');
      packages[kind] = report;
    }
    return { ok: true, runtime: process.version, platform: process.platform, standalone, packages,
      evidence: 'Authenticated endpoint checks through standalone and copied Node packages. Not Codex/Claude binary, model behavior, provider or deployment verification.' };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) smoke().then(report => console.log(JSON.stringify(report, null, 2))).catch(() => {
  console.error('Live smoke did not pass. Explicit opt-in, a running reviewed Zenith, and a valid scoped credential are required. No raw error body or credential is printed.'); process.exitCode = 1;
});
