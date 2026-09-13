import { spawn } from 'node:child_process';
import { ClientError } from '../client/dist/index.js';

const TOKEN = /^(za_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const SECURITY = '/usr/bin/security';

function validateIdentifier(value: string, field: string): void {
  if (!value || value.length > 200 || /[\0\r\n]/.test(value))
    throw new ClientError('keychain_identifier', `Use a bounded single-line macOS Keychain ${field}.`);
}

function validateCredential(token: string): void {
  if (!TOKEN.test(token) || Buffer.byteLength(token) > 16384)
    throw new ClientError('invalid_credential', 'Supply a bounded Zenith credential or OAuth JWT through stdin, not arguments.');
}

async function security(args: string[], input?: string): Promise<string> {
  if (process.platform !== 'darwin')
    throw new ClientError('keychain_platform', 'macOS Keychain credentials require macOS; use the platform credential mechanism documented for this host.');
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = '', diagnosticBytes = 0, failed = false;
    const fail = () => { failed = true; child.kill(); };
    const timer = setTimeout(fail, 15_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (output.length > 32_768) fail(); });
    child.stderr.on('data', (chunk: Buffer) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 8_192) fail(); });
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      reject(new ClientError('keychain_unavailable', 'macOS Keychain access could not start.'));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || failed) reject(new ClientError('keychain_refused', 'macOS Keychain refused credential access. Unlock the login keychain and verify this user owns the item. Existing items are never overwritten.'));
      else resolve(output);
    });
    child.stdin.end(input ?? '');
  });
}

export async function storeKeychain(service: string, account: string, token: string): Promise<void> {
  validateIdentifier(service, 'service');
  validateIdentifier(account, 'account');
  validateCredential(token);
  // A trailing -w asks security(1) to read the password interactively. Feeding stdin
  // keeps the credential out of argv, environment variables and diagnostics.
  await security(['add-generic-password', '-a', account, '-s', service, '-T', SECURITY, '-w'], `${token}\n`);
}

export async function readKeychain(service: string, account: string): Promise<string> {
  validateIdentifier(service, 'service');
  validateIdentifier(account, 'account');
  const value = (await security(['find-generic-password', '-a', account, '-s', service, '-w'])).trim();
  validateCredential(value);
  return value;
}
