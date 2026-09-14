import { spawn } from 'node:child_process';
import { ClientError } from '../client/dist/index.js';

const TOKEN = /^(za_[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const SECURITY = '/usr/bin/security';

function validateIdentifier(value: string, field: string): void {
  if (!IDENTIFIER.test(value))
    throw new ClientError('keychain_identifier', `Use a 1–200 character macOS Keychain ${field} containing only letters, digits, dot, underscore, colon, at, slash or hyphen.`);
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
    let output = '', diagnosticBytes = 0, failed = false, settled = false;
    const rejectOnce = (error: ClientError) => { if (!settled) { settled = true; reject(error); } };
    const fail = () => { failed = true; child.kill(); };
    const timer = setTimeout(fail, 15_000);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); if (Buffer.byteLength(output) > 32_768) fail(); });
    child.stderr.on('data', (chunk: Buffer) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 8_192) fail(); });
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      rejectOnce(new ClientError('keychain_unavailable', 'macOS Keychain access could not start.'));
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0 || failed) rejectOnce(new ClientError('keychain_refused', 'macOS Keychain refused credential access. Unlock the login keychain and verify this user owns the item. Existing items are never overwritten.'));
      else { settled = true; resolve(output); }
    });
    child.stdin.end(input ?? '');
  });
}

export async function storeKeychain(service: string, account: string, token: string): Promise<void> {
  validateIdentifier(service, 'service');
  validateIdentifier(account, 'account');
  validateCredential(token);
  // security(1)'s trailing -w prompt reads from a terminal rather than a pipe on CI.
  // Interactive mode reads commands from stdin, so the secret remains out of argv,
  // environment variables and diagnostics. Identifier/token alphabets are deliberately
  // constrained so none of the interpolated data can alter the security command grammar.
  await security(['-i'], `add-generic-password -a ${account} -s ${service} -w ${token}\n`);
  // Verify that the exact item was stored; interactive security may otherwise hide a
  // command-level refusal behind its session exit status.
  if (await readKeychain(service, account) !== token)
    throw new ClientError('keychain_refused', 'macOS Keychain did not persist the exact credential.');
}

export async function readKeychain(service: string, account: string): Promise<string> {
  validateIdentifier(service, 'service');
  validateIdentifier(account, 'account');
  const value = (await security(['find-generic-password', '-a', account, '-s', service, '-w'])).trim();
  validateCredential(value);
  return value;
}
