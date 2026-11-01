import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import path from 'node:path';

// Generate assets in memory, then write synchronously. This also works on
// Windows environments where Rollup's concurrent async writes return EBADF.
const outDir=path.resolve('release');
const results=await build({
 configFile:false,
 plugins:[react()],
 build:{write:false,outDir}
});
for(const result of [results].flat()){
 for(const file of result.output){
  const destination=path.resolve(outDir,file.fileName);
  if(!destination.startsWith(outDir+path.sep))throw new Error('Invalid build output path.');
  mkdirSync(path.dirname(destination),{recursive:true});
  writeFileSync(destination,file.type==='asset'?file.source:file.code);
  console.log('Wrote '+path.relative(outDir,destination));
 }
}
console.log('Build complete: release/');
copyFileSync(path.resolve('public/sw.js'),path.join(outDir,'sw.js'));
