import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');const server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
try{
 for(const scenario of ['read-only-editing','write-denied','prompt','denied']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{
   if(window!==window.top)return;
   window.readGranted=sessionStorage.getItem('read-grant')!=='prompt';window.writeGranted=sessionStorage.getItem('write-grant')!=='prompt';
   FileSystemDirectoryHandle.prototype.queryPermission=async({mode})=>mode==='read'?(readGranted?'granted':'prompt'):(writeGranted?'granted':'prompt');
   FileSystemDirectoryHandle.prototype.requestPermission=async({mode})=>{window.permissionCalls=(window.permissionCalls||[]).concat({mode,active:navigator.userActivation.isActive});if(window.denyPermission)return 'denied';window.readGranted=true;if(mode==='readwrite')window.writeGranted=true;return 'granted';};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async()=>{window.testFolder=await(await navigator.storage.getDirectory()).getDirectoryHandle('Remembered',{create:true});await library.writeFile(testFolder,'game.html','<h1>Playable</h1>');window.showDirectoryPicker=async()=>testFolder;});
  await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);
  await page.evaluate(scenario=>{if(['read-only-editing','write-denied'].includes(scenario)){localStorage.setItem('game-portal.offline-editing','true');sessionStorage.setItem('write-grant','prompt');}else sessionStorage.setItem('read-grant','prompt');},scenario);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(()=>{window.showDirectoryPicker=()=>{throw Error('Automatic reconnect must not open the folder picker');};});
  if(['read-only-editing','write-denied'].includes(scenario)){
   await expect(page.locator('#folderName')).toHaveText('Remembered');assert.equal(await page.evaluate(()=>window.permissionCalls?.length||0),0);
   await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);if(scenario==='write-denied'){await page.evaluate(()=>window.denyPermission=true);await page.locator('#editPlaying').click();await expect(page.locator('#playerStatus')).toContainText('保存の許可');await expect(page.locator('#edit')).toBeHidden();await page.evaluate(()=>{window.denyPermission=false;window.permissionCalls=[];});}await page.locator('#editPlaying').click();await expect(page.locator('#edit')).toBeVisible();
   assert.deepEqual(await page.evaluate(()=>permissionCalls),[{mode:'readwrite',active:true}]);await page.locator('#editTitle').fill('Updated');await page.locator('#editEnvironment').fill('HTML / JavaScript');await page.locator('#saveGameSettings').click();await expect(page.locator('#edit')).toBeHidden();
  }else{
   await expect(page.locator('#setupFolder')).toHaveText('前回の保存先を開く');assert.equal(await page.evaluate(()=>window.permissionCalls?.length||0),0);
   await page.locator('#helpButton').click();await expect(page.locator('#help')).toBeVisible();await page.locator('#help [data-close]').first().click();
   await page.locator('#settingsButton').click();await page.locator('#settings [data-close]').click();assert.equal(await page.evaluate(()=>window.permissionCalls?.length||0),0);
   if(scenario==='denied')await page.evaluate(()=>window.denyPermission=true);
   await page.locator('#emptyTitle').click();
   if(scenario==='denied'){
    await expect(page.locator('#status')).toContainText('アクセスを許可');await page.locator('#emptyTitle').click();assert.equal(await page.evaluate(()=>permissionCalls.length),1);
    await page.evaluate(()=>window.denyPermission=false);await page.locator('#setupFolder').click();
   }
   await expect(page.locator('#folderName')).toHaveText('Remembered');await expect(page.locator('#setupFolder')).toBeHidden();
   assert((await page.evaluate(()=>permissionCalls)).every(call=>call.mode==='read'&&call.active));await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Playable');
  }
  assert.deepEqual(errors,[]);await context.close();console.log('Automatic connection passed:',scenario);
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
