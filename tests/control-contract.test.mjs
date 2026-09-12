import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CONTROL_VERSION,CONTROL_TOOLS} from '../packages/client/dist/control.js';
test('control names and mutation metadata match the authoritative schema snapshot',async()=>{
 const doc=JSON.parse(await readFile(new URL('../contracts/control-v2.json',import.meta.url),'utf8'));
 assert.equal(doc.contractVersion,CONTROL_VERSION);assert.deepEqual(doc.tools.map(t=>t.name).sort(),[...CONTROL_TOOLS].sort());
 assert.deepEqual(doc.tools.filter(t=>t.mutates).map(t=>t.name),['zenith_prepare_change','zenith_execute_operation']);
 assert.ok(doc.tools.find(t=>t.name==='zenith_prepare_change').inputSchema.properties.kind.enum.includes('deployment.promote'));
});
