import {readFile} from 'node:fs/promises';
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
  if(!(await readFile(base+'Resources/THIRD-PARTY-LICENSES.txt')).equals(await readFile('THIRD-PARTY-LICENSES.txt')))throw Error('Mac app license differs: '+name);
  const binary=await readFile(base+'MacOS/GAME-PORTAL-'+suffix);
  if(binary.length<32||!binary.includes(Buffer.from(version)))throw Error('Mac app executable/version missing: '+name);
 }
}
console.log('Both editions verified: matching tested HTML, four Mac app roles/resources/versions/licenses.');
