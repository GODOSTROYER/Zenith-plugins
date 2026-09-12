import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CONTROL_VERSION,CONTROL_TOOLS} from '../packages/client/dist/control.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const snapshot=JSON.parse(await readFile(path.join(root,'contracts/control-v2.json'),'utf8'));
assert.equal(snapshot.contractVersion,CONTROL_VERSION);
assert.deepEqual(snapshot.tools.map(t=>t.name).sort(),[...CONTROL_TOOLS].sort());
assert.equal(new Set(snapshot.tools.map(t=>t.name)).size,snapshot.tools.length);
for(const t of snapshot.tools){assert.equal(t.inputSchema.type,'object');assert.ok(snapshot.scopes.includes(t.scope));assert.equal(typeof t.mutates,'boolean');}
if(process.argv[2]){
  assert.equal(process.argv[2],'--backend');assert.ok(path.isAbsolute(process.argv[3]??''),'Provide an explicit absolute backend checkout path.');
  const url=pathToFileURL(path.join(process.argv[3],'src/lib/agent-access/control/contracts.ts')).href;
  const code=`const ns=await import(${JSON.stringify(url)});const m=ns.default??ns;console.log(JSON.stringify({contractVersion:m.CONTROL_VERSION,scopes:m.SCOPE_NAMES,edits:m.EDIT_ACTIONS,tools:m.controlTools}));`;
  const current=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,encoding:'utf8',maxBuffer:262144}));
  assert.deepEqual(current,snapshot,'Backend contract drift: review and regenerate the snapshot and shared client together.');
}
console.log('Versioned control tool/schema inventory matches the shared client'+(process.argv[2]?' and the supplied backend.':'. Backend parity requires --backend ABSOLUTE_PATH.'));
