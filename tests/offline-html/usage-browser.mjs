import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html'),server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-usage-browser-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,viewport:{width:1280,height:960}});
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await page.locator('#settingsButton').click();await page.locator('#inspectButton').click();await expect(page.locator('#measureUsage')).toBeDisabled();await page.locator('#inspection [data-close]').click();
 await page.evaluate(async()=>{
   const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('usage-library',{create:true});window.usageRoot=dir;window.showDirectoryPicker=async()=>dir;
   library.setSettingsSaveObserver(async()=>{});const id=await library.ensureLibraryId(dir);await library.postGame(dir,[new File(['Original'],'original.html')],preview);
   let game=(await library.scan(dir,{games:{}}))[0];await library.saveGameSettings(dir,game,{...game,title:'Capacity Game',thumbnail:null});game=(await library.scan(dir,{games:{}}))[0];
   const check=(files,tools,packages)=>improvements.checkUpload(files,tools,packages,maintenance.localResources);
   for(const version of ['second','third']){await updateTools.replaceGameContent(dir,game,[new File([version],version+'.html')],id,library,preview,check);game=(await library.scan(dir,{games:{}}))[0];}
   window.usageGame=game;window.stagedVersion=crypto.randomUUID();await library.writeFile(dir,game.path.split('/')[0]+'/.gameportal-versions/'+window.stagedVersion+'/partial.bin',new Uint8Array(37));
   await library.writeFile(dir,'direct/.hidden.bin',new Uint8Array(19));await library.writeFile(dir,'loose.html','Loose');
   window.usageSnapshot=async()=>{const result=[];async function walk(folder,prefix=''){for await(const e of folder.values()){if(e.kind==='directory')await walk(e,prefix+e.name+'/');else{const f=await e.getFile(),digest=await crypto.subtle.digest('SHA-256',await f.arrayBuffer());result.push([prefix+e.name,f.size,[...new Uint8Array(digest)].join(',')]);}}}await walk(dir);return result.sort((a,b)=>a[0].localeCompare(b[0]));};
   window.beforeUsage=await window.usageSnapshot();window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(){throw new Error('Capacity must not write');};
 });
 await page.locator('#settingsButton').click();await page.locator('#inspectButton').click();await page.locator('#inspectionFolder').click();await page.waitForFunction(()=>!busy);await page.locator('#measureUsage').click();await page.waitForFunction(()=>!busy);
 await expect(page.locator('#usageSummary')).toContainText('確認完了');await expect(page.locator('#usageRows')).toContainText('Capacity Game');await expect(page.locator('#usageRows')).toContainText('選択中の更新版');
 const result=await page.evaluate(()=>usageReport),snapshot=await page.evaluate(()=>window.beforeUsage);assert.equal(result.bytes,snapshot.reduce((n,item)=>n+item[1],0));assert.equal(result.files,snapshot.length);assert.deepEqual(await page.evaluate(()=>window.usageSnapshot()),snapshot);assert.equal(result.rows.find(r=>r.path==='direct').bytes,19);
 await page.locator('#usageFilter').selectOption('versions');await expect(page.locator('[data-usage-path]')).toHaveCount(1);const row=page.locator('[data-usage-path]');await row.locator('details summary').click();await expect(row).toContainText('それ以外の保存版（準備途中を含む）');assert.equal(result.rows.find(r=>r.kind==='posted').releases.length,3);
 await mkdir('offline-release/ui-checks',{recursive:true});await page.screenshot({path:'offline-release/ui-checks/library-usage.png',fullPage:true});await page.setViewportSize({width:640,height:900});await page.screenshot({path:'offline-release/ui-checks/library-usage-narrow.png',fullPage:true});assert(await page.locator('#inspection').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.setViewportSize({width:1280,height:960});
 const downloaded=page.waitForEvent('download');await page.locator('#exportUsage').click();const file=await downloaded,exported=JSON.parse(await readFile(await file.path(),'utf8'));assert.equal(exported.bytes,result.bytes);assert.equal(exported.rows.length,result.rows.length);assert.equal(exported.schema,1);assert(!JSON.stringify(exported).includes('getFileHandle'));
 // Pending selectors and interrupted uploads are measured but never called disposable.
 await page.evaluate(async()=>{FileSystemFileHandle.prototype.createWritable=window.originalWritable;const owner=usageGame.path.split('/')[0];await library.writeFile(usageRoot,owner+'/.gameportal-content-pending.json','pending');await library.writeFile(usageRoot,'uploading/.gameportal-uploading','pending');await library.writeFile(usageRoot,'uploading/new.html','partial');FileSystemFileHandle.prototype.createWritable=function(){throw new Error('Capacity must not write');};});
 await page.locator('#usageFilter').selectOption('all');await page.locator('#measureUsage').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#usageSummary')).toContainText('一部確認');await expect(page.locator('#usageWarnings')).toContainText('更新結果未確認');await expect(page.locator('#usageWarnings')).toContainText('投稿途中');assert((await page.evaluate(()=>usageReport.rows.find(r=>r.kind==='posted').releases)).every(r=>r.status==='unknown'));
 await page.locator('#usageFilter').selectOption('attention');await expect(page.locator('[data-usage-path]')).toHaveCount(2);
 // A cancel keeps the previous completed result, rather than publishing zero bytes.
 await page.evaluate(()=>{window.realMeasure=usageTools.measureLibraryUsage;usageTools.measureLibraryUsage=async(...args)=>{await new Promise(r=>window.continueUsage=r);return window.realMeasure(...args);};});const previous=await page.evaluate(()=>usageReport.checkedAt);
 await page.locator('#measureUsage').click();await expect(page.locator('#cancelUsage')).toBeVisible();await page.locator('#cancelUsage').click();await page.evaluate(()=>window.continueUsage());await page.waitForFunction(()=>!busy);assert.equal(await page.evaluate(()=>usageReport.checkedAt),previous);await expect(page.locator('#status')).toContainText('中止');
 await page.evaluate(()=>{usageTools.measureLibraryUsage=window.realMeasure;FileSystemFileHandle.prototype.createWritable=window.originalWritable;});
 // Changing the inspection folder clears stale capacity even when no launcher is connected.
 await page.evaluate(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('empty-library',{create:true});window.showDirectoryPicker=async()=>folder;});await page.locator('#inspectionFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#usagePanel')).toBeHidden();assert.equal(await page.evaluate(()=>usageReport),null);await page.locator('#measureUsage').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#usageSummary')).toContainText('0 B');
 assert.deepEqual(errors,[]);console.log('Capacity UI passed: readonly measurements include hidden versions/metadata, exact totals, grouped current/previous/other releases, filters/export, pending/upload uncertainty, cancellation retaining prior result, folder-switch reset, empty folder and 640px layout. No files changed.');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
