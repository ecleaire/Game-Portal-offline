import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const html={creator:await readFile('GAME-PORTAL.html'),player:await readFile('GAME-PORTAL-PLAY.html')};
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html[req.url==='/player'?'player':'creator']);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'portal-save-import-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
try{
 await context.addInitScript(()=>{if(top!==window)return;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';localStorage.setItem('game-portal.remember-folder','false');});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 for(const edition of ['creator','player']){
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+edition);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
  await page.evaluate(async edition=>{
   window.fixtureRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('save-import',{create:true});
   if(edition==='creator'){await library.ensureLibraryId(fixtureRoot);await library.writeFile(fixtureRoot,'Game.html','<h1>Save game</h1><output></output><script>document.querySelector("output").textContent=localStorage.score||"none";document.body.dataset.boot=String(Math.random());</script>');}
   window.showDirectoryPicker=async()=>fixtureRoot;window.confirmations=0;window.importWrites=0;window.normalText=File.prototype.text;window.normalWrite=localState.writeLocalSave;
   window.confirm=()=>{window.confirmations++;return true;};localState.writeLocalSave=(...args)=>{if(args[2]?.score==='imported')window.importWrites++;return normalWrite(...args);};
  },edition);
  await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);
  await page.evaluate(async()=>{window.fixtureGame=games.find(game=>game.path==='Game.html');await localState.writeLocalSave(localLibrary,fixtureGame.id,{score:'existing'});});
  const body=page.frameLocator('#frame').locator('body');
  const open=async()=>{await page.locator('.game-title-link').filter({hasText:'Game'}).click();await expect(body.locator('output')).toHaveText('existing');await page.waitForFunction(()=>!busy&&!!activePlay);};
  await open();
  for(const intent of ['reload','close'])for(const outcome of ['resolve','reject']){
   await page.evaluate(()=>{window.finishRead=null;window.lateDone=false;File.prototype.text=function(...args){if(this.name!=='Held-save.json')return normalText.apply(this,args);return new Promise((resolve,reject)=>{window.finishRead=outcome=>outcome==='reject'?reject(new DOMException('Late read failure','NotReadableError')):resolve(JSON.stringify({schema:1,gameId:fixtureGame.id,data:{score:'imported'}}));}).finally(()=>{window.lateDone=true;});};});
   await page.locator('#importSave').setInputFiles({name:'Held-save.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.waitForFunction(()=>!!window.finishRead&&busy);const boot=await body.getAttribute('data-boot');
   await page.locator(intent==='reload'?'#reloadPlaying':'#closePlayer').click();
   if(intent==='close')await expect(page.locator('#player')).toBeHidden();
   await page.waitForFunction(()=>!busy&&!playerReloadWorker&&!closingPlayer,{},{timeout:5000});
   await expect(page.locator('#chooseFolder')).toBeEnabled();
   if(intent==='close')await open();else{await expect(body.locator('output')).toHaveText('existing');assert.notEqual(await body.getAttribute('data-boot'),boot);}
   const currentBoot=await body.getAttribute('data-boot');
   await page.evaluate(outcome=>{File.prototype.text=normalText;finishRead(outcome);},outcome);await page.waitForFunction(()=>window.lateDone);
   assert.equal(await page.evaluate(()=>confirmations),0);assert.equal(await page.evaluate(()=>importWrites),0);assert.equal(await body.getAttribute('data-boot'),currentBoot);assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,fixtureGame.id)),{score:'existing'});
  }
  // A pending game save drains first. A later priority Reload cancels the import
  // before it starts a replacement write, even when both await the same flush.
  await page.evaluate(()=>{window.releaseSave=null;localState.writeLocalSave=async(...args)=>{if(args[2]?.score==='latest')await new Promise(resolve=>window.releaseSave=resolve);if(args[2]?.score==='imported')window.importWrites++;return normalWrite(...args);};receiveSave(activePlay,{score:'latest'});});await page.waitForFunction(()=>!!window.releaseSave);
  const save=await page.evaluate(()=>({schema:1,gameId:fixtureGame.id,data:{score:'imported'}}));
  await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(save))});await page.waitForFunction(()=>confirmations===1&&busy);
  await page.locator('#reloadPlaying').click();assert.equal(await page.evaluate(()=>busy),true);await page.evaluate(()=>{localState.writeLocalSave=normalWrite;releaseSave();});await page.waitForFunction(()=>!busy&&!playerReloadWorker);await expect(body.locator('output')).toHaveText('latest');assert.equal(await page.evaluate(()=>importWrites),0);
  // An import that has already started writing must finish safely. List cancels
  // the queued restart but cannot cancel this commit or reopen the closed game.
  await page.evaluate(()=>{window.releaseImport=null;localState.writeLocalSave=async(...args)=>{if(args[2]?.score==='imported'){window.importWrites++;await new Promise(resolve=>window.releaseImport=resolve);}return normalWrite(...args);};});
  await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(save))});await page.waitForFunction(()=>!!window.releaseImport&&busy);await page.locator('#reloadPlaying').click();await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();assert.equal(await page.evaluate(()=>busy),true);
  await page.evaluate(()=>{localState.writeLocalSave=normalWrite;releaseImport();});await page.waitForFunction(()=>!busy&&!playerReloadWorker&&!closingPlayer);await expect(page.locator('#player')).toBeHidden();assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,fixtureGame.id)),{score:'imported'});assert.equal(await page.evaluate(()=>importWrites),1);assert.equal(await page.evaluate(()=>confirmations),2);
  await page.locator('.game-title-link').filter({hasText:'Game'}).click();await expect(body.locator('output')).toHaveText('imported');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer&&!busy);
 }
 assert.deepEqual(errors,[]);console.log('Save import priority passed in Creator and Player: held reads interrupted by Reload/List, late success/failure ignored without prompts or writes, old save preserved, pending flush honored and started import commit drained without reopening.');
}finally{await context.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
