/** Explicit user configuration only; never discover endpoints from a repository. */
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { dirname, isAbsolute, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareProfileFile, readVault, sealProfileFile, validateVaultPath, verifyProfileFile } from './vault.js';
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
/**
 * A profiles file names the origin a credential is sent to, so it is read only
 * from a private location. POSIX: an owned 0600 file (readBoundedFile). Windows:
 * a directory and file whose protected ACLs grant only the current user and
 * SYSTEM, checked by the same native helper that guards DPAPI vaults.
 */
export async function loadProfiles(file:string,platform:NodeJS.Platform=process.platform):Promise<Profiles>{
  if(platform==='win32'){
    if(process.platform!=='win32')throw new ClientError('private_profile_unavailable','Windows profile files are checked on Windows only.');
    validateVaultPath(file);await verifyProfileFile(file);
    return readVerified(file);
  }
  return validateProfiles(JSON.parse(await readBoundedFile(file,65536,true)));
}
/** Windows only, after the native helper verified the directory and file ACLs. */
const readVerified=async(file:string):Promise<Profiles>=>validateProfiles(JSON.parse(await readBoundedFile(file,65536,false,true)));
export async function updateProfiles(file:string,change:(current:Profiles|undefined)=>Profiles,platform:NodeJS.Platform=process.platform):Promise<void>{
  const windows=platform==='win32';
  if(!isAbsolute(file)||windows!==(process.platform==='win32'))throw new ClientError('private_profile_unavailable','Use an absolute private profile file for this platform.');
  const dir=dirname(file);
  if(windows){validateVaultPath(file);await prepareProfileFile(file);}
  else{
    await mkdir(dir,{recursive:true,mode:0o700});const stat=await lstat(dir);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid!()||(stat.mode&0o077)!==0)throw new ClientError('profile_directory','Use an owned private non-symlink directory (0700).');
  }
  const lock=await open(`${file}.lock`,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600).catch(()=>{throw new ClientError('profile_busy','Another profile edit may be active. Do not remove its lock without checking.');});
  const temporary=join(dir,`.${basename(file)}.${randomUUID()}.tmp`);let handle;
  try{
    // On Windows prepareProfileFile has just verified this file inside the private directory.
    let current:Profiles|undefined;try{await lstat(file);current=windows?await readVerified(file):await loadProfiles(file,platform);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const next=validateProfiles(change(current));if(Buffer.byteLength(JSON.stringify(next,null,2)+'\n')>65536)throw new ClientError('profiles_too_large','Named profiles exceed the 64 KiB configuration limit.');handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(next,null,2)+'\n');await handle.sync();await handle.close();handle=undefined;
    await rename(temporary,file);
    // The file inherited the verified private directory ACL on creation; give it its own.
    if(windows)await sealProfileFile(file);
  }finally{await handle?.close();await unlink(temporary).catch(()=>{});await lock.close();await unlink(`${file}.lock`);}
}
/**
 * The `profile add` body, factored out so `login` can persist a profile it
 * already validated without shelling through the flag parser. It never
 * overwrites: the existence check happens inside the same locked, atomic
 * update that writes the file, so two concurrent logins cannot both win.
 * `activate` makes the new profile the active one (what `login` wants: the
 * person just approved it in the browser); `profile add` keeps the current one.
 */
export async function writeProfile(file:string,profileName:string,value:unknown,options:{activate?:boolean;platform?:NodeJS.Platform}={}):Promise<{created:string;active:string}>{
  const selected=name.parse(profileName),entry=definition.parse(value);let active=selected;
  await updateProfiles(file,doc=>{
    if(doc&&Object.hasOwn(doc.profiles,selected))throw new ClientError('profile_exists','Choose a new profile name; this never overwrites an existing destination.');
    active=options.activate?selected:doc?.active??selected;return {version:2,active,profiles:{...doc?.profiles,[selected]:entry}};
  },options.platform);
  return {created:selected,active};
}
const conflicting=['ZENITH_URL','ZENITH_WORKSPACE_ID','ZENITH_PROJECT_ID','ZENITH_ENVIRONMENT_ID','ZENITH_CONFIG_FILE','ZENITH_TOKEN_FILE','ZENITH_TOKEN_VAULT','ZENITH_TOKEN_KEYCHAIN_SERVICE','ZENITH_TOKEN_KEYCHAIN_ACCOUNT','ZENITH_CREDENTIAL_KIND','ZENITH_ALLOW_WRITES','ZENITH_ALLOW_LOOPBACK_HTTP'];
/**
 * The location `login` writes when no explicit profiles file is configured:
 * `$XDG_CONFIG_HOME/zenith/profiles.json` (else `~/.config/…`) on POSIX, and
 * `%APPDATA%\zenith\profiles.json` (else `~\AppData\Roaming\…`) on Windows.
 */
export function defaultProfilesFile(env:NodeJS.ProcessEnv,home:string=homedir(),platform:NodeJS.Platform=process.platform):string{
  if(platform==='win32'){
    const base=env.APPDATA&&/^[A-Za-z]:\\/.test(env.APPDATA)?env.APPDATA:path.win32.join(home,'AppData','Roaming');
    return path.win32.join(base,'zenith','profiles.json');
  }
  const base=env.XDG_CONFIG_HOME&&isAbsolute(env.XDG_CONFIG_HOME)?env.XDG_CONFIG_HOME:join(home,'.config');
  return join(base,'zenith','profiles.json');
}
/**
 * Which named-profile document this process should read, if any.
 *
 * An explicit ZENITH_PROFILES_FILE always wins. Otherwise the connector falls
 * back to the file `login` just wrote in the user's own configuration
 * directory, because a plugin's MCP server is started by the host and cannot be
 * handed a per-user absolute path in a committed descriptor: without this, a
 * browser link succeeded and the very next server start could not find it.
 * The fallback is deliberately narrow. It is the user's own configuration
 * directory, never repository content, and it is skipped entirely when any
 * explicit connection variable is set, so nothing is ever silently preferred
 * over what an operator configured. On Windows the file is additionally
 * ACL-checked every time it is read (loadProfiles).
 */
export async function resolveProfilesFile(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):Promise<string|undefined>{
  if(env.ZENITH_PROFILES_FILE)return env.ZENITH_PROFILES_FILE;
  if(env.ZENITH_CONFIG_FILE||conflicting.some(k=>env[k]!==undefined))return undefined;
  const file=defaultProfilesFile(env,homedir(),platform);
  try{return (await lstat(file)).isFile()?file:undefined;}catch{return undefined;}
}
/** The file a profile command edits when no --file is given: the one the server reads. */
export function profilesFileFor(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):string{
  return env.ZENITH_PROFILES_FILE??defaultProfilesFile(env,homedir(),platform);
}
export async function controlClient(env:NodeJS.ProcessEnv=process.env):Promise<ControlClient>{
  let profile:Profile;
  const profilesFile=await resolveProfilesFile(env);
  if(profilesFile){
    if(conflicting.some(k=>env[k]!==undefined))throw new ClientError('ambiguous_configuration','Use named profiles or individual connection variables, not both.');
    const doc=await loadProfiles(profilesFile),selected=env.ZENITH_PROFILE??doc.active;
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
const SWITCH_NOTE='A running Zenith MCP server switches to this profile on its next tool call and announces a changed tool list. Hosts that ignore tools/list_changed need the Zenith server reconnected.';
export async function profileCommand(args:string[],env:NodeJS.ProcessEnv=process.env):Promise<unknown>{
  const verb=args.shift(),fields:Record<string,string>={};
  // `profile use NAME` / `profile remove NAME`: the name may be positional.
  const positional=(verb==='use'||verb==='remove')&&args[0]!==undefined&&!args[0].startsWith('--')?args.shift():undefined;
  const flags=new Set(['--file','--name','--url','--workspace','--project','--environment','--loopback','--writes','--credential-kind','--token-file','--token-env','--token-vault','--keychain-service','--keychain-account']);
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!key||!value||!flags.has(key)||key in fields)throw new ClientError('usage','Use explicit --file, --name and connection fields; never pass a raw token.');fields[key]=value;}
  if(positional!==undefined){if(fields['--name']!==undefined)throw new ClientError('usage','Name the profile once: `profile use NAME` or `profile use --name NAME`.');fields['--name']=positional;}
  const keychainConfigured=Boolean(fields['--keychain-service']||fields['--keychain-account']);
  if(keychainConfigured&&(!fields['--keychain-service']||!fields['--keychain-account']))throw new ClientError('ambiguous_configuration','Set both --keychain-service and --keychain-account.');
  if([fields['--token-file'],fields['--token-env'],fields['--token-vault'],keychainConfigured?'keychain':undefined].filter(Boolean).length>1)throw new ClientError('ambiguous_configuration','Choose a token file, environment variable, Windows DPAPI vault OR macOS Keychain item.');
  for(const key of ['--writes','--loopback'])if(fields[key]!==undefined&&!['0','1'].includes(fields[key]!))throw new ClientError('usage','Boolean profile flags require 0 or 1.');
  // list/use/remove default to the file the server itself reads; add stays explicit.
  const file=fields['--file']??(verb==='add'?undefined:profilesFileFor(env));
  if(!file||!isAbsolute(file))throw new ClientError('usage','Select an explicit absolute --file path.');
  if(verb==='list'){const doc=await loadProfiles(file);return {file,active:doc.active,profiles:Object.entries(doc.profiles).map(([name,p])=>({name,origin:p.origin,scope:p.scope,allowWrites:p.allowWrites,credentialKind:p.credentialKind,credentialSource:p.credential.kind}))};}
  const selected=name.parse(fields['--name']);
  if(verb==='use'){let previous='';await updateProfiles(file,doc=>{if(!doc||!Object.hasOwn(doc.profiles,selected))throw new ClientError('profile_missing','Unknown profile. Run `profile list` to see the names.');previous=doc.active;return {...doc,active:selected};});
    return {file,active:selected,previous,restartRequired:false,next:SWITCH_NOTE};}
  if(verb==='remove'){await updateProfiles(file,doc=>{if(!doc||doc.active===selected)throw new ClientError('active_profile','Select a different active profile before removing this one.');const profiles={...doc.profiles};delete profiles[selected];return {...doc,profiles};});return {removed:selected,credentialRevoked:false};}
  if(verb!=='add')throw new ClientError('usage','Use profile add, list, use or remove.');
  const credential=fields['--token-file']?{kind:'file' as const,path:fields['--token-file']}:fields['--token-vault']?{kind:'dpapi' as const,path:fields['--token-vault']}:keychainConfigured?{kind:'keychain' as const,service:fields['--keychain-service']!,account:fields['--keychain-account']!}:{kind:'environment' as const,variable:fields['--token-env']??'ZENITH_TOKEN'};
  const p={origin:fields['--url'],scope:{version:1,workspaceId:fields['--workspace'],...(fields['--project']?{projectId:fields['--project']}:{}),...(fields['--environment']?{environmentId:fields['--environment']}:{})},allowLoopbackHttp:fields['--loopback']==='1',allowWrites:fields['--writes']==='1',credentialKind:fields['--credential-kind']??'opaque',credential};
  const written=await writeProfile(file,selected,p);
  return {created:written.created,active:written.active,authenticated:false,next:'Set ZENITH_API_VERSION=2 and, unless this is the default profiles file, ZENITH_PROFILES_FILE; then run doctor. `profile use NAME` switches a running server without a restart.'};
}
