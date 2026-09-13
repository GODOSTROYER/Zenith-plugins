import { readdir, readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function files(root, exclude = new Set()) {
  const output = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (exclude.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not permitted in distributed sources.');
    if (entry.isDirectory()) output.push(...await files(full, exclude));
    else if (entry.isFile()) output.push(full);
    else throw new Error('Only regular package files are permitted.');
  }
  return output;
}
export async function inventory(root) {
  const entries = {};
  for (const file of await files(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (relative === 'integrity.json') continue;
    if ((await lstat(file)).size > 8_388_608) throw new Error('A distributed file exceeds the 8 MiB package-file limit.');
    entries[relative] = sha256(await readFile(file));
  }
  return entries;
}
