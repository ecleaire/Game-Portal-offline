import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Mojave版のビルドはmacOSで実行してください。');
const root=resolve(import.meta.dirname,'..'),build=join(root,'offline-release/.mojave-build');await mkdir(build,{recursive:true});
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8')),source=join(build,'native-launcher.swift'),output=join(root,'GAME-PORTAL-MOJAVE');await writeFile(source,(await readFile(join(root,'scripts/macos/native-launcher.swift'),'utf8')).replace('__VERSION__',version));
execFileSync('xcrun',['swiftc','-swift-version','5','-D','MOJAVE','-O','-target','x86_64-apple-macosx10.14',source,'-o',output],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-','--timestamp=none',output],{stdio:'inherit'});
console.log('Mojave helper built: v'+version+', Intel x86_64, macOS 10.14+, Firefox ESR 115, play-only.');
