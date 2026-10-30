import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,copyFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(process.platform!=='win32'){console.log('Windows player EXE test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'portal-player-')),app=join(temp,'launcher'),disk=join(app,'Library'),profile=join(temp,'profile'),exe=join(app,'GAME-PORTAL-PLAY.exe'),html='<html><body>PLAYER <button onclick="localStorage.score=42">SAVE</button></body></html>';
let child,browser;
try{
 await mkdir(join(disk,'.gameportal'),{recursive:true});await writeFile(join(disk,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'a'.repeat(32)}));await writeFile(join(disk,'Game.html'),html);
 await copyFile(resolve(process.env.PORTAL_DESKTOP_PLAYER_EXE||'GAME-PORTAL-PLAY.exe'),exe);await writeFile(join(app,'GAME-PORTAL-CONNECTION.json'),JSON.stringify({schema:1,kind:'relative',path:'Library',libraryId:'a'.repeat(32)}));
 for(let cycle=0;cycle<3;cycle++){
  const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const ready=join(temp,'ready-'+cycle+'.json');
  child=spawn(exe,['--profile',profile,'--debug-port',String(port),'--ready-file',ready,'--test-mode'],{windowsHide:true,stdio:'pipe'});
  for(let n=0;;n++){try{await readFile(ready);break;}catch{if(child.exitCode!==null||n>250)throw Error('Player failed to start');await delay(100);}}
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);let page;for(let n=0;n<150;n++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}assert(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.locator('html')).toHaveAttribute('data-ready','true');await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('#postButton')).toBeHidden();assert.equal(await page.evaluate(()=>editingEnabled),false);
  assert.equal(await page.locator('#desktopShareConnection').count(),0);assert.match(await page.evaluate(async()=>{try{await desktopHost.share(root,(await desktopHost.sharedInfo(root)).revision);return 'unexpected';}catch(error){return error.message;}}),/クリエイター/);
  if(cycle===0){
   const other=join(app,'OtherLibrary');await mkdir(join(other,'.gameportal'),{recursive:true});await writeFile(join(other,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'b'.repeat(32)}));await writeFile(join(other,'Other.html'),'<h1>Creator selected another library</h1>');
   // Simulate another PC atomically changing the shared default while this
   // unconfigured Player stays open. No local folder selection is required.
   const sharedFile=join(app,'GAME-PORTAL-CONNECTION.json');
   const setShared=async(path,id)=>{const temp=sharedFile+'.test.tmp';await writeFile(temp,JSON.stringify({schema:1,kind:'relative',path,libraryId:id}));await rename(temp,sharedFile);};
   await setShared('OtherLibrary','b'.repeat(32));await page.bringToFront();await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('OtherLibrary');
   await setShared('Library','a'.repeat(32));await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('Library');
   await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#player')).toBeVisible();
   await setShared('OtherLibrary','b'.repeat(32));await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('Library');
   await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('OtherLibrary');
   await setShared('Library','a'.repeat(32));await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('Library');
   await page.evaluate(()=>localState.cacheHandle(root));const originalSelection=JSON.parse(await readFile(join(profile,'folder.json'),'utf8'));
   // Creator and Player use the same local selection file. Simulate the
   // atomic Creator update while the actual Player window is already open.
   await writeFile(join(profile,'folder.json'),JSON.stringify({...originalSelection,path:other,id:'b'.repeat(32)}));await page.bringToFront();const folderDiagnostic=await page.evaluate(async()=>({hidden:document.hidden,paused:automaticConnectionPaused,busy,starting,dialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id),native:(await desktopHost.current())?.name,status:document.getElementById('status').textContent}));await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName'),JSON.stringify(folderDiagnostic)).toHaveText('OtherLibrary',{timeout:10000});assert.equal(await page.evaluate(()=>localLibrary),'b'.repeat(32));
   await writeFile(join(profile,'folder.json'),JSON.stringify({...originalSelection,path:disk,id:'a'.repeat(32)}));await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('Library');assert.equal(await page.evaluate(()=>localLibrary),'a'.repeat(32));
  }
  await rm(join(app,'GAME-PORTAL-CONNECTION.json'));await page.evaluate(()=>localState.cacheHandle(root));await assert.rejects(readFile(join(app,'GAME-PORTAL-CONNECTION.json')),{code:'ENOENT'});await writeFile(join(app,'GAME-PORTAL-CONNECTION.json'),JSON.stringify({schema:1,kind:'relative',path:'Library',libraryId:'a'.repeat(32)}));
  await page.locator('#settingsButton').click();await page.locator('#folderDrop').scrollIntoViewIfNeeded();
  const drop=await page.locator('#folderDrop').boundingBox(),cdp=await browser.contexts()[0].newCDPSession(page);
  for(const type of ['dragEnter','dragOver','drop'])await cdp.send('Input.dispatchDragEvent',{type,x:drop.x+drop.width/2,y:drop.y+drop.height/2,data:{items:[],files:[disk],dragOperationsMask:2}});
  await page.waitForFunction(()=>!busy);await expect(page.locator('#settings')).toBeHidden();await expect(page.locator('.card')).toHaveCount(1);await cdp.detach();
  // Exercise the native boundary directly, bypassing UI and JS edition guards.
  const rejected=await page.evaluate(async()=>{
   const token=root.desktopToken;let id=1000000;const rpc=data=>new Promise(resolve=>{const request=++id;const receive=e=>{if(e.data.id!==request)return;chrome.webview.removeEventListener('message',receive);resolve(e.data);};chrome.webview.addEventListener('message',receive);chrome.webview.postMessage({id:request,root:token,...data});});
   const results=[];for(const data of [{op:'recoverSharedConnection',revision:'missing'},{op:'file',path:'Game.html',create:true},{op:'file',path:'Injected.html',create:true},{op:'directory',path:'new-game',create:true},{op:'beginWrite',path:'Game.html'},{op:'beginWrite',path:'.gameportal/library-id.json'},{op:'remove',path:'Game.html'},{op:'remove',path:'.gameportal/shared-saves',recursive:true},{op:'file',path:'.gameportal/shared-saves/../Injected.json',create:true}])results.push(!(await rpc(data)).ok);
   const record=await desktopHost.current();const response=await fetch('/io/write?root='+token+'&path=Game.html&writer=invalid',{method:'POST',headers:{'X-Game-Portal-Desktop':record.secret},body:'broken'});results.push(!response.ok);return results;
  });assert(rejected.every(Boolean));assert.equal(await readFile(join(disk,'Game.html'),'utf8'),html);
  await page.locator('.card').click();await expect(page.frameLocator('#frame').locator('body')).toContainText('PLAYER');await page.frameLocator('#frame').getByText('SAVE',{exact:true}).click();await page.waitForFunction(()=>activePlay?.latest?.score==='42');await page.evaluate(()=>window.beforeReload=activePlay);await page.locator('#reloadPlaying').click();await page.waitForFunction(()=>!busy&&activePlay!==window.beforeReload&&!gameLoading);assert.equal(await page.frameLocator('#frame').locator('body').evaluate(()=>localStorage.getItem('score')),'42');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!busy&&!pendingSave&&!flushing);
  await page.locator('#settingsButton').click();await expect(page.locator('.settings-editing')).toBeHidden();await page.locator('#syncSaves').click();await page.waitForFunction(()=>!busy&&!syncPromise);await expect(page.locator('#sharedSaveStatus')).toContainText('セーブ同期を確認しました');await page.locator('#settings [data-close]').click();
  const shared=join(disk,'.gameportal/shared-saves');assert((await readdir(shared)).length>0,'player may publish supported saves');assert.equal(await readFile(join(disk,'Game.html'),'utf8'),html);assert.deepEqual(errors,[]);
  await page.waitForFunction(()=>!busy&&!pendingSave&&!flushing);await page.evaluate(()=>chrome.webview.postMessage({id:2000000,op:'closeWindow'}));await browser.close();browser=null;for(let n=0;child.exitCode===null&&n<100;n++)await delay(100);assert.equal(child.exitCode,0);child=null;
 }
 console.log('Windows player passed: three native app starts, automatic folder restore, play/save/shared-save writes; ten direct forbidden native mutations per cycle denied and game bytes preserved.');
}finally{await browser?.close();if(child&&child.exitCode===null)child.kill();await rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:200}).catch(()=>console.log('Temporary test profile will be released when WebView2 exits.'));}
