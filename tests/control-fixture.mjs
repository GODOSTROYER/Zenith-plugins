// A loopback stand-in for the Zenith v2 tools API. It authorizes by bearer token,
// maps each token to the one workspace it was issued for, and echoes the
// selection headers back so a test can see which profile a call used.
import {createServer} from 'node:http';
import {once} from 'node:events';

export const FIXTURE_TOOLS=['zenith_get_context','zenith_get_capabilities','zenith_list_workspaces','zenith_get_handoff'];

/** tokens: {token: workspaceId}. catalogs: optional {workspaceId: tool names}. */
export async function startControlFixture(tokens,catalogs={}){
  const calls=[];
  const server=createServer(async(req,res)=>{
    const token=(req.headers.authorization??'').replace(/^Bearer /,'');
    const workspace=tokens[token];
    if(!workspace||req.headers['x-zenith-workspace']!==workspace){res.writeHead(401);res.end();return;}
    let data;
    if(req.method==='GET'){
      const names=catalogs[workspace]??FIXTURE_TOOLS;
      data={contractVersion:2,mode:'reviewed-operations',tools:names.map(name=>({name,description:`Fixture ${name} for ${workspace}`,inputSchema:{type:'object',properties:{},additionalProperties:false}}))};
    }else{
      let text='';for await(const chunk of req)text+=chunk;
      const body=JSON.parse(text);
      calls.push({workspace,name:body.name});
      const selected={workspaceId:req.headers['x-zenith-workspace'],...(req.headers['x-zenith-project']?{projectId:req.headers['x-zenith-project']}:{})};
      data={content:[{type:'text',text:`fixture ${body.name}`}],structuredContent:{contractVersion:2,mode:'reviewed-operations',data:{selected,tool:body.name}}};
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {
    origin:`http://127.0.0.1:${server.address().port}`,
    calls,
    close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
