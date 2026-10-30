import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyMacImageMinimum} from '../mac-system.mjs';

// Swift 5 is included in macOS from 10.14.4. Earlier Mojave versions need
// the compiler's redistributable runtime beside the app/helper, offline.
export function swiftRuntimeLinkFlags(directory){
 if(!['../Frameworks','Swift-MAC','Swift-MOJAVE'].includes(directory))throw Error('Invalid Swift runtime location');
 return ['-Xlinker','-rpath','-Xlinker','@executable_path/'+directory];
}
export async function bundleSwiftRuntime(binary,destination){
 if(process.platform!=='darwin')throw Error('Swift runtimes must be collected on macOS.');
 await rm(destination,{recursive:true,force:true});await mkdir(destination,{recursive:true});
 execFileSync('xcrun',['swift-stdlib-tool','--copy','--platform','macosx','--scan-executable',binary,'--destination',destination,'--resource-destination',destination],{stdio:'inherit'});
 const libraries=(await readdir(destination)).filter(name=>/^libswift[A-Za-z0-9_]+\.dylib$/.test(name));
 if(!libraries.includes('libswiftCore.dylib'))throw Error('The build toolchain lacks the Swift runtime required by macOS 10.14.0–10.14.3. Do not publish a 10.14 build without it.');
 for(const name of libraries){verifyMacImageMinimum(await readFile(join(destination,name)));execFileSync('codesign',['--force','--sign','-','--timestamp=none',join(destination,name)],{stdio:'inherit'});}
 await copyFile(new URL('SWIFT-RUNTIME-LICENSE.txt',import.meta.url),join(destination,'SWIFT-RUNTIME-LICENSE.txt'));
 const files=[];for(const name of [...libraries,'SWIFT-RUNTIME-LICENSE.txt']){const bytes=await readFile(join(destination,name));files.push({name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 await writeFile(join(destination,'runtime.json'),JSON.stringify({schema:1,kind:'swift-mojave-v1',files})+'\n');
 await verifySwiftRuntimeFiles(async(path,max)=>{const bytes=await readFile(path);if(bytes.length>max)throw Error('Oversized Swift runtime');return bytes;},destination);
 console.log('Bundled and checked Swift runtime for initial Mojave: '+libraries.length+' libraries.');
}


export async function verifySwiftRuntimeFiles(read,base){
 const manifest=JSON.parse((await read(base+'/runtime.json',16384)).toString());
 if(manifest.schema!==1||manifest.kind!=='swift-mojave-v1'||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>80)throw Error('Invalid bundled Swift runtime manifest');
 const names=new Set();
 for(const file of manifest.files){
  if(!file||typeof file.name!=='string'||!(/^(libswift[A-Za-z0-9_]+\.dylib|SWIFT-RUNTIME-LICENSE\.txt)$/.test(file.name))||names.has(file.name)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>100*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid bundled Swift runtime entry');
  names.add(file.name);const bytes=await read(base+'/'+file.name,100*1024*1024);
  if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Bundled Swift runtime is incomplete: '+file.name);
  if(file.name.endsWith('.dylib')){const images=verifyMacImageMinimum(bytes);if(file.name==='libswiftCore.dylib'&&!images.has(0x01000007))throw Error('Intel Swift runtime missing');}
 }
 if(!names.has('libswiftCore.dylib')||!names.has('SWIFT-RUNTIME-LICENSE.txt'))throw Error('Required Swift runtime/license missing');
}
