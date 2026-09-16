import type { ZenithClient } from '../client/dist/index.js';
export function readBoundedFile(path:string,maxBytes:number,privateFile?:boolean,aclVerified?:boolean):Promise<string>;
export function readCredential(path:string):Promise<string>;
export function configuredClient(env?:NodeJS.ProcessEnv):Promise<ZenithClient>;
