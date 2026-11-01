import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
const html=await readFile('GAME-PORTAL.html'),server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-receipts-')),context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
try{
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
 await page.evaluate(async()=>{
  window.receipt={schema:1,libraryId:'a'.repeat(32),id:'b'.repeat(32),gamePath:'Game.html',historyName:'abc.json',expectedHash:'c'.repeat(64),beforeHash:null,kind:'edit',uploadFolder:null};
  window.rawReceipt=async(mode,value,key='save-receipts')=>new Promise((resolve,reject)=>{const request=indexedDB.open('game-portal-offline-folder-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('settings',mode),store=tx.objectStore('settings');let result;const op=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);op.onsuccess=()=>result=op.result;tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(tx.error);};};request.onerror=()=>reject(request.error);});
 });
 for(const kind of ['null','false','zero','empty','sparse','mixed-sparse']){
  const outcome=await page.evaluate(async kind=>{
   const value=kind==='null'?null:kind==='false'?false:kind==='zero'?0:kind==='empty'?'':kind==='sparse'?new Array(1):[,receipt];await rawReceipt('readwrite',value);
   let readRejected=false,writeRejected=false;try{await localState.loadSettingsReceipts();}catch{readRejected=true;}try{await localState.trackSettingsReceipt(receipt);}catch{writeRejected=true;}
   const after=await rawReceipt('readonly');const unchanged=Array.isArray(value)?Array.isArray(after)&&after.length===value.length&&Object.keys(after).join()===Object.keys(value).join()&&JSON.stringify(after)===JSON.stringify(value):after===value;
   return {readRejected,writeRejected,unchanged};
  },kind);assert.deepEqual(outcome,{readRejected:true,writeRejected:true,unchanged:true},kind);
 }
 await page.evaluate(async()=>{await rawReceipt('readwrite',undefined);await localState.trackSettingsReceipt(receipt);await localState.trackSettingsReceipt(receipt);});assert.equal(await page.evaluate(async()=>(await localState.loadSettingsReceipts()).length),1);
 await page.evaluate(()=>localState.trackSettingsReceipt(receipt,true));assert.deepEqual(await page.evaluate(()=>localState.loadSettingsReceipts()),[]);
 await page.evaluate(()=>Promise.all([localState.trackSettingsReceipt(receipt),localState.trackSettingsReceipt({...receipt,id:'d'.repeat(32),gamePath:'Other.html',historyName:'def.json'})]));assert.equal(await page.evaluate(async()=>(await localState.loadSettingsReceipts()).length),2);
 assert.equal(await page.evaluate(async()=>{const before=await rawReceipt('readonly');let rejected=false;try{await localState.trackSettingsReceipt({...receipt,historyName:'fed.json'},false,{...receipt,historyName:'bad.json'});}catch{rejected=true;}return rejected&&JSON.stringify(before)===JSON.stringify(await rawReceipt('readonly'));}),true);
 assert.equal(await page.evaluate(async()=>{const key=['save-backups',receipt.libraryId,receipt.id];await localState.writeLocalSave(receipt.libraryId,receipt.id,{score:'keep'});await rawReceipt('readwrite',new Array(1),key);let blocked=0;try{await localState.backupLocalSave(receipt.libraryId,receipt.id,'manual');}catch{blocked++;}try{await localState.restoreLocalSaveBackup(receipt.libraryId,receipt.id,'missing');}catch{blocked++;}const after=await rawReceipt('readonly',undefined,key),save=await localState.loadLocalSave(receipt.libraryId,receipt.id);return blocked===2&&after.length===1&&Object.keys(after).length===0&&save.score==='keep';}),true);
 // Exercise the visible recovery path with actual OPFS files and durable
 // browser receipts when the very first settings writer cannot be opened.
 await page.evaluate(async()=>{
  await rawReceipt('readwrite',undefined);
  window.initialSettingsRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('initial-settings-recovery',{create:true});
  const w=await(await initialSettingsRoot.getFileHandle('Fresh.html',{create:true})).createWritable();await w.write('<h1>Original game</h1>');await w.close();
  window.showDirectoryPicker=async()=>initialSettingsRoot;
 });
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy&&!!root);await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();
 await page.locator('#editTitle').fill('Recovered first edit');await page.locator('#editEnvironment').fill('HTML');
 await page.evaluate(()=>{
  const folder=root,original=folder.getFileHandle.bind(folder);
  folder.getFileHandle=async(name,options)=>{const handle=await original(name,options);if(name==='Fresh.html.gameportal.json')handle.createWritable=async()=>{throw new DOMException('Initial writer blocked','NotAllowedError');};return handle;};
  window.restoreInitialSettingsWriter=()=>{folder.getFileHandle=original;};
 });
 await page.locator('#saveGameSettings').click();await expect(page.locator('#saveVerification')).toBeVisible();await page.waitForFunction(()=>!busy);
 assert.equal(await page.evaluate(async()=>(await localState.loadSettingsReceipts()).length),1);
 assert.equal(await page.evaluate(async()=>await(await(await initialSettingsRoot.getFileHandle('Fresh.html.gameportal.json')).getFile()).text()),'');
 await page.evaluate(()=>restoreInitialSettingsWriter());
 // Recovery must survive losing the editor's in-memory values and handles.
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
 await page.evaluate(async()=>{window.initialSettingsRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('initial-settings-recovery');window.showDirectoryPicker=async()=>initialSettingsRoot;});
 if(!await page.evaluate(()=>!!root)){await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy&&!!root);}
 await page.locator('#openSaveVerification').click();await page.locator('#verifySettingsSaves').click();await page.waitForFunction(()=>!busy);await expect(page.locator('[data-retry-settings]')).toBeVisible();
 await page.locator('[data-retry-settings]').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#edit')).toBeHidden();
 const recovered=await page.evaluate(async()=>({settings:JSON.parse(await(await(await initialSettingsRoot.getFileHandle('Fresh.html.gameportal.json')).getFile()).text()),game:await(await(await initialSettingsRoot.getFileHandle('Fresh.html')).getFile()).text(),receipts:await localState.loadSettingsReceipts()}));
 assert.equal(recovered.settings.title,'Recovered first edit');assert.equal(recovered.game,'<h1>Original game</h1>');assert.deepEqual(recovered.receipts,[]);
 assert.deepEqual(errors,[]);console.log('Receipt integrity passed: initial settings writer failure recovered through visible verification/retry without changing game bytes, malformed/falsy/sparse records preserved on read and write failure, missing storage initializes, repeated writes are idempotent, concurrent records survive, stale replacement preserves existing records.');
}finally{await context.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
