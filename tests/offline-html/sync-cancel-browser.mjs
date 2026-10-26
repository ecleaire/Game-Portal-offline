import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const editions={creator:await readFile('offline-release/GAME-PORTAL.html'),player:await readFile('offline-release/GAME-PORTAL-PLAY.html')},server=createServer((q,r)=>r.end(editions[q.url.slice(1)]||editions.creator));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-sync-cancel-'));
try{for(const edition of ['creator','player']){
 const context=await chromium.launchPersistentContext(join(profile,edition),{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
 try{
 await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/'+edition);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
 await page.evaluate(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('sync-cancel',{create:true}),management=await folder.getDirectoryHandle('.gameportal',{create:true});for(const [dir,name,text]of [[management,'library-id.json',JSON.stringify({schema:1,id:'a'.repeat(32)})],[folder,'game.html','<h1>Ready after cancellation</h1>']]){const writer=await(await dir.getFileHandle(name,{create:true})).createWritable();await writer.write(text);await writer.close();}window.showDirectoryPicker=async()=>folder;});
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);
 const identity=await page.evaluate(()=>({library:localLibrary,game:games[0].id}));
 // Each read can stall on a disconnected disk. A play click must stop waiting.
 for(const stage of ['compatibility','loadLibraryId','loadMetadata','scan']){
  await page.evaluate(stage=>{
   window.auditOwner=stage==='compatibility'?compatibilityTools:library;window.auditKey=stage==='compatibility'?'checkCompatibility':stage;window.auditOriginal=auditOwner[auditKey];window.auditRelease=null;
   let stalled=false;auditOwner[auditKey]=async(...args)=>{if(!stalled){stalled=true;await new Promise(resolve=>window.auditRelease=resolve);}return auditOriginal(...args);};
   lastHomeActivity=performance.now()-HOME_IDLE_MS-1;void syncLibrary({idle:true});
  },stage);
  await page.waitForFunction(()=>!!window.auditRelease);await page.locator('.game-title-link').click();
  await page.waitForFunction(()=>!syncPromise,{},{timeout:2500});
  // Release the old read only after cancellation. It must not replace the new state.
  await page.evaluate(()=>{auditOwner[auditKey]=auditOriginal;auditRelease();});
  await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Ready after cancellation');await page.waitForFunction(()=>!busy);await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
  assert.deepEqual(await page.evaluate(()=>({library:localLibrary,game:games[0].id})),identity);
 }
 // A shared-save directory read is also cancellable, with no late import or lock leak.
 await page.evaluate(()=>{window.auditOriginalDirectory=FileSystemDirectoryHandle.prototype.getDirectoryHandle;window.auditRelease=null;FileSystemDirectoryHandle.prototype.getDirectoryHandle=async function(name,...args){if(name==='shared-saves'){await new Promise(resolve=>window.auditRelease=resolve);}return auditOriginalDirectory.call(this,name,...args);};lastHomeActivity=performance.now()-HOME_IDLE_MS-1;void syncLibrary({idle:true});});
 await page.waitForFunction(()=>!!window.auditRelease);await page.locator('#settingsButton').click();await page.waitForFunction(()=>!syncPromise,{},{timeout:2500});
 await page.evaluate(()=>{FileSystemDirectoryHandle.prototype.getDirectoryHandle=auditOriginalDirectory;auditRelease();});await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#chooseFolder')).toBeEnabled();
 assert.equal(await page.evaluate(async()=>{const release=await localState.acquirePlaySession(localLibrary,games[0].id);release();return true;}),true);
 await page.locator('#settings [data-close]').click();await page.clock.install();
 await page.evaluate(()=>{window.auditOriginal=library.loadMetadata;window.auditRelease=null;library.loadMetadata=async(...args)=>{await new Promise(resolve=>window.auditRelease=resolve);return auditOriginal(...args);};lastHomeActivity=performance.now()-HOME_IDLE_MS-1;void syncLibrary({idle:true});});
 await page.waitForFunction(()=>!!window.auditRelease);await page.clock.fastForward(31000);await page.waitForFunction(()=>!syncPromise);await expect(page.locator('#syncStatus')).toContainText('応答しません');await expect(page.locator('#settingsButton')).toBeEnabled();
 await page.evaluate(()=>{pauseAutomaticConnection();library.loadMetadata=auditOriginal;auditRelease();});
 assert.deepEqual(errors,[]);console.log('Sync cancellation passed ('+edition+'): stalled compatibility/identity/metadata/scan/save-directory reads release UI and play locks; late results preserve library identity.');
 }finally{await context.close();}
}}finally{await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
