import {mkdtemp,mkdir,writeFile,readFile,cp,rm,readdir,stat,open} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')process.exit(0);
const temporary=await mkdtemp(join(tmpdir(),'portal-mac-desktop-')),root=await import('node:fs/promises').then(async fs=>fs.realpath(temporary));
const suffix=process.env.PORTAL_MAC_SUFFIX||'MAC',disk=join(root,'ゲーム # +');let processHandle, nativeOutput="";
function diagnostic(label,text){console.error(label,text);if(process.env.GITHUB_ACTIONS){const value=String(text);for(let offset=0;offset<value.length;offset+=2400){const message=(label+' ['+(offset/2400+1)+']\n'+value.slice(offset,offset+2400)).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');console.log('::error title=Mac native diagnostic::'+message);}}}
async function waitForExit(child,timeout){return Promise.race([new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve(true):child.once('exit',()=>resolve(true))),delay(timeout).then(()=>false)]);}
async function terminate(child){try{process.kill(-child.pid,'SIGTERM');}catch{}if(!await waitForExit(child,2000)){try{process.kill(-child.pid,'SIGKILL');}catch{}assert(await waitForExit(child,3000),'Native app did not terminate');}child.stdout?.destroy();child.stderr?.destroy();}
try{
 await mkdir(disk,{recursive:true});
 await mkdir(join(root,'_内部ファイル'),{recursive:true});await writeFile(join(root,'_内部ファイル/GAME-PORTAL-DISTRIBUTION.json'),JSON.stringify({schema:1,project:'GAME-PORTAL',layout:'platform-role'}));
 await writeFile(join(disk,'game.html'),'<!doctype html><h1>Native Mac play</h1><script>localStorage.setItem("mac-retained","yes");parent.postMessage({macGameReady:true,title:document.querySelector("h1").textContent,webgl2:!!document.createElement("canvas").getContext("webgl2"),wasm:new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,7,1,3,114,117,110,0,0,10,6,1,4,0,65,7,11]))).exports.run()===7},"*");window.addEventListener("message",event=>{if(event.data==="security-test"){let parentBlocked=false;try{void parent.document;}catch{parentBlocked=true;}parent.postMessage({macSecurity:true,denied:typeof window.__portalSend==="undefined"&&parentBlocked},"*");}});</script>');
 for(const edition of ['creator','player']){
  const prefix=edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-',role=edition==='player'?'プレイ用':'クリエイター用';
  const families=suffix==='MAC'&&process.arch==='x64'?['MAC','MOJAVE','MAC']:[suffix,suffix];
  for(const family of new Set(families)){const name=prefix+family,app=join(root,'Mac',role,name+'.app');await cp(resolve(name+'.app'),app,{recursive:true});execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});}
  const primary=join(root,'Mac',role,prefix+suffix+'.app/Contents/MacOS/GAME-PORTAL-'+suffix);
  assert(!execFileSync('otool',['-L',primary],{encoding:'utf8'}).includes('/Network.framework/'),'Startup host must not depend on Network.framework path evaluation');
  const selftest=join(root,'self-test-'+edition);execFileSync(primary,['--self-test',selftest],{timeout:30000,stdio:'pipe'});assert.equal(JSON.parse(await readFile(join(selftest,'result.json'))).ok,true);
  if(edition==='player')await rm(join(root,'GAME-PORTAL-CONNECTION.json'),{force:true}); // First Player start must use the same-Mac Creator selection.
  for(let cycle=0;cycle<families.length;cycle++){
   const family=families[cycle],executable=join(root,'Mac',role,prefix+family+'.app/Contents/MacOS/GAME-PORTAL-'+family);
   console.log('Mac native app test starting: '+edition+' / '+family+' / '+cycle);
   let corruptedOrigin;
   if(cycle===families.length-1){
    for(const entry of await readdir(join(root,'runtime'))){if(!/^(arm64|x86_64)-[a-f0-9]{64}-[a-f0-9]{64}$/.test(entry))continue;const bundle=join(root,'runtime',entry,'GAME PORTAL Runtime.app'),manifest=await readFile(join(bundle,'Contents/Resources/build.json'),'utf8').then(JSON.parse).catch(()=>null);if(manifest?.edition!==edition||!await stat(join(bundle,'Contents/MacOS/GAME-PORTAL-'+family)).then(value=>value.isFile()).catch(()=>false))continue;corruptedOrigin=join(bundle,'Contents/Resources/origin.json');await writeFile(corruptedOrigin,JSON.stringify({schema:0}));break;}
    assert(corruptedOrigin,'Earlier runtime cache must exist for the repair check');
   }
   const result=join(root,edition+'-'+cycle+'.json'),script=join(root,edition+'-'+cycle+'.js');
   const body=`
const until=async(test,label)=>{for(let count=0;count<400;count++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label+' / '+document.body.innerText.slice(-500));};
const check=(condition,label)=>{if(!condition)throw Error(label);};
await until(()=>document.documentElement.dataset.ready==='true','startup');
if(${cycle}===0&&launcherEdition==='creator'){check(!root,'first creator start has no selected folder');document.getElementById('settingsButton').click();check(document.getElementById('settings').open,'settings before connection');document.getElementById('desktopFolderPath').value=${JSON.stringify(disk)};await document.getElementById('desktopConnectPath').onclick();document.getElementById('settings').close();}
await until(()=>root,'native folder restore');
await until(()=>games.length===1,'game listing');
check(root.nativeDesktop&&!root.nativeReadOnly,'writable native adapter');
check(window.chrome?.webview===undefined,'no WebView2/browser dependency');
document.getElementById('helpButton').click();check(document.getElementById('help').open,'help opens');document.getElementById('help').close();
document.getElementById('settingsButton').click();check(document.getElementById('settings').open,'settings opens');document.getElementById('settings').close();
check(await root.queryPermission({mode:'readwrite'})==='granted','no browser permission needed');
if(launcherEdition==='creator'&&${cycle}===0){document.getElementById('settingsButton').click();const share=document.getElementById('desktopShareConnection');check(share&&!share.hidden,'native creator share control');const original=window.confirm;window.confirm=()=>true;try{share.click();await until(()=>!busy,'sharing completed');check(document.getElementById('desktopSharedConnection').textContent.includes('未設定のPC'),'shared default publication notice');}finally{window.confirm=original;}document.getElementById('settings').close();}
if(launcherEdition==='player'){check(!document.getElementById('desktopShareConnection'),'player cannot change shared default');let denied=false;try{const info=await desktopHost.sharedInfo(root);await desktopHost.share(root,info.revision);}catch{denied=true;}check(denied,'backend denies player shared default change');}
if(launcherEdition==='creator'&&${cycle}===0){const input=document.getElementById('enableEditing');input.checked=true;await input.onchange();check(editingEnabled,'native edit mode');editGame(games[0]);document.getElementById('editTitle').value='Mac edited';document.getElementById('editEnvironment').value='HTML';document.getElementById('editDescription').value='Native metadata';document.getElementById('editForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>!busy&&!document.getElementById('edit').open,'metadata save');check(games[0].title==='Mac edited','edited title');}
if(launcherEdition==='player'){check(!editingEnabled,'player mode');let blocked=false;try{await root.getFileHandle('forbidden.html',{create:true});}catch{blocked=true;}check(blocked,'native player write denial');}
const library=localLibrary;
if(${cycle}>0)check((await localState.loadLocalSave(library,games[0].id))['mac-retained']==='yes','save survives real app restart before game starts');
let gameReady=null,security=null;const listener=event=>{if(event.source!==document.getElementById('frame').contentWindow)return;if(event.data?.macGameReady)gameReady=event.data;if(event.data?.macSecurity)security=event.data;};window.addEventListener('message',listener);
await playGame(games[0]);await until(()=>!busy&&!document.getElementById('frame').hidden,'game opens');
await until(()=>gameReady,'game really executed');check(gameReady.title==='Native Mac play'&&gameReady.wasm&&gameReady.webgl2,'WebGL2 and WebAssembly inside bundled Chromium: '+JSON.stringify(gameReady));document.getElementById('frame').contentWindow.postMessage('security-test','*');await until(()=>security,'sandbox test');check(security.denied,'game cannot call the native host or access its parent');window.removeEventListener('message',listener);
check(document.getElementById('frame').sandbox.contains('allow-scripts')&&!document.getElementById('frame').sandbox.contains('allow-same-origin'),'game sandbox retained');
await until(()=>activePlay?.latest?.['mac-retained']==='yes','game save received');check(await flushSave(),'game save persisted');
const priorSession=activePlay;gameReady=null;window.addEventListener('message',listener);document.getElementById('reloadPlaying').click();await until(()=>!busy&&activePlay!==priorSession&&gameReady&&!gameLoading,'reload current game');check(gameReady.webgl2&&gameReady.wasm,'reloaded game runtime');check((await localState.loadLocalSave(library,games[0].id))['mac-retained']==='yes','reload retains save');// Exercise priority operations inside the shipped CEF engine, in both editions.
const originalRefresh=refresh;let lateRefresh,refreshAttempts=0;refresh=async options=>{if(++refreshAttempts===1)await new Promise(resolve=>lateRefresh=resolve);return originalRefresh(options);};
const beforePriority=activePlay;gameReady=null;document.getElementById('reloadPlaying').click();await until(()=>lateRefresh,'blocked refresh');check(!document.getElementById('reloadPlaying').disabled&&!document.getElementById('closePlayer').disabled,'priority controls remain enabled');document.getElementById('reloadPlaying').click();await until(()=>!busy&&activePlay!==beforePriority&&gameReady&&!gameLoading,'reload interrupts earlier refresh');check(refreshAttempts===2,'one replacement reload');const currentSession=activePlay;refresh=originalRefresh;lateRefresh();await new Promise(resolve=>setTimeout(resolve,30));check(activePlay===currentSession,'late refresh cannot replace current game');
lateRefresh=null;refresh=async options=>{await new Promise(resolve=>lateRefresh=resolve);return originalRefresh(options);};document.getElementById('reloadPlaying').click();await until(()=>lateRefresh,'second blocked refresh');document.getElementById('closePlayer').click();await until(()=>!document.getElementById('player').open,'List interrupts pending reload');refresh=originalRefresh;lateRefresh();await until(()=>!busy&&!playerReloadWorker&&!closingPlayer,'cancelled reload drains');check(!document.getElementById('player').open&&!activePlay,'late reload cannot reopen game');
window.removeEventListener('message',listener);
stopPlayer();
const selectedRoot=root;await localState.forgetHandle();check(await desktopHost.current()===null,'forgotten folder suppresses shared default');check(root===selectedRoot,'forget preserves current connection');await localState.cacheHandle(selectedRoot);check(!!(await desktopHost.current()),'explicit selection resumes remembering');
return {edition:launcherEdition,cycle:${cycle},library,version:document.getElementById('appVersion').textContent};`;
   // Tests execute the actual bundled Chromium application on macOS CI.
   // This does not claim physical macOS 10.14 testing.
   await writeFile(script,body);let logs='';nativeOutput='';processHandle=spawn(executable,['--test-mode','--profile',join(root,'profile-'+edition),'--test-script',script,'--result-file',result],{detached:true,stdio:['ignore','pipe','pipe']});processHandle.stdout.on('data',data=>{logs+=data;nativeOutput+=data;});processHandle.stderr.on('data',data=>{logs+=data;nativeOutput+=data;});
   let value;for(let count=0;count<900;count++){value=await readFile(result,'utf8').then(JSON.parse).catch(()=>null);if(value)break;if(processHandle.exitCode!==null||processHandle.signalCode!==null)break;await delay(100);}
   if(!value){console.error('Native application exit:',processHandle.exitCode,processHandle.signalCode);await delay(1500);const reports=join(homedir(),'Library/Logs/DiagnosticReports');for(const name of (await readdir(reports).catch(()=>[])).filter(name=>/^GAME-PORTAL.*\.(ips|crash)$/.test(name))){const file=join(reports,name),info=await stat(file);if(Date.now()-info.mtimeMs<600000&&info.size<2*1024*1024)console.error('Native crash report:',name,(await readFile(file,'utf8')).slice(0,16000));}}
   if(!value){
    const mainPID=[...logs.matchAll(/CEF main before initialize: pid=(\d+)/g)].at(-1)?.[1];
    if(mainPID)try{diagnostic('Native live stack:',execFileSync('/usr/bin/lldb',['--batch','--attach-pid',mainPID,'-o','thread backtrace -c 24','-o','detach'],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024}).slice(0,7000));}catch(error){diagnostic('Native live stack:',String(error.stdout||'').slice(0,6000)+'\n'+String(error.stderr||'').slice(0,1000));}
    await terminate(processHandle);
    try{const file=await open(join(root,'profile-'+edition,'Chromium/cef.log'),'r');try{const size=(await file.stat()).size,bytes=Buffer.alloc(Math.min(size,16000));await file.read(bytes,0,bytes.length,Math.max(0,size-bytes.length));diagnostic('Native Chromium log:',bytes.toString());}finally{await file.close();}}catch{}
    const runtime=join(root,'runtime');for(const entry of await readdir(runtime).catch(()=>[])){
     if(!/^(arm64|x86_64)-[a-f0-9]{64}-[a-f0-9]{64}$/.test(entry))continue;
     const bundle=join(runtime,entry,'GAME PORTAL Runtime.app');const manifest=await readFile(join(bundle,'Contents/Resources/build.json'),'utf8').then(JSON.parse).catch(()=>null);if(manifest?.edition!==edition||!await stat(join(bundle,'Contents/MacOS/GAME-PORTAL-'+family)).then(value=>value.isFile()).catch(()=>false))continue;
     const args=['--batch','-k','thread backtrace -c 24','-o','run','-o','thread backtrace -c 24','-o','quit','--',join(bundle,'Contents/MacOS/GAME-PORTAL-'+family),'--test-mode','--profile',join(root,'profile-'+edition),'--application-directory',join(root,'Mac',edition==='creator'?'クリエイター用':'プレイ用'),'--test-script',script,'--result-file',result];
     try{diagnostic('Native debugger:',execFileSync('/usr/bin/lldb',args,{encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024}).slice(-16000));}catch(error){diagnostic('Native debugger:',String(error.stdout||'').slice(-24000)+'\n'+String(error.stderr||'').slice(-2000));}break;
    }
   }
   if(!value)diagnostic('Native startup output:',logs.slice(-30000));
   assert(value,'Mac app test did not finish: '+logs);assert.equal(value.ok,true,JSON.stringify(value)+'\n'+logs);
   assert(await waitForExit(processHandle,10000),'Mac window did not close after test: '+logs);assert.equal(processHandle.exitCode,0,logs);processHandle.stdout.destroy();processHandle.stderr.destroy();processHandle=null;
   if(corruptedOrigin)assert.equal(JSON.parse(await readFile(corruptedOrigin,'utf8')).schema,1,'Invalid signed runtime resources must be repaired without losing saves');
  }
 }
 assert.equal(JSON.parse(await readFile(join(disk,'game.html.gameportal.json'))).title,'Mac edited');
 console.log('Actual Mac standalone app passed: native filesystem invariants, Creator/Player, no external browser, native edit/write, help/settings, sandboxed play and persistent saves across restarts.');
}catch(error){diagnostic("Native test failure:",String(error.stack||error).slice(0,1800));for(const edition of ["creator","player"]){try{const log=await readFile(join(root,"profile-"+edition,"Chromium/cef.log"),"utf8");diagnostic("Chromium graphics/errors "+edition+":",log.split("\n").filter(line=>/ERROR|FATAL|gpu|[Ww]eb[Gg][Ll]|ANGLE|[Ss]wift[Ss]hader/.test(line)).slice(-60).join("\n"));}catch{}}diagnostic("Native helper/graphics output:",nativeOutput.split("\n").filter(line=>/lifecycle|CEF helper|ERROR|FATAL|[Gg][Pp][Uu]|[Ww]eb[Gg][Ll]|ANGLE|[Ss]wift[Ss]hader/.test(line)).slice(-80).join("\n"));
await delay(1500);const reports=join(homedir(),"Library/Logs/DiagnosticReports");for(const name of (await readdir(reports).catch(()=>[])).filter(name=>/^GAME[ -]PORTAL.*\.(ips|crash)$/.test(name))){const file=join(reports,name),info=await stat(file);if(Date.now()-info.mtimeMs<600000&&info.size<2*1024*1024)diagnostic("Native recent crash "+name+":",(await readFile(file,"utf8")).slice(0,18000));}
if(error.stdout)diagnostic("Native command output:",String(error.stdout));if(error.stderr)diagnostic("Native command error:",String(error.stderr));if(process.env.GITHUB_ACTIONS&&String(error).includes("WebGL2")){try{const values=JSON.parse(execFileSync("/usr/sbin/system_profiler",["SPDisplaysDataType","-json"],{encoding:"utf8",timeout:10000,maxBuffer:1024*1024}));diagnostic("Mac runner graphics:",JSON.stringify((values.SPDisplaysDataType||[]).map(device=>Object.fromEntries(Object.entries(device).filter(([key,value])=>/chipset|model|metal|vendor/.test(key)&&typeof value==="string")))));}catch{}}
throw error;}finally{if(processHandle)await terminate(processHandle);await rm(root,{recursive:true,force:true});}
