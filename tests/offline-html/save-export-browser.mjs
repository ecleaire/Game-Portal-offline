import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const html={creator:await readFile('GAME-PORTAL.html'),player:await readFile('GAME-PORTAL-PLAY.html')};
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html[q.url==='/player'?'player':'creator']);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-save-export-')),context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
try{
 await context.addInitScript(()=>{if(top!==window)return;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';localStorage.setItem('game-portal.remember-folder','false');});
 const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('download',d=>downloads.push(d));
 for(const edition of ['creator','player']){
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+edition);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async edition=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('export-library',{create:true});if(edition==='creator'){await library.ensureLibraryId(folder);await library.writeFile(folder,'Game.html','<h1>Export fixture</h1><output></output><script>document.querySelector("output").textContent=localStorage.score||"none";document.body.dataset.boot=String(Math.random());</script>');}window.showDirectoryPicker=async()=>folder;window.normalExportLoad=localState.loadLocalSave;},edition);
  await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);
  await page.evaluate(()=>localState.writeLocalSave(localLibrary,games[0].id,{score:'existing'}));
  const open=async()=>{await page.locator('.game-title-link').click();await expect(page.frameLocator('#frame').locator('output')).toHaveText('existing');await page.waitForFunction(()=>!busy&&!!activePlay);};
  await open();
  for(const intent of ['reload','close'])for(const outcome of ['resolve','reject']){
   const before=downloads.length;
   await page.evaluate(()=>{window.finishExport=null;window.lateExportDone=false;let hold=true;localState.loadLocalSave=(...args)=>{if(!hold)return normalExportLoad(...args);hold=false;return new Promise((resolve,reject)=>window.finishExport=outcome=>outcome==='reject'?reject(Error('Late export read failed')):resolve({score:'old'})).finally(()=>window.lateExportDone=true);};});
   if(!await page.locator('#exportSave').isVisible())await page.locator('#playerMoreTools summary').click();await page.locator('#exportSave').click();await page.waitForFunction(()=>!!window.finishExport&&busy);
   const boot=await page.frameLocator('#frame').locator('body').getAttribute('data-boot');await page.locator(intent==='reload'?'#reloadPlaying':'#closePlayer').click();
   await page.waitForFunction(()=>!busy&&!playerReloadWorker&&!closingPlayer,{},{timeout:3000});
   if(intent==='close'){await expect(page.locator('#player')).toBeHidden();await open();}else{await expect(page.frameLocator('#frame').locator('output')).toHaveText('existing');assert.notEqual(await page.frameLocator('#frame').locator('body').getAttribute('data-boot'),boot);}
   const currentBoot=await page.frameLocator('#frame').locator('body').getAttribute('data-boot');await page.evaluate(outcome=>{localState.loadLocalSave=normalExportLoad;finishExport(outcome);},outcome);await page.waitForFunction(()=>lateExportDone);assert.equal(downloads.length,before);assert.equal(await page.frameLocator('#frame').locator('body').getAttribute('data-boot'),currentBoot);assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{score:'existing'});
  }
  // A fresh in-game snapshot received during a slow read wins over that old read.
  await page.evaluate(()=>{window.finishExport=null;localState.loadLocalSave=()=>new Promise(resolve=>window.finishExport=()=>resolve({score:'existing'}));});
  if(!await page.locator('#exportSave').isVisible())await page.locator('#playerMoreTools summary').click();await page.locator('#exportSave').click();await page.waitForFunction(()=>!!finishExport&&busy);await page.frameLocator('#frame').locator('body').evaluate(()=>localStorage.score='newer');await page.waitForFunction(()=>activePlay?.latest?.score==='newer');
  const downloadPromise=page.waitForEvent('download');await page.evaluate(()=>{localState.loadLocalSave=normalExportLoad;finishExport();});const download=await downloadPromise;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(exported.data,{score:'newer'});assert.equal(exported.gameId,await page.evaluate(()=>activePlay.game.id));await page.waitForFunction(()=>!busy);await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();
  // Cancelling the export wait must still drain a game save already being committed.
  await page.evaluate(()=>localState.writeLocalSave(localLibrary,games[0].id,{score:'existing'}));await open();
  const beforePending=downloads.length;await page.evaluate(()=>{window.finishExport=null;window.finishExportSave=null;window.exportReadFinished=false;window.normalExportWrite=localState.writeLocalSave;let hold=true;localState.loadLocalSave=(...args)=>{if(!hold)return normalExportLoad(...args);hold=false;return new Promise(resolve=>window.finishExport=()=>resolve({score:'existing'})).finally(()=>window.exportReadFinished=true);};localState.writeLocalSave=async(...args)=>{if(args[2]?.score==='queued')await new Promise(resolve=>window.finishExportSave=resolve);return normalExportWrite(...args);};});
  if(!await page.locator('#exportSave').isVisible())await page.locator('#playerMoreTools summary').click();await page.locator('#exportSave').click();await page.waitForFunction(()=>!!finishExport);await page.frameLocator('#frame').locator('body').evaluate(()=>localStorage.score='queued');await page.waitForFunction(()=>!!finishExportSave);
  await page.locator('#reloadPlaying').click();await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeVisible();assert.match(await page.evaluate(async()=>{try{const release=await localState.acquirePlaySession(localLibrary,games[0].id);release();return 'unlocked';}catch(e){return e.message;}}),/別のタブ/);
  await page.evaluate(()=>{localState.loadLocalSave=normalExportLoad;localState.writeLocalSave=normalExportWrite;finishExportSave();});await expect(page.locator('#player')).toBeHidden();await page.waitForFunction(()=>!busy&&!playerReloadWorker&&!closingPlayer);await page.evaluate(()=>finishExport());await page.waitForFunction(()=>exportReadFinished);assert.equal(downloads.length,beforePending);assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{score:'queued'});
 }
 assert.deepEqual(errors,[]);console.log('Save export passed in both editions: priority Reload/List cancels held reads, late success/failure produces no download or stale UI, saves stay intact, started writes drain with play lock retained, real JSON download includes the newest in-game snapshot.');
}finally{await context.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
