import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')process.exit(0);
const temporary=await mkdtemp(join(tmpdir(),'portal-mac-desktop-')),root=await import('node:fs/promises').then(async fs=>fs.realpath(temporary));
const suffix=process.env.PORTAL_MAC_SUFFIX||'MAC',disk=join(root,'ゲーム # +'),id='a'.repeat(32);let processHandle;
try{
 await mkdir(join(disk,'.gameportal'),{recursive:true});await writeFile(join(disk,'.gameportal/library-id.json'),JSON.stringify({schema:1,id}));
 await writeFile(join(disk,'game.html'),'<!doctype html><h1>Native Mac play</h1><script>window.addEventListener("message",event=>{if(event.data==="security-test"){let denied=false;try{window.webkit.messageHandlers.gamePortal.postMessage({id:777,op:"remove",root:"fake",path:"game.html"});}catch{denied=true;}parent.postMessage({gameTest:true,denied},"*");}});</script>');
 for(const edition of ['creator','player']){
  const name=(edition==='player'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+suffix,app=join(root,name+'.app');await cp(resolve(name+'.app'),app,{recursive:true});
  const executable=join(app,'Contents/MacOS/GAME-PORTAL-'+suffix);
  const selftest=join(root,'self-test-'+edition);execFileSync(executable,['--self-test',selftest],{timeout:30000,stdio:'pipe'});assert.equal(JSON.parse(await readFile(join(selftest,'result.json'))).ok,true);
  for(let cycle=0;cycle<2;cycle++){
   const result=join(root,edition+'-'+cycle+'.json'),script=join(root,edition+'-'+cycle+'.js');
   const body=`
const until=async(test,label)=>{for(let count=0;count<400;count++){if(await test())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label+' / '+document.body.innerText.slice(-500));};
const check=(condition,label)=>{if(!condition)throw Error(label);};
await until(()=>document.documentElement.dataset.ready==='true'&&typeof root!=='undefined'&&root,'startup');
await until(()=>games.length===1,'game listing');
check(root.nativeDesktop&&!root.nativeReadOnly,'writable native adapter');
check(window.chrome?.webview===undefined,'no WebView2/browser dependency');
document.getElementById('helpButton').click();check(document.getElementById('help').open,'help opens');document.getElementById('help').close();
document.getElementById('settingsButton').click();check(document.getElementById('settings').open,'settings opens');document.getElementById('settings').close();
check(await root.queryPermission({mode:'readwrite'})==='granted','no browser permission needed');
if(launcherEdition==='creator'&&${cycle}===0){const input=document.getElementById('enableEditing');input.checked=true;await input.onchange();check(editingEnabled,'native edit mode');editGame(games[0]);document.getElementById('editTitle').value='Mac edited';document.getElementById('editEnvironment').value='HTML';document.getElementById('editDescription').value='Native metadata';document.getElementById('editForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await until(()=>!busy&&!document.getElementById('edit').open,'metadata save');check(games[0].title==='Mac edited','edited title');}
if(launcherEdition==='player'){check(!editingEnabled,'player mode');let blocked=false;try{await root.getFileHandle('forbidden.html',{create:true});}catch{blocked=true;}check(blocked,'native player write denial');}
const library=localLibrary;
await playGame(games[0]);await until(()=>!busy&&document.getElementById('frame').src,'game opens');
check(document.getElementById('frame').sandbox.contains('allow-scripts')&&!document.getElementById('frame').sandbox.contains('allow-same-origin'),'game sandbox retained');
if(${cycle}===0)await localState.writeLocalSave(library,games[0].id,{'mac-retained':'yes'});else check((await localState.loadLocalSave(library,games[0].id))['mac-retained']==='yes','save survives real app restart');
stopPlayer();return {edition:launcherEdition,cycle:${cycle},library,version:document.getElementById('appVersion').textContent};`;
   // Latest-system WebKit is tested here. The shipped launcher is separately
   // transformed for Safari 12 syntax; this is not old-OS physical testing.
   await writeFile(script,body);let logs='';processHandle=spawn(executable,['--test-mode','--profile',join(root,'profile-'+edition),'--library',disk,'--test-script',script,'--result-file',result],{stdio:['ignore','pipe','pipe']});processHandle.stdout.on('data',data=>logs+=data);processHandle.stderr.on('data',data=>logs+=data);
   let value;for(let count=0;count<900;count++){value=await readFile(result,'utf8').then(JSON.parse).catch(()=>null);if(value)break;if(processHandle.exitCode!==null)break;await delay(100);}
   assert(value,'Mac app test did not finish: '+logs);assert.equal(value.ok,true,JSON.stringify(value)+'\n'+logs);
   await new Promise(resolve=>processHandle.exitCode!==null?resolve():processHandle.once('exit',resolve));assert.equal(processHandle.exitCode,0,logs);processHandle=null;
  }
 }
 assert.equal(JSON.parse(await readFile(join(disk,'game.html.gameportal.json'))).title,'Mac edited');
 console.log('Actual Mac standalone app passed: native filesystem invariants, Creator/Player, no external browser, native edit/write, help/settings, sandboxed play and persistent saves across restarts.');
}finally{if(processHandle){processHandle.kill();await new Promise(resolve=>processHandle.exitCode!==null?resolve():processHandle.once('exit',resolve));}await rm(root,{recursive:true,force:true});}
