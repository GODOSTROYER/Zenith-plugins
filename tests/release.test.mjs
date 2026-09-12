import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { prepareRelease } from '../scripts/release.mjs';
// Inspect generated npm tar headers without extracting or trusting their paths.
function tarEntries(bytes) {
  const tar = gunzipSync(bytes), entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(v => v === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0); assert.equal(header[156], 48);
    assert.ok(name.startsWith('package/') && !name.split('/').includes('..')); assert.ok(!entries.has(name));
    entries.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
test('release archives include hidden manifests and reproduce byte-for-byte', { timeout: 30_000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith artifact test ')); t.after(() => rm(dir, { recursive: true, force: true }));
  const first = await prepareRelease(path.join(dir, 'first')), second = await prepareRelease(path.join(dir, 'second'));
  assert.deepEqual(first, second); assert.equal(first.nativeClientVerified, false);
  for (const artifact of first.artifacts) {
    const bytes = await readFile(path.join(dir, 'first', artifact.filename));
    assert.deepEqual(bytes, await readFile(path.join(dir, 'second', artifact.filename)));
    const entries = tarEntries(bytes), integrity = JSON.parse(entries.get('integrity.json'));
    const manifest = artifact.client === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json';
    assert.ok(entries.has(manifest)); assert.ok(entries.has('.mcp.json'));
    assert.deepEqual([...entries.keys()].sort(), [...Object.keys(integrity.files), 'integrity.json'].sort());
    for (const [name, expected] of Object.entries(integrity.files)) assert.equal(createHash('sha256').update(entries.get(name)).digest('hex'), expected);
  }
});
