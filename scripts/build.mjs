import { build } from 'esbuild';
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
await rm(path.join(root,'packages/control/dist'),{recursive:true,force:true});
const bundle = await build({entryPoints:[path.join(root,'packages/control/cli.ts')],outfile:path.join(root,'packages/control/dist/cli.mjs'),bundle:true,platform:'node',target:'node22.16',format:'esm',minify:true,legalComments:'none',metafile:true,banner:{js:"import {createRequire as zenithCreateRequire} from 'node:module';const require=zenithCreateRequire(import.meta.url);"}});
const dependencyRoots=new Set();
for(const input of Object.keys(bundle.metafile.inputs)){let dir=path.dirname(path.resolve(input));while(dir!==path.dirname(dir)){try{const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));if(dir.includes('node_modules')&&pkg.name){dependencyRoots.add(dir);break;}}catch{}dir=path.dirname(dir);}}
const notices=[], components=[];
for(const dir of [...dependencyRoots].sort()){const pkg=JSON.parse(await readFile(path.join(dir,'package.json'),'utf8'));let license='';for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md']){try{license=await readFile(path.join(dir,file),'utf8');break;}catch{}}if(!license)license=JSON.stringify(pkg.license??'See upstream package');notices.push(`${pkg.name}@${pkg.version}\n${license}`);components.push({name:pkg.name,version:pkg.version,license:pkg.license??'NOASSERTION'});}
await writeFile(path.join(root,'packages/control/dist/THIRD_PARTY_NOTICES.txt'),notices.join('\n\n---\n\n')+'\n');
await writeFile(path.join(root,'packages/control/dist/components.json'),JSON.stringify({version:1,components:components.sort((a,b)=>`${a.name}@${a.version}`<`${b.name}@${b.version}`?-1:1)},null,2)+'\n');
const json = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(data, null, 2)}\n`); };
for (const client of ['codex', 'claude-code']) {
  const target = path.join(root, 'plugins', client), manifestDir = client === 'codex' ? '.codex-plugin' : '.claude-plugin';
  await rm(target, { recursive: true, force: true });
  await mkdir(path.join(target, 'runtime'), { recursive: true });
  await cp(path.join(root, 'packages/client/dist'), path.join(target, 'runtime/client/dist'), { recursive: true });
  await cp(path.join(root, 'packages/bridge'), path.join(target, 'runtime/bridge'), { recursive: true });
  await cp(path.join(root, 'packages/provenance'), path.join(target, 'runtime/provenance'), { recursive: true });
  await cp(path.join(root,'packages/control/dist'),path.join(target,'runtime/control'),{recursive:true});
  await cp(path.join(root, 'shared/skills'), path.join(target, 'skills'), { recursive: true });
  if(client==='claude-code') await cp(path.join(root,'shared/claude-agents'),path.join(target,'agents'),{recursive:true});
  await json(path.join(target, 'package.json'), { name: 'zenith', version, private: true, type: 'module', engines: { node: '>=22.16.0' },
    files: [manifestDir, '.mcp.json', 'runtime', 'skills', ...(client==='claude-code'?['agents']:[]), 'README.md', 'integrity.json'] });
  const manifest = { name: 'zenith', version, description: 'Zenith inspection, exact browser-reviewed changes, deployment and supported source publishing. Writes require explicit v2 enablement.',
    author: { name: 'GODOSTROYER' }, skills: './skills/', mcpServers: './.mcp.json' };
  await json(path.join(target, manifestDir, 'plugin.json'), manifest);
  const variable = client === 'codex' ? '${PLUGIN_ROOT}' : '${CLAUDE_PLUGIN_ROOT}';
  const server = { zenith: { command: 'zenith-plugin-launcher', args: ['--package-dir', variable, '--entry', 'runtime/bridge/cli.mjs', 'stdio'] } };
  await json(path.join(target, '.mcp.json'), client === 'codex' ? server : { mcpServers: server });
  await writeFile(path.join(target, 'README.md'), `# Zenith — development package\n\nVersion ${version}. Node 22.16 or later; no runtime installation or hooks.\n\nVersion 1 remains the read-only default. Set ZENITH_API_VERSION=2 with the companion Zenith control backend to inspect, prepare exact changes, execute browser-approved operations and package/upload supported frontend source. Writes require explicit client and server enablement. The client cannot approve its own operations. Native-client compatibility remains unverified.\n\nFrom this installed package directory, run:\n\n\`\`\`bash\nnode runtime/bridge/cli.mjs --help\nnode runtime/bridge/cli.mjs doctor\n\`\`\`\n\nFor v1 use ZENITH_CONFIG_FILE. For v2 use explicit ZENITH_PROFILES_FILE and named profiles, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.\n\nThe setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.\n\nProduction installers/launchers must provide absolute ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST paths from the trusted installer. Packaged activation always verifies the signed Ed25519 publisher envelope and exact package bytes before opening the MCP/control surface; missing or invalid inputs fail closed. ZENITH_REQUIRE_PROVENANCE=0 cannot disable this packaged gate.\n\nRevoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.\n`);
  await json(path.join(target, 'integrity.json'), { version: 1, algorithm: 'sha256', files: await inventory(target) });
}
await json(path.join(root, '.agents/plugins/marketplace.json'), { name: 'zenith', interface: { displayName: 'Zenith integrations — development' },
  plugins: [{ name: 'zenith', source: { source: 'local', path: './plugins/codex' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
await json(path.join(root, '.claude-plugin/marketplace.json'), { name: 'zenith', owner: { name: 'GODOSTROYER' }, plugins: [{ name: 'zenith', source: './plugins/claude-code',
  description: 'Zenith inspection and opt-in browser-reviewed operations; development build.', version }] });
console.log('Built client and both self-contained packages with deterministic file inventories.');
