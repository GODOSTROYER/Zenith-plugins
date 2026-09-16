import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CONTROL_VERSION,CONTROL_TOOLS} from '../packages/client/dist/control.js';
// Usage:
//   node scripts/contracts.mjs                                  snapshot matches the shared client
//   node scripts/contracts.mjs --backend ABS                    ... and the backend checkout at ABS
//   node scripts/contracts.mjs --write --backend ABS            regenerate the snapshot from ABS, then check both
const root=fileURLToPath(new URL('../',import.meta.url));
const snapshotFile=path.join(root,'contracts/control-v2.json');
const args=process.argv.slice(2);let backend,write=false;
for(let i=0;i<args.length;i++){
  if(args[i]==='--write'&&!write){write=true;continue;}
  if(args[i]==='--backend'&&backend===undefined){backend=args[++i];continue;}
  throw new Error(`Unknown or repeated argument: ${args[i]}. Use [--write] --backend ABSOLUTE_PATH.`);
}
if(backend!==undefined)assert.ok(path.isAbsolute(backend),'Provide an explicit absolute backend checkout path.');
assert.ok(!write||backend!==undefined,'--write regenerates the snapshot from a backend: pass --backend ABSOLUTE_PATH.');
function inventory(doc,label){
  assert.equal(doc.contractVersion,CONTROL_VERSION,`${label}: contract version differs from the shared client.`);
  assert.deepEqual(doc.tools.map(t=>t.name).sort(),[...CONTROL_TOOLS].sort(),`${label}: tool names differ from CONTROL_TOOLS in packages/client/control.ts; update both together.`);
  assert.equal(new Set(doc.tools.map(t=>t.name)).size,doc.tools.length,`${label}: duplicate tool names.`);
  for(const t of doc.tools){assert.equal(t.inputSchema.type,'object');assert.ok(doc.scopes.includes(t.scope));assert.equal(typeof t.mutates,'boolean');}
}
let current;
if(backend!==undefined){
  const url=pathToFileURL(path.join(backend,'src/lib/agent-access/control/contracts.ts')).href;
  const code=`const ns=await import(${JSON.stringify(url)});const m=ns.default??ns;console.log(JSON.stringify({contractVersion:m.CONTROL_VERSION,scopes:m.SCOPE_NAMES,edits:m.EDIT_ACTIONS,tools:m.controlTools}));`;
  current=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,encoding:'utf8',maxBuffer:1048576}));
}
if(write){
  // Refuse to write a snapshot the shared client could not serve.
  inventory(current,'Backend');
  await writeFile(snapshotFile,`${JSON.stringify(current,null,2)}\n`);
  console.log(`Wrote ${path.relative(root,snapshotFile)} from ${backend}. Review the diff, then run npm run verify.`);
}
const snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));
inventory(snapshot,'Snapshot');
if(current!==undefined)assert.deepEqual(current,snapshot,'Backend contract drift: review and regenerate the snapshot (--write) and shared client together.');
console.log('Versioned control tool/schema inventory matches the shared client'+(backend!==undefined?' and the supplied backend.':'. Backend parity requires --backend ABSOLUTE_PATH.'));
