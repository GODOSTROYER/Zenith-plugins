import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
const {remoteConfiguration}=await tsImport('../packages/control/remote.ts',import.meta.url);
const {vaultFailureStage}=await tsImport('../packages/control/vault.ts',import.meta.url);

test('OAuth bootstrap needs only trusted origin and explicit selection, not an access token',async()=>{
 const result=await remoteConfiguration({ZENITH_URL:'https://zenith.example',ZENITH_WORKSPACE_ID:'ws',ZENITH_PROJECT_ID:'project',ZENITH_ENVIRONMENT_ID:'prod'});
 assert.equal(result.claude.mcpServers.zenith.url,'https://zenith.example/api/agent/v2/mcp?workspace=ws&project=project&environment=prod');
 assert.match(result.codexToml,/\[mcp_servers\.zenith\]/);
 assert.equal(Object.keys(result.claude.mcpServers.zenith).sort().join(','),'type,url');
});
test('remote config neither reads nor embeds supplied credential sources',async()=>{
 const marker='private-credential-that-must-not-be-read';
 const env={ZENITH_URL:'https://zenith.example',ZENITH_WORKSPACE_ID:'ws',ZENITH_TOKEN_FILE:'/does/not/exist',ZENITH_TOKEN_VAULT:'C:\\does-not-exist'};
 Object.defineProperty(env,'ZENITH_TOKEN',{get(){throw Error(marker);}});
 assert.equal(JSON.stringify(await remoteConfiguration(env)).includes(marker),false);
});
test('remote bootstrap rejects insecure, ambiguous and incomplete selections',async()=>{
 for(const env of [{}, {ZENITH_URL:'http://127.0.0.1:3400',ZENITH_WORKSPACE_ID:'ws'},
  {ZENITH_URL:'https://attacker.example/path',ZENITH_WORKSPACE_ID:'ws'},
  {ZENITH_URL:'https://zenith.example',ZENITH_WORKSPACE_ID:'ws',ZENITH_ENVIRONMENT_ID:'prod'},
  {ZENITH_URL:'https://zenith.example',ZENITH_WORKSPACE_ID:'ws',ZENITH_CONFIG_FILE:'/unused'},
  {ZENITH_PROFILES_FILE:'/unused',ZENITH_URL:'https://zenith.example'}])await assert.rejects(remoteConfiguration(env));
});
test('vault diagnostics expose only fixed stage names, never arbitrary native output',()=>{
 assert.equal(vaultFailureStage('zenith-vault:verify_directory\r\n'),'verify_directory');
 for(const input of ['','native secret body','zenith-vault:my_secret','zenith-vault:decrypt\nprivate-token','#< CLIXML secret'])assert.equal(vaultFailureStage(input),'unavailable');
});
