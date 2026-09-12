/** Local source edit only; does not commit, tag, install, or publish. */
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),version=process.argv[2];
if(process.argv.length!==3||!version||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version))throw Error('Use npm run version:prepare -- VERSION.');
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
for(const name of ['packages/bridge/doctor.mjs','packages/control/server.ts']){
 const file=new URL(name,root),before=await readFile(file,'utf8');if(!before.includes(`'${pkg.version}'`))throw Error('Unexpected source version; resolve it explicitly.');
 await writeFile(file,before.replaceAll(`'${pkg.version}'`,`'${version}'`));
}
pkg.version=version;await writeFile(new URL('package.json',root),JSON.stringify(pkg,null,2)+'\n');
console.log('Updated source version markers only. Update the lockfile/changelog, build and verify before committing. No release was created.');
