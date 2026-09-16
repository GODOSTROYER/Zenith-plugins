import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inventory, scanForSecrets } from './package-files.mjs';
import { CLIENTS, PROVENANCE_MODE_FILE, SIGNED_RELEASE, UNSIGNED_PREVIEW, mcpDescriptor, provenanceModeDocument, readmeFragments } from './package-mode.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Default build = the committed unsigned-preview shape, so `npm run build` is
// reproducible and CI can diff plugins/**. `--signed` writes the production
// shape a publisher signs: the launcher descriptor and the signed-release
// marker. See scripts/package-mode.mjs.
const mode = process.argv.includes('--signed') ? SIGNED_RELEASE : UNSIGNED_PREVIEW;
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

for (const client of CLIENTS) {
  const target = path.join(root, 'plugins', client), manifestDir = client === 'codex' ? '.codex-plugin' : '.claude-plugin';
  await rm(target, { recursive: true, force: true });
  await mkdir(path.join(target, 'runtime'), { recursive: true });
  await cp(path.join(root, 'packages/client/dist'), path.join(target, 'runtime/client/dist'), { recursive: true });
  await cp(path.join(root, 'packages/bridge'), path.join(target, 'runtime/bridge'), { recursive: true });
  await cp(path.join(root, 'packages/provenance'), path.join(target, 'runtime/provenance'), { recursive: true });
  await cp(path.join(root,'packages/control/dist'),path.join(target,'runtime/control'),{recursive:true});
  await cp(path.join(root, 'shared/skills'), path.join(target, 'skills'), { recursive: true });
  if(client==='claude-code') await cp(path.join(root,'shared/claude-agents'),path.join(target,'agents'),{recursive:true});
  // The launcher is shipped as an installer input, not used from this
  // package-owned path at runtime. A trusted installer must copy it and its
  // provenance verifier to an absolute location outside the package before
  // registering the native client. Keeping both files in the signed package
  // makes that handoff reproducible without making the package its own trust
  // root.
  await cp(path.join(root, 'packages/launcher'), path.join(target, 'installer/launcher'), { recursive: true });
  await cp(path.join(root, 'packages/provenance'), path.join(target, 'installer/provenance'), { recursive: true });
  await json(path.join(target, 'package.json'), { name: 'zenith', version, private: true, type: 'module', engines: { node: '>=22.16.0' },
    files: [manifestDir, '.mcp.json', PROVENANCE_MODE_FILE, 'runtime', 'installer', 'skills', ...(client==='claude-code'?['agents']:[]), 'README.md', 'integrity.json'] });
  const manifest = { name: 'zenith', version, description: 'Link a Zenith account with zenith login, then inspect, architect and deploy through browser-reviewed changes. Phase 1 deployments are simulated by the sandbox provider.',
    author: { name: 'GODOSTROYER' }, skills: './skills/', mcpServers: './.mcp.json' };
  await json(path.join(target, manifestDir, 'plugin.json'), manifest);
  await json(path.join(target, '.mcp.json'), mcpDescriptor(client, mode));
  // The package states its own activation mode, and the runtime gate reads it
  // from here. A package with no readable marker still fails closed.
  await json(path.join(target, PROVENANCE_MODE_FILE), provenanceModeDocument(client, version, mode));
  const readme = readmeFragments(client, mode);
  await writeFile(path.join(target, 'README.md'), `# Zenith — ${mode === SIGNED_RELEASE ? 'signed release package' : 'unsigned preview package'}\n\nVersion ${version}. Node 22.16 or later; no runtime installation or hooks.\n\n${readme.banner}\n\nLink this package to a Zenith account with \`login\`. It prints a verification URL and a user code, waits while you sign in and approve a workspace (all of it, or chosen projects) and scopes in the browser, then stores the issued credential in this platform's credential store: a private 0600 file beside the named profile on POSIX, the macOS Keychain with --keychain, a CurrentUser DPAPI vault referenced from an ACL-checked %APPDATA%\\zenith\\profiles.json on Windows. It never prints the credential. The new profile becomes the active one, and a running stdio server follows it (and \`profile use NAME\`) on its next call without a restart. \`status\` reports what the approval granted. \`logout\` removes the local copy; it does not revoke authority, which you do at ORIGIN/integrations. Phase 1 deployments are simulated by the sandbox provider: LocalStack and AWS are not enabled.\n\nVersion 1 remains the read-only default. Set ZENITH_API_VERSION=2 with the companion Zenith control backend to inspect, prepare exact changes, execute browser-approved operations and package/upload supported frontend source. Writes require explicit client and server enablement. The client cannot approve its own operations. Native-client compatibility remains unverified.\n\n${readme.commands}\n\nFor v1 use ZENITH_CONFIG_FILE. For v2 use explicit ZENITH_PROFILES_FILE and named profiles, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.\n\nThe setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.\n\n${readme.gate}\n\nRevoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.\n`);
  // Refuse to stamp an inventory over a package that carries a credential, so a
  // bad file never reaches a commit.
  const hits = await scanForSecrets(target);
  if (hits.length) throw new Error(`Generated ${client} package carries credential-shaped content:\n  ${hits.join('\n  ')}`);
  await json(path.join(target, 'integrity.json'), { version: 1, algorithm: 'sha256', files: await inventory(target) });
}
// `authentication: 'ON_INSTALL'` is now true rather than aspirational: it is
// what should trigger `zenith login`.
const DESCRIPTION = 'Link a Zenith account, architect and deploy with browser-reviewed changes. Phase 1 deploys are simulated.';
await json(path.join(root, '.agents/plugins/marketplace.json'), { name: 'zenith', interface: { displayName: 'Zenith integrations — development' },
  plugins: [{ name: 'zenith', source: { source: 'local', path: './plugins/codex' }, description: DESCRIPTION,
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
await json(path.join(root, '.claude-plugin/marketplace.json'), { name: 'zenith', owner: { name: 'GODOSTROYER' },
  plugins: [{ name: 'zenith', source: './plugins/claude-code', description: DESCRIPTION, version }] });
console.log('Built client and both self-contained packages with deterministic file inventories.');
