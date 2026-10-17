import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
if(!['win32','darwin'].includes(process.platform))process.exit(0);
const root=await mkdtemp(join(tmpdir(),'portal-native-distribution-')),libraryId='c'.repeat(32),{version}=JSON.parse(await readFile('package.json'));
let helper;
try{
 await mkdir(join(root,'shared games/.gameportal'),{recursive:true});
 await writeFile(join(root,'shared games/.gameportal/library-id.json'),JSON.stringify({schema:1,id:libraryId}));
 await writeFile(join(root,'shared games/.gameportal/compatibility.json'),JSON.stringify({schema:1,minLauncherVersion:'0.22.0',requiredFeatures:['extended-tags-v1']}));
 await writeFile(join(root,'GAME-PORTAL-DISTRIBUTION.json'),JSON.stringify({schema:1,project:'GAME-PORTAL',layout:'platform-role'}));
 await writeFile(join(root,'GAME-PORTAL-CONNECTION.json'),JSON.stringify({schema:1,kind:'relative',path:'shared games',libraryId}));
 // The common pinned JSON takes precedence over a stale legacy text path.
 await writeFile(join(root,'GAME-PORTAL-FOLDER.txt'),'missing legacy folder');
 const source=resolve(process.env.PORTAL_NATIVE_EXE||(process.platform==='win32'?'GAME-PORTAL-WINDOWS.exe':'GAME-PORTAL-MAC'));
 for(const role of ['プレイ用','クリエイター用']){
  const folder=join(root,'HTML',role),ready=join(root,role+'-ready.json'),filename=role==='プレイ用'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html';await mkdir(folder,{recursive:true});
  await writeFile(join(folder,filename),'<h1>Launcher fixture</h1>');
  const executable=join(folder,process.platform==='win32'?'helper.exe':'helper');await cp(source,executable);
  // No --html override: the Player helper must discover its only adjacent HTML.
  helper=spawn(executable,['--headless','--ready-file',ready],{windowsHide:true,stdio:'pipe'});let output='';helper.stderr.on('data',bytes=>output+=bytes);
  let info;for(let n=0;n<150;n++){try{info=JSON.parse(await readFile(ready));break;}catch{if(helper.exitCode!==null)throw Error(output||'helper exited');await delay(100);}}assert(info,'helper readiness');
  const response=await fetch(info.origin+'/native/folder',{method:'POST',headers:{Origin:'null','Content-Type':'application/json','X-Game-Portal-Token':info.token},body:JSON.stringify({version,action:'info',path:''}),signal:AbortSignal.timeout(10000)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.configured,true);assert.equal(result.name,'shared games');
  const identity=await fetch(info.origin+'/native/folder',{method:'POST',headers:{Origin:'null','Content-Type':'application/json','X-Game-Portal-Token':info.token},body:JSON.stringify({version,action:'read',path:'.gameportal/library-id.json'}),signal:AbortSignal.timeout(10000)});assert.equal(identity.status,200);assert.equal((await identity.json()).id,libraryId);
  helper.kill();await new Promise(resolve=>(helper.exitCode!==null||helper.signalCode!==null)?resolve():helper.once('exit',resolve));helper=null;
 }
 console.log('Native distribution passed: both roles find their HTML, share the common pinned connection and accept extended tags.');
}finally{if(helper){helper.kill();await new Promise(resolve=>(helper.exitCode!==null||helper.signalCode!==null)?resolve():helper.once('exit',resolve));}assert(resolve(root).startsWith(resolve(tmpdir())));await rm(root,{recursive:true,force:true});}
