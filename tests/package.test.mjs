import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readCredential } from '../packages/bridge/cli.mjs';
import { signedPackageEnvironment } from './provenance-fixture.mjs';
const credential=`za_${'B'.repeat(43)}`;
test('credential file ownership, permissions, size and symlink guards',{skip:process.platform==='win32'?'POSIX ownership/mode checks; Windows private files fail closed':false},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zenith token '));
 try {const file=path.join(dir,'client.token');await writeFile(file,credential,{mode:0o600});assert.equal(await readCredential(file),credential);await chmod(file,0o644);await assert.rejects(readCredential(file));await chmod(file,0o600);await writeFile(file,'x'.repeat(257));await assert.rejects(readCredential(file));await symlink(file,path.join(dir,'linked'));await assert.rejects(readCredential(path.join(dir,'linked')));await assert.rejects(readCredential('relative.token'));} finally{await rm(dir,{recursive:true,force:true});}
});
for(const kind of ['codex','claude-code'])test(`copied ${kind} package runs authenticated stdio against HTTP fixture`,{timeout:10000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zenith installed package '));let child;
 const server=createServer(async(req,res)=>{
  if(req.headers.authorization!==`Bearer ${credential}`||req.headers['x-zenith-workspace']!=='ws'){res.writeHead(401);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const m=JSON.parse(Buffer.concat(chunks));
  if(m.id===undefined){res.writeHead(202);res.end();return;}
  let result={};
  if(m.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  if(m.method==='tools/list')result={tools:[{name:'zenith_get_context',inputSchema:{type:'object'}}]};
  if(m.method==='tools/call')result={content:[{type:'text',text:'fixture: scoped ws'}],structuredContent:{data:{workspaceId:'ws'},mode:'read-only',contractVersion:1}};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });
 try{
  await cp(new URL(`../plugins/${kind}/`,import.meta.url),dir,{recursive:true});
  const provenance=await signedPackageEnvironment(dir);t.after(provenance.cleanup);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('ZENITH_'))delete env[k];
  Object.assign(env,provenance.env,{ZENITH_URL:`http://127.0.0.1:${server.address().port}`,ZENITH_ALLOW_LOOPBACK_HTTP:'1',ZENITH_WORKSPACE_ID:'ws',ZENITH_TOKEN:credential});
  child=spawn(process.execPath,[path.join(dir,'runtime/bridge/cli.mjs'),'stdio'],{cwd:tmpdir(),env,stdio:['pipe','pipe','pipe']});
  const messages=createInterface({input:child.stdout})[Symbol.asyncIterator]();let errors='';child.stderr.on('data',b=>errors+=b);
  const send=async(m)=>{child.stdin.write(JSON.stringify(m)+'\n');if(m.id===undefined)return;const line=await messages.next();assert.equal(line.done,false,errors);return JSON.parse(line.value);};
  const init=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});assert.equal(init.result.serverInfo.name,'fixture');
  await send({jsonrpc:'2.0',method:'notifications/initialized'});
  assert.equal((await send({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools[0].name,'zenith_get_context');
  assert.equal((await send({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'zenith_get_context',arguments:{}}})).result.structuredContent.data.workspaceId,'ws');
  assert.equal((await send({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'zenith_execute_plan',arguments:{approved:true}}})).result.isError,true);
  assert.equal(errors.includes(credential),false);child.stdin.end();await once(child,'exit');
 }finally{child?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
