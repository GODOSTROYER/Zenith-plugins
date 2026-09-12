import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const localCompiler = path.join(root, 'node_modules/typescript/bin/tsc');
// npm ci installs the pinned compiler. A global compiler is not used by this script.
execFileSync(process.execPath, [localCompiler, '-p', path.join(root, 'tsconfig.json')], { stdio: 'inherit' });
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const json = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(data, null, 2)}\n`); };
for (const client of ['codex', 'claude-code']) {
  const target = path.join(root, 'plugins', client);
  await rm(target, { recursive: true, force: true });
  await mkdir(path.join(target, 'runtime'), { recursive: true });
  await cp(path.join(root, 'packages/client/dist'), path.join(target, 'runtime/client/dist'), { recursive: true });
  await cp(path.join(root, 'packages/bridge'), path.join(target, 'runtime/bridge'), { recursive: true });
  await cp(path.join(root, 'shared/skills'), path.join(target, 'skills'), { recursive: true });
  await json(path.join(target, 'package.json'), { name: 'zenith', version, private: true, type: 'module', engines: { node: '>=22.16.0' } });
  const manifest = { name: 'zenith', version, description: 'Read-only Zenith inspection and non-executable deployment previews. Development build.', author: { name: 'GODOSTROYER' }, skills: './skills/', mcpServers: './.mcp.json' };
  await json(path.join(target, client === 'codex' ? '.codex-plugin/plugin.json' : '.claude-plugin/plugin.json'), manifest);
  // Use the unwrapped map on Codex to avoid incompatible wrapper spellings.
  const variable = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
  const server = { zenith: { command: 'node', args: [`${variable}/runtime/bridge/cli.mjs`, 'stdio'] } };
  await json(path.join(target, '.mcp.json'), client === 'codex' ? server : { mcpServers: server });
  await writeFile(path.join(target, 'README.md'), '# Zenith — development package\n\nRead-only inspection and previews; no execution, upload, or OAuth. Native client compatibility is pending. See the repository docs/installation.md and docs/verification.md before use. No runtime installation or hooks are required.\n');
}
await json(path.join(root, '.agents/plugins/marketplace.json'), { name: 'zenith', interface: { displayName: 'Zenith integrations — development' }, plugins: [{ name: 'zenith', source: { source: 'local', path: './plugins/codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
await json(path.join(root, '.claude-plugin/marketplace.json'), { name: 'zenith', owner: { name: 'GODOSTROYER' }, plugins: [{ name: 'zenith', source: './plugins/claude-code', description: manifestDescription(), version }] });
function manifestDescription() { return 'Read-only Zenith inspection; development build, not a deployment integration.'; }
console.log('Built client and generated both self-contained development packages.');
