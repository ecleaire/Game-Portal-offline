import {readFile,writeFile,mkdir,stat,rename,rm} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
export async function prepareCEF(arch,{recordIntegrity=false}={}){
 const lock=JSON.parse(await readFile(new URL('./macos/cef-lock.json',import.meta.url),'utf8')),target=lock.targets[arch];
 if(!target)throw Error('Unknown CEF architecture');
 if(!target.sha256&&!recordIntegrity)throw Error('Pin the independently observed CEF SHA256 before building a distribution.');
 const cache=resolve('.tools/cef'),name='cef_binary_'+lock.version+'_'+target.platform+'_minimal',archive=join(cache,name+'.tar.bz2'),sdk=join(cache,name);
 await mkdir(cache,{recursive:true});
 const integrity=async file=>{const sha1=createHash('sha1'),sha256=createHash('sha256');let size=0;for await(const chunk of createReadStream(file)){size+=chunk.length;if(size>target.size)throw Error('CEF official archive size differs');sha1.update(chunk);sha256.update(chunk);}const observed=sha256.digest('hex');if(size!==target.size||sha1.digest('hex')!==target.sha1||target.sha256&&observed!==target.sha256)throw Error('CEF official archive checksum differs');return observed;};
 let observed;try{observed=await integrity(archive);}catch{
  // A cancelled download or a damaged cache must not poison future builds.
  // Only these fixed, derived archive paths can be replaced.
  const partial=archive+'.part';await rm(partial,{force:true});
  try{
  const response=await fetch('https://cef-builds.spotifycdn.com/'+encodeURIComponent(name)+'.tar.bz2',{signal:AbortSignal.timeout(1200000)});if(!response.ok)throw Error('CEF official download '+response.status);
  let size=0,last=0;const progress=new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>target.size){done(Error('Unexpected CEF archive size'));return;}if(Date.now()-last>30000){last=Date.now();console.log('CEF '+arch+' downloaded '+Math.round(size/1048576)+' MB');}done(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),progress,createWriteStream(partial,{flags:'wx'}));
  observed=await integrity(partial);await rename(partial,archive);
  }finally{await rm(partial,{force:true});}
 }
 console.log('CEF integrity '+arch+' SHA256 '+observed);
 if(process.platform==='darwin'){
  const receipt=join(sdk,'.portal-sdk-sha256');
  if(await readFile(receipt,'utf8').catch(()=>null)!==observed){
   if(!sdk.startsWith(cache+'/')&&!sdk.startsWith(cache+'\\'))throw Error('SDK extraction path is outside cache');
   await rm(sdk,{recursive:true,force:true});execFileSync('tar',['-xjf',archive,'-C',cache],{stdio:'inherit'});await stat(join(sdk,'include/cef_app.h'));await writeFile(receipt,observed);
  }
 }
 return {sdk,archive,sha256:observed,version:lock.version};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))for(const arch of process.argv.includes('--all')?['x86_64','arm64']:[process.arch==='arm64'?'arm64':'x86_64'])await prepareCEF(arch,{recordIntegrity:process.argv.includes('--record-integrity')});
