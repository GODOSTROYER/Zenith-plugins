import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, lstat, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { profile, readBoundedFile, configuredClient, setup, writeProfile, sameFileIdentity } from '../packages/bridge/config.mjs';
const token = `za_${'C'.repeat(43)}`;
const posix = { skip: process.platform === 'win32' ? 'Private-file ACL checks intentionally refuse Windows.' : false };
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith private profile '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = path.join(dir, 'client.token'), output = path.join(dir, 'profile.json');
  await writeFile(tokenFile, token, { mode: 0o600 });
  return { dir, tokenFile, output, value: { version: 1, origin: 'http://127.0.0.1:3400', allowLoopbackHttp: true, association: { version: 1, workspaceId: 'ws', projectId: 'project' }, tokenFile } };
}
test('private setup writes only validated metadata and never overwrites', posix, async t => {
  const f = await fixture(t);
  const result = await setup(['--output', f.output, '--url', f.value.origin, '--workspace', 'ws', '--project', 'project', '--token-file', f.tokenFile, '--allow-loopback-http']);
  assert.equal(result.ok, true); assert.equal(result.evidence.includes('no authentication'), true);
  assert.equal((await lstat(f.output)).mode & 0o777, 0o600);
  const text = await readFile(f.output, 'utf8'); assert.equal(text.includes(token), false); assert.equal(JSON.stringify(result).includes(token), false);
  const client = await configuredClient({ ZENITH_CONFIG_FILE: f.output });
  assert.equal(client.scope.projectId, 'project'); assert.equal(client.url.origin, f.value.origin);
  await assert.rejects(writeProfile(f.output, f.value), e => e.code === 'profile_exists');
  assert.equal(await readFile(f.output, 'utf8'), text);
  assert.deepEqual((await readdir(f.dir)).sort(), ['client.token', 'profile.json']);
});
test('setup refuses credential overwrite and non-private parent', posix, async t => {
  const f = await fixture(t);
  await assert.rejects(writeProfile(f.tokenFile, f.value), e => e.code === 'configuration_path');
  await chmod(f.dir, 0o755);
  await assert.rejects(writeProfile(f.output, f.value), e => e.code === 'profile_directory');
  assert.equal(await readFile(f.tokenFile, 'utf8'), token);
});
test('setup never follows a destination symlink', posix, async t => {
  const f = await fixture(t); await symlink(f.tokenFile, f.output);
  await assert.rejects(writeProfile(f.output, f.value), e => e.code === 'profile_exists');
  assert.equal(await readFile(f.tokenFile, 'utf8'), token);
});
test('bounded configuration refuses oversized, malformed UTF-8 and non-regular files', async t => {
  const f = await fixture(t); await writeFile(f.output, 'x'.repeat(4097));
  await assert.rejects(readBoundedFile(f.output, 4096));
  await writeFile(f.output, Buffer.from([0xff])); await assert.rejects(readBoundedFile(f.output, 4096));
  await assert.rejects(readBoundedFile(f.dir, 4096)); await assert.rejects(readBoundedFile('relative.json', 4096));
});
test('profile forbids raw credentials, unknown versions and hostile destination data', async t => {
  const f = await fixture(t);
  for (const value of [{ ...f.value, token }, { ...f.value, version: 2 }, { ...f.value, allowLoopbackHttp: '1' },
    { ...f.value, origin: 'https://host.invalid/redirect' }, { ...f.value, tokenFile: 'relative' },
    { ...f.value, association: { ...f.value.association, url: 'https://attacker.invalid' } }]) assert.throws(() => profile(value));
});
test('setup rejects unknown, duplicate and secret-bearing flags', async () => {
  for (const args of [[], ['--token', token], ['--output', '/a', '--output', '/b'], ['--allow-loopback-http', '--allow-loopback-http']])
    await assert.rejects(setup(args), e => e.code === 'usage' && !e.message.includes(token));
});
test('configuration rejects profile/env and association/env ambiguity before access', async () => {
  await assert.rejects(configuredClient({ ZENITH_CONFIG_FILE: '/unused', ZENITH_URL: 'https://host.invalid' }), e => e.code === 'ambiguous_configuration');
  await assert.rejects(configuredClient({ ZENITH_URL: 'https://host.invalid', ZENITH_ASSOCIATION_FILE: '/unused', ZENITH_WORKSPACE_ID: 'ws' }), e => e.code === 'ambiguous_configuration');
});
test('environment-only configuration requires explicit scope and one credential', async () => {
  const base = { ZENITH_URL: 'https://host.invalid', ZENITH_WORKSPACE_ID: 'ws', ZENITH_TOKEN: token };
  assert.equal((await configuredClient(base)).scope.workspaceId, 'ws');
  for (const values of [{}, { ...base, ZENITH_WORKSPACE_ID: '' }, { ...base, ZENITH_TOKEN: '' }, { ...base, ZENITH_TOKEN_FILE: '/unused' }, { ...base, ZENITH_ALLOW_LOOPBACK_HTTP: 'true' }])
    await assert.rejects(configuredClient(values));
});
test('ID-only association verifies scope or refuses unavailable Windows identity', async t => {
  const f = await fixture(t); await writeFile(f.output, JSON.stringify(f.value.association));
  const env = { ZENITH_URL: 'https://host.invalid', ZENITH_ASSOCIATION_FILE: f.output, ZENITH_TOKEN: token };
  if (process.platform === 'win32' && (await lstat(f.output, { bigint: true })).dev === 0n) {
    await assert.rejects(configuredClient(env), { code: 'file_identity_unverified' });
  } else {
    assert.equal((await configuredClient(env)).scope.projectId, 'project');
  }
});
test('private profile refuses permissive permissions', posix, async t => {
  const f = await fixture(t); await writeFile(f.output, JSON.stringify(f.value), { mode: 0o644 });
  await assert.rejects(configuredClient({ ZENITH_CONFIG_FILE: f.output }), e => e.code === 'credential_permissions');
});

test('file identity retains full inode precision and normalizes only Windows serial width', () => {
  const pathStat = { dev: 0x123456789abcdef0n, ino: 9007199254740993n };
  const handleStat = { dev: 0x9abcdef0n, ino: 9007199254740993n };
  assert.equal(sameFileIdentity(pathStat, handleStat, 'win32'), true);
  assert.equal(sameFileIdentity(pathStat, handleStat, 'linux'), false);
  assert.equal(sameFileIdentity(pathStat, { ...handleStat, dev: 0x9abcdef1n }, 'win32'), false);
  assert.equal(sameFileIdentity(pathStat, { ...handleStat, ino: 9007199254740992n }, 'win32'), false);
  assert.equal(sameFileIdentity(pathStat, { ...pathStat }, 'linux'), true);
});
