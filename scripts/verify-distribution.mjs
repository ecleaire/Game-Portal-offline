import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=JSON.parse(await readFile('package.json','utf8')).version;
const rootHTML=await readFile('GAME-PORTAL.html');
if(digest(rootHTML)!==digest(await readFile('offline-release/GAME-PORTAL.html')))throw Error('Code ZIP root HTML differs from the tested build. Run npm run build.');
if(!rootHTML.includes(Buffer.from('>v'+version+'</span>'))||!rootHTML.includes(Buffer.from('<script id="folderConnection" type="application/json">null</script>')))throw Error('Code ZIP HTML has an incorrect version or a personal folder connection.');
if(digest(await readFile('THIRD-PARTY-LICENSES.txt'))!==digest(await readFile('offline-release/THIRD-PARTY-LICENSES.txt')))throw Error('Root runtime licenses differ.');
if(!await readFile('README.md','utf8').then(text=>text.includes('バージョン：**'+version+'**')))throw Error('README version differs.');
const rootHelper=await readFile('GAME-PORTAL-WINDOWS.exe');
if(!rootHelper.subarray(0,2).equals(Buffer.from('MZ'))||!rootHelper.includes(Buffer.from(version,'utf16le')))throw Error('The Code ZIP Windows helper is missing, corrupt or from another version. Rebuild on Windows.');
if(await readFile('README-WINDOWS.txt','utf8')!==(await readFile('docs/WINDOWS_EXE.md','utf8')).replaceAll('\r\n','\n'))throw Error('Windows guide differs from the built UTF-8 guide.');
const mac=await readFile('GAME-PORTAL-MAC');
if(mac.readUInt32BE(0)!==0xcafebabe||mac.readUInt32BE(4)!==2||!mac.includes(Buffer.from(version)))throw Error('Mac universal helper is missing or from another version.');
const architectures=new Set();
for(let i=0;i<2;i++){
 const record=8+i*20,cpu=mac.readUInt32BE(record),offset=mac.readUInt32BE(record+8),size=mac.readUInt32BE(record+12);
 if(offset+size>mac.length||mac.readUInt32LE(offset)!==0xfeedfacf)throw Error('Mac architecture is corrupt.');
 architectures.add(cpu);let command=offset+32,minimum=null;
 for(let n=0;n<mac.readUInt32LE(offset+16);n++){
  const type=mac.readUInt32LE(command),length=mac.readUInt32LE(command+4);if(length<8||command+length>offset+size)throw Error('Mac load command is corrupt.');
  if(type===0x32)minimum=mac.readUInt32LE(command+12);command+=length;
 }
 if(minimum===null||minimum>0x000c0000)throw Error('Mac helper requires a system newer than macOS 12.');
}
if(!architectures.has(0x01000007)||!architectures.has(0x0100000c))throw Error('Mac helper must support Intel and Apple silicon.');
const macCommand=await readFile('GAME-PORTAL-MAC.command','utf8');if(!macCommand.startsWith('#!/bin/zsh\n')||macCommand.includes('\r'))throw Error('Mac entry point must retain Unix line endings.');
try{const helper=await readFile('offline-release/GAME-PORTAL-WINDOWS.exe');if(digest(helper)!==digest(await readFile('GAME-PORTAL-WINDOWS.exe')))throw Error('Root Windows helper differs from the tested build.');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Code ZIP distribution verified: root HTML v'+version+', matching build and licenses, Windows helper, Intel/Apple silicon macOS 12+ helper, no personal folder connection.');
await import('./verify-desktop.mjs');
await import('./verify-mojave.mjs');
