import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inventory } from './package-files.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const localCompiler = path.join(root, 'node_modules/typescript/bin/tsc');
await rm(path.join(root, 'packages/client/dist'), { recursive: true, force: true });
execFileSync(process.execPath, [localCompiler, '-p', path.join(root, 'tsconfig.json')], { stdio: 'inherit' });
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const json = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(data, null, 2)}\n`); };
for (const client of ['codex', 'claude-code']) {
  const target = path.join(root, 'plugins', client), manifestDir = client === 'codex' ? '.codex-plugin' : '.claude-plugin';
  await rm(target, { recursive: true, force: true });
  await mkdir(path.join(target, 'runtime'), { recursive: true });
  await cp(path.join(root, 'packages/client/dist'), path.join(target, 'runtime/client/dist'), { recursive: true });
  await cp(path.join(root, 'packages/bridge'), path.join(target, 'runtime/bridge'), { recursive: true });
  await cp(path.join(root, 'shared/skills'), path.join(target, 'skills'), { recursive: true });
  await json(path.join(target, 'package.json'), { name: 'zenith', version, private: true, type: 'module', engines: { node: '>=22.16.0' },
    files: [manifestDir, '.mcp.json', 'runtime', 'skills', 'README.md', 'integrity.json'] });
  const manifest = { name: 'zenith', version, description: 'Read-only Zenith inspection and non-executable deployment previews. Development build.',
    author: { name: 'GODOSTROYER' }, skills: './skills/', mcpServers: './.mcp.json' };
  await json(path.join(target, manifestDir, 'plugin.json'), manifest);
  const variable = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
  const server = { zenith: { command: 'node', args: [`${variable}/runtime/bridge/cli.mjs`, 'stdio'] } };
  await json(path.join(target, '.mcp.json'), client === 'codex' ? server : { mcpServers: server });
  await writeFile(path.join(target, 'README.md'), `# Zenith — development package\n\nVersion ${version}. Node 22.16 or later; no runtime installation or hooks.\n\nThis package supports read-only inspection and non-executable previews against the opt-in Zenith reader. It cannot deploy, approve, upload, or authenticate with remote OAuth. Native-client compatibility remains unverified.\n\nFrom this installed package directory, run:\n\n\`\`\`bash\nnode runtime/bridge/cli.mjs --help\nnode runtime/bridge/cli.mjs doctor\n\`\`\`\n\nSet ZENITH_CONFIG_FILE to an explicitly created private user profile, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.\n\nThe setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.\n\nRevoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.\n`);
  await json(path.join(target, 'integrity.json'), { version: 1, algorithm: 'sha256', files: await inventory(target) });
}
await json(path.join(root, '.agents/plugins/marketplace.json'), { name: 'zenith', interface: { displayName: 'Zenith integrations — development' },
  plugins: [{ name: 'zenith', source: { source: 'local', path: './plugins/codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
await json(path.join(root, '.claude-plugin/marketplace.json'), { name: 'zenith', owner: { name: 'GODOSTROYER' }, plugins: [{ name: 'zenith', source: './plugins/claude-code',
  description: 'Read-only Zenith inspection; development build, not a deployment integration.', version }] });
console.log('Built client and both self-contained packages with deterministic file inventories.');
