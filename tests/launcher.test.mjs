import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { signedPackageEnvironment } from './provenance-fixture.mjs';

const launcher = path.resolve('packages/launcher/cli.mjs');

function run(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [launcher, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('trusted launcher verifies before importing a package-owned runtime', { timeout: 10000 }, async t => {
  const packageDir = await mkdtemp(path.join(tmpdir(), 'zenith launcher package '));
  t.after(() => rm(packageDir, { recursive: true, force: true }));
  await cp(path.resolve('plugins/codex'), packageDir, { recursive: true });
  const provenance = await signedPackageEnvironment(packageDir);
  t.after(provenance.cleanup);
  const env = { ...process.env, ...provenance.env };
  const normal = await run(['--package-dir', packageDir, '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.equal(normal.code, 0, normal.stderr);

  const consumer = path.join(packageDir, 'runtime/provenance/consumer.mjs');
  const original = await readFile(consumer, 'utf8');
  await writeFile(consumer, `${original}\nexport const tampered = true;\n`);
  const tampered = await run(['--package-dir', packageDir, '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.notEqual(tampered.code, 0);
  assert.match(tampered.stderr, /artifact_mismatch/);
});

test('trusted launcher rejects a relative package directory', { timeout: 10000 }, async t => {
  const env = { ...process.env };
  const result = await run(['--package-dir', '.', '--entry', 'runtime/bridge/cli.mjs', '--help'], env);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /absolute path/);
});
