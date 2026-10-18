import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {posix} from 'node:path';

// Inspect directory records and bounded Markdown only; never execute archive files.
export function verifyCodeZip(bytes){
 let end=-1;for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50){end=at;break;}
 assert(end>=0,'ZIP directory missing');const count=bytes.readUInt16LE(end+10);assert(count>0&&count<1000,'Unexpected archive size');let at=bytes.readUInt32LE(end+16);const entries=[];
 for(let index=0;index<count;index++){assert.equal(bytes.readUInt32LE(at),0x02014b50);const length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),name=bytes.subarray(at+46,at+46+length).toString('utf8'),mode=bytes.readUInt32LE(at+38)>>>16,method=bytes.readUInt16LE(at+10),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),offset=bytes.readUInt32LE(at+42);assert(!name.includes('\\')&&!name.split('/').includes('..'));entries.push({name,mode,method,packed,size,offset});at+=46+length+extra+comment;}
 const prefix=entries.some(entry=>entry.name==='README.md')?'':entries.find(entry=>entry.name.endsWith('/README.md'))?.name.replace(/README\.md$/,'');assert(prefix!==undefined,'README missing');
 const files=new Map(entries.filter(entry=>!entry.name.endsWith('/')).map(entry=>[entry.name.slice(prefix.length),entry]));assert.equal(files.size,entries.filter(entry=>!entry.name.endsWith('/')).length,'Duplicate archive paths');
 for(const [name,entry]of files){assert(entry.name.startsWith(prefix));assert(/^(README\.md$|Windows\/|Mac\/|HTML\/|docs\/|_内部ファイル\/)/.test(name),'Unexpected download file: '+name);assert(!/^docs\/DEVELOPMENT\.md$/.test(name),'Developer guide should stay in Git');if(/\.command$|\/Contents\/MacOS\/|\/起動補助\/_runtime\/GAME-PORTAL-(MAC|MOJAVE)$/.test(name))assert(entry.mode&0o111,'Missing Mac executable permission: '+name);}
 for(const [role,basename]of[['プレイ用','GAME-PORTAL-PLAY'],['クリエイター用','GAME-PORTAL']]){
  for(const path of ['Windows/'+role+'/'+basename+'.exe','HTML/'+role+'/'+basename+'.html','Mac/'+role+'/'+basename+'-MAC.app/Contents/Info.plist','Mac/'+role+'/'+basename+'-MOJAVE.app/Contents/Info.plist','HTML/'+role+'/起動補助/Windowsで起動.cmd','HTML/'+role+'/起動補助/Macで起動.command','HTML/'+role+'/起動補助/古いMacで起動.command'])assert(files.has(path),'Missing entrypoint: '+path);
  for(const platform of ['Windows','Mac','HTML'])for(const name of files.keys())if(name.startsWith(platform+'/'+role+'/')){const leaf=name.slice((platform+'/'+role+'/').length);assert(!leaf.includes('/')||leaf.startsWith('_内部ファイル/')||leaf.startsWith('起動補助/')||platform==='Mac'&&leaf.includes('.app/'),'Unexpected role folder: '+name);if(!leaf.includes('/'))assert(platform==='Windows'?leaf===basename+'.exe':platform==='HTML'?leaf===basename+'.html':false,'Internal file exposed beside app: '+name);}
 }
 assert(files.has('_内部ファイル/GAME-PORTAL-DISTRIBUTION.json'));
 let links=0;for(const [name,file]of files)if(name.endsWith('.md')){
  assert(file.size<=1024*1024,'Guide too large');assert.equal(bytes.readUInt32LE(file.offset),0x04034b50);const start=file.offset+30+bytes.readUInt16LE(file.offset+26)+bytes.readUInt16LE(file.offset+28);assert(start+file.packed<=bytes.length);const raw=bytes.subarray(start,start+file.packed);assert([0,8].includes(file.method));const text=(file.method===0?raw:inflateRawSync(raw,{maxOutputLength:1024*1024})).toString('utf8');
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){const target=match[1].split('#')[0];if(!target||/^[a-z]+:/i.test(target))continue;assert(files.has(posix.normalize(posix.join(posix.dirname(name),target))),'Missing guide link: '+name+' -> '+target);links++;}
 }
 console.log('Code ZIP layout passed: only apps, guides and internal files; no development code; one Windows/HTML entrypoint per role; Mac permissions and '+links+' guide links preserved.');return files;
}
if(process.argv[1]?.endsWith('verify-code-zip.mjs'))verifyCodeZip(await readFile(process.argv[2]));
