import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const creator=await readFile('GAME-PORTAL.html'),player=await readFile('GAME-PORTAL-PLAY.html');
const server=createServer((request,response)=>response.end(request.url.includes('-PLAY.html')?player:creator));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'portal-tags-distribution-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,viewport:{width:980,height:800}});
const base='http://127.0.0.1:'+server.address().port,errors=[];
try{
 await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const visit=async path=>{await page.goto(base+path);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});};
 await visit('/GAME-PORTAL.html');
 await page.evaluate(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('Shared tags',{create:true});await library.ensureLibraryId(folder);await library.writeFile(folder,'game.html','<h1>Playing</h1>');window.showDirectoryPicker=async()=>folder;});
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);
 const libraryId=await page.evaluate(()=>localLibrary);
 // Moving the HTML to the platform/role layout keeps the old pathname's handle.
 await visit('/HTML/'+encodeURIComponent('クリエイター用')+'/GAME-PORTAL.html');await expect(page.locator('#folderName')).toHaveText('Shared tags');assert.equal(await page.evaluate(()=>localLibrary),libraryId);
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
 await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();await page.locator('#editEnvironment').fill('Godot');await page.locator('#editEnvironment').blur();
 const tags=['Godot',...Array.from({length:31},(_,i)=>'カスタムタグ'+i)];
 await page.locator('#editTags').fill(tags.slice(0,-1).join(', '));await page.locator('#newTag').fill(tags.at(-1));await page.locator('#addTag').click();await expect(page.locator('#tagCount')).toHaveText('32 / 32');
 await page.locator('#saveGameSettings').click();await expect(page.locator('#edit')).toBeHidden();await page.waitForFunction(()=>!busy);
 const settings=await page.evaluate(()=>library.loadGameSettings(root,'game.html'));assert.deepEqual(settings.data.tags,tags);
 assert.equal(await page.evaluate(async()=>(await compatibilityTools.checkCompatibility(root)).minLauncherVersion),'0.22.0');
 await page.locator('#closePlayer').click();
 // A separate Player page reads the same per-game metadata and keeps all tags reachable.
 await page.evaluate(()=>localState.cacheHandle(root,true,'/GAME-PORTAL-PLAY.html'));
 await visit('/HTML/'+encodeURIComponent('プレイ用')+'/GAME-PORTAL-PLAY.html');await expect(page.locator('#folderName')).toHaveText('Shared tags');await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);
 await expect(page.locator('#editPlaying')).toBeHidden();await expect(page.locator('#playerTags .game-tag')).toHaveCount(32);
 const bounds=await page.locator('#playerTags').evaluate(element=>({height:element.clientHeight,scroll:element.scrollHeight}));assert(bounds.height<=112&&bounds.scroll>bounds.height);
 await page.locator('#playerTags .game-tag').last().scrollIntoViewIfNeeded();await page.locator('#playerTags .game-tag').last().click();await expect(page.locator('#player')).toBeHidden();await expect(page.locator('.game-title-link')).toHaveCount(1);
 await page.locator('#settingsButton').click();await page.locator('#folderMemoryDetails summary').click();await page.locator('#forgetFolder').click();await page.waitForFunction(()=>!busy);await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await expect(page.locator('#folderName')).toHaveText('未選択');
 assert.deepEqual(errors,[]);console.log('Tags/distribution passed: 32 custom tags, shared creator/player metadata, scroll and tag search, bounded legacy scope migration, explicit forget stays forgotten.');
}finally{await context.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
