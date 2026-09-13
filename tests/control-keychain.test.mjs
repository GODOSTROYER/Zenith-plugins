import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tsImport } from 'tsx/esm/api';

const { storeKeychain, readKeychain } = await tsImport('../packages/control/keychain.ts', import.meta.url);
const credential = `za_${'K'.repeat(43)}`;

function remove(service, account) {
  if (process.platform !== 'darwin') return Promise.resolve();
  return new Promise(resolve => {
    const child = spawn('/usr/bin/security', ['delete-generic-password', '-a', account, '-s', service], { stdio: 'ignore', shell: false });
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

test('keychain rejects malformed credentials and identifiers before native execution', async () => {
  await assert.rejects(storeKeychain('zenith-test', 'member', 'not-a-token'), { code: 'invalid_credential' });
  await assert.rejects(storeKeychain('bad\nservice', 'member', credential), { code: 'keychain_identifier' });
  await assert.rejects(storeKeychain('zenith-test', 'bad\raccount', credential), { code: 'keychain_identifier' });
});

test('Keychain refuses other platforms instead of pretending secure storage is available', { skip: process.platform === 'darwin' }, async () => {
  await assert.rejects(storeKeychain('zenith-test', 'member', credential), { code: 'keychain_platform' });
});

test('macOS Keychain roundtrip is create-only', { skip: process.platform !== 'darwin', timeout: 60_000 }, async t => {
  const suffix = randomUUID(), service = `zenith-ci-${suffix}`, account = `member-${suffix}`;
  t.after(() => remove(service, account));
  await storeKeychain(service, account, credential);
  assert.equal(await readKeychain(service, account), credential);
  await assert.rejects(storeKeychain(service, account, credential), { code: 'keychain_refused' });
});
