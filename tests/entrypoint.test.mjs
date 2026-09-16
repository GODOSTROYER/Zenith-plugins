import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMain } from '../packages/bridge/entrypoint.mjs';
const run = promisify(execFile);
test('entrypoint identity requires a real matching file', () => {
  assert.equal(isMain(import.meta.url, fileURLToPath(import.meta.url)), true);
  assert.equal(isMain(import.meta.url, fileURLToPath(new URL('../package.json', import.meta.url))), false);
  assert.equal(isMain(import.meta.url, ''), false);
  assert.equal(isMain(import.meta.url, '/nonexistent/zenith-entrypoint.mjs'), false);
});
test('launcher works through a symlinked parent, as in macOS temporary paths', {
  timeout: 10000, skip: process.platform === 'win32' ? 'Creating directory symlinks requires additional Windows privileges.' : false,
}, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith linked launcher '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const alias = path.join(dir, 'linked bridge');
  await symlink(fileURLToPath(new URL('../packages/bridge', import.meta.url)), alias, 'dir');
  const { stdout, stderr } = await run(process.execPath, [path.join(alias, 'cli.mjs'), '--help'], { timeout: 5000 });
  assert.match(stdout, /^Zenith connector: /);
  assert.match(stdout, /\bstdio\b/);
  assert.equal(stderr, '');
});
