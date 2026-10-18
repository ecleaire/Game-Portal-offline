import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const lock=JSON.parse(await readFile(new URL('./macos/cef-lock.json',import.meta.url),'utf8'));
export async function verifyEngineTarget(target,arch,load){
 assert(target&&lock.targets[arch],'Unknown Mac engine architecture');
 assert.equal(target.sdkSHA256,lock.targets[arch].sha256,'Unpinned Mac engine SDK');
 assert(Number.isSafeInteger(target.size)&&target.size>0&&target.size<=300*1024*1024,'Invalid Mac engine size');
 assert(/^[a-f0-9]{64}$/.test(target.sha256),'Invalid Mac engine hash');
 assert(Array.isArray(target.parts)&&target.parts.length>0&&target.parts.length<=8,'Invalid Mac engine parts');
 let total=0;const hash=createHash('sha256');
 for(const [index,part]of target.parts.entries()){
  assert.equal(part.name,'engine.part'+String(index).padStart(2,'0'),'Invalid Mac engine part path');
  assert(Number.isSafeInteger(part.size)&&part.size>0&&part.size<=40*1024*1024,'Mac engine part exceeds download bounds');
  const bytes=await load('Mac/_内部ファイル/engine/'+arch+'/'+part.name,40*1024*1024);
  assert.equal(bytes.length,part.size,'Truncated Mac engine part');assert.equal(digest(bytes),part.sha256,'Mac engine part checksum differs');
  total+=bytes.length;hash.update(bytes);
 }
 assert.equal(total,target.size,'Incomplete Mac engine');assert.equal(hash.digest('hex'),target.sha256,'Mac engine checksum differs');
}
export async function verifyMacEngineFiles(load,exists){
 const seen=new Map();
 for(const [role,base]of [['プレイ用','GAME-PORTAL-PLAY'],['クリエイター用','GAME-PORTAL']])for(const suffix of ['MAC','MOJAVE']){
  const resources='Mac/'+role+'/'+base+'-'+suffix+'.app/Contents/Resources/';
  assert(!await exists(resources+'origin.json'),'Private Mac origin must never be distributed');
  const manifest=JSON.parse((await load(resources+'engine.json',16384)).toString('utf8'));
  assert.equal(manifest.schema,1);assert.equal(manifest.kind,'cef-offline-v1');
  assert.deepEqual(Object.keys(manifest.targets).sort(),suffix==='MAC'?['arm64','x86_64']:['x86_64']);
  for(const [arch,target]of Object.entries(manifest.targets)){
   const value=JSON.stringify(target);if(seen.has(arch)){assert.equal(value,seen.get(arch),'Mac editions must use the same bundled engine');continue;}
   await verifyEngineTarget(target,arch,load);seen.set(arch,value);
  }
 }
 console.log('Mac offline engines verified: pinned SDKs, bounded complete parts, matching four apps, no private origin.');
}
export async function verifyMacEngines(root=process.cwd()){
 const load=async(path,max)=>{const file=join(root,path),info=await lstat(file);assert(info.isFile()&&!info.isSymbolicLink()&&info.size<=max,'Invalid engine distribution file: '+path);return readFile(file);};
 await verifyMacEngineFiles(load,async path=>{try{await lstat(join(root,path));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}});
}
if(process.argv[1]===fileURLToPath(import.meta.url))await verifyMacEngines();
