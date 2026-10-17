import {materializeDistribution,publishDistribution} from './distribution.mjs';
await materializeDistribution();
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin')throw Error('Mojave版のビルドはmacOSで実行してください。');
const root=resolve(import.meta.dirname,'..'),build=join(root,'offline-release/.mojave-build');await mkdir(build,{recursive:true});
const {version}=JSON.parse(await readFile(join(root,'package.json'),'utf8')),source=join(build,'native-launcher.swift'),output=join(root,'GAME-PORTAL-MOJAVE');await writeFile(source,(await readFile(join(root,'scripts/macos/native-launcher.swift'),'utf8')).replace('__VERSION__',version));
execFileSync('xcrun',['swiftc','-swift-version','5','-D','MOJAVE','-O','-target','x86_64-apple-macosx10.14',source,'-o',output],{stdio:'inherit'});
execFileSync('codesign',['--force','--sign','-','--timestamp=none',output],{stdio:'inherit'});
for(const edition of ['creator','player']){
const name=edition==='player'?'GAME-PORTAL-PLAY-MOJAVE':'GAME-PORTAL-MOJAVE';
const app=join(root,name+'.app'),contents=join(app,'Contents'),resources=join(contents,'Resources');await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(resources,{recursive:true});
await copyFile(output,join(contents,'MacOS/GAME-PORTAL-MOJAVE'));await copyFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'),join(resources,'GAME-PORTAL.html'));await copyFile(join(root,'THIRD-PARTY-LICENSES.txt'),join(resources,'THIRD-PARTY-LICENSES.txt'));
await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>GAME-PORTAL-MOJAVE</string><key>CFBundleIdentifier</key><string>jp.ecleaire.gameportal.mojave.'+edition+'</string><key>GamePortalEdition</key><string>'+edition+'</string><key>CFBundleName</key><string>GAME PORTAL '+(edition==='player'?'Play':'Creator')+' Mojave</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>'+version+'</string><key>CFBundleVersion</key><string>'+version+'</string><key>LSMinimumSystemVersion</key><string>10.14</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>CFBundleDevelopmentRegion</key><string>ja</string></dict></plist>\n');
const hashes={};for(const path of ['scripts/macos/native-launcher.swift','scripts/build-mojave.mjs'])hashes[path]=createHash('sha256').update((await readFile(join(root,path),'utf8')).replaceAll('\r\n','\n')).digest('hex');
await writeFile(join(resources,'build.json'),JSON.stringify({schema:1,version,files:hashes})+'\n');execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',app],{stdio:'inherit'});execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
console.log('Mojave helper built: v'+version+', Intel x86_64, macOS 10.14+, Firefox ESR 115, play-only.');

}

await publishDistribution('mojave');
