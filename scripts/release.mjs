/** Prepare local review artifacts only. Never publishes or creates a GitHub release. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../packages/bridge/entrypoint.mjs';
import { createHash } from 'node:crypto';
import { inventory } from './package-files.mjs';
const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
export async function prepareRelease(destination = path.join(root, 'artifacts')) {
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
    return report;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) prepareRelease().then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
  console.error('Release preparation failed. Rebuild and verify locally; nothing was published.'); process.exitCode = 1;
});
