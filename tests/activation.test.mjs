/**
 * Phase-1 activation: the generated packages are unsigned previews.
 *
 * A marketplace install has to activate with nothing for the user to configure,
 * and it has to say, everywhere a person or a server can read it, that these
 * bytes carry no publisher signature. These tests pin both halves: the declared
 * mode and descriptor the packages ship, the gate that accepts the declaration
 * and the three ways it must still fail closed, and the user-facing lines in
 * login, status and doctor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { tsImport } from 'tsx/esm/api';
import { ControlClient } from '../packages/client/dist/control.js';
import { CLIENTS, PROVENANCE_MODE_FILE, SIGNED_RELEASE, UNSIGNED_PREVIEW, mcpDescriptor, provenanceModeDocument } from '../scripts/package-mode.mjs';
import { readPreviewMarker } from '../packages/provenance/consumer.mjs';

const { loginCommand } = await tsImport('../packages/control/login.ts', import.meta.url);
const { statusCommand } = await tsImport('../packages/control/status.ts', import.meta.url);
const { doctorReport } = await tsImport('../packages/control/cli.ts', import.meta.url);
const { PREVIEW_NOTICE, withVerification } = await tsImport('../packages/control/activation.ts', import.meta.url);

const execFileAsync = promisify(execFile);
const { version } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));

/** Run a packaged command with every Zenith variable removed and no home configuration. */
async function packaged(dir, args, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('ZENITH_')) delete env[key];
  const empty = await mkdtemp(path.join(tmpdir(), 'zenith empty config '));
  // APPDATA is the Windows home of the default profiles file; never read the real one.
  Object.assign(env, { XDG_CONFIG_HOME: empty, APPDATA: empty }, extra);
  try { return await execFileAsync(process.execPath, [path.join(dir, 'runtime/bridge/cli.mjs'), ...args], { env, timeout: 20_000 }); }
  finally { await rm(empty, { recursive: true, force: true }); }
}

async function previewPackage(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zenith preview package '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(path.resolve('plugins/codex'), dir, { recursive: true });
  return dir;
}

test('both generated packages declare the unsigned-preview mode and run the bridge directly', async () => {
  for (const client of CLIENTS) {
    const base = path.resolve('plugins', client);
    const marker = JSON.parse(await readFile(path.join(base, PROVENANCE_MODE_FILE), 'utf8'));
    assert.deepEqual(marker, provenanceModeDocument(client, version, UNSIGNED_PREVIEW));
    assert.equal(marker.mode, UNSIGNED_PREVIEW);
    assert.match(marker.verification, /does not authenticate a publisher/);

    const descriptor = JSON.parse(await readFile(path.join(base, '.mcp.json'), 'utf8'));
    assert.deepEqual(descriptor, mcpDescriptor(client, UNSIGNED_PREVIEW));
    const server = (client === 'codex' ? descriptor : descriptor.mcpServers).zenith;
    const root = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
    assert.equal(server.command, 'node');
    assert.deepEqual(server.args, [`${root}/runtime/bridge/cli.mjs`, 'stdio']);
    assert.deepEqual(server.env, { ZENITH_API_VERSION: '2' });
    // No credential, profile path or user name may appear in a committed descriptor.
    assert.doesNotMatch(JSON.stringify(descriptor), /token|credential|profiles/i);
    // The package README must carry the same warning the commands print.
    assert.match(await readFile(path.join(base, 'README.md'), 'utf8'), /not publisher-verified/);
  }
});

test('the marker is only believed in the exact shape the build writes', async t => {
  const dir = await previewPackage(t);
  assert.equal((await readPreviewMarker(dir)).mode, UNSIGNED_PREVIEW);
  const marker = path.join(dir, PROVENANCE_MODE_FILE);
  for (const bad of [
    'not json at all',
    JSON.stringify({ version: 2, mode: UNSIGNED_PREVIEW, packageVersion: version, generatedFrom: 'x' }),
    JSON.stringify({ version: 1, mode: SIGNED_RELEASE, packageVersion: version, generatedFrom: 'x' }),
    JSON.stringify({ version: 1, mode: UNSIGNED_PREVIEW, generatedFrom: 'x' }),
    JSON.stringify([{ version: 1, mode: UNSIGNED_PREVIEW }]),
  ]) {
    await writeFile(marker, bad);
    assert.equal(await readPreviewMarker(dir), undefined, `must not accept: ${bad.slice(0, 40)}`);
  }
  await rm(marker, { force: true });
  assert.equal(await readPreviewMarker(dir), undefined);
});

test('an unsigned-preview package activates a gated command and reports that it is not verified', { timeout: 30_000 }, async t => {
  const dir = await previewPackage(t);
  const report = await packaged(dir, ['status', '--json']);
  const parsed = JSON.parse(report.stdout);
  assert.equal(parsed.activation, UNSIGNED_PREVIEW);
  assert.match(parsed.verification, /unsigned preview build/);
  assert.match(parsed.verification, /not publisher-verified/);
  assert.equal(parsed.linked, false);

  const human = await packaged(dir, ['status']);
  assert.match(human.stdout, /unsigned preview build/);
  assert.match(human.stdout, /not publisher-verified/);
});

test('a package with neither a marker nor provenance inputs still fails closed', { timeout: 30_000 }, async t => {
  const dir = await previewPackage(t);
  await rm(path.join(dir, PROVENANCE_MODE_FILE), { force: true });
  for (const command of [['status'], ['login', '--no-browser'], ['doctor'], ['stdio']]) {
    await assert.rejects(packaged(dir, command), error =>
      error.code === 1 && /"code":"provenance_required"/.test(error.stderr) && /ZENITH_PROVENANCE_MANIFEST/.test(error.stderr),
      `${command[0]} must fail closed without a marker`);
  }
});

test('an operator asking for provenance is never answered by the package claiming it needs none', { timeout: 30_000 }, async t => {
  const dir = await previewPackage(t);
  const missing = path.join(dir, 'no-such-manifest.json');
  for (const extra of [
    { ZENITH_REQUIRE_PROVENANCE: '1' },
    { ZENITH_PROVENANCE_MANIFEST: missing },
    { ZENITH_PROVENANCE_TRUST: missing },
  ]) {
    await assert.rejects(packaged(dir, ['status'], extra), error =>
      error.code === 1 && /"code":"provenance_required"/.test(error.stderr),
      `${Object.keys(extra)[0]} must make the preview marker irrelevant`);
  }
});

test('login leads with the preview line and carries it into the client identity the browser shows', async () => {
  const ORIGIN = 'https://zenith.test';
  const DEVICE = `zl_${'A'.repeat(43)}`;
  const TOKEN = `za_${'L'.repeat(43)}`;
  const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  const requests = [];
  const out = [], err = [];
  const options = {
    env: { CLAUDE_PLUGIN_ROOT: '/installed/zenith' }, sleep: async () => {},
    signal: new AbortController().signal, activation: UNSIGNED_PREVIEW,
    out: line => out.push(line), err: line => err.push(line), open: () => true,
    fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return String(url).endsWith('/api/agent/link/start')
        ? json({ deviceCode: DEVICE, userCode: 'K7QM-3XRB', verificationUri: `${ORIGIN}/agent/link`, verificationUriComplete: `${ORIGIN}/agent/link?code=K7QM-3XRB`, interval: 5, expiresIn: 600, protocolVersion: 1 })
        : json({ status: 'issued', token: TOKEN, credentialId: 'cred_1', origin: ORIGIN, workspaceId: 'ws_1', projectIds: ['prj_a'], environmentIds: null, scopes: ['read', 'plan'], expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    },
  };
  // Each platform keeps its own credential destination; the vault directory is
  // created by the vault writer so it gets the private ACL it checks for.
  const home = await mkdtemp(path.join(tmpdir(), 'zenith preview home '));
  const windows = process.platform === 'win32';
  options.platform = process.platform;
  const destination = windows
    ? ['--vault', path.join(home, 'private', 'preview.dpapi'), '--print-env']
    : ['--profiles', path.join(home, 'profiles.json'), '--name', 'preview'];
  await loginCommand(['--url', ORIGIN, '--no-browser', '--json', ...destination], options);

  // Human-readable progress goes to stderr under --json; the notice is still first.
  assert.match(err[0], /unsigned preview build/);
  assert.match(err[0], /not publisher-verified/);
  assert.ok(err.indexOf('Zenith link\n') > 0, 'the notice must precede the link instructions');
  const report = JSON.parse(out.join('\n'));
  assert.equal(report.activation, UNSIGNED_PREVIEW);
  assert.match(report.verification, /not publisher-verified/);
  assert.equal(JSON.stringify(report).includes(TOKEN), false);
  assert.equal(JSON.stringify(report).includes(DEVICE), false);

  // The link protocol has no verification field, so the state travels in the
  // client name the approval page shows, in the shape that protocol accepts.
  const start = requests.find(entry => entry.url.endsWith('/api/agent/link/start'));
  assert.equal(start.body.clientName, 'Claude Code - unsigned preview');
  assert.match(start.body.clientName, /^[A-Za-z0-9 ._-]{1,60}$/);
  assert.equal(withVerification('Codex', 'verified'), 'Codex');
  assert.equal(withVerification('Codex', undefined), 'Codex');
  assert.ok(PREVIEW_NOTICE.startsWith('unsigned preview build'));
});

/**
 * A plugin's MCP server is started by the host from a committed descriptor, so
 * it cannot be handed a per-user absolute profiles path. Without the default
 * lookup the browser link succeeded and the next server start could not find
 * the credential it had just written.
 */
test('a linked profile in the user configuration directory is found without an explicit variable', {
  skip: process.platform === 'win32' ? 'POSIX modes on a mkdtemp directory; the Windows default-file lookup is covered in control-profiles.test.mjs.' : false,
}, async t => {
  const { profileCommand } = await tsImport('../packages/control/profiles.ts', import.meta.url);
  const { resolveProfilesFile, controlClient } = await tsImport('../packages/control/profiles.ts', import.meta.url);
  const home = await mkdtemp(path.join(tmpdir(), 'zenith xdg '));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = path.join(home, 'zenith', 'profiles.json');

  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home }), undefined, 'nothing is assumed before a link exists');
  await profileCommand(['add', '--file', file, '--name', 'tryzenith', '--url', 'https://zenith.test', '--workspace', 'ws_1', '--token-env', 'ZENITH_FIXTURE']);
  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home }), file);

  const client = await controlClient({ XDG_CONFIG_HOME: home, ZENITH_FIXTURE: `za_${'X'.repeat(43)}` });
  assert.equal(client.origin, 'https://zenith.test');

  // Explicit connection settings always win; the default is never preferred over them.
  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home, ZENITH_URL: 'https://other.test' }), undefined);
  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home, ZENITH_CONFIG_FILE: '/v1/profile.json' }), undefined);
  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home, ZENITH_PROFILES_FILE: '/explicit/profiles.json' }), '/explicit/profiles.json');
  assert.equal(await resolveProfilesFile({ XDG_CONFIG_HOME: home }, 'win32'), undefined);
});

test('status and doctor both report the activation the gate found', async () => {
  const ORIGIN = 'https://zenith.test';
  const scope = { version: 1, workspaceId: 'ws_1', projectId: 'prj_a' };
  const tools = { contractVersion: 2, mode: 'reviewed-operations', tools: [
    { name: 'zenith_get_context', description: 'context', inputSchema: { type: 'object' } },
    { name: 'zenith_get_capabilities', description: 'capabilities', inputSchema: { type: 'object' } },
  ] };
  const payload = data => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: { contractVersion: 2, mode: 'reviewed-operations', data } }), { headers: { 'content-type': 'application/json' } });
  const client = new ControlClient({ origin: ORIGIN, association: scope, allowWrites: true, token: async () => `za_${'S'.repeat(43)}`,
    fetch: async (url, init) => {
      if (init.method === 'GET') return new Response(JSON.stringify(tools), { headers: { 'content-type': 'application/json' } });
      return payload(JSON.parse(init.body).name === 'zenith_get_context'
        ? { selected: { workspaceId: 'ws_1', projectId: 'prj_a' }, integrationId: 'cred_1', scopes: ['read', 'plan'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
        : { journal: 'postgres' });
    } });

  const lines = [];
  await statusCommand([], { env: { ZENITH_URL: ORIGIN, ZENITH_TOKEN_FILE: '/private/client.token' }, client, out: line => lines.push(line), activation: UNSIGNED_PREVIEW });
  assert.match(lines[0], /^Build {2,}unsigned preview build/);

  const json = [];
  await statusCommand(['--json'], { env: { ZENITH_URL: ORIGIN, ZENITH_TOKEN_FILE: '/private/client.token' }, client, out: line => json.push(line), activation: UNSIGNED_PREVIEW });
  assert.equal(JSON.parse(json.join('\n')).activation, UNSIGNED_PREVIEW);

  const preview = await doctorReport(client, UNSIGNED_PREVIEW);
  assert.equal(preview.activation, UNSIGNED_PREVIEW);
  assert.match(String(preview.verification), /not publisher-verified/);
  assert.match(String(preview.evidence), /unsigned preview build/);

  const verified = await doctorReport(client, 'verified');
  assert.equal(verified.activation, 'verified');
  assert.equal(verified.verification, undefined);
  assert.doesNotMatch(String(verified.evidence), /unsigned preview/);
});
