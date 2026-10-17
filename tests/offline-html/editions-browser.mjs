import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const files={creator:await readFile('GAME-PORTAL.html'),player:await readFile('GAME-PORTAL-PLAY.html')};
const server=createServer((q,r)=>r.end(files[q.url==='/player'?'player':'creator']));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
try{
 const context=await browser.newContext(),errors=[];
 await context.addInitScript(()=>{if(top!==window)return;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';localStorage.setItem('game-portal.offline-editing','true');});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const url='http://127.0.0.1:'+server.address().port;
 await page.goto(url+'/creator');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const folder=await navigator.storage.getDirectory();await library.ensureLibraryId(folder);await library.writeFile(folder,'Game.html','<html><body><button onclick="localStorage.score=42">SAVE</button>PLAY</body></html>');});
 for(let cycle=0;cycle<3;cycle++){
  await page.goto(url+'/player');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>{window.showDirectoryPicker=()=>navigator.storage.getDirectory();});
  await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);
  assert.equal(await page.evaluate(()=>editingEnabled),false);await expect(page.locator('#postButton')).toBeHidden();
  await page.locator('#settingsButton').click();await expect(page.locator('.settings-editing')).toBeHidden();await expect(page.locator('#inspectButton')).toBeHidden();
  await page.evaluate(()=>{document.getElementById('enableEditing').checked=true;document.getElementById('enableEditing').onchange();});assert.equal(await page.evaluate(()=>editingEnabled),false);
  assert.equal(await page.evaluate(async()=>{try{await library.writeFile(root,'Game.html','broken');return false;}catch(e){return e.name==='NotAllowedError';}}),true);
  assert.equal(await page.evaluate(async()=>{try{await requireLibraryConnection(true);return false;}catch{return true;}}),true);
  assert((await page.evaluate(async()=> (await library.getFile(root,'Game.html')).text())).includes('PLAY'));
  await page.locator('#settings [data-close]').click();await page.locator('.card').first().click();await expect(page.locator('#player')).toBeVisible();await expect(page.locator('#editPlaying')).toBeHidden();
  await expect(page.frameLocator('#frame').locator('body')).toContainText('PLAY');await page.frameLocator('#frame').getByText('SAVE',{exact:true}).click();
  await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();await page.waitForFunction(()=>!pendingSave&&!flushing&&!busy);
  await page.locator('#settingsButton').click();await page.locator('#syncSaves').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#sharedSaveStatus')).toContainText('セーブ同期を確認しました');await page.locator('#settings [data-close]').click();
  await page.locator('#helpButton').click();await expect(page.locator('[data-help-topic="helpPost"]')).toHaveCount(0);await expect(page.locator('#helpSetup')).toContainText('プレイ専用');await page.locator('#help [data-close]').first().click();
  await page.locator('#search').fill('missing');await expect(page.locator('.card')).toHaveCount(0);await page.locator('#search').fill('Game');await expect(page.locator('.card')).toHaveCount(1);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true');await expect(page.locator('.card')).toHaveCount(1);assert.equal(await page.evaluate(()=>editingEnabled),false);
 }
 // Player layout: light/dark, desktop/narrow screens, essential dialogs only.
 for(const theme of ['dark','light'])for(const width of [320,390,640,1280]){
  await page.setViewportSize({width,height:720});await page.evaluate(theme=>applyTheme(theme),theme);
  for(const id of [null,'settings','help','player']){
   const fits=await page.evaluate(id=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();if(id)document.getElementById(id).showModal();const d=id&&document.getElementById(id);return document.documentElement.scrollWidth<=innerWidth+1&&(!d||d.scrollWidth<=d.clientWidth+1);},id);assert(fits,theme+' '+width+' '+id);
  }
 }
 await page.evaluate(()=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();});
 await page.goto(url+'/creator');await expect(page.locator('html')).toHaveAttribute('data-ready','true');assert.equal(await page.evaluate(()=>editingEnabled),true);
 assert.deepEqual(errors,[]);console.log('Editions passed: three player connect/play/save/search/reload cycles; stored editing preference ignored, mutation entry points denied, creator remains editable, player help contains no creation controls.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
