import { readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { files, inventory } from './package-files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const rootPackage = await readJson(path.join(root, 'package.json'));
const { version } = rootPackage;
// The launcher must stay installable outside any plugin package: the trust root
// is the host MCP configuration pointing at this bin, not a file the package
// ships. Keep the bin name identical to the command every generated .mcp.json
// declares.
const LAUNCHER_COMMAND = 'zenith-plugin-launcher';
assert.deepEqual(Object.keys(rootPackage.bin ?? {}), [LAUNCHER_COMMAND], 'Exactly one launcher bin must be published.');
assert.equal(rootPackage.bin[LAUNCHER_COMMAND], 'packages/launcher/cli.mjs');
const launcherSource = await readFile(path.join(root, rootPackage.bin[LAUNCHER_COMMAND]), 'utf8');
assert.ok(launcherSource.startsWith('#!/usr/bin/env node\n'), 'The launcher bin needs an executable shebang.');
assert.ok((await stat(path.join(root, 'packages/provenance/index.mjs'))).isFile(), 'The launcher bin must ship beside its verifier.');
assert.match(rootPackage.scripts.verify, /provenance:selftest/, 'The verify lane must run the provenance selftest.');
assert.match(rootPackage.scripts['release:sign'], /release\.mjs --sign/, 'Release signing must stay an explicit gated script.');
const isInside = (base, target) => { const relative = path.relative(base, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
for (const client of ['codex', 'claude-code']) {
  const base = path.join(root, 'plugins', client);
  const pkg = await readJson(path.join(base, 'package.json'));
  const manifest = await readJson(path.join(base, client === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json'));
  assert.equal(manifest.version, version); assert.equal(pkg.version, version); assert.equal(manifest.name, 'zenith');
  assert.equal(manifest.skills, './skills/'); assert.equal(manifest.mcpServers, './.mcp.json');
  const config = await readJson(path.join(base, '.mcp.json'));
  const server = (client === 'codex' ? config : config.mcpServers).zenith;
  assert.deepEqual(Object.keys(server).sort(), ['args', 'command']); assert.equal(server.command, LAUNCHER_COMMAND);
  const packageVariable = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
  assert.deepEqual(server.args, ['--package-dir', packageVariable, '--entry', 'runtime/bridge/cli.mjs', 'stdio']);
  const entry = path.join(base, server.args[3]);
  assert.ok(isInside(base, entry)); assert.ok((await stat(entry)).isFile());
  for (const [source, destination] of [['packages/client/dist', 'runtime/client/dist'], ['packages/bridge', 'runtime/bridge'], ['packages/provenance', 'runtime/provenance'], ['packages/launcher', 'installer/launcher'], ['packages/provenance', 'installer/provenance'], ['shared/skills', 'skills'], ['packages/control/dist','runtime/control']]) {
    assert.deepEqual(await inventory(path.join(base, destination)), await inventory(path.join(root, source)), `Stale ${client} ${destination}`);
  }
  if(client==='claude-code') assert.deepEqual(await inventory(path.join(base,'agents')),await inventory(path.join(root,'shared/claude-agents')));
  const hashes = await readJson(path.join(base, 'integrity.json'));
  assert.equal(hashes.version, 1); assert.equal(hashes.algorithm, 'sha256');
  assert.deepEqual(hashes.files, await inventory(base), `Invalid ${client} package inventory`);
}
const codexMarket = await readJson(path.join(root, '.agents/plugins/marketplace.json'));
const claudeMarket = await readJson(path.join(root, '.claude-plugin/marketplace.json'));
assert.equal(codexMarket.plugins[0].source.path, './plugins/codex');
assert.equal(claudeMarket.plugins[0].source, './plugins/claude-code');
assert.equal(claudeMarket.plugins[0].version, version);
const doctor = await readFile(path.join(root, 'packages/bridge/doctor.mjs'), 'utf8');
assert.ok(doctor.includes(`VERSION = '${version}'`), 'Doctor and package versions must agree.');
for (const file of await files(root, new Set(['node_modules', '.git', 'artifacts']))) {
  if (file.endsWith('.mjs') && !file.includes(`${path.sep}plugins${path.sep}`)) execFileSync(process.execPath, ['--check', file]);
  if (!file.endsWith('.md')) continue;
  const text = await readFile(file, 'utf8');
  for (const [, target] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const location = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
    assert.ok(isInside(root, location), `Documentation link escapes repository: ${target}`);
    assert.ok((await stat(location)).isFile(), `Missing documentation link: ${target}`);
  }
}
console.log('Syntax, manifest layouts, all runtime/skill copies, integrity inventories, marketplace versions and local links passed. Native clients were not invoked.');
