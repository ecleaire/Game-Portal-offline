import {bundleSwiftRuntime,swiftRuntimeLinkFlags} from './macos/swift-runtime.mjs';
import {materializeDistribution,publishDistribution} from './distribution.mjs';
await materializeDistribution();
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin')throw Error('Mojave版のビルドはmacOSで実行してください。');
const root=resolve(import.meta.dirname,'..'),build=join(root,'offline-release/.mojave-build');await mkdir(build,{recursive:true});
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8')),source=join(build,'native-launcher.swift'),output=join(root,'GAME-PORTAL-MOJAVE');await writeFile(source,(await readFile(join(root,'scripts/macos/native-launcher.swift'),'utf8')).replace('__VERSION__',version));
execFileSync('xcrun',['swiftc','-swift-version','5','-D','MOJAVE','-O','-target','x86_64-apple-macosx10.14',source,...swiftRuntimeLinkFlags('Swift-MOJAVE'),'-o',output],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-','--timestamp=none',output],{stdio:'inherit'});
await bundleSwiftRuntime(output,join(root,'offline-release/Swift-MOJAVE'));
await import('./build-mac-apps.mjs').then(module=>module.buildMacApps('MOJAVE'));

await publishDistribution('mojave');
