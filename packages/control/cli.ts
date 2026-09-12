import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { controlClient, profileCommand } from './profiles.js';
import { packageSource } from './source.js';
import { storeVault } from './vault.js';
import { remoteConfiguration } from './remote.js';
import { serveControl } from './server.js';
import { ClientError, isObject } from '../client/dist/index.js';
export async function main(args:string[]=process.argv.slice(2)):Promise<void>{
  const command=args.shift()??'stdio';
  if(['--help','help'].includes(command)){console.log('Zenith v2: stdio | doctor | remote-config | credential-store | profile add/list/use/remove | source\nUse an explicit trusted connection profile or ZENITH_URL and scoped credentials. Writes require ZENITH_ALLOW_WRITES=1 or allowWrites:true.\nProfiles: profile add --file ABS --name NAME --url ORIGIN --workspace ID [--project ID] [--environment ID] [--token-file ABS | --token-env NAME] [--writes 1] [--loopback 1]\nSource: source --root ABS --include index.html --include zenith.app.json --include src [--output ABS] [--upload APP_ID --confirm-upload]\nBrowser approval is required for every operation; source upload is not publishing.');return;}
  if(command==='credential-store'){
    if(args.length!==2||args[0]!=='--file'||process.stdin.isTTY)throw new ClientError('usage','Use credential-store --file ABSOLUTE_WINDOWS_PATH with the credential piped through stdin. Never paste it into an agent conversation.');
    const parts:Buffer[]=[];let bytes=0;for await(const chunk of process.stdin){const b=Buffer.from(chunk);bytes+=b.length;if(bytes>16386)throw new ClientError('invalid_credential','Credential stdin exceeds its size limit.');parts.push(b);}
    const token=Buffer.concat(parts).toString('utf8').trim();for(const b of parts)b.fill(0);await storeVault(args[1]!,token);console.log(JSON.stringify({stored:true,mechanism:'Windows CurrentUser DPAPI',credentialRevoked:false}));return;
  }
  if(command==='profile'){console.log(JSON.stringify(await profileCommand(args),null,2));return;}
  if(command==='source'){
    const fields:Record<string,string>={},includes:string[]=[];let confirm=false;
    for(let i=0;i<args.length;i++){const key=args[i]!;if(key==='--confirm-upload'){confirm=true;continue;}const value=args[++i];if(!value)throw new ClientError('usage','Source requires explicit --root and --include entries.');if(key==='--include')includes.push(value);else if(['--root','--output','--upload'].includes(key)&&!(key in fields))fields[key]=value;else throw new ClientError('usage','Unknown or repeated source option.');}
    const archive=await packageSource(fields['--root']??'',includes),summary={sha256:archive.sha256,archiveBytes:archive.bytes.length,totalBytes:archive.totalBytes,files:archive.files,validation:'Conservative local preflight; Zenith revalidates the authoritative source contract.'};
    if(fields['--output']){if(!isAbsolute(fields['--output']))throw new ClientError('configuration_path','Choose an absolute archive output path.');const file=await open(fields['--output'],'wx',0o600);try{await file.writeFile(archive.bytes);await file.sync();}finally{await file.close();}}
    if(fields['--upload']){if(!confirm)throw new ClientError('upload_confirmation','Review source inventory first, then explicitly pass --confirm-upload. No upload was performed.');const uploaded=await(await controlClient()).upload(fields['--upload'],archive.bytes);console.log(JSON.stringify({...summary,uploaded},null,2));}else console.log(JSON.stringify(summary,null,2));return;
  }
  if(command==='remote-config'){
    if(args.length)throw new ClientError('usage','remote-config reads explicit connection settings; it accepts no token or extra arguments.');
    console.log(JSON.stringify(await remoteConfiguration(),null,2));return;
  }
  const client=await controlClient();
  if(command==='stdio'){await serveControl(client);return;}
  if(command==='doctor'){
    const tools=await client.catalog(),context=await client.call('zenith_get_context',{}),data=context.structuredContent?.data;
    if(context.isError||!isObject(data)||!isObject(data.selected)||['workspaceId','projectId','environmentId'].some(k=>data.selected&&isObject(data.selected)&&data.selected[k]!==client.scope[k as keyof typeof client.scope]))throw new ClientError('scope_mismatch','The backend did not verify the exact selected scope.');
    console.log(JSON.stringify({ok:true,contractVersion:2,selected:client.scope,allowWrites:client.allowWrites,tools:tools.map(t=>t.name),evidence:'Authenticated tools and scope only; no deployment or provider-health verification.'},null,2));return;
  }
  throw new ClientError('usage','Control commands: stdio, doctor, profile, source, remote-config. Set ZENITH_API_VERSION=2 explicitly.');
}
