import {materializeDistribution,publishDistribution} from './distribution.mjs';
await materializeDistribution();
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {desktopPage} from '../desktop/page.mjs';
import {desktopBuildInfo} from '../desktop/build-info.mjs';
if(process.platform!=='win32')throw Error('Windowsでビルドしてください。');
const root=resolve(import.meta.dirname,'..'),config=JSON.parse(await readFile(join(root,'desktop/desktop.json'),'utf8')),pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(config.launcherVersion!==pkg.version)throw Error('Desktop launcher version needs updating.');
const sdkRoot=join(root,'.tools/desktop-sdk'),sdk=join(sdkRoot,'sdk'),nupkg=join(sdkRoot,'webview2.nupkg'),build=join(root,'offline-release/.desktop-build');await mkdir(build,{recursive:true});
let bytes;try{bytes=await readFile(nupkg);}catch{if(!process.argv.includes('--prepare'))throw Error('Run build-desktop.mjs --prepare first.');const response=await fetch(config.webview2.url,{signal:AbortSignal.timeout(90000)});if(!response.ok)throw Error('WebView2 SDK download failed');bytes=Buffer.from(await response.arrayBuffer());await mkdir(sdkRoot,{recursive:true});await writeFile(nupkg,bytes);}
if(createHash('sha256').update(bytes).digest('hex')!==config.webview2.sha256)throw Error('WebView2 SDK hash mismatch');
await access(join(sdk,'lib/net462/Microsoft.Web.WebView2.Core.dll')).catch(()=>{
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${nupkg.replaceAll("'","''")}','${sdk.replaceAll("'","''")}')`],{stdio:'pipe'});
});
const license=await readFile(join(sdk,'LICENSE.txt'),'utf8'),notice=await readFile(join(sdk,'NOTICE.txt'),'utf8'),licenses='Microsoft.Web.WebView2 '+config.webview2.version+'\n\n'+license+'\n\n'+notice+'\n\n'+await readFile(join(root,'THIRD-PARTY-LICENSES.txt'),'utf8');
for(const edition of ['creator','player']){
const filename=edition==='player'?'GAME-PORTAL-PLAY':'GAME-PORTAL';
const html=desktopPage((await readFile(join(root,filename+'.html'),'utf8')).replaceAll('\r\n','\n'),(await readFile(join(root,'desktop/bootstrap.js'),'utf8')).replaceAll('\r\n','\n'),licenses);await writeFile(join(build,'GAME-PORTAL-DESKTOP.html'),html);
await writeFile(join(build,'desktop-build.json'),await desktopBuildInfo(root,licenses,edition));
if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(config.version))throw Error('Invalid desktop version');
await writeFile(join(build,'assembly.cs'),'using System.Reflection;\n[assembly:AssemblyTitle("GAME PORTAL Desktop")]\n[assembly:AssemblyProduct("GAME PORTAL")]\n[assembly:AssemblyVersion("'+config.version.split('-')[0]+'.0")]\n[assembly:AssemblyFileVersion("'+config.version.split('-')[0]+'.0")]\n[assembly:AssemblyInformationalVersion("'+config.version+'")]\n');
const host=(await readFile(join(root,'desktop/host.cs'),'utf8')).replaceAll('__DESKTOP_VERSION__',config.version).replaceAll('__EDITION__',edition);await writeFile(join(build,'host.cs'),host);
let validators=(await readFile(join(root,'scripts/windows/native-launcher.cs'),'utf8')).replace('__VERSION__',pkg.version);for(const name of ['CheckLibrary','Executable','Id'])validators=validators.replace('static string '+name+'(','internal static string '+name+'(').replace('static void '+name+'(','internal static void '+name+'(');await writeFile(join(build,'validators.cs'),validators);
const framework=join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319'),compiler=join(framework,'csc.exe'),core=join(sdk,'lib/net462/Microsoft.Web.WebView2.Core.dll'),forms=join(sdk,'lib/net462/Microsoft.Web.WebView2.WinForms.dll'),loader=join(sdk,'runtimes/win-x64/native/WebView2Loader.dll'),output=resolve((edition==='creator'?process.env.PORTAL_DESKTOP_OUTPUT:process.env.PORTAL_DESKTOP_PLAYER_OUTPUT)||join(root,filename+'.exe'));
const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output','/main:DesktopProgram','/out:'+output,...['System.Windows.Forms','System.Drawing','System.Web.Extensions','System.Web'].map(name=>'/reference:'+join(framework,name+'.dll')),'/reference:'+core,'/reference:'+forms,...[[core,'Microsoft.Web.WebView2.Core.dll'],[forms,'Microsoft.Web.WebView2.WinForms.dll'],[loader,'WebView2Loader.dll'],[join(build,'GAME-PORTAL-DESKTOP.html'),'GAME-PORTAL-DESKTOP.html'],[join(build,'desktop-build.json'),'desktop-build.json']].map(([file,name])=>'/resource:'+file+','+name),join(build,'assembly.cs'),join(build,'host.cs'),join(build,'validators.cs'),join(root,'desktop/files.cs'),join(root,'desktop/folder-dialog.cs'),join(root,'desktop/shared-connection.cs'),join(root,'desktop/self-test.cs')];
try{execFileSync(compiler,args,{stdio:'pipe'});}catch(error){process.stderr.write(String(error.stdout||'')+String(error.stderr||''));throw Error('Desktop compilation failed');}
await writeFile(join(root,'offline-release',filename+'.exe'),await readFile(output));
await writeFile(join(root,'DESKTOP-LICENSES.txt'),licenses);
console.log('Desktop EXE built: '+config.version+', embedded launcher '+pkg.version+'. No adjacent HTML or SDK DLLs needed.');

}

await publishDistribution('windows');
