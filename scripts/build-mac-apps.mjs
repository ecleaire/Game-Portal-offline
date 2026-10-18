import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {macDesktopPage} from './macos/desktop-page.mjs';
import {MAC_MINIMUM,MAC_TARGETS,verifyMacMinimum} from './mac-system.mjs';

export const macDesktopSources=['scripts/macos/desktop-files.swift','scripts/macos/desktop-host.swift','scripts/macos/desktop-self-test.swift','scripts/macos/desktop-page.mjs','scripts/macos/desktop-polyfills.js','scripts/build-mac-apps.mjs','desktop/bootstrap.js','desktop/page.mjs'];
export async function macDesktopManifest(root,version,edition){
  const files={};for(const path of macDesktopSources)files[path]=createHash('sha256').update((await readFile(join(root,path),'utf8')).replaceAll('\r\n','\n')).digest('hex');
  return {schema:1,version,edition,kind:'mac-standalone-v1',files};
}
export async function buildMacApps(suffix){
  if(process.platform!=='darwin')throw Error('Mac applications require macOS to build.');
  const root=resolve(import.meta.dirname,'..'),build=join(root,'offline-release/.mac-desktop-'+suffix),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  await mkdir(build,{recursive:true});
  const host=join(build,'desktop-host.swift');await writeFile(host,(await readFile(join(root,'scripts/macos/desktop-host.swift'),'utf8')).replace('__VERSION__',version));
  const architectures=suffix==='MAC'?MAC_TARGETS:{x86_64:MAC_MINIMUM},outputs=[];
  for(const [arch,minimum]of Object.entries(architectures)){
    const output=join(build,arch);outputs.push(output);
    execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O','-target',arch+'-apple-macosx'+minimum,host,join(root,'scripts/macos/desktop-files.swift'),join(root,'scripts/macos/desktop-self-test.swift'),'-o',output],{stdio:'inherit'});
  }
  const binary=join(build,'GAME-PORTAL-'+suffix);
  if(outputs.length===2)execFileSync('xcrun',['lipo','-create',...outputs,'-output',binary],{stdio:'inherit'});else await copyFile(outputs[0],binary);
  execFileSync('codesign',['--force','--sign','-','--timestamp=none',binary],{stdio:'inherit'});
  if(suffix==='MAC')verifyMacMinimum(await readFile(binary));
  const bootstrap=(await readFile(join(root,'desktop/bootstrap.js'),'utf8')).replaceAll('\r\n','\n'),licenses=await readFile(join(root,'THIRD-PARTY-LICENSES.txt'),'utf8');
  for(const edition of ['creator','player']){
    const name=(edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+suffix,app=join(root,name+'.app'),contents=join(app,'Contents'),resources=join(contents,'Resources');
    await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(resources,{recursive:true});
    await copyFile(binary,join(contents,'MacOS/GAME-PORTAL-'+suffix));
    const html=await readFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'),'utf8');
    await writeFile(join(resources,'GAME-PORTAL.html'),html);
    await writeFile(join(resources,'GAME-PORTAL-DESKTOP.html'),await macDesktopPage(html,bootstrap,licenses));
    const esbuildLicense=await readFile(join(root,'node_modules/esbuild-wasm/LICENSE'),'utf8');
    await writeFile(join(resources,'MAC-DESKTOP-LICENSES.txt'),'esbuild-wasm 0.25.12 (build output)\n\n'+esbuildLicense+'\n\n'+licenses);
    await copyFile(join(root,'THIRD-PARTY-LICENSES.txt'),join(resources,'THIRD-PARTY-LICENSES.txt'));
    await writeFile(join(resources,'build.json'),JSON.stringify(await macDesktopManifest(root,version,edition))+'\n');
    await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>GAME-PORTAL-'+suffix+'</string><key>CFBundleIdentifier</key><string>jp.ecleaire.gameportal.mac.'+edition+'</string><key>GamePortalEdition</key><string>'+edition+'</string><key>GamePortalStandalone</key><true/><key>CFBundleName</key><string>GAME PORTAL '+edition+'</string><key>LSUIElement</key><false/><key>NSHighResolutionCapable</key><true/><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>'+MAC_MINIMUM+'</string><key>CFBundleShortVersionString</key><string>'+version+'</string><key>CFBundleVersion</key><string>'+version+'.1</string></dict></plist>\n');
    execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',app],{stdio:'inherit'});
    execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
  }
  console.log('Standalone Mac applications built: native window and filesystem; no external browser required.');
}
