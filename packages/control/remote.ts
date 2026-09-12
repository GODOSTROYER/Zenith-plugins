/** Native OAuth bootstrap never requires or reads the credential it is meant to acquire. */
import { association, endpoint, ClientError, type Association } from '../client/dist/index.js';
import { loadProfiles } from './profiles.js';

export async function remoteConfiguration(env:NodeJS.ProcessEnv=process.env):Promise<{
  claude:{mcpServers:{zenith:{type:'http';url:string}}};
  codexToml:string;
  authentication:string;
}> {
  let origin:string, scope:Association;
  if(env.ZENITH_PROFILES_FILE){
    const conflicting=['ZENITH_URL','ZENITH_WORKSPACE_ID','ZENITH_PROJECT_ID','ZENITH_ENVIRONMENT_ID','ZENITH_CONFIG_FILE',
      'ZENITH_TOKEN_FILE','ZENITH_TOKEN_VAULT','ZENITH_CREDENTIAL_KIND','ZENITH_ALLOW_WRITES','ZENITH_ALLOW_LOOPBACK_HTTP'];
    if(conflicting.some(key=>env[key]!==undefined))throw new ClientError('ambiguous_configuration','Use one named profile or explicit connection settings, not both.');
    const profiles=await loadProfiles(env.ZENITH_PROFILES_FILE),name=env.ZENITH_PROFILE??profiles.active;
    const selected=Object.hasOwn(profiles.profiles,name)?profiles.profiles[name]:undefined;
    if(!selected)throw new ClientError('profile_missing','Select an existing named connection.');
    origin=endpoint(selected.origin,selected.allowLoopbackHttp).origin;scope=association(selected.scope);
  }else{
    if(env.ZENITH_PROFILE||env.ZENITH_CONFIG_FILE)throw new ClientError('ambiguous_configuration','Select a v2 named profile explicitly; no legacy profile is inherited.');
    if(!env.ZENITH_URL)throw new ClientError('configuration','Set a trusted HTTPS ZENITH_URL and explicit scope IDs. No token is required for remote-config.');
    origin=endpoint(env.ZENITH_URL).origin;
    scope=association({version:1,workspaceId:env.ZENITH_WORKSPACE_ID,
      ...(env.ZENITH_PROJECT_ID?{projectId:env.ZENITH_PROJECT_ID}:{}),
      ...(env.ZENITH_ENVIRONMENT_ID?{environmentId:env.ZENITH_ENVIRONMENT_ID}:{})});
  }
  if(!origin.startsWith('https://'))throw new ClientError('remote_requires_https','Remote OAuth configuration requires HTTPS.');
  const url=new URL('/api/agent/v2/mcp',origin);url.searchParams.set('workspace',scope.workspaceId);
  if(scope.projectId)url.searchParams.set('project',scope.projectId);
  if(scope.environmentId)url.searchParams.set('environment',scope.environmentId);
  return {
    claude:{mcpServers:{zenith:{type:'http',url:url.href}}},
    codexToml:`[mcp_servers.zenith]\nurl = ${JSON.stringify(url.href)}\n`,
    authentication:'Use the native client OAuth flow and a matching resource grant in Zenith. This command reads no credential and makes no network request.',
  };
}
