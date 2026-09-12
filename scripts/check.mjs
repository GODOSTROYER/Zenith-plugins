import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir) { const out=[]; for (const e of await readdir(dir, { withFileTypes: true })) { if (['node_modules','.git'].includes(e.name)) continue; const p=path.join(dir,e.name); if(e.isSymbolicLink()) throw Error(`Symlink is not permitted: ${p}`); if(e.isDirectory()) out.push(...await files(p)); else out.push(p); } return out; }
for (const client of ['codex','claude-code']) {
 const base=path.join(root,'plugins',client);
 const pkg=JSON.parse(await readFile(path.join(base,'package.json'),'utf8'));
 const manifest=JSON.parse(await readFile(path.join(base,client==='codex'?'.codex-plugin/plugin.json':'.claude-plugin/plugin.json'),'utf8'));
 assert.equal(manifest.version,pkg.version); assert.equal(manifest.name,'zenith');
 const config=JSON.parse(await readFile(path.join(base,'.mcp.json'),'utf8'));
 const server=(config.mcpServers??config).zenith;
 assert.equal(server.command,'node'); assert.equal(server.args[1],'stdio');
 const entry=server.args[0].replace('${PLUGIN_ROOT}',base).replace('${CLAUDE_PLUGIN_ROOT}',base);
 assert.ok(entry.startsWith(base+path.sep)); assert.ok((await stat(entry)).isFile());
 assert.equal(await readFile(path.join(base,'runtime/bridge/cli.mjs'),'utf8'),await readFile(path.join(root,'packages/bridge/cli.mjs'),'utf8'));
 assert.equal(await readFile(path.join(base,'runtime/client/dist/index.js'),'utf8'),await readFile(path.join(root,'packages/client/dist/index.js'),'utf8'));
}
for (const file of await files(root)) {
 if (!file.endsWith('.md')) continue;
 const text=await readFile(file,'utf8');
 for(const [,target] of text.matchAll(/\]\(([^\s)]+)\)/g)) {
  if(/^(https?:|mailto:|#)/.test(target)) continue;
  const location=path.resolve(path.dirname(file),decodeURIComponent(target.split('#')[0]));
  assert.ok(location.startsWith(root),`Documentation link escapes repository: ${target}`);
  assert.ok((await stat(location)).isFile(),`Missing documentation link: ${target}`);
 }
}
console.log('Package layout, generated-runtime equality, and local Markdown links passed. This is not native-client validation.');
