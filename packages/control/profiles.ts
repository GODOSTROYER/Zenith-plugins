/** Explicit user configuration only; never discover endpoints from a repository. */
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readVault } from './vault.js';
import { readKeychain } from './keychain.js';
import { z } from 'zod';
import { readBoundedFile, readCredential } from '../bridge/config.mjs';
import { ClientError, association, endpoint } from '../client/dist/index.js';
import { ControlClient, type ControlOptions } from '../client/control.js';
const name=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const keychainIdentifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/);
const scope=z.object({version:z.literal(1),workspaceId:z.string(),projectId:z.string().optional(),environmentId:z.string().optional()}).strict();
const definition=z.object({origin:z.string(),scope,allowLoopbackHttp:z.boolean().default(false),allowWrites:z.boolean().default(false),
  credentialKind:z.enum(['opaque','oauth']).default('opaque'),credential:z.discriminatedUnion('kind',[
    z.object({kind:z.literal('file'),path:z.string()}).strict(),z.object({kind:z.literal('dpapi'),path:z.string()}).strict(),
    z.object({kind:z.literal('keychain'),service:keychainIdentifier,account:keychainIdentifier}).strict(),
    z.object({kind:z.literal('environment'),variable:z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/)}).strict()
  ])}).strict();
const document=z.object({version:z.literal(2),active:name,profiles:z.record(name,definition)}).strict();
export type Profile=z.infer<typeof definition>;
export type Profiles=z.infer<typeof document>;
export function validateProfiles(value:unknown):Profiles{
  const result=document.parse(value);if(Object.keys(result.profiles).length>50||!Object.hasOwn(result.profiles,result.active))throw new ClientError('invalid_profiles','Choose an existing active profile (at most 50).');
  for(const p of Object.values(result.profiles)){association(p.scope);endpoint(p.origin,p.allowLoopbackHttp);if((p.credential.kind==='file'||p.credential.kind==='dpapi')&&!isAbsolute(p.credential.path))throw new ClientError('configuration_path','Credential paths must be absolute.');if(p.credentialKind==='oauth'&&!p.origin.startsWith('https://'))throw new ClientError('insecure_endpoint','OAuth profiles require HTTPS.');}
  return result;
}
export async function loadProfiles(file:string):Promise<Profiles>{return validateProfiles(JSON.parse(await readBoundedFile(file,65536,true)));}
export async function updateProfiles(file:string,change:(current:Profiles|undefined)=>Profiles):Promise<void>{
  if(!isAbsolute(file)||process.platform==='win32')throw new ClientError('private_profile_unavailable','Use an absolute private POSIX profile file. On Windows use explicit environment settings until secure profile ACL support is available.');
  const dir=dirname(file);await mkdir(dir,{recursive:true,mode:0o700});const stat=await lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0)throw new ClientError('profile_directory','Use an owned private non-symlink directory (0700).');
  const lock=await open(`${file}.lock`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600).catch(()=>{throw new ClientError('profile_busy','Another profile edit may be active. Do not remove its lock without checking.');});
  const temporary=join(dir,`.${basename(file)}.${randomUUID()}.tmp`);let handle;
  try{
    let current:Profiles|undefined;try{await lstat(file);current=await loadProfiles(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const next=validateProfiles(change(current));if(Buffer.byteLength(JSON.stringify(next,null,2)+'\n')>65536)throw new ClientError('profiles_too_large','Named profiles exceed the 64 KiB configuration limit.');handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(next,null,2)+'\n');await handle.sync();await handle.close();handle=undefined;
    await rename(temporary,file);
  }finally{await handle?.close();await unlink(temporary).catch(()=>{});await lock.close();await unlink(`${file}.lock`);}
}
const conflicting=['ZENITH_URL','ZENITH_WORKSPACE_ID','ZENITH_PROJECT_ID','ZENITH_ENVIRONMENT_ID','ZENITH_CONFIG_FILE','ZENITH_TOKEN_FILE','ZENITH_TOKEN_VAULT','ZENITH_TOKEN_KEYCHAIN_SERVICE','ZENITH_TOKEN_KEYCHAIN_ACCOUNT','ZENITH_CREDENTIAL_KIND','ZENITH_ALLOW_WRITES','ZENITH_ALLOW_LOOPBACK_HTTP'];
export async function controlClient(env:NodeJS.ProcessEnv=process.env):Promise<ControlClient>{
  let profile:Profile;
  if(env.ZENITH_PROFILES_FILE){
    if(conflicting.some(k=>env[k]!==undefined))throw new ClientError('ambiguous_configuration','Use named profiles or individual connection variables, not both.');
    const doc=await loadProfiles(env.ZENITH_PROFILES_FILE),selected=env.ZENITH_PROFILE??doc.active;
    const found=Object.hasOwn(doc.profiles,selected)?doc.profiles[selected]:undefined;if(!found)throw new ClientError('profile_missing','Select an existing named connection.');profile=found;
  }else{
    if(env.ZENITH_PROFILE||env.ZENITH_CONFIG_FILE)throw new ClientError('ambiguous_configuration','V2 named profiles use ZENITH_PROFILES_FILE. Do not reuse a version-1 profile implicitly.');
    if(env.ZENITH_ALLOW_WRITES!==undefined&&!['0','1'].includes(env.ZENITH_ALLOW_WRITES)||env.ZENITH_ALLOW_LOOPBACK_HTTP!==undefined&&!['0','1'].includes(env.ZENITH_ALLOW_LOOPBACK_HTTP))throw new ClientError('configuration','Boolean connection settings accept only 0 or 1.');
    const keychainConfigured=Boolean(env.ZENITH_TOKEN_KEYCHAIN_SERVICE||env.ZENITH_TOKEN_KEYCHAIN_ACCOUNT);
    if(keychainConfigured&&(!env.ZENITH_TOKEN_KEYCHAIN_SERVICE||!env.ZENITH_TOKEN_KEYCHAIN_ACCOUNT))throw new ClientError('configuration','Set both macOS Keychain service and account.');
    if([env.ZENITH_TOKEN_FILE,env.ZENITH_TOKEN,env.ZENITH_TOKEN_VAULT,keychainConfigured?'keychain':undefined].filter(Boolean).length!==1)throw new ClientError('configuration','Choose exactly one credential source.');
    profile=definition.parse({origin:env.ZENITH_URL,scope:{version:1,workspaceId:env.ZENITH_WORKSPACE_ID,...(env.ZENITH_PROJECT_ID?{projectId:env.ZENITH_PROJECT_ID}:{}),...(env.ZENITH_ENVIRONMENT_ID?{environmentId:env.ZENITH_ENVIRONMENT_ID}:{})},allowLoopbackHttp:env.ZENITH_ALLOW_LOOPBACK_HTTP==='1',allowWrites:env.ZENITH_ALLOW_WRITES==='1',credentialKind:env.ZENITH_CREDENTIAL_KIND??'opaque',credential:env.ZENITH_TOKEN_VAULT?{kind:'dpapi',path:env.ZENITH_TOKEN_VAULT}:env.ZENITH_TOKEN_FILE?{kind:'file',path:env.ZENITH_TOKEN_FILE}:keychainConfigured?{kind:'keychain',service:env.ZENITH_TOKEN_KEYCHAIN_SERVICE,account:env.ZENITH_TOKEN_KEYCHAIN_ACCOUNT}:{kind:'environment',variable:'ZENITH_TOKEN'}});
  }
  const selected=structuredClone(profile),token=async()=>{
    if(selected.credential.kind==='environment')return env[selected.credential.variable]??'';
    if(selected.credential.kind==='dpapi')return readVault(selected.credential.path);
    if(selected.credential.kind==='keychain')return readKeychain(selected.credential.service,selected.credential.account);
    return selected.credentialKind==='opaque'?readCredential(selected.credential.path):(await readBoundedFile(selected.credential.path,16384,true)).trim();
  };
  const options:ControlOptions={origin:profile.origin,association:association(profile.scope),allowLoopbackHttp:profile.allowLoopbackHttp,allowWrites:profile.allowWrites,credentialKind:profile.credentialKind,token,
    ...(env.ZENITH_DIAGNOSTICS==='1'?{diagnostic:(record:Record<string,unknown>)=>console.error(JSON.stringify(record))}:{})};
  return new ControlClient(options);
}
export async function profileCommand(args:string[]):Promise<unknown>{
  const verb=args.shift(),fields:Record<string,string>={};
  const flags=new Set(['--file','--name','--url','--workspace','--project','--environment','--loopback','--writes','--credential-kind','--token-file','--token-env','--keychain-service','--keychain-account']);
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!key||!value||!flags.has(key)||key in fields)throw new ClientError('usage','Use explicit --file, --name and connection fields; never pass a raw token.');fields[key]=value;}
  const keychainConfigured=Boolean(fields['--keychain-service']||fields['--keychain-account']);
  if(keychainConfigured&&(!fields['--keychain-service']||!fields['--keychain-account']))throw new ClientError('ambiguous_configuration','Set both --keychain-service and --keychain-account.');
  if([fields['--token-file'],fields['--token-env'],keychainConfigured?'keychain':undefined].filter(Boolean).length>1)throw new ClientError('ambiguous_configuration','Choose a token file, environment variable OR macOS Keychain item.');
  for(const key of ['--writes','--loopback'])if(fields[key]!==undefined&&!['0','1'].includes(fields[key]!))throw new ClientError('usage','Boolean profile flags require 0 or 1.');
  const file=fields['--file'];if(!file)throw new ClientError('usage','Select an explicit absolute --file path.');
  if(verb==='list'){const doc=await loadProfiles(file);return {active:doc.active,profiles:Object.entries(doc.profiles).map(([name,p])=>({name,origin:p.origin,scope:p.scope,allowWrites:p.allowWrites,credentialKind:p.credentialKind,credentialSource:p.credential.kind}))};}
  const selected=name.parse(fields['--name']);
  if(verb==='use'){await updateProfiles(file,doc=>{if(!doc||!Object.hasOwn(doc.profiles,selected))throw new ClientError('profile_missing','Unknown profile.');return {...doc,active:selected};});return {active:selected,restartRequired:true};}
  if(verb==='remove'){await updateProfiles(file,doc=>{if(!doc||doc.active===selected)throw new ClientError('active_profile','Select a different active profile before removing this one.');const profiles={...doc.profiles};delete profiles[selected];return {...doc,profiles};});return {removed:selected,credentialRevoked:false};}
  if(verb!=='add')throw new ClientError('usage','Use profile add, list, use or remove.');
  const credential=fields['--token-file']?{kind:'file' as const,path:fields['--token-file']}:keychainConfigured?{kind:'keychain' as const,service:fields['--keychain-service']!,account:fields['--keychain-account']!}:{kind:'environment' as const,variable:fields['--token-env']??'ZENITH_TOKEN'};
  const p=definition.parse({origin:fields['--url'],scope:{version:1,workspaceId:fields['--workspace'],...(fields['--project']?{projectId:fields['--project']}:{}),...(fields['--environment']?{environmentId:fields['--environment']}:{})},allowLoopbackHttp:fields['--loopback']==='1',allowWrites:fields['--writes']==='1',credentialKind:fields['--credential-kind']??'opaque',credential});
  await updateProfiles(file,doc=>{if(doc&&Object.hasOwn(doc.profiles,selected))throw new ClientError('profile_exists','Choose a new profile name; add never overwrites an existing destination.');return {version:2,active:doc?.active??selected,profiles:{...doc?.profiles,[selected]:p}};});
  return {created:selected,active:(await loadProfiles(file)).active,authenticated:false,next:'Set ZENITH_API_VERSION=2 and ZENITH_PROFILES_FILE, then run doctor. Restart the agent to change targets.'};
}
