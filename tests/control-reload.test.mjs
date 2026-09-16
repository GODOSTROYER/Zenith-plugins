import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tsImport} from 'tsx/esm/api';
import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport} from '@modelcontextprotocol/server';
import {startControlFixture} from './control-fixture.mjs';
const {writeProfile,profileCommand}=await tsImport('../packages/control/profiles.ts',import.meta.url);
const {ClientResolver,profileSignature}=await tsImport('../packages/control/reload.ts',import.meta.url);
const {serveControl}=await tsImport('../packages/control/server.ts',import.meta.url);

const TA=`za_${'a'.repeat(43)}`,TB=`za_${'b'.repeat(43)}`;
const waitFor=async(check,label,ms=60000)=>{const end=Date.now()+ms;while(!check()){if(Date.now()>end)assert.fail(`timed out waiting for ${label}`);await new Promise(r=>setTimeout(r,20));}};
const text=result=>result.content.map(c=>c.text).join('\n');

test('switching the active profile retargets the next call and re-lists tools without a restart',{timeout:180000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-reload-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const fixture=await startControlFixture({[TA]:'ws_a',[TB]:'ws_b'},{
    ws_a:['zenith_get_context','zenith_list_workspaces'],
    ws_b:['zenith_get_context','zenith_get_handoff'],
  });t.after(fixture.close);
  const file=path.join(dir,'cfg','profiles.json');
  const entry=(workspace,variable)=>({origin:fixture.origin,allowLoopbackHttp:true,scope:{version:1,workspaceId:workspace},credential:{kind:'environment',variable}});
  await writeProfile(file,'alpha',entry('ws_a','ZENITH_FIXTURE_A'));
  await writeProfile(file,'beta',entry('ws_b','ZENITH_FIXTURE_B'));
  await writeProfile(file,'broken',entry('ws_b','ZENITH_FIXTURE_MISSING'));
  const env={ZENITH_PROFILES_FILE:file,ZENITH_FIXTURE_A:TA,ZENITH_FIXTURE_B:TB};

  const [serverSide,clientSide]=InMemoryTransport.createLinkedPair();
  const served=await serveControl(new ClientResolver(env),undefined,{pollMs:0,transport:serverSide});
  t.after(served.close);
  const changes=[];
  const client=new Client({name:'zenith-reload-test',version:'1'},{listChanged:{tools:{debounceMs:0,onChanged:(error,tools)=>changes.push(error?`error:${error.message}`:tools.map(tool=>tool.name).sort())}}});
  await client.connect(clientSide);t.after(()=>client.close());

  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),['zenith_get_context','zenith_list_workspaces']);
  let result=await client.callTool({name:'zenith_get_context',arguments:{}});
  assert.equal(result.structuredContent.data.selected.workspaceId,'ws_a');

  // A signature change is what the server watches for.
  const before=await profileSignature(env);
  const used=await profileCommand(['use','beta'],env);
  assert.equal(used.restartRequired,false);
  assert.notEqual(await profileSignature(env),before);

  // The very next call runs against the newly active profile, in the same process.
  result=await client.callTool({name:'zenith_get_context',arguments:{}});
  assert.equal(result.isError,undefined,text(result));
  assert.equal(result.structuredContent.data.selected.workspaceId,'ws_b');
  assert.deepEqual(fixture.calls.map(call=>call.workspace),['ws_a','ws_b']);
  await waitFor(()=>changes.some(names=>Array.isArray(names)&&names.includes('zenith_get_handoff')),'tools/list_changed after the switch');
  assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name).sort(),['zenith_get_context','zenith_get_handoff']);

  // The background check alone also notices a switch and announces it before any call.
  const seen=changes.length;
  await profileCommand(['use','alpha'],env);
  await served.refresh();
  await waitFor(()=>changes.length>seen&&Array.isArray(changes.at(-1))&&changes.at(-1).includes('zenith_list_workspaces'),'tools/list_changed from the poll');
  result=await client.callTool({name:'zenith_get_context',arguments:{}});
  assert.equal(result.structuredContent.data.selected.workspaceId,'ws_a');

  // A profile that cannot be used fails closed: nothing reaches any workspace.
  await profileCommand(['use','broken'],env);
  const sent=fixture.calls.length;
  result=await client.callTool({name:'zenith_get_context',arguments:{}});
  assert.equal(result.isError,true);
  assert.match(text(result),/nothing was sent/);
  assert.equal(fixture.calls.length,sent);
  // And recovers as soon as the file points somewhere usable again.
  await profileCommand(['use','beta'],env);
  result=await client.callTool({name:'zenith_get_context',arguments:{}});
  assert.equal(result.structuredContent.data.selected.workspaceId,'ws_b');
});

test('the resolver shares one resolution, caches by signature and never retries a failed signature from the poll',async()=>{
  let signature='one',builds=0,fail=false;
  const resolver=new ClientResolver({},async()=>{builds++;await new Promise(r=>setTimeout(r,5));if(fail)throw Object.assign(new Error('boom'),{name:'ClientError',code:'profile_missing'});return {client:{},tools:[{name:`t${builds}`}]};},async()=>signature);
  const [a,b]=await Promise.all([resolver.resolve(),resolver.resolve()]);
  assert.equal(builds,1);assert.equal(a,b);assert.equal(a.changed,true);
  assert.equal((await resolver.resolve()).changed,false);
  assert.equal(await resolver.poll(),undefined);
  signature='two';fail=true;
  await assert.rejects(resolver.poll(),{code:'profile_missing'});
  assert.equal(resolver.current,undefined,'a failed switch forgets the previous client');
  assert.equal(await resolver.poll(),undefined,'the poll does not hammer a signature that already failed');
  assert.equal(builds,2);
  await assert.rejects(resolver.resolve(),{code:'profile_missing'});
  assert.equal(builds,3,'a tool call always retries');
  fail=false;
  const recovered=await resolver.resolve();
  assert.equal(recovered.changed,true);assert.deepEqual(recovered.resolved.tools,[{name:'t4'}]);
});
