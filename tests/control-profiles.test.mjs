import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tsImport} from 'tsx/esm/api';
const {validateProfiles,loadProfiles,profileCommand,controlClient,resolveProfilesFile,writeProfile}=await tsImport('../packages/control/profiles.ts',import.meta.url);
const definition={origin:'https://zenith.test',scope:{version:1,workspaceId:'w'},credential:{kind:'environment',variable:'ZENITH_TOKEN'}};
test('v2 profiles reject ambiguous fields, unknown active names and prototype names',()=>{for(const doc of [{version:2,active:'other',profiles:{local:definition}},{version:2,active:'local',profiles:{local:{...definition,token:'secret'}}},{version:2,active:'toString',profiles:{}},{version:2,active:'constructor',profiles:{constructor:definition}}])assert.throws(()=>validateProfiles(doc));});
test('v2 profiles accept bounded macOS Keychain references without storing a credential',()=>{const doc=validateProfiles({version:2,active:'mac',profiles:{mac:{origin:'https://zenith.test',scope:{version:1,workspaceId:'w'},credential:{kind:'keychain',service:'com.example.zenith',account:'member'}}}});assert.equal(doc.profiles.mac.credential.kind,'keychain');assert.equal(JSON.stringify(doc).includes('za_'),false);for(const credential of [{kind:'keychain',service:'bad\nservice',account:'member'},{kind:'keychain',service:'service',account:''}])assert.throws(()=>validateProfiles({version:2,active:'mac',profiles:{mac:{origin:'https://zenith.test',scope:{version:1,workspaceId:'w'},credential}}}));});
test('named profile add/use/remove retains active targets and never stores raw credentials',{skip:process.platform==='win32'?'POSIX modes on a mkdtemp directory; the cross-platform profile test below covers Windows':false},async t=>{const dir=await mkdtemp(path.join(tmpdir(),'zenith profile suite '));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'profiles.json');const create=name=>profileCommand(['add','--file',file,'--name',name,'--url','https://zenith.test','--workspace','w','--token-env','ZENITH_FIXTURE']);await create('staging');await create('production');assert.equal((await loadProfiles(file)).active,'staging');await assert.rejects(create('staging'));await profileCommand(['use','--file',file,'--name','production']);await profileCommand(['remove','--file',file,'--name','staging']);assert.deepEqual(Object.keys((await loadProfiles(file)).profiles),['production']);const c=await controlClient({ZENITH_PROFILES_FILE:file,ZENITH_FIXTURE:`za_${'X'.repeat(43)}`});assert.equal(c.origin,'https://zenith.test');assert.equal((await readFile(file,'utf8')).includes('za_'),false);await assert.rejects(controlClient({ZENITH_PROFILES_FILE:file,ZENITH_URL:'https://other.test'}),{code:'ambiguous_configuration'});});
test('profile add can persist a Keychain reference without reading the Keychain',{skip:process.platform==='win32'?'POSIX modes on a mkdtemp directory; Keychain references are platform-neutral data':false},async t=>{const dir=await mkdtemp(path.join(tmpdir(),'zenith keychain profile '));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'profiles.json');await profileCommand(['add','--file',file,'--name','mac','--url','https://zenith.test','--workspace','w','--keychain-service','com.example.zenith','--keychain-account','member']);const loaded=await loadProfiles(file);assert.deepEqual(loaded.profiles.mac.credential,{kind:'keychain',service:'com.example.zenith',account:'member'});assert.equal((await readFile(file,'utf8')).includes('za_'),false);});
test('profile commands reject raw tokens, unknown flags and ambiguous credential sources',async()=>{for(const args of [['add','--token','secret'],['add','--file','/unused','--name','local','--writes','yes'],['add','--token-file','/unused','--token-env','ZENITH_TOKEN'],['add','--token-file','/unused','--keychain-service','service','--keychain-account','account'],['add','--keychain-service','service']])await assert.rejects(profileCommand(args));});

// Runs on every platform: POSIX uses 0700/0600 modes, Windows uses the protected-ACL helper.
// The profiles file sits in a directory this test creates, never in an existing one.
test('profile use NAME switches the active profile in the file the server reads, on this platform',{timeout:120000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-profile-use-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'cfg','profiles.json');
  const entry=workspace=>({origin:'https://zenith.test',scope:{version:1,workspaceId:workspace},credential:{kind:'environment',variable:'ZENITH_FIXTURE'}});
  assert.deepEqual(await writeProfile(file,'alpha',entry('ws_a')),{created:'alpha',active:'alpha'});
  assert.deepEqual(await writeProfile(file,'beta',entry('ws_b')),{created:'beta',active:'alpha'});
  assert.deepEqual(await writeProfile(file,'gamma',entry('ws_c'),{activate:true}),{created:'gamma',active:'gamma'});
  const env={ZENITH_PROFILES_FILE:file,ZENITH_FIXTURE:`za_${'X'.repeat(43)}`};
  assert.equal(await resolveProfilesFile(env),file);
  const used=await profileCommand(['use','beta'],env);
  assert.equal(used.active,'beta');assert.equal(used.previous,'gamma');assert.equal(used.restartRequired,false);
  assert.equal((await loadProfiles(file)).active,'beta');
  assert.equal((await controlClient(env)).scope.workspaceId,'ws_b');
  const listed=await profileCommand(['list'],env);
  assert.equal(listed.active,'beta');assert.deepEqual(listed.profiles.map(p=>p.name),['alpha','beta','gamma']);
  await assert.rejects(profileCommand(['use','missing'],env),{code:'profile_missing'});
  await assert.rejects(profileCommand(['use','beta','--name','beta'],env),{code:'usage'});
  assert.equal((await readFile(file,'utf8')).includes('za_'),false);
});

test('Windows reads the default %APPDATA% profiles file and refuses one in a directory with inherited access',{skip:process.platform!=='win32'?'Windows profile ACLs; a skipped POSIX run is not Windows evidence':false,timeout:120000},async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'zenith-profile-appdata-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const appdata=path.join(dir,'Roaming'),file=path.join(appdata,'zenith','profiles.json');
  await writeProfile(file,'vaulted',{origin:'https://zenith.test',scope:{version:1,workspaceId:'w'},credential:{kind:'dpapi',path:path.join(dir,'vault','w.dpapi')}});
  const env={APPDATA:appdata};
  assert.equal(await resolveProfilesFile(env,'win32'),file);
  // Any explicit connection variable still turns the default lookup off.
  assert.equal(await resolveProfilesFile({...env,ZENITH_URL:'https://zenith.test'},'win32'),undefined);
  const client=await controlClient(env);
  assert.equal(client.origin,'https://zenith.test');
  // The temp directory itself inherits its ACL, so a profiles file placed directly in it is refused.
  const {writeFile}=await import('node:fs/promises');
  const loose=path.join(dir,'profiles.json');
  await writeFile(loose,JSON.stringify({version:2,active:'x',profiles:{x:definition}}));
  await assert.rejects(loadProfiles(loose),{code:'profile_acl'});
  await assert.rejects(writeProfile(path.join(dir,'profiles.json'),'y',definition),{code:'profile_acl'});
});
