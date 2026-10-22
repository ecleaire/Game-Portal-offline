import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {packageWebFiles} from '../../assets/zip-upload.js';
const pyxelApp=await packageWebFiles([new File(['main.py'],'app/.pyxapp_startup_script'),new File(['import pyxel\nfrom js import document\npyxel.init(32,32)\ndocument.body.dataset.started="yes"\npyxel.run(lambda:None,lambda:pyxel.cls(3))\n'],'app/main.py')]);
const pyxelBytes=[...new Uint8Array(await pyxelApp.arrayBuffer())];
const files={creator:await readFile('GAME-PORTAL.html'),player:await readFile('GAME-PORTAL-PLAY.html')};
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(files[q.url==='/player'?'player':'creator']);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-reload-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
try{
 await context.addInitScript(()=>{if(top!==window)return;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';localStorage.setItem('game-portal.remember-folder','false');});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const edition of ['creator','player']){
  await page.goto('http://127.0.0.1:'+server.address().port+'/'+edition);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async edition=>{window.fixtureRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('reload',{create:true});if(edition==='creator')await library.ensureLibraryId(fixtureRoot);window.fixtureSource=title=>'<h1>'+title+'</h1><output></output><script>document.querySelector("output").textContent=localStorage.score||"none";document.body.dataset.boot=String(Math.random());</script>';const handle=await fixtureRoot.getFileHandle('Game.html',{create:true}),writer=await handle.createWritable();await writer.write(fixtureSource('Original'));await writer.close();window.showDirectoryPicker=async()=>fixtureRoot;},edition);
  await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);await page.locator('.game-title-link').filter({hasText:'Game'}).click();
  const body=page.frameLocator('#frame').locator('body'),reload=page.locator('#reloadPlaying');await expect(body.locator('h1')).toHaveText('Original');await expect(reload).toBeEnabled();
  assert.equal(await reload.evaluate(b=>b.previousElementSibling.id),'fullscreen');const firstBoot=await body.getAttribute('data-boot');
  // Save failures must keep the running document and pending save intact.
  await page.evaluate(()=>{window.normalSave=localState.writeLocalSave;localState.writeLocalSave=async()=>{throw Error('Simulated full disk');};});
  await body.evaluate(()=>localStorage.score='keep');await page.waitForFunction(()=>activePlay?.latest?.score==='keep');
  await reload.click();await page.waitForFunction(()=>!busy);await expect(page.locator('#playerStatus')).toContainText('このPCへセーブできません');assert.equal(await body.getAttribute('data-boot'),firstBoot);assert.equal(await page.evaluate(()=>pendingSave.data.score),'keep');
  await page.evaluate(()=>localState.writeLocalSave=normalSave);
  // Re-read the changed game file, without reloading the launcher or losing saves.
  await page.evaluate(async()=>{const file=await fixtureRoot.getFileHandle('Game.html');const writer=await file.createWritable();await writer.write(fixtureSource('Updated'));await writer.close();window.launcherMarker=123;});
  await reload.click();await expect(body.locator('h1')).toHaveText('Updated');await expect(body.locator('output')).toHaveText('keep');await expect(reload).toBeEnabled();assert.notEqual(await body.getAttribute('data-boot'),firstBoot);assert.equal(await page.evaluate(()=>launcherMarker),123);
  // Only one restart while reads are pending; cancellation still works.
  await page.evaluate(()=>{window.normalRefresh=refresh;window.refreshCalls=0;refresh=async options=>{refreshCalls++;await new Promise(resolve=>window.releaseRefresh=resolve);return normalRefresh(options);};});
  await reload.click();await page.waitForFunction(()=>!!window.releaseRefresh);await expect(reload).toBeDisabled();await page.evaluate(()=>document.getElementById('reloadPlaying').onclick());assert.equal(await page.evaluate(()=>refreshCalls),1);
  await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();await page.evaluate(()=>{refresh=normalRefresh;releaseRefresh();});await page.waitForFunction(()=>!busy&&!closingPlayer);assert.equal(await page.evaluate(()=>activePlay),null);
  await page.locator('.game-title-link').filter({hasText:'Game'}).click();await expect(body.locator('output')).toHaveText('keep');await expect(reload).toBeEnabled();await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
  // Pyxel must obtain a fresh rendered document on repeated reloads, including fallback codecs.
  await context.addInitScript(()=>{Uint8Array.fromBase64=undefined;Uint8Array.prototype.toBase64=undefined;});
  await page.evaluate(async bytes=>{const handle=await fixtureRoot.getFileHandle('Tiny.pyxapp',{create:true}),writer=await handle.createWritable();await writer.write(new Uint8Array(bytes));await writer.close();await refresh();},pyxelBytes);
  await page.locator('.game-title-link').filter({hasText:'Tiny'}).click();
  for(let cycle=0;cycle<3;cycle++){
   const game=page.frameLocator('#frame');await expect(game.locator('#pyxel-prompt')).toBeVisible({timeout:90000});await game.locator('#canvas').click();await expect(game.locator('body')).toHaveAttribute('data-started','yes',{timeout:30000});await expect(reload).toBeEnabled();
   assert.equal(await page.locator('#frame').getAttribute('sandbox'),'allow-scripts allow-pointer-lock');
   if(cycle<2){await page.evaluate(()=>window.previousGameFrame=document.getElementById('frame'));await reload.click();await page.waitForFunction(()=>document.getElementById('frame')!==window.previousGameFrame);assert.equal(await page.evaluate(()=>previousGameFrame.isConnected),false);}
  }
  await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
 }
 assert.deepEqual(errors,[]);console.log('Reload passed in Creator and Player: adjacent button, same-game fresh files, retained save, save-failure protection, no launcher reload, repeated-click guard, close during restart and three real Pyxel starts per edition.');
}finally{await context.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
