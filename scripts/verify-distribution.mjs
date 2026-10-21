import {materializeDistribution} from './distribution.mjs';
import {verifyMacMinimum} from './mac-system.mjs';
await materializeDistribution();
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=JSON.parse(await readFile('package.json','utf8')).version;
const rootHTML=await readFile('GAME-PORTAL.html');
if(digest(rootHTML)!==digest(await readFile('offline-release/GAME-PORTAL.html')))throw Error('Code ZIP root HTML differs from the tested build. Run npm run build.');
if(!rootHTML.includes(Buffer.from('>v'+version+'</span>'))||!rootHTML.includes(Buffer.from('<script id="folderConnection" type="application/json">null</script>')))throw Error('Code ZIP HTML has an incorrect version or a personal folder connection.');
if(digest(await readFile('THIRD-PARTY-LICENSES.txt'))!==digest(await readFile('offline-release/THIRD-PARTY-LICENSES.txt')))throw Error('Root runtime licenses differ.');
if(!await readFile('README.md','utf8').then(text=>text.includes('バージョン：**'+version+'**')))throw Error('README version differs.');
if(!await readFile('README.md','utf8').then(text=>text.includes('/archive/refs/tags/v'+version+'.zip')))throw Error('README download tag must match the distribution version.');
for(const guide of ['README.md','docs/OFFLINE_HTML.md','docs/TRANSFER_GUIDE.md','docs/DEVELOPMENT.md']){
 const text=await readFile(guide,'utf8');
 for(const match of text.matchAll(/https:\/\/github\.com\/ecleaire\/Game-Portal-offline\/archive\/refs\/tags\/v([^/]+)\.zip/g))if(match[1]!==version)throw Error('Download tag differs from the distribution version: '+guide);
}
const rootHelper=await readFile('GAME-PORTAL-WINDOWS.exe');
if(!rootHelper.subarray(0,2).equals(Buffer.from('MZ'))||!rootHelper.includes(Buffer.from(version,'utf16le')))throw Error('The Code ZIP Windows helper is missing, corrupt or from another version. Rebuild on Windows.');
if(await readFile('README-WINDOWS.txt','utf8')!==(await readFile('docs/WINDOWS_EXE.md','utf8')).replaceAll('\r\n','\n'))throw Error('Windows guide differs from the built UTF-8 guide.');
const mac=await readFile('GAME-PORTAL-MAC');
if(mac.readUInt32BE(0)!==0xcafebabe||mac.readUInt32BE(4)!==2||!mac.includes(Buffer.from(version)))throw Error('Mac universal helper is missing or from another version.');
verifyMacMinimum(mac);
const macCommand=await readFile('GAME-PORTAL-MAC.command','utf8');if(!macCommand.startsWith('#!/bin/zsh\n')||macCommand.includes('\r'))throw Error('Mac entry point must retain Unix line endings.');
try{const helper=await readFile('offline-release/GAME-PORTAL-WINDOWS.exe');if(digest(helper)!==digest(await readFile('GAME-PORTAL-WINDOWS.exe')))throw Error('Root Windows helper differs from the tested build.');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Code ZIP distribution verified: root HTML v'+version+', matching build and licenses, Windows helper, Intel macOS 10.14.6 / Apple silicon macOS 11+ helper, no personal folder connection.');
await import('./verify-desktop.mjs');
await import('./verify-mojave.mjs');
await import('./verify-editions.mjs');
await import('./verify-mac-engines.mjs').then(module=>module.verifyMacEngines());

await import('./distribution.mjs').then(module=>module.verifyPublishedDistribution());
