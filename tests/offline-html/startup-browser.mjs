import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
let html=await readFile('offline-release/GAME-PORTAL.html','utf8');
html=html.replace('function initialized() {',`const originalStartupCompatibility=compatibilityTools.checkCompatibility;compatibilityTools.checkCompatibility=(...args)=>sessionStorage.getItem('startup-test')==='compatibility'?new Promise((resolve,reject)=>{window.releaseStartupCompatibility=()=>{const error=new Error('Late incompatible old folder');error.code='LIBRARY_INCOMPATIBLE';reject(error);};}):originalStartupCompatibility(...args);
const originalStartupScan=library.scan;
library.scan=(...args)=>sessionStorage.getItem('startup-test')==='scan'?new Promise(resolve=>{window.releaseStartupScan=async()=>resolve(await originalStartupScan(...args));}):originalStartupScan(...args);
function initialized() {`);
const server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
// Match a normal Chrome profile: Chromium 153 can crash when restoring OPFS handles in an incognito context.
const profiles=[],contexts=new Set();
try{
 for(const mode of ['permission','scan','compatibility','database','upgrade']){
  const profile=await mkdtemp(join(tmpdir(),'portal-startup-'));profiles.push(profile);const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});contexts.add(context);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   if(window!==window.top)return;
   if(window.FileSystemDirectoryHandle){FileSystemDirectoryHandle.prototype.queryPermission=()=>sessionStorage.getItem('startup-test')==='permission'?new Promise(resolve=>{window.releaseStartupPermission=()=>resolve('granted');}):Promise.resolve('granted');FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';}
   if(['database','upgrade'].includes(sessionStorage.getItem('startup-test'))){const open=indexedDB.open.bind(indexedDB);window.realStartupOpen=open;indexedDB.open=(...args)=>{const pending={};window.finishLateDatabase=()=>new Promise(resolve=>{const actual=open(...args);actual.onupgradeneeded=()=>{pending.result=actual.result;pending.transaction=actual.transaction;pending.onupgradeneeded?.();};actual.onerror=event=>{event.preventDefault();pending.error=actual.error;pending.onerror?.();resolve();};actual.onsuccess=()=>{pending.result=actual.result;pending.onsuccess?.();resolve();};});return pending;};}
  });
  // Finish cold-profile storage setup before injecting a controlled startup fault.
  // The recovery deadlines and immediate Help checks below remain independent.
  await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:20000});
  await page.evaluate(async()=>{const opfs=await navigator.storage.getDirectory();window.testOld=await opfs.getDirectoryHandle('Old',{create:true});await library.writeFile(testOld,'old.html','<h1>Old game</h1>');window.showDirectoryPicker=async()=>testOld;});
  await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);
  if(mode==='upgrade')await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('game-portal-offline-folder-v1');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('game-portal-offline-folder-v1',2);r.onupgradeneeded=()=>{for(const name of ['settings','saves','libraries'])r.result.createObjectStore(name);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(['settings','saves','libraries'],'readwrite');for(const name of ['settings','saves','libraries'])tx.objectStore(name).put('KEEP_'+name,'sentinel');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();});
  await page.evaluate(mode=>sessionStorage.setItem('startup-test',mode),mode);
  await page.reload();await expect(page.locator('#helpButton')).toBeEnabled();await page.locator('#helpButton').click();await expect(page.locator('#help')).toBeVisible();await page.locator('#help [data-close]').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:20000});
  await expect(page.locator('#helpButton')).toBeEnabled();await page.locator('#helpButton').click();await expect(page.locator('#help')).toBeVisible();await page.locator('#help [data-close]').first().click();
  await page.locator('#settingsButton').click();await expect(page.locator('#settings')).toBeVisible();await expect(page.locator('#chooseFolder')).toBeEnabled();
  await page.locator('#folderSelectionHelp > summary').click();assert((await page.locator('#folderDrop').boundingBox()).height>=160);
  await expect(page.locator('#status')).toContainText(['database','upgrade'].includes(mode)?'保存機能':'自動接続を中止');
  if(!['database','upgrade'].includes(mode)){
   await page.evaluate(async()=>{sessionStorage.removeItem('startup-test');window.testNew=await(await navigator.storage.getDirectory()).getDirectoryHandle('New',{create:true});await library.writeFile(testNew,'new.html','<h1>New game</h1>');window.showDirectoryPicker=async()=>testNew;});
   await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#folderName')).toHaveText('New');
   await page.evaluate(async mode=>{if(mode==='permission')releaseStartupPermission();else if(mode==='compatibility')releaseStartupCompatibility();else await releaseStartupScan();},mode);
   await page.waitForTimeout(100);await expect(page.locator('#folderName')).toHaveText('New');await expect(page.locator('#compatibilityNotice')).toBeHidden();assert.equal(await page.evaluate(()=>syncPaused),false);await expect(page.locator('.game-title-link')).toHaveText('new');
   await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('h1')).toHaveText('New game');
  }else{
   await page.evaluate(async()=>{sessionStorage.removeItem('startup-test');await finishLateDatabase();indexedDB.open=realStartupOpen;});await expect(page.locator('#settings')).toBeVisible();
   if(mode==='upgrade')assert.deepEqual(await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('game-portal-offline-folder-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const result={version:db.version};for(const name of ['settings','saves','libraries'])result[name]=await new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).get('sentinel');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return result;}),{version:2,settings:'KEEP_settings',saves:'KEEP_saves',libraries:'KEEP_libraries'});
  }
  assert.deepEqual(errors,[]);await context.close();contexts.delete(context);console.log('Startup recovery passed:',mode);
 }
}finally{for(const context of contexts)await context.close().catch(()=>{});await new Promise(r=>server.close(r));for(const profile of profiles){assert.equal(dirname(profile),resolve(tmpdir()));await rm(profile,{recursive:true,force:true});}}
