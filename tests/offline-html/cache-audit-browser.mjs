import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const instrument=source=>source.replace('let nativeBridge=null',`const auditCacheHandle=localState.cacheHandle;localState.cacheHandle=async(...args)=>{if(sessionStorage.getItem('audit-startup-delay')){sessionStorage.removeItem('audit-startup-delay');await new Promise(resolve=>setTimeout(resolve,7000));}return auditCacheHandle(...args);};
const auditPageConnection=nativeTools.nativePageConnection;
nativeTools.nativePageConnection=(...args)=>sessionStorage.getItem('audit-helper')?{origin:'http://127.0.0.1:1',token:'b'.repeat(64)}:auditPageConnection(...args);
const auditNativeFolder=nativeTools.nativeFolder;
nativeTools.nativeFolder=(...args)=>{window.auditHelperCalls=(window.auditHelperCalls||0)+1;if(sessionStorage.getItem('audit-helper')==='fallback')return(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('Folder B');Object.defineProperty(folder,'nativeReadOnly',{value:true});return folder;})();if(sessionStorage.getItem('audit-helper'))throw Error('Unavailable test helper');return auditNativeFolder(...args);};
let nativeBridge=null`);
const html=instrument(await readFile('GAME-PORTAL.html','utf8')),playerHTML=instrument(await readFile('GAME-PORTAL-PLAY.html','utf8'));
const exports=new Map(),server=createServer((q,r)=>r.end(exports.get(q.url)||(q.url==='/two'?playerHTML:html)));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-cache-audit-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined}),issues=[],errors=[];
try{
 await context.addInitScript(()=>{if(top!==window)return;FileSystemDirectoryHandle.prototype.queryPermission=async function(){return sessionStorage.getItem('audit-helper')==='fallback'&&this.name==='Folder B'&&!this.nativeReadOnly?'prompt':'granted';};FileSystemDirectoryHandle.prototype.requestPermission=async()=>{window.auditPermissionRequests=(window.auditPermissionRequests||0)+1;return 'granted';};});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:'+server.address().port;
 // The app permits 12 seconds for startup recovery; allow runner scheduling too.
 async function waitReady(){try{await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});}catch(error){error.message+='\nCaptured page errors: '+JSON.stringify(errors);throw error;}}
 async function visit(path){await page.goto(base+path);await waitReady();}
 async function select(name){await page.evaluate(name=>window.showDirectoryPicker=async()=>await(await navigator.storage.getDirectory()).getDirectoryHandle(name),name);await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#folderName')).toHaveText(name);}
 await visit('/one');await page.evaluate(async()=>{const opfs=await navigator.storage.getDirectory();for(const name of ['Folder A','Folder B']){const folder=await opfs.getDirectoryHandle(name,{create:true});await library.ensureLibraryId(folder);await library.writeFile(folder,'Game.html','<h1>Cache audit</h1>');}});
 await select('Folder A');await visit('/two');await select('Folder B');await visit('/one');
 // A slow permitted cache read can exceed Playwright's default five seconds.
 await page.evaluate(()=>sessionStorage.setItem('audit-startup-delay','true'));await page.reload();await waitReady();await expect(page.locator('#folderName')).toHaveText('Folder A');
 let actual=await page.locator('#folderName').textContent();if(actual!=='Folder A')issues.push('Opening another HTML lost the first HTML folder: '+actual);
 // A failed IDB cache write must not partially replace either record.
 assert.equal(await page.evaluate(async()=>{const before=await localState.cacheHandle(),put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='folder'&&value?.scope==='/failed')throw new DOMException('test quota','QuotaExceededError');return put.apply(this,arguments);};let failed=false;try{await localState.cacheHandle(root,true,'/failed');}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}const after=await localState.cacheHandle();return failed&&before.revision===after.revision&&(await localState.cacheHandle(null,true,'/failed'))===null;}),true);
 // Forget only this HTML's selection; the other edition and local saves remain.
 const libraryA=await page.evaluate(()=>localLibrary);await page.evaluate(()=>localState.writeLocalSave(localLibrary,'d'.repeat(32),{keep:'yes'}));
 await page.locator('#settingsButton').click();await page.locator('#folderMemoryDetails summary').click();await page.evaluate(()=>{const forget=localState.forgetHandle;localState.forgetHandle=async(...args)=>{await new Promise(resolve=>setTimeout(resolve,200));return forget(...args);};});
 // Wait for the forget transaction to commit before deliberately reloading.
 await page.locator('#forgetFolder').click();await page.waitForFunction(()=>!busy);assert.equal(await page.evaluate(()=>localState.cacheHandle(null,true,location.pathname)),null);await page.reload();await waitReady();await expect(page.locator('#folderName')).toHaveText('未選択');
 await visit('/two');await expect(page.locator('#folderName')).toHaveText('Folder B');assert.deepEqual(await page.evaluate(id=>localState.loadLocalSave(id,'d'.repeat(32)),libraryA),{keep:'yes'});
 // Upgrade from the old single-slot record, preserving it when the second edition selects a folder.
 await page.evaluate(async()=>{await localState.forgetHandle();const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('Folder A');const record={name:folder.name,handle:folder,scope:'/one'};await new Promise((resolve,reject)=>{const request=indexedDB.open('game-portal-offline-folder-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(record,'folder');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});});
 await visit('/one');await expect(page.locator('#folderName')).toHaveText('Folder A');await visit('/two');await select('Folder B');await visit('/one');await expect(page.locator('#folderName')).toHaveText('Folder A');
 // Cache failures must be visible even though the selected folder can still be opened.
 await page.evaluate(()=>{window.auditPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='folder'&&value?.scope===location.pathname)throw new DOMException('test cache quota','QuotaExceededError');return auditPut.apply(this,arguments);};});await select('Folder B');
 await page.evaluate(()=>checkSharedFolder());await expect(page.locator('#folderName')).toHaveText('Folder B');
 if(!(await page.locator('#status').textContent()).includes('記憶できませんでした'))issues.push('Folder cache failure was hidden after a successful connection');
 await page.evaluate(()=>{IDBObjectStore.prototype.put=auditPut;});await select('Folder A');
 for(const [path,name,editing]of [['/one','Folder A',true],['/two','Folder B',false]]){
  await visit(path);await page.evaluate(()=>{localStorage.setItem('game-portal.offline-editing','true');sessionStorage.setItem('audit-helper','unavailable');});await page.reload();await waitReady();
  actual=await page.locator('#folderName').textContent();if(actual!==name)issues.push('Native helper failure blocked an already permitted folder: '+actual);
  assert.equal(await page.evaluate(()=>editingEnabled),editing);assert.equal(await page.evaluate(()=>window.auditHelperCalls||0),0);
  await page.evaluate(()=>sessionStorage.removeItem('audit-helper'));
 }
 // Without a browser read grant, keep the helper's read-only fallback and never prompt automatically.
 await visit('/two');await page.evaluate(()=>sessionStorage.setItem('audit-helper','fallback'));await page.reload();await waitReady();await expect(page.locator('#folderName')).toHaveText('Folder B');assert.equal(await page.evaluate(()=>!!root.nativeReadOnly),true);assert.equal(await page.evaluate(()=>window.auditHelperCalls),1);assert.equal(await page.evaluate(()=>window.auditPermissionRequests||0),0);await page.evaluate(()=>sessionStorage.removeItem('audit-helper'));
 await visit('/export-source');
 for(let generation=1;generation<=2;generation++){const path='/export-'+generation;exports.set(path,await page.evaluate(()=>launcherSource()));await visit(path);const count=await page.locator('#homeLink .app-edition').count();if(count!==1)issues.push('Export generation '+generation+' duplicated the edition label: '+count);}
 assert.deepEqual(errors,[]);assert.deepEqual(issues,[]);
 console.log('Cache audit passed: slow seven-second startup within recovery budget, independent HTML folder restoration, permitted browser handle survives unavailable helper, two export generations keep one edition label.');
}finally{await context.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
