import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
const token=`za_${'V'.repeat(43)}`;
for(const kind of ['codex','claude-code'])test(`SDK client calls copied ${kind} v2 package with writes disabled`,{timeout:15000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zenith SDK installed package ')),calls=[];t.after(()=>rm(dir,{recursive:true,force:true}));
 const server=createServer(async(req,res)=>{if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}let data;if(req.method==='GET')data={contractVersion:2,mode:'reviewed-operations',tools:['zenith_get_context','zenith_execute_operation'].map(name=>({name,description:'Fixture',inputSchema:{type:'object',properties:{},additionalProperties:false}}))};else{let text='';for await(const b of req)text+=b;const body=JSON.parse(text);calls.push(body.name);data={content:[{type:'text',text:'fixture only'}],structuredContent:{contractVersion:2,mode:'reviewed-operations',data:{selected:{workspaceId:'w'}}}};}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});await cp(new URL(`../plugins/${kind}/`,import.meta.url),dir,{recursive:true});
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ZENITH_'))delete env[key];Object.assign(env,{ZENITH_API_VERSION:'2',ZENITH_URL:`http://127.0.0.1:${server.address().port}`,ZENITH_ALLOW_LOOPBACK_HTTP:'1',ZENITH_WORKSPACE_ID:'w',ZENITH_TOKEN:token});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(dir,'runtime/bridge/cli.mjs'),'stdio'],env,cwd:tmpdir(),stderr:'pipe'});let stderr='';transport.stderr?.on('data',b=>stderr+=b);const client=new Client({name:'zenith-contract-test',version:'1'});t.after(()=>client.close());
 await client.connect(transport);const catalog=await client.listTools();assert.deepEqual(catalog.tools.map(t=>t.name),['zenith_get_context']);const result=await client.callTool({name:'zenith_get_context',arguments:{}});assert.equal(result.structuredContent.data.selected.workspaceId,'w');assert.deepEqual(calls,['zenith_get_context']);assert.equal(stderr.includes(token),false);await client.close();
});
