import {readFile,writeFile,mkdir,copyFile,cp,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {macDesktopPage} from './macos/desktop-page.mjs';
import {prepareCEF} from './prepare-cef.mjs';
import {MAC_MINIMUM,MAC_TARGETS,verifyMacMinimum} from './mac-system.mjs';
import {bundleSwiftRuntime,swiftRuntimeLinkFlags} from './macos/swift-runtime.mjs';
import {verifyMacImageMinimum} from './mac-system.mjs';
import {publishDistribution} from './distribution.mjs';

export const macDesktopSources=['scripts/macos/desktop-files.swift','scripts/macos/desktop-network.swift','scripts/macos/desktop-instance.swift','scripts/macos/cef-desktop-host.swift','scripts/macos/desktop-engine.swift','scripts/macos/desktop-self-test.swift','scripts/macos/desktop-page.mjs','scripts/macos/cef-bridge.mm','scripts/macos/cef/CMakeLists.txt','scripts/macos/cef-lock.json','scripts/build-mac-apps.mjs','scripts/prepare-cef.mjs','scripts/mac-system.mjs','scripts/macos/swift-runtime.mjs','scripts/macos/SWIFT-RUNTIME-LICENSE.txt','desktop/bootstrap.js','desktop/page.mjs'];
export async function macDesktopManifest(root,version,edition){
 const files={};for(const path of macDesktopSources)files[path]=createHash('sha256').update((await readFile(join(root,path),'utf8')).replaceAll('\r\n','\n')).digest('hex');
 return {schema:1,version,edition,kind:'mac-cef-standalone-v1',htmlSHA256:createHash('sha256').update(await readFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'))).digest('hex'),files};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function compileCEF(root,build,arch){
 // CMake caches contain absolute source/build paths and cannot move between checkouts.
 const cef=await prepareCEF(arch),toolchain=execFileSync('xcrun',['clang','--version'],{encoding:'utf8'}),directory=join(root,'.tools/cef/build-'+arch+'-'+digest(Buffer.from(cef.version+'\n'+toolchain+'\n'+root+'\n'+MAC_TARGETS[arch])).slice(0,16));
 execFileSync('cmake',['-S',join(root,'scripts/macos/cef'),'-B',directory,'-DCEF_ROOT='+cef.sdk,'-DPROJECT_ARCH='+arch,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_POLICY_VERSION_MINIMUM=3.5','-DCMAKE_OSX_ARCHITECTURES='+arch,'-DCMAKE_OSX_DEPLOYMENT_TARGET='+MAC_TARGETS[arch],'-DCMAKE_CXX_FLAGS=-ffile-prefix-map='+root+'=. -Wno-deprecated-declarations'],{stdio:'inherit'});
 execFileSync('cmake',['--build',directory,'--config','Release','--parallel','4'],{stdio:'inherit'});
 return {...cef,directory};
}
async function packageEngine(root,build,arch,cef){
 const staging=join(build,'engine-'+arch),engine=join(staging,'engine');await mkdir(engine,{recursive:true});
 const framework=join(engine,'Chromium Embedded Framework.framework');await cp(join(cef.sdk,'Release/Chromium Embedded Framework.framework'),framework,{recursive:true});
 // Sign complete framework and helpers before creating the offline payload.
 verifyMacImageMinimum(await readFile(join(framework,'Chromium Embedded Framework')));
 verifyMacImageMinimum(await readFile(join(cef.directory,'portal_cef_helper')));
 execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',framework],{stdio:'inherit'});
 for(const suffix of ['',' (Alerts)',' (GPU)',' (Plugin)',' (Renderer)']){
  const name='GAME PORTAL Helper'+suffix,app=join(engine,name+'.app'),contents=join(app,'Contents');await mkdir(join(contents,'MacOS'),{recursive:true});
  await copyFile(join(cef.directory,'portal_cef_helper'),join(contents,'MacOS',name));
  await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>'+name+'</string><key>CFBundleIdentifier</key><string>jp.ecleaire.gameportal.cef.'+(suffix.match(/[A-Za-z]+/)?.[0]||'main').toLowerCase()+'</string><key>CFBundleName</key><string>'+name+'</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/><key>LSMinimumSystemVersion</key><string>'+(arch==='arm64'?'11.0':MAC_MINIMUM)+'</string></dict></plist>\n');
  execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',app],{stdio:'inherit'});
 }
 await copyFile(join(cef.sdk,'LICENSE.txt'),join(engine,'CEF-LICENSE.txt'));
 const archive=join(staging,'engine.zip');execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--keepParent',engine,archive],{stdio:'inherit'});
 const bytes=await readFile(archive),parts=[],destination=join(build,'engine-packs',arch);await mkdir(destination,{recursive:true});
 for(let offset=0,index=0;offset<bytes.length;offset+=40*1024*1024,index++){
  const chunk=bytes.subarray(offset,offset+40*1024*1024),name='engine.part'+String(index).padStart(2,'0');await writeFile(join(destination,name),chunk);parts.push({name,size:chunk.length,sha256:digest(chunk)});
 }
 for(const file of await readdir(destination))if(/^engine\.part\d+$/.test(file)&&!parts.some(part=>part.name===file))await rm(join(destination,file));
 return {size:bytes.length,sha256:digest(bytes),sdkSHA256:cef.sha256,parts};
}
export async function buildMacApps(suffix){
 if(process.platform!=='darwin')throw Error('Mac applications require macOS to build.');
 const root=resolve(import.meta.dirname,'..'),build=join(root,'offline-release/.mac-desktop-'+suffix),{version}=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
 await mkdir(build,{recursive:true});
 const host=join(build,'cef-desktop-host.swift');await writeFile(host,(await readFile(join(root,'scripts/macos/cef-desktop-host.swift'),'utf8')).replace('__VERSION__',version));
 const architectures=suffix==='MAC'?MAC_TARGETS:{x86_64:MAC_MINIMUM},outputs=[],targets={};let cefLicense='';
 for(const [arch,minimum]of Object.entries(architectures)){
  const cef=await compileCEF(root,build,arch),output=join(build,arch);outputs.push(output);
  if(!cefLicense)cefLicense=await readFile(join(cef.sdk,'LICENSE.txt'),'utf8');
  const wrapper=join(cef.directory,'libcef_dll_wrapper/libcef_dll_wrapper.a');
  execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O','-target',arch+'-apple-macosx'+minimum,host,...['desktop-files.swift','desktop-network.swift','desktop-instance.swift','desktop-engine.swift','desktop-self-test.swift'].map(file=>join(root,'scripts/macos',file)),join(cef.directory,'libportal_cef.a'),wrapper,join(cef.sdk,'Release/cef_sandbox.a'),'-lc++','-lsandbox','-framework','Cocoa','-framework','Security',...swiftRuntimeLinkFlags('../Frameworks'),'-o',output],{stdio:'inherit'});
  targets[arch]=await packageEngine(root,build,arch,cef);
 }
 const binary=join(build,'GAME-PORTAL-'+suffix);
 if(outputs.length===2)execFileSync('xcrun',['lipo','-create',...outputs,'-output',binary],{stdio:'inherit'});else await copyFile(outputs[0],binary);
 execFileSync('codesign',['--force','--sign','-','--timestamp=none',binary],{stdio:'inherit'});
 if(suffix==='MAC')verifyMacMinimum(await readFile(binary));
 const runtimeRoot=join(build,'swift-runtime');await bundleSwiftRuntime(binary,runtimeRoot);
 const bootstrap=(await readFile(join(root,'desktop/bootstrap.js'),'utf8')).replaceAll('\r\n','\n'),licenses=await readFile(join(root,'THIRD-PARTY-LICENSES.txt'),'utf8');
 const families=suffix==='MAC'?['MAC','MOJAVE']:['MOJAVE'];
 for(const family of families)for(const edition of ['creator','player']){
  const name=(edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+family,app=join(root,name+'.app'),contents=join(app,'Contents'),resources=join(contents,'Resources');
  // Rebuild the dedicated output bundle from scratch; never retain a private
  // runtime cache, an old signature or resources from a previous build.
  await rm(app,{recursive:true,force:true});
  await mkdir(join(contents,'MacOS'),{recursive:true});await mkdir(resources,{recursive:true});
  await cp(runtimeRoot,join(contents,'Frameworks'),{recursive:true});
  await copyFile(family==='MOJAVE'?outputs[0]:binary,join(contents,'MacOS/GAME-PORTAL-'+family));
  const html=await readFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'),'utf8');
  await writeFile(join(resources,'GAME-PORTAL.html'),html);
  await writeFile(join(resources,'GAME-PORTAL-DESKTOP.html'),await macDesktopPage(html,bootstrap,licenses));
  await writeFile(join(resources,'engine.json'),JSON.stringify({schema:1,kind:'cef-offline-v1',targets:family==='MOJAVE'?{x86_64:targets.x86_64}:targets})+'\n');
  for(const arch of family==='MOJAVE'?['x86_64']:Object.keys(targets))await cp(join(build,'engine-packs',arch),join(resources,'engine',arch),{recursive:true});
  await writeFile(join(resources,'MAC-DESKTOP-LICENSES.txt'),'Chromium Embedded Framework 116.0.27 / Chromium 116.0.5845.190\n\n'+cefLicense+'\n\n'+licenses+'\n\n'+await readFile(join(root,'scripts/macos/SWIFT-RUNTIME-LICENSE.txt'),'utf8'));
  await copyFile(join(root,'THIRD-PARTY-LICENSES.txt'),join(resources,'THIRD-PARTY-LICENSES.txt'));
  await writeFile(join(resources,'build.json'),JSON.stringify(await macDesktopManifest(root,version,edition))+'\n');
  await writeFile(join(contents,'Info.plist'),'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>GAME-PORTAL-'+family+'</string><key>CFBundleIdentifier</key><string>jp.ecleaire.gameportal.mac.'+edition+'</string><key>GamePortalEdition</key><string>'+edition+'</string><key>GamePortalStandalone</key><true/><key>CFBundleName</key><string>GAME PORTAL '+edition+'</string><key>LSUIElement</key><false/><key>NSHighResolutionCapable</key><true/><key>CFBundlePackageType</key><string>APPL</string><key>LSMinimumSystemVersion</key><string>'+MAC_MINIMUM+'</string><key>CFBundleShortVersionString</key><string>'+version+'</string><key>CFBundleVersion</key><string>'+version+'.2</string></dict></plist>\n');
  execFileSync('codesign',['--force','--deep','--sign','-','--timestamp=none',app],{stdio:'inherit'});
  execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 }
 if(suffix==='MAC')await publishDistribution('mojave-apps');
 console.log('Standalone Mac applications built: bundled Chromium, native window and filesystem; no external browser required.');
}
