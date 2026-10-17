import {materializeDistribution,publishDistribution} from './distribution.mjs';
await materializeDistribution();
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Mac版のビルドはmacOSで実行してください。');
const root=resolve(import.meta.dirname,'..'),output=join(root,'offline-release','.mac-build');
await mkdir(output,{recursive:true});
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const source=join(output,'native-launcher.swift');await writeFile(source,(await readFile(join(root,'scripts/macos/native-launcher.swift'),'utf8')).replace('__VERSION__',version));
for(const arch of ['x86_64','arm64'])execFileSync('xcrun',['swiftc','-swift-version','5','-D','MOJAVE','-O','-target',arch+'-apple-macosx12.0',source,'-o',join(output,arch)],{stdio:'inherit'});
execFileSync('xcrun',['lipo','-create',join(output,'x86_64'),join(output,'arm64'),'-output',join(root,'GAME-PORTAL-MAC')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-','--timestamp=none',join(root,'GAME-PORTAL-MAC')],{stdio:'inherit'});
console.log('Mac helper built: v'+version+', universal Intel / Apple silicon, macOS 12+.');

for(const edition of ['creator','player']){
 const name=edition==='player'?'GAME-PORTAL-PLAY-MAC':'GAME-PORTAL-MAC',contents=join(root,name+'.app/Contents');
 await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(join(contents,'Resources'),{recursive:true});
 await copyFile(join(root,'GAME-PORTAL-MAC'),join(contents,'MacOS/GAME-PORTAL-MAC'));
 await copyFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'),join(contents,'Resources/GAME-PORTAL.html'));
 await copyFile(join(root,'THIRD-PARTY-LICENSES.txt'),join(contents,'Resources/THIRD-PARTY-LICENSES.txt'));
 await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>GAME-PORTAL-MAC</string><key>CFBundleIdentifier</key><string>jp.ecleaire.gameportal.mac.'+edition+'</string><key>GamePortalEdition</key><string>'+edition+'</string><key>CFBundleName</key><string>GAME PORTAL '+edition+'</string><key>LSUIElement</key><true/><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>12.0</string><key>CFBundleShortVersionString</key><string>'+version+'</string></dict></plist>\n');
 execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',join(root,name+'.app')],{stdio:'inherit'});
 execFileSync('codesign',['--verify','--deep','--strict',join(root,name+'.app')],{stdio:'inherit'});
}

await publishDistribution('mac');
