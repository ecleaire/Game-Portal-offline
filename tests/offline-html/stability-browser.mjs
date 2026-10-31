import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const creator=await readFile('offline-release/GAME-PORTAL.html','utf8'),player=await readFile('offline-release/GAME-PORTAL-PLAY.html','utf8');
const server=createServer((q,r)=>{if(q.url==='/favicon.ico'){r.writeHead(204);r.end();return;}r.setHeader('Content-Type','text/html');r.end(q.url.startsWith('/player')?player:q.url.startsWith('/low')?creator.replace('<html lang="ja"','<html lang="ja" data-performance="low"'):creator);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-stability-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
try{
 await context.addInitScript(()=>{if(window!==top)return;FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=>{window.permissionCount=(window.permissionCount||0)+1;window.permissionGesture=navigator.userActivation.isActive;return 'granted';};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 const origin='http://127.0.0.1:'+server.address().port;
 const ready=()=>expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.clock.install();await page.goto(origin+'/creator');await ready();
 assert.equal(await page.evaluate(()=>editingEnabled),true,'fresh Creator defaults to editing');
 await page.evaluate(()=>localStorage.setItem('game-portal.offline-editing','false'));await page.reload();await ready();
 assert.equal(await page.evaluate(()=>editingEnabled),true,'legacy implicit OFF does not defeat migration');
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').uncheck();await page.waitForFunction(()=>!busy);await page.reload();await ready();
 assert.equal(await page.evaluate(()=>editingEnabled),false,'new explicit OFF persists');
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
 await page.evaluate(async()=>{window.fixture=await(await navigator.storage.getDirectory()).getDirectoryHandle('stability',{create:true});await library.writeFile(fixture,'one.html','<h1>One</h1>');window.showDirectoryPicker=async options=>{window.pickMode=options.mode;return fixture;};});
 await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);assert.equal(await page.evaluate(()=>pickMode),'readwrite');await expect(page.locator('.card')).toHaveCount(1);
 await page.evaluate(()=>{window.originalCard=document.querySelector('.card');window.startPermissionCount=window.permissionCount||0;window.nativeWrite=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=()=>{throw Error('Automatic sync must never write');};});
 // External change bypasses launcher announcements, as on a second PC.
 await page.evaluate(async()=>{const writer=await nativeWrite.call(await root.getFileHandle('two.html',{create:true}));await writer.write('<h1>Two</h1>');await writer.close();});
 for(let tick=0;tick<8;tick++){await page.clock.fastForward(5000);await page.waitForFunction(()=>!syncPromise&&!folderWatchPromise);}
 await expect(page.locator('.card')).toHaveCount(2);assert.equal(await page.evaluate(()=>document.querySelector('.card')===originalCard),true,'unchanged cards retain focus and image state');
 assert.equal(await page.evaluate(()=>(window.permissionCount||0)===startPermissionCount),true,'background sync never prompts');
 // A dialog protects unsaved edits, even after the next scheduled check.
 await page.evaluate(()=>FileSystemFileHandle.prototype.createWritable=nativeWrite);await page.locator('.game-title-link').first().click();await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();await page.locator('#editTitle').fill('Unsaved');
 await page.evaluate(async()=>{await library.writeFile(root,'three.html','<h1>Three</h1>');});await page.clock.fastForward(65000);assert.equal(await page.evaluate(()=>games.length),2);await expect(page.locator('#editTitle')).toHaveValue('Unsaved');
 await page.locator('#editEnvironment').fill('HTML');
 await page.evaluate(()=>{window.permittedRequest=root.requestPermission;root.requestPermission=async()=> 'denied';});await page.locator('#saveGameSettings').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#editTitle')).toHaveValue('Unsaved');assert.equal(await page.evaluate(async()=>{try{await root.getFileHandle('one.html.gameportal.json');return true;}catch(error){if(error.name==='NotFoundError')return false;throw error;}}),false,'denied writes never create metadata');
 await page.evaluate(()=>root.requestPermission=permittedRequest);await page.locator('#saveGameSettings').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#edit')).toBeHidden();assert.equal(await page.evaluate(()=>permissionGesture),true,'save requests permission during its own click');
 await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);await expect(page.locator('.card')).toHaveCount(3);
 await page.goto(origin+'/player');await ready();assert.equal(await page.evaluate(()=>editingEnabled),false);await expect(page.locator('#postButton')).toBeHidden();
 await page.goto(origin+'/low');await ready();assert.equal(await page.evaluate(()=>cardBatch),12);assert.equal(await page.evaluate(()=>catalogSyncDelay()),60000);
 await page.evaluate(async()=>{games=Array.from({length:30},(_,i)=>({id:String(i),path:i+'.html',kind:'html',title:'Game '+i,tags:[]}));resetCards();await render();});await expect(page.locator('.card')).toHaveCount(12);
 assert.equal(await page.locator('.card').first().evaluate(e=>getComputedStyle(e).boxShadow),'none');
 assert.deepEqual(errors,[]);console.log('Stability passed: Creator default/migration/explicit OFF, Player restriction, write gesture, external automatic sync without writes/prompts, unchanged card reuse, unsaved editor protection and Mojave light UI.');
}finally{await context.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
