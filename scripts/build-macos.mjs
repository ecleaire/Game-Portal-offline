import {materializeDistribution,publishDistribution} from './distribution.mjs';
import {MAC_MINIMUM,MAC_TARGETS,verifyMacMinimum} from './mac-system.mjs';
await materializeDistribution();
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Mac版のビルドはmacOSで実行してください。');
const root=resolve(import.meta.dirname,'..'),output=join(root,'offline-release','.mac-build');
await mkdir(output,{recursive:true});
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const source=join(output,'native-launcher.swift');await writeFile(source,(await readFile(join(root,'scripts/macos/native-launcher.swift'),'utf8')).replace('__VERSION__',version));
for(const [arch,minimum] of Object.entries(MAC_TARGETS))execFileSync('xcrun',['swiftc','-swift-version','5','-D','MOJAVE','-O','-target',arch+'-apple-macosx'+minimum,source,'-o',join(output,arch)],{stdio:'inherit'});
execFileSync('xcrun',['lipo','-create',join(output,'x86_64'),join(output,'arm64'),'-output',join(root,'GAME-PORTAL-MAC')],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-','--timestamp=none',join(root,'GAME-PORTAL-MAC')],{stdio:'inherit'});
verifyMacMinimum(await readFile(join(root,'GAME-PORTAL-MAC')));
console.log('Mac helper built: v'+version+', Intel macOS '+MAC_MINIMUM+' / Apple silicon macOS 11+.');

await import('./build-mac-apps.mjs').then(module=>module.buildMacApps('MAC'));

await publishDistribution('mac');
