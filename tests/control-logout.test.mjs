import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tsImport} from 'tsx/esm/api';
const {loginCommand,logoutCommand}=await tsImport('../packages/control/login.ts',import.meta.url);
const {storeVault}=await tsImport('../packages/control/vault.ts',import.meta.url);

const ORIGIN='https://zenith.test';
const TOKEN=`za_${'G'.repeat(43)}`;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const START={deviceCode:`zl_${'A'.repeat(43)}`,userCode:'K7QM-3XRB',verificationUri:`${ORIGIN}/agent/link`,verificationUriComplete:`${ORIGIN}/agent/link?code=K7QM-3XRB`,interval:5,expiresIn:600,protocolVersion:1};
const ISSUED={status:'issued',token:TOKEN,credentialId:'cred_1',origin:ORIGIN,workspaceId:'ws_1',projectIds:['prj_a'],environmentIds:null,scopes:['read','plan'],expiresAt:new Date(Date.now()+7*86400000).toISOString()};
const loginIo=()=>({env:{},sleep:async()=>{},signal:new AbortController().signal,out:()=>{},err:()=>{},open:()=>true,
  fetch:async url=>String(url).endsWith('/api/agent/link/start')?json(START,201):json(ISSUED)});
function logoutIo(extra={}){
  const out=[],opened=[];
  return {out,opened,options:{env:{},out:line=>out.push(line),open:url=>{opened.push(url);return true;},...extra}};
}
/** Logout is local-only: any network reachable from this process fails the test. */
function offline(t){
  const real=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('logout must not make a network request');};
  t.after(()=>{globalThis.fetch=real;});
}
const POSIX=process.platform==='win32'?'POSIX token-file profiles; the Windows tests below cover the DPAPI layouts.':false;
const {loadProfiles}=await tsImport('../packages/control/profiles.ts',import.meta.url);

test('logout removes one profile, keeps the others and hands the active flag on',{skip:POSIX},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','first','--no-browser'],loginIo());
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','second','--no-browser'],loginIo());
  // login makes the profile it just wrote the active one.
  assert.equal(JSON.parse(await readFile(file,'utf8')).active,'second');
  const harness=logoutIo();
  await logoutCommand(['--url',ORIGIN,'--profiles',file,'--name','first'],harness.options);
  const document=JSON.parse(await readFile(file,'utf8'));
  assert.deepEqual(Object.keys(document.profiles),['second']);
  assert.equal(document.active,'second');
  await assert.rejects(stat(path.join(dir,'first.token')),'the credential this profile owned must be removed');
  assert.equal((await stat(path.join(dir,'second.token'))).isFile(),true,'another profile\'s credential must be left alone');
  const printed=harness.out.join('\n');
  assert.ok(printed.includes('does not revoke it'));
  assert.ok(printed.includes(`${ORIGIN}/integrations`));
  assert.ok(printed.includes('Linked agents'));
});

test('logging out of the only profile removes the profiles file, which cannot hold zero profiles',{skip:POSIX},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-last-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','only','--no-browser'],loginIo());
  await logoutCommand(['--url',ORIGIN,'--profiles',file],logoutIo().options);
  await assert.rejects(stat(file));
  await assert.rejects(stat(path.join(dir,'only.token')));
  await assert.rejects(stat(`${file}.lock`),'the lock must not be left behind');
});

test('logout refuses an unknown profile and a missing profiles file without touching anything',{skip:POSIX},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-missing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await assert.rejects(logoutCommand(['--profiles',file],logoutIo().options),{code:'profile_missing'});
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','only','--no-browser'],loginIo());
  await assert.rejects(logoutCommand(['--profiles',file,'--name','other'],logoutIo().options),{code:'profile_missing'});
  assert.deepEqual(Object.keys(JSON.parse(await readFile(file,'utf8')).profiles),['only']);
});

test('--revoke opens the browser page because a credential may never revoke itself',{skip:POSIX},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-revoke-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'profiles.json');
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','only','--no-browser'],loginIo());
  const harness=logoutIo();
  await logoutCommand(['--url',ORIGIN,'--profiles',file,'--revoke'],harness.options);
  assert.deepEqual(harness.opened,[`${ORIGIN}/integrations`]);
});

test('Windows logout --vault removes a --print-env DPAPI vault and still says revocation happens in the browser',{skip:process.platform!=='win32'?'Windows DPAPI path; a skipped POSIX run is not Windows evidence':false,timeout:60000},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-dpapi-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const vault=path.join(dir,'private','zen.dpapi');
  await storeVault(vault,TOKEN);
  assert.equal((await stat(vault)).isFile(),true);
  const harness=logoutIo({platform:'win32'});
  await logoutCommand(['--url',ORIGIN,'--vault',vault,'--name','zen'],harness.options);
  await assert.rejects(stat(vault));
  const printed=harness.out.join('\n');
  assert.ok(printed.includes(vault));
  assert.ok(printed.includes('does not revoke it'));
  assert.ok(printed.includes(`${ORIGIN}/integrations`));
  // Removing a vault that is already gone is not an error: logout is idempotent.
  await logoutCommand(['--url',ORIGIN,'--vault',vault,'--name','zen'],logoutIo({platform:'win32'}).options);
});

test('Windows logout removes a DPAPI profile and its vault, and hands the active flag on',{skip:process.platform!=='win32'?'Windows profile ACLs and DPAPI; a skipped POSIX run is not Windows evidence':false,timeout:120000},async t=>{
  offline(t);
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-logout-winprofile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'cfg','profiles.json'),vaults=path.join(dir,'vaults');
  const winLogin=()=>({...loginIo(),platform:'win32',env:{LOCALAPPDATA:vaults}});
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','first','--no-browser'],winLogin());
  await loginCommand(['--url',ORIGIN,'--profiles',file,'--name','second','--no-browser'],winLogin());
  assert.equal((await loadProfiles(file)).active,'second');
  const harness=logoutIo({platform:'win32'});
  await logoutCommand(['--url',ORIGIN,'--profiles',file],harness.options);
  const document=await loadProfiles(file);
  assert.deepEqual(Object.keys(document.profiles),['first']);
  assert.equal(document.active,'first');
  await assert.rejects(stat(path.join(vaults,'ZenithPrivate','second.dpapi')));
  assert.equal((await stat(path.join(vaults,'ZenithPrivate','first.dpapi'))).isFile(),true);
  assert.ok(harness.out.join('\n').includes('does not revoke it'));
});
