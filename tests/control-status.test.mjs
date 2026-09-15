import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {ControlClient} from '../packages/client/dist/control.js';
const {status,statusCommand}=await tsImport('../packages/control/status.ts',import.meta.url);

const ORIGIN='https://zenith.test';
const TOKEN=`za_${'S'.repeat(43)}`;
const EXPIRES=new Date(Date.now()+6*86400000+3600000).toISOString();
const CONTEXT={selected:{workspaceId:'ws_1',projectId:'prj_a'},integrationId:'cred_1',label:'tarun-laptop',scopes:['read','plan','write','logs'],expiresAt:EXPIRES};
const CAPABILITIES={journal:'postgres',coordination:'database',writesEnabled:true,nested:{ignored:true},overlong:'y'.repeat(300),'bad key':'dropped'};
const TOOLS={contractVersion:2,mode:'reviewed-operations',tools:[
  {name:'zenith_get_context',description:'context',inputSchema:{type:'object'}},
  {name:'zenith_get_capabilities',description:'capabilities',inputSchema:{type:'object'}},
  {name:'zenith_prepare_change',description:'prepare',inputSchema:{type:'object'}},
]};
const result=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:{contractVersion:2,mode:'reviewed-operations',data}});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
function client(change={}){
  return new ControlClient({origin:ORIGIN,association:{version:1,workspaceId:'ws_1',projectId:'prj_a'},allowWrites:true,token:async()=>TOKEN,
    fetch:async(url,options)=>{
      if(options.method==='GET')return json(TOOLS);
      const name=JSON.parse(options.body).name;
      if(name==='zenith_get_context')return json(result({...CONTEXT,...change}));
      return json(result(CAPABILITIES));
    }});
}

test('status reports origin, account, scopes, expiry, capabilities and tools without a new MCP tool',async()=>{
  const report=await status(client(),{ZENITH_TOKEN_FILE:'/private/client.token'},Date.parse(EXPIRES)-6*86400000);
  assert.equal(report.ok,true);
  assert.equal(report.contractVersion,2);
  assert.equal(report.origin,ORIGIN);
  assert.deepEqual(report.selected,{version:1,workspaceId:'ws_1',projectId:'prj_a'});
  assert.deepEqual(report.profile,{name:null,active:true,credentialSource:'file',allowWrites:true});
  assert.deepEqual(report.credential,{id:'cred_1',label:'tarun-laptop',scopes:['read','plan','write','logs'],expiresAt:EXPIRES,expiresInDays:6});
  assert.deepEqual(report.capabilities,{journal:'postgres',coordination:'database',writesEnabled:true});
  assert.deepEqual(report.tools,['zenith_get_context','zenith_get_capabilities','zenith_prepare_change']);
  assert.ok(String(report.evidence).includes('No provider health'));
  assert.equal(JSON.stringify(report).includes(TOKEN),false);
});

test('status is honest when the backend reports no credential facts yet',async()=>{
  const report=await status(client({integrationId:undefined,label:undefined,scopes:undefined,expiresAt:undefined}),{});
  assert.equal(report.ok,true);
  assert.deepEqual(report.credential,{id:null,label:null,scopes:null,expiresAt:null,expiresInDays:null});
  assert.equal(report.profile.credentialSource,'unknown');
  assert.ok(String(report.evidence).includes('null'));
});

test('status refuses to call a scope mismatch a healthy link',async()=>{
  const report=await status(client({selected:{workspaceId:'foreign',projectId:'prj_a'}}),{});
  assert.equal(report.ok,false);
  assert.ok(String(report.evidence).includes('did not confirm the exact selected scope'));
});

test('a failed or errored verification tool is reported, not silently omitted',async()=>{
  const failing=new ControlClient({origin:ORIGIN,association:{version:1,workspaceId:'ws_1'},token:async()=>TOKEN,
    fetch:async(_url,options)=>options.method==='GET'?json(TOOLS):json({isError:true,content:[{type:'text',text:'credential expired'}]})});
  await assert.rejects(status(failing,{}),{code:'verification_failed'});
});

test('an unconfigured machine is a state, not an error',async()=>{
  const before=process.exitCode;
  const lines=[];
  await statusCommand([],{env:{},out:line=>lines.push(line)});
  assert.deepEqual(lines,['Not linked. Run `zenith login`.']);
  const asJson=[];
  await statusCommand(['--json'],{env:{},out:line=>asJson.push(line)});
  assert.deepEqual(JSON.parse(asJson.join('\n')),{ok:true,linked:false,next:'Run `zenith login`.'});
  assert.equal(process.exitCode,before);
});

test('statusCommand prints a human table by default and JSON on request',async t=>{
  const before=process.exitCode;t.after(()=>{process.exitCode=before;});
  const env={ZENITH_URL:ORIGIN,ZENITH_TOKEN_FILE:'/private/client.token'};
  const lines=[];
  await statusCommand([],{env,out:line=>lines.push(line),client:client()});
  const printed=lines.join('\n');
  assert.ok(printed.includes(`Origin      ${ORIGIN}`));
  assert.ok(printed.includes('tarun-laptop'));
  assert.ok(printed.includes('read, plan, write, logs'));
  assert.equal(printed.includes(TOKEN),false);
  const asJson=[];
  await statusCommand(['--json'],{env,out:line=>asJson.push(line),client:client()});
  assert.equal(JSON.parse(asJson.join('\n')).ok,true);
  assert.equal(process.exitCode,before);
  await assert.rejects(statusCommand(['--verbose'],{env,client:client()}),{code:'usage'});
});

test('a mismatched scope sets a failing exit code instead of printing a green report',async t=>{
  const before=process.exitCode;t.after(()=>{process.exitCode=before;});
  await statusCommand([],{env:{ZENITH_URL:ORIGIN},out:()=>{},client:client({selected:{workspaceId:'foreign'}})});
  assert.equal(process.exitCode,1);
});
