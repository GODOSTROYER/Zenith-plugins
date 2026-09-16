import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const {loginCommand,allowWritesFor,clientName,defaultProfileName,defaultProfilesFile,defaultVaultPath,preferredProfileName}=await tsImport('../packages/control/login.ts',import.meta.url);
const {controlClient,loadProfiles}=await tsImport('../packages/control/profiles.ts',import.meta.url);
const {startControlFixture}=await import('./control-fixture.mjs');
const {readVault}=await tsImport('../packages/control/vault.ts',import.meta.url);

const ORIGIN='https://zenith.test';
const DEVICE=`zl_${'A'.repeat(43)}`;
const TOKEN=`za_${'L'.repeat(43)}`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const START={deviceCode:DEVICE,userCode:'K7QM-3XRB',verificationUri:`${ORIGIN}/agent/link`,verificationUriComplete:`${ORIGIN}/agent/link?code=K7QM-3XRB`,interval:5,expiresIn:600,protocolVersion:1};
const WHOLE={projectIds:[],allProjects:true,workspaceSlug:'acme-team'};
const issued=(change={})=>({status:'issued',token:TOKEN,credentialId:'cred_1',origin:ORIGIN,workspaceId:'ws_1',projectIds:['prj_a','prj_b'],environmentIds:null,scopes:['read','plan','write','logs'],expiresAt:new Date(Date.now()+7*86400000).toISOString(),label:'tarun-laptop',...change});

function io(extra={},grant={},{version=1,origin=ORIGIN}={}){
  const out=[],err=[],opened=[],bodies=[];
  const start={...START,protocolVersion:version,verificationUri:`${origin}/agent/link`,verificationUriComplete:`${origin}/agent/link?code=K7QM-3XRB`};
  return {out,err,opened,bodies,options:{
    env:{},sleep:async()=>{},signal:new AbortController().signal,
    out:line=>out.push(line),err:line=>err.push(line),open:url=>{opened.push(url);return true;},
    fetch:async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return String(url).endsWith('/api/agent/link/start')?json(start,201):json(issued({origin,...grant}));},
    ...extra,
  }};
}
const POSIX=process.platform==='win32'?'POSIX token-file profiles; on win32 login writes a DPAPI profile instead (the Windows tests below).':false;
const WINDOWS=process.platform!=='win32'?'Windows DPAPI and profile ACLs; a skipped POSIX run is not Windows evidence':false;

test('login detects the host agent, the profile name and the private defaults without asking',()=>{
  assert.equal(clientName({CLAUDE_PLUGIN_ROOT:'/x'}),'Claude Code');
  assert.equal(clientName({CODEX_HOME:'/x'}),'Codex');
  assert.equal(clientName({PLUGIN_ROOT:'/x'}),'Codex');
  assert.equal(clientName({}),'Zenith CLI');
  assert.equal(defaultProfileName('https://tryzenith.cloud'),'tryzenith');
  assert.equal(defaultProfileName('https://127.0.0.1:3400'),'127');
  assert.equal(defaultProfilesFile({XDG_CONFIG_HOME:path.resolve('/cfg')},path.resolve('/home/you'),'linux'),path.join(path.resolve('/cfg'),'zenith','profiles.json'));
  assert.equal(defaultProfilesFile({APPDATA:'C:\\Users\\you\\AppData\\Roaming'},'C:\\Users\\you','win32'),'C:\\Users\\you\\AppData\\Roaming\\zenith\\profiles.json');
  assert.equal(defaultProfilesFile({APPDATA:'relative'},'C:\\Users\\you','win32'),'C:\\Users\\you\\AppData\\Roaming\\zenith\\profiles.json');
  assert.equal(preferredProfileName('https://tryzenith.cloud',{workspaceSlug:'acme-team'}),'acme-team');
  assert.equal(preferredProfileName('https://tryzenith.cloud',{}),'tryzenith');
  assert.equal(defaultVaultPath({LOCALAPPDATA:'C:\\Users\\you\\AppData\\Local'},'tryzenith'),'C:\\Users\\you\\AppData\\Local\\ZenithPrivate\\tryzenith.dpapi');
});

test('allowWrites follows the scopes the browser granted, not a second local flag',()=>{
  assert.equal(allowWritesFor(['read','plan']),false);
  assert.equal(allowWritesFor(['read','plan','write','logs']),true);
  assert.equal(allowWritesFor(['read','publish']),true);
  assert.equal(allowWritesFor(['read','logs','export']),false);
});

test('login writes a private 0600 credential and a profile carrying the granted scope',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json'),token=path.join(dir,'zen.token');
  const harness=io();
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser'],harness.options);
  assert.equal(await readFile(token,'utf8'),TOKEN);
  assert.equal((await stat(token)).mode&0o777,0o600);
  const document=JSON.parse(await readFile(file,'utf8'));
  assert.equal(document.active,'zen');
  assert.deepEqual(document.profiles.zen.credential,{kind:'file',path:token});
  assert.equal(document.profiles.zen.origin,ORIGIN);
  assert.equal(document.profiles.zen.allowWrites,true);
  assert.equal(document.profiles.zen.credentialKind,'opaque');
  assert.deepEqual(document.profiles.zen.scope,{version:1,workspaceId:'ws_1'});
  // Two approved projects: the agent must pass an explicit target per call.
  assert.equal(document.profiles.zen.scope.projectId,undefined);
  const printed=[...harness.out,...harness.err].join('\n');
  assert.equal(printed.includes(TOKEN),false);
  assert.equal(printed.includes(DEVICE),false);
  assert.equal(printed.includes('K7QM-3XRB'),true);
  assert.equal(printed.includes(`${ORIGIN}/agent/link?code=K7QM-3XRB`),true);
  assert.equal((await readFile(file,'utf8')).includes('za_'),false);
});

test('a single approved project is pinned and read-only scopes leave writes off',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-one-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser'],io({},{projectIds:['prj_a'],scopes:['read','plan']}).options);
  const document=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(document.profiles.zen.scope,{version:1,workspaceId:'ws_1',projectId:'prj_a'});
  assert.equal(document.profiles.zen.allowWrites,false);
});

test('login never overwrites an existing profile or credential file',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-twice-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser'],io().options);
  await assert.rejects(loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser'],io().options),{code:'profile_exists'});
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file,'utf8')).profiles),['zen']);
  // A leftover credential file is refused too rather than silently replaced.
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','other','--no-browser'],io().options);
  await rm(file,{force:true});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--profiles',file,'--name','other','--no-browser'],io().options),{code:'credential_exists'});
});

test('an approval that does not include the pinned project stores nothing',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-scope-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await assert.rejects(loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--project','prj_z','--no-browser'],io().options),{code:'scope_denied'});
  await assert.rejects(stat(file));
  await assert.rejects(stat(path.join(dir,'zen.token')));
});

test('--json keeps stdout machine readable and the prompt on stderr, with no credential in either',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-json-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  const harness=io();
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser','--json'],harness.options);
  const report=JSON.parse(harness.out.join('\n'));
  assert.equal(report.linked,true);
  assert.equal(report.credentialId,'cred_1');
  assert.deepEqual(report.scopes,['read','plan','write','logs']);
  assert.equal(report.allowWrites,true);
  assert.deepEqual(report.credential,{kind:'file',path:path.join(dir,'zen.token')});
  assert.equal(JSON.stringify(report).includes(TOKEN),false);
  assert.equal(JSON.stringify(report).includes(DEVICE),false);
  assert.equal(harness.err.join('\n').includes('K7QM-3XRB'),true);
});

test('the browser is opened with the printed verification URL and only when asked',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-open-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const quiet=io();
  await loginCommand(['--url',ORIGIN,'--profiles',path.join(dir,'a.json'),'--name','a','--no-browser'],quiet.options);
  assert.deepEqual(quiet.opened,[]);
  const opened=io();
  await loginCommand(['--url',ORIGIN,'--profiles',path.join(dir,'b.json'),'--name','b'],opened.options);
  assert.deepEqual(opened.opened,[`${ORIGIN}/agent/link?code=K7QM-3XRB`]);
});

test('login refuses an insecure or unknown destination before it reaches the network',async()=>{
  const network=io({fetch:()=>assert.fail('network reached')}).options;
  await assert.rejects(loginCommand(['--url','http://zenith.test','--no-browser'],network),{code:'insecure_endpoint'});
  await assert.rejects(loginCommand(['--url','https://zenith.test/path','--no-browser'],network),{code:'invalid_endpoint'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--scopes','read,root','--no-browser'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--unknown','x'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--name','bad name'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--workspace','ws_1','--new-workspace','Team'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--workspace','bad id'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--new-workspace','<b>'],network),{code:'usage'});
  await assert.rejects(loginCommand(['--url',ORIGIN,'--print-env'],{...network,platform:'linux'}),{code:'usage'});
});

test('the bridge routes login and reports the real refusal code, not startup_failed',{timeout:20000},async()=>{
  const cli=fileURLToPath(new URL('../packages/bridge/cli.mjs',import.meta.url));
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('ZENITH_'))delete env[key];
  // Point both default profile locations at a directory that does not exist, so no real profile is read.
  env.XDG_CONFIG_HOME=env.APPDATA=path.join(tmpdir(),'zenith-no-config-'+process.pid);
  const run=args=>new Promise(resolve=>execFile(process.execPath,[cli,...args],{env},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));
  // Ungated help names the new verb and opens nothing.
  const help=await run(['--help']);
  assert.equal(help.code,0);
  assert.match(help.stdout,/login/);
  // login routes to the control CLI with no Zenith environment at all, which is
  // the entire point, and its refusal reaches the operator by its own code. The
  // control CLI is a bundle with its own ClientError, so `instanceof` alone
  // reported every control refusal as startup_failed.
  const refused=await run(['login','--url','http://example.test','--no-browser']);
  assert.equal(refused.code,1);
  assert.deepEqual(JSON.parse(refused.stderr).code,'insecure_endpoint');
  assert.equal(refused.stdout,'');
  const unlinked=await run(['status']);
  assert.equal(unlinked.code,0);
  assert.equal(unlinked.stdout.trim(),'Not linked. Run `zenith login`.');
});

test('Windows login --print-env stores a DPAPI vault, writes no profile and prints the environment block',{skip:WINDOWS,timeout:60000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-dpapi-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const vault=path.join(dir,'private','zen.dpapi'),file=path.join(dir,'profiles.json');
  const harness=io({platform:'win32'});
  await loginCommand(['--url',ORIGIN,'--vault',vault,'--profiles',file,'--name','zen','--no-browser','--print-env'],harness.options);
  assert.equal(await readVault(vault),TOKEN);
  assert.equal((await readFile(vault)).includes(Buffer.from(TOKEN)),false);
  await assert.rejects(stat(file),'Windows must not write a named profile file');
  const printed=harness.out.join('\n');
  assert.equal(printed.includes(TOKEN),false);
  assert.equal(printed.includes(DEVICE),false);
  assert.ok(printed.includes('ZENITH_API_VERSION=2'));
  assert.ok(printed.includes(`ZENITH_URL=${ORIGIN}`));
  assert.ok(printed.includes('ZENITH_WORKSPACE_ID=ws_1'));
  assert.ok(printed.includes(`ZENITH_TOKEN_VAULT=${vault}`));
  assert.ok(printed.includes('ZENITH_ALLOW_WRITES=1'));
  // Create-only: a second link to the same vault refuses rather than replacing it.
  await assert.rejects(loginCommand(['--url',ORIGIN,'--vault',vault,'--profiles',file,'--name','zen','--no-browser','--print-env'],io({platform:'win32'}).options),{code:'vault_refused'});
});

test('a v2 whole-workspace login stores a profile named after the workspace, with no project pin, and makes it active',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-whole-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  const first=io({},{},{version:2});
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','old','--no-browser'],first.options);
  const harness=io({},{...WHOLE},{version:2});
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--no-browser','--new-workspace','Acme Team'],harness.options);
  assert.equal(harness.bodies[0].protocolVersion,2);
  assert.equal(harness.bodies[0].workspaceNameHint,'Acme Team');
  assert.equal(harness.bodies[1].protocolVersion,2);
  const document=JSON.parse(await readFile(file,'utf8'));
  assert.equal(document.active,'acme-team');
  assert.deepEqual(document.profiles['acme-team'].scope,{version:1,workspaceId:'ws_1'});
  assert.equal(document.profiles['acme-team'].credential.path,path.join(dir,'acme-team.token'));
  const printed=harness.out.join('\n');
  assert.match(printed,/Whole workspace/);
  assert.match(printed,/Create a new workspace/);
  // A second link to the same workspace steps to a fresh name instead of failing.
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--no-browser','--json'],io({},{...WHOLE},{version:2}).options);
  const again=JSON.parse(await readFile(file,'utf8'));
  assert.equal(again.active,'acme-team-2');
  assert.deepEqual(Object.keys(again.profiles).sort(),['acme-team','acme-team-2','old']);
});

test('a whole-workspace grant never pins a project implicitly',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-nopin-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  const harness=io({},{...WHOLE},{version:2});
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','zen','--no-browser','--json'],harness.options);
  const report=JSON.parse(harness.out.join('\n'));
  assert.equal(report.scopeMode,'workspace');assert.equal(report.allProjects,true);assert.deepEqual(report.projectIds,[]);
  assert.equal(report.pinnedProject,undefined);
  assert.deepEqual(report.profile,{name:'zen',file,active:true});
  assert.equal((await loadProfiles(file)).profiles.zen.scope.projectId,undefined);
  // An explicit --project still narrows, exactly like the server's header.
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','pinned','--project','prj_later','--no-browser'],io({},{...WHOLE},{version:2}).options);
  assert.equal((await loadProfiles(file)).profiles.pinned.scope.projectId,'prj_later');
});

test('a v1 server keeps working: the hint is reported as not sent and the explicit project list is stored',{skip:POSIX},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-v1-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  const bodies=[],out=[];
  const fetch=async(url,init)=>{const body=JSON.parse(init.body);bodies.push(body);
    if(String(url).endsWith('/start'))return body.protocolVersion===1?json(START,201):json({error:{code:'invalid_request',message:'This server speaks link protocol version 1.'}},400);
    return json(issued({projectIds:['prj_a']}));};
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--no-browser','--workspace','ws_1'],{...io().options,fetch,out:line=>out.push(line)});
  assert.deepEqual(bodies.map(b=>b.protocolVersion),[2,1,1]);
  assert.match(out.join('\n'),/link protocol 1/);
  const document=await loadProfiles(file);
  assert.equal(document.active,'zenith');
  assert.deepEqual(document.profiles.zenith.scope,{version:1,workspaceId:'ws_1',projectId:'prj_a'});
});

test('Windows login writes a DPAPI profile that the connector resolves, with no pin under a whole-workspace grant',{skip:WINDOWS,timeout:120000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-login-winprofile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const fixture=await startControlFixture({[TOKEN]:'ws_1'});t.after(fixture.close);
  const file=path.join(dir,'cfg','profiles.json'),vaults=path.join(dir,'vaults');
  const harness=io({platform:'win32',env:{LOCALAPPDATA:vaults}},{...WHOLE},{version:2,origin:fixture.origin});
  await loginCommand(['--url',fixture.origin,'--loopback','1','--profiles',file,'--no-browser'],harness.options);
  const vault=path.join(vaults,'ZenithPrivate','acme-team.dpapi');
  assert.equal(await readVault(vault),TOKEN);
  const document=await loadProfiles(file);
  assert.equal(document.active,'acme-team');
  assert.deepEqual(document.profiles['acme-team'].credential,{kind:'dpapi',path:vault});
  assert.deepEqual(document.profiles['acme-team'].scope,{version:1,workspaceId:'ws_1'});
  assert.equal((await readFile(file,'utf8')).includes('za_'),false);
  const printed=harness.out.join('\n');
  assert.equal(printed.includes(TOKEN),false);
  assert.equal(printed.includes('ZENITH_TOKEN_VAULT'),false,'no environment block without --print-env');
  // The server side: the profile resolves, the vault decrypts, and the request carries the workspace.
  const client=await controlClient({ZENITH_PROFILES_FILE:file});
  assert.equal(client.origin,fixture.origin);
  assert.deepEqual({...client.scope},{version:1,workspaceId:'ws_1'});
  const context=await client.call('zenith_get_context',{});
  assert.equal(context.structuredContent.data.selected.workspaceId,'ws_1');
  assert.equal(context.structuredContent.data.selected.projectId,undefined);
  // A second profile for the same workspace steps past the existing name and vault.
  await loginCommand(['--url',fixture.origin,'--loopback','1','--profiles',file,'--no-browser'],io({platform:'win32',env:{LOCALAPPDATA:vaults}},{...WHOLE},{version:2,origin:fixture.origin}).options);
  assert.equal((await loadProfiles(file)).active,'acme-team-2');
});
