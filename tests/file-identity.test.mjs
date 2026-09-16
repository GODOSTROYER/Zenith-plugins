import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtemp, writeFile, lstat, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sameFileIdentity, readBoundedFile } from '../packages/bridge/config.mjs';

test('bounded file reading verifies identity or refuses an unavailable Windows device', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith identity fixture '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const name = path.join(dir, 'ids.json');
  await writeFile(name, '{"version":1,"workspaceId":"fixture"}');
  const before = await lstat(name, { bigint: true });
  if (process.platform === 'win32' && before.dev === 0n) {
    await assert.rejects(readBoundedFile(name, 4096), { code: 'file_identity_unverified' });
    // An ACL-verified profile read falls back to the file index on such a volume.
    assert.match(await readBoundedFile(name, 4096, false, true), /fixture/);
    return;
  }
  const handle = await open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const after = await handle.stat({ bigint: true });
    const fields = stat => ({ dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), size: String(stat.size), regular: stat.isFile() });
    assert.ok(sameFileIdentity(before, after), JSON.stringify({ platform: process.platform, before: fields(before), after: fields(after) }));
    assert.equal(after.isFile(), true);
  } finally { await handle.close(); }
});
