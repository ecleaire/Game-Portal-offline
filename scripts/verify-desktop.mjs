import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {desktopPage} from '../desktop/page.mjs';
import {desktopBuildInfo} from '../desktop/build-info.mjs';
const root=resolve(import.meta.dirname,'..');
for(const edition of ['creator','player']){
const filename=edition==='player'?'GAME-PORTAL-PLAY':'GAME-PORTAL';
const exe=await readFile(resolve((edition==='creator'?process.env.PORTAL_DESKTOP_EXE:process.env.PORTAL_DESKTOP_PLAYER_EXE)||resolve(root,filename+'.exe'))),config=JSON.parse(await readFile(resolve(root,'desktop/desktop.json'),'utf8')),licenses=await readFile(resolve(root,'DESKTOP-LICENSES.txt'),'utf8');
if(!exe.subarray(0,2).equals(Buffer.from('MZ'))||!exe.includes(Buffer.from(config.version,'utf16le')))throw Error('Desktop executable/version is invalid');
if(!exe.includes(Buffer.from(await desktopBuildInfo(root,licenses,edition))))throw Error('Desktop executable was built from different source or HTML. Rebuild it.');
const page=desktopPage((await readFile(resolve(root,filename+'.html'),'utf8')).replaceAll('\r\n','\n'),(await readFile(resolve(root,'desktop/bootstrap.js'),'utf8')).replaceAll('\r\n','\n'),licenses);
if(!exe.includes(Buffer.from(page)))throw Error('Desktop embedded page differs from the source');
console.log('Desktop distribution verified: '+config.version+', complete embedded launcher '+config.launcherVersion+', source hashes and licenses.');

}
