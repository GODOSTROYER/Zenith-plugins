/** Deterministic, explicit source packaging. The authoritative source contract is revalidated by Zenith. */
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ClientError } from '../client/dist/index.js';
const roots=new Set(['index.html','zenith.app.json','package.json','README.md']);
const extensions=new Set(['.ts','.tsx','.js','.jsx','.css','.json','.svg','.png','.jpg','.jpeg','.webp','.ico','.woff2','.txt','.md']);
const secret=/(?:-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\bza_[A-Za-z0-9_-]{43}\b|\bAKIA[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b)/;
interface File {path:string;bytes:Buffer}
export interface SourceArchive {bytes:Buffer;sha256:string;files:{path:string;bytes:number;sha256:string}[];totalBytes:number}
function safe(path:string):void{
  if(!path||path.length>200||path.split('/').length>12||path.startsWith('/')||path.includes('\\')||path.includes(':')||path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new ClientError('unsafe_source_path','Source paths must be bounded relative paths without hidden entries, traversal, devices or symlinks.');
  if(/(^|\/)node_modules(\/|$)|(^|\/)tsconfig[^/]*\.json$|\.config\.[cm]?[jt]s$|(^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path))throw new ClientError('unsupported_source_path','Build configuration, lockfiles and installed dependencies are not source-contract inputs.');
  if(!/^[A-Za-z0-9_./-]+$/.test(path))throw new ClientError('unsupported_source_path','This portable source packer requires ASCII paths.');
}
function tar(files:File[]):Buffer{
  const parts:Buffer[]=[];
  for(const file of files){const h=Buffer.alloc(512);let name=file.path,prefix='';if(Buffer.byteLength(name)>100){const at=name.lastIndexOf('/');prefix=name.slice(0,at);name=name.slice(at+1);if(at<0||Buffer.byteLength(prefix)>155||Buffer.byteLength(name)>100)throw new ClientError('source_path_long','Shorten this source path.');}
    h.write(name,0,100,'utf8');h.write('0000644\0',100,8,'ascii');h.write('0000000\0',108,8,'ascii');h.write('0000000\0',116,8,'ascii');h.write(file.bytes.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');h.write('00000000000\0',136,12,'ascii');h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6,'ascii');h.write('00',263,2,'ascii');h.write(prefix,345,155,'utf8');const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');parts.push(h,file.bytes,Buffer.alloc((512-file.bytes.length%512)%512));
  }parts.push(Buffer.alloc(1024));const archive=gzipSync(Buffer.concat(parts),{level:9});archive[9]=255;return archive;
}
export async function packageSource(root:string,includes:string[]):Promise<SourceArchive>{
  if(!isAbsolute(root)||!includes.length)throw new ClientError('source_selection','Choose an absolute source root and explicit --include entries.');
  const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new ClientError('unsafe_source_root','Choose the actual source directory, not a symlink.');
  const realRoot=await realpath(root),files:File[]=[],seen=new Set<string>(),directories=new Set<string>();let total=0;
  const walk=async(path:string):Promise<void>=>{
    safe(path);const absolute=resolve(realRoot,path),inside=relative(realRoot,absolute);if(inside==='..'||inside.startsWith(`..${sep}`)||isAbsolute(inside))throw new ClientError('unsafe_source_path','Path escapes the source root.');
    // Check every component, not only the final file.
    let cursor=realRoot;for(const component of path.split('/')){cursor=resolve(cursor,component);if((await lstat(cursor)).isSymbolicLink())throw new ClientError('source_symlink','Source symlinks are not accepted.');}
    const before=await lstat(absolute,{bigint:true});if(before.isDirectory()){if(directories.has(path))return;directories.add(path);if(directories.size>1000)throw new ClientError('source_too_large','Source selection traverses too many directories.');if(!['src','public'].includes(path.split('/')[0]!))throw new ClientError('unsupported_source','Only src/ and public/ directories are supported.');for(const e of (await readdir(absolute)).sort())await walk(`${path}/${e}`);return;}
    if(!before.isFile()||before.nlink!==1n||before.size>2n*1024n*1024n)throw new ClientError('unsafe_source_file','Source must contain single-link regular files no larger than 2 MiB.');
    if(!roots.has(path)&&(!['src','public'].includes(path.split('/')[0]!)||!extensions.has(extname(path))))throw new ClientError('unsupported_source','Source contains a file outside the supported frontend contract.');
    if(seen.has(path))return;seen.add(path);if(files.length>=500||total+Number(before.size)>5*1024*1024)throw new ClientError('source_too_large','Source exceeds 500 files or 5 MiB.');
    const handle=await open(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW??0));let bytes:Buffer;
    try{const opened=await handle.stat({bigint:true}),resolved=await realpath(absolute);if(opened.ino!==before.ino||opened.size!==before.size||(process.platform!=='win32'&&opened.dev!==before.dev)||(!resolved.startsWith(realRoot+sep)))throw new ClientError('source_changed','Source changed while being selected. Retry after edits stop.');
      bytes=Buffer.alloc(Number(before.size)+1);let bytesRead=0;while(bytesRead<bytes.length){const read=await handle.read(bytes,bytesRead,bytes.length-bytesRead,bytesRead);if(!read.bytesRead)break;bytesRead+=read.bytesRead;}if(bytesRead!==Number(before.size))throw new ClientError('source_changed','Source size changed while packaging.');bytes=bytes.subarray(0,bytesRead);
    }finally{await handle.close();}
    if(secret.test(bytes.toString('utf8')))throw new ClientError('source_secret','A known credential/private-key pattern was detected. Remove it and use server-side secret references.');
    total+=bytes.length;files.push({path,bytes});
  };
  for(const entry of includes)await walk(entry);for(const required of ['index.html','zenith.app.json'])if(!seen.has(required))throw new ClientError('source_required',`Explicitly include ${required}.`);
  const manifest=JSON.parse(files.find(f=>f.path==='zenith.app.json')!.bytes.toString('utf8')) as Record<string,unknown>;
  if(manifest.contract!==1||manifest.schema!==1||typeof manifest.name!=='string'||Object.keys(manifest).some(k=>!['contract','schema','name','entry'].includes(k)))throw new ClientError('source_contract','Use the Zenith frontend source contract version 1.');
  const pkg=files.find(f=>f.path==='package.json');if(pkg){const p=JSON.parse(pkg.bytes.toString('utf8')) as Record<string,unknown>;if(Object.keys(p).some(k=>!['name','version','private','type','dependencies'].includes(k))||typeof p.dependencies==='object'&&p.dependencies!==null&&Object.keys(p.dependencies).some(k=>!['react','react-dom'].includes(k)))throw new ClientError('source_recipe','Submitted scripts, build configuration, and extra dependencies are not supported.');}
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const bytes=tar(files);return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),totalBytes:total,files:files.map(f=>({path:f.path,bytes:f.bytes.length,sha256:createHash('sha256').update(f.bytes).digest('hex')}))};
}
