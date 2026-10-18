import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')process.exit(0);
const temporary=await mkdtemp(join(tmpdir(),'portal-mac-desktop-')),root=await import('node:fs/promises').then(async fs=>fs.realpath(temporary));
const suffix=process.env.PORTAL_MAC_SUFFIX||'MAC',disk=join(root,'ゲーム # +');let processHandle;
async function waitForExit(child,timeout){return Promise.race([new Promise(resolve=>child.exitCode!==null||child.signalCode!==null?resolve(true):child.once('exit',()=>resolve(true))),delay(timeout).then(()=>false)]);}
async function terminate(child){if(child.exitCode!==null||child.signalCode!==null)return;try{process.kill(-child.pid,'SIGTERM');}catch{}if(!await waitForExit(child,2000)){try{process.kill(-child.pid,'SIGKILL');}catch{}assert(await waitForExit(child,3000),'Native app did not terminate');}}
try{
 await mkdir(disk,{recursive:true});
 await writeFile(join(disk,'game.html'),'<!doctype html><h1>Native Mac play</h1><script>localStorage.setItem("mac-retained","yes");parent.postMessage({macGameReady:true,title:document.querySelector("h1").textContent,webgl2:!!document.createElement("canvas").getContext("webgl2"),wasm:WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0]))},"*");window.addEventListener("message",event=>{if(event.data==="security-test"){let parentBlocked=false;try{void parent.document;}catch{parentBlocked=true;}parent.postMessage({macSecurity:true,denied:typeof window.__portalSend==="undefined"&&parentBlocked},"*");}});</script>');
 await mkdir(join(root,'Mac/_内部ファイル'),{recursive:true});await cp(resolve('Mac/_内部ファイル/engine'),join(root,'Mac/_内部ファイル/engine'),{recursive:true});
 for(const edition of ['creator','player']){
  const name=(edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+suffix,app=join(root,'Mac',edition==='player'?'プレイ用':'クリエイター用',name+'.app');await cp(resolve(name+'.app'),app,{recursive:true});
  const executable=join(app,'Contents/MacOS/GAME-PORTAL-'+suffix);
  const selftest=join(root,'self-test-'+edition);execFileSync(executable,['--self-test',selftest],{timeout:30000,stdio:'pipe'});assert.equal(JSON.parse(await readFile(join(selftest,'result.json'))).ok,true);
  for(let cycle=0;cycle<2;cycle++){
   const result=join(root,edition+'-'+cycle+'.json'),script=join(root,edition+'-'+cycle+'.js');
   const body=`
const until=async(test,label)=>{for(let count=0;count<400;count++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label+' / '+document.body.innerText.slice(-500));};
const check=(condition,label)=>{if(!condition)throw Error(label);};
await until(()=>document.documentElement.dataset.ready==='true','startup');
if(${cycle}===0){check(!root,'first start has no selected folder');document.getElementById('settingsButton').click();check(document.getElementById('settings').open,'settings before connection');document.getElementById('desktopFolderPath').value=${JSON.stringify(disk)};await document.getElementById('desktopConnectPath').onclick();document.getElementById('settings').close();}
await until(()=>root,'native folder restore');
await until(()=>games.length===1,'game listing');
check(root.nativeDesktop&&!root.nativeReadOnly,'writable native adapter');
check(window.chrome?.webview===undefined,'no WebView2/browser dependency');
document.getElementById('helpButton').click();check(document.getElementById('help').open,'help opens');document.getElementById('help').close();
document.getElementById('settingsButton').click();check(document.getElementById('settings').open,'settings opens');document.getElementById('settings').close();
check(await root.queryPermission({mode:'readwrite'})==='granted','no browser permission needed');
if(launcherEdition==='creator'&&${cycle}===0){const input=document.getElementById('enableEditing');input.checked=true;await input.onchange();check(editingEnabled,'native edit mode');editGame(games[0]);document.getElementById('editTitle').value='Mac edited';document.getElementById('editEnvironment').value='HTML';document.getElementById('editDescription').value='Native metadata';document.getElementById('editForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>!busy&&!document.getElementById('edit').open,'metadata save');check(games[0].title==='Mac edited','edited title');}
if(launcherEdition==='player'){check(!editingEnabled,'player mode');let blocked=false;try{await root.getFileHandle('forbidden.html',{create:true});}catch{blocked=true;}check(blocked,'native player write denial');}
const library=localLibrary;
if(${cycle}===1)check((await localState.loadLocalSave(library,games[0].id))['mac-retained']==='yes','save survives real app restart before game starts');
let gameReady=null,security=null;const listener=event=>{if(event.source!==document.getElementById('frame').contentWindow)return;if(event.data?.macGameReady)gameReady=event.data;if(event.data?.macSecurity)security=event.data;};window.addEventListener('message',listener);
await playGame(games[0]);await until(()=>!busy&&!document.getElementById('frame').hidden,'game opens');
await until(()=>gameReady,'game really executed');check(gameReady.title==='Native Mac play'&&gameReady.wasm&&gameReady.webgl2,'WebGL2 and WebAssembly inside bundled Chromium');document.getElementById('frame').contentWindow.postMessage('security-test','*');await until(()=>security,'sandbox test');check(security.denied,'game cannot call the native host or access its parent');window.removeEventListener('message',listener);
check(document.getElementById('frame').sandbox.contains('allow-scripts')&&!document.getElementById('frame').sandbox.contains('allow-same-origin'),'game sandbox retained');
await until(()=>activePlay?.latest?.['mac-retained']==='yes','game save received');check(await flushSave(),'game save persisted');
stopPlayer();return {edition:launcherEdition,cycle:${cycle},library,version:document.getElementById('appVersion').textContent};`;
   // Tests execute the actual bundled Chromium application on macOS CI.
   // This does not claim physical macOS 10.14.6 testing.
   await writeFile(script,body);let logs='';processHandle=spawn(executable,['--test-mode','--profile',join(root,'profile-'+edition),'--test-script',script,'--result-file',result],{detached:true,stdio:['ignore','pipe','pipe']});processHandle.stdout.on('data',data=>logs+=data);processHandle.stderr.on('data',data=>logs+=data);
   let value;for(let count=0;count<900;count++){value=await readFile(result,'utf8').then(JSON.parse).catch(()=>null);if(value)break;if(processHandle.exitCode!==null)break;await delay(100);}
   assert(value,'Mac app test did not finish: '+logs);assert.equal(value.ok,true,JSON.stringify(value)+'\n'+logs);
   assert(await waitForExit(processHandle,10000),'Mac window did not close after test: '+logs);assert.equal(processHandle.exitCode,0,logs);processHandle=null;
  }
 }
 assert.equal(JSON.parse(await readFile(join(disk,'game.html.gameportal.json'))).title,'Mac edited');
 console.log('Actual Mac standalone app passed: native filesystem invariants, Creator/Player, no external browser, native edit/write, help/settings, sandboxed play and persistent saves across restarts.');
}finally{if(processHandle)await terminate(processHandle);await rm(root,{recursive:true,force:true});}
