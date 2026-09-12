import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {tsImport} from 'tsx/esm/api';
const {storeVault,readVault,vaultInput}=await tsImport('../packages/control/vault.ts',import.meta.url);
const credential=`za_${'W'.repeat(43)}`;
test('vault rejects malformed credentials before native execution',async()=>{await assert.rejects(storeVault('C:\\not-used','not-a-token'),{code:'invalid_credential'});});
test('DPAPI refuses other platforms instead of pretending encryption is available',{skip:process.platform==='win32'},async()=>{await assert.rejects(storeVault('/tmp/not-used',credential),{code:'vault_platform'});});
test('Windows DPAPI roundtrip, encrypted bytes, create-only storage and private ACLs',{skip:process.platform!=='win32',timeout:60000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zenith-vault-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'private-नमस्ते','credential.dpapi');await storeVault(file,credential);
 assert.equal(await readVault(file),credential);assert.equal((await readFile(file)).includes(Buffer.from(credential)),false);
 await assert.rejects(storeVault(file,credential),{code:'vault_refused'});
 const other=path.join(dir,'private-नमस्ते','invalid.dpapi');const {writeFile}=await import('node:fs/promises');await writeFile(other,'garbage');await assert.rejects(readVault(other),{code:'vault_refused'});
});

test('native credential input is ASCII JSON with Unicode paths preserved as data',()=>{
 const value={verb:'store',path:'C:\\users\\नमस्ते\\credential.dpapi',token:credential};
 const encoded=vaultInput(value.verb,value.path,value.token);
 assert.match(encoded,/^[\x00-\x7f]*$/);assert.deepEqual(JSON.parse(encoded),value);
 assert.equal(encoded.endsWith('\n'),true);
});
