import {verifySwiftRuntimeFiles} from './macos/swift-runtime.mjs';
import {materializeDistribution} from './distribution.mjs';
await materializeDistribution();
import {readFile} from 'node:fs/promises';
import {MAC_MINIMUM,verifyMacMinimum,verifyMacImageMinimum} from './mac-system.mjs';
import {macDesktopPage} from './macos/desktop-page.mjs';
import {macDesktopManifest} from './build-mac-apps.mjs';
const version=JSON.parse(await readFile('package.json','utf8')).version;
for(const edition of ['creator','player']){
 const htmlFile=edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html',html=await readFile(htmlFile);
 if(!html.equals(await readFile('offline-release/'+htmlFile)))throw Error('Edition HTML differs from tested build: '+edition);
 if(!html.includes(Buffer.from('>v'+version+'</span>')))throw Error('Edition version differs: '+edition);
 if(html.includes(Buffer.from('<html lang="ja" data-edition="player">'))!==(edition==='player'))throw Error('Edition role mismatch');
 for(const suffix of ['MAC','MOJAVE']){
  const name=(edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+suffix,base=name+'.app/Contents/',info=await readFile(base+'Info.plist','utf8');
  if(!info.includes('<key>LSUIElement</key>')||!info.includes('<key>GamePortalEdition</key><string>'+edition+'</string>')||!info.includes('<string>'+version+'</string>'))throw Error('Mac app edition/version differs: '+name);
  if(!(await readFile(base+'Resources/GAME-PORTAL.html')).equals(html))throw Error('Mac app embeds incorrect edition HTML: '+name);
  if(!info.includes('<key>GamePortalStandalone</key><true/>')||!info.includes('<key>LSUIElement</key><false/>'))throw Error('Mac app must open its own native window: '+name);
  const expected=await macDesktopPage(html.toString(),(await readFile('desktop/bootstrap.js','utf8')).replaceAll('\r\n','\n'),await readFile('THIRD-PARTY-LICENSES.txt','utf8'));
  if(await readFile(base+'Resources/GAME-PORTAL-DESKTOP.html','utf8')!==expected)throw Error('Mac standalone page differs: '+name);
  if(await readFile(base+'Resources/build.json','utf8')!==JSON.stringify(await macDesktopManifest(process.cwd(),version,edition))+'\n')throw Error('Mac standalone source manifest differs: '+name);
  if(!(await readFile(base+'Resources/THIRD-PARTY-LICENSES.txt')).equals(await readFile('THIRD-PARTY-LICENSES.txt')))throw Error('Mac app license differs: '+name);
  const binary=await readFile(base+'MacOS/GAME-PORTAL-'+suffix);
  if(!info.includes('<key>LSMinimumSystemVersion</key><string>'+MAC_MINIMUM+'</string>'))throw Error('Mac app minimum OS differs: '+name);
  if(suffix==='MAC')verifyMacMinimum(binary);else verifyMacImageMinimum(binary);
  await verifySwiftRuntimeFiles(async(path,max)=>{const bytes=await readFile(path);if(bytes.length>max)throw Error('Oversized Swift runtime');return bytes;},base+'Frameworks');
  if(binary.length<32||!binary.includes(Buffer.from(version)))throw Error('Mac app executable/version missing: '+name);
 }
}
console.log('Both editions verified: matching tested HTML, four Mac app roles/resources/versions/licenses.');

for(const suffix of ['MAC','MOJAVE'])await verifySwiftRuntimeFiles(async(path,max)=>{const bytes=await readFile(path);if(bytes.length>max)throw Error('Oversized Swift runtime');return bytes;},'offline-release/Swift-'+suffix);
