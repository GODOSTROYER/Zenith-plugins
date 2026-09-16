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
/**
 * No generated file may carry a credential. The first two patterns are the
 * exact shapes Zenith mints (an agent bearer and a link device code); the third
 * catches an environment block that assigns ZENITH_TOKEN a value, while its
 * negative lookahead keeps an `=== env.ZENITH_TOKEN` comparison in shipped
 * runtime code from reading as an inlined secret. scripts/build.mjs runs this
 * before it writes an inventory and tests/hardening.test.mjs runs it over the
 * committed packages, so a bad file is caught whether it arrives through the
 * build or by hand. This is a check for these exact shapes, not a universal
 * secret detector.
 */
export const SECRET_PATTERNS = Object.freeze([/za_[A-Za-z0-9_-]{43}/, /zl_[A-Za-z0-9_-]{43}/, /ZENITH_TOKEN["']?\s*[:=](?!=)/]);
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.wasm', '.zip', '.tgz']);
export async function scanForSecrets(root) {
  const hits = [];
  for (const file of await files(root, new Set(['node_modules', '.git']))) {
    if (BINARY.has(path.extname(file).toLowerCase())) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const pattern of SECRET_PATTERNS)
      if (pattern.test(text)) hits.push(`${path.relative(root, file).split(path.sep).join('/')} matches ${pattern}`);
  }
  return hits;
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
