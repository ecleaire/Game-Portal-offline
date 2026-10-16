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
await readFile('README-WINDOWS.txt');
try{const helper=await readFile('offline-release/GAME-PORTAL-WINDOWS.exe');if(digest(helper)!==digest(await readFile('GAME-PORTAL-WINDOWS.exe')))throw Error('Root Windows helper differs from the tested build.');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log('Code ZIP distribution verified: root HTML v'+version+', matching build and licenses, Windows helper, no personal folder connection.');
