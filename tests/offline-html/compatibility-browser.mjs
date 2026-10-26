import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';

const html=await readFile('offline-release/GAME-PORTAL.html','utf8');
const {version}=JSON.parse(await readFile('package.json','utf8'));
const patchVersion=version.replace(/\d+$/,v=>String(Number(v)+1));
const token=`const LAUNCHER_VERSION = '${version}';`;
assert(html.includes(token));
// These are instrumented guard-aware readers, not pre-0.14 distributions.
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/older'?html.replace(token,"const LAUNCHER_VERSION = '0.13.9';"):req.url==='/patch'?html.replace(token,`const LAUNCHER_VERSION = '${patchVersion}';`):html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-compatibility-browser-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,viewport:{width:1280,height:960}});
try{
 const context=browser,page=await context.newPage(),errors=[];
 await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 const origin='http://127.0.0.1:'+server.address().port;
 async function open(path='/'){
   const target=path==='/'?page:await context.newPage();target.on('pageerror',e=>errors.push(e.message));
   await target.goto(origin+path);await expect(target.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
   await target.evaluate(async()=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('shared',{create:true});window.showDirectoryPicker=async()=>directory;});
   return target;
 }
 await open();await page.evaluate(async()=>{const dir=await showDirectoryPicker();await library.writeFile(dir,'game.html','<body><script>localStorage.setItem("level","keep")</script>Game</body>');await library.writeFile(dir,'.gameportal/library-id.json',JSON.stringify({schema:1,id:'1'.repeat(32)}));});
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);
 assert.equal(await page.evaluate(()=>compatibilityTools.checkCompatibility(root)),null);
 await page.locator('#settingsButton').click();await expect(page.locator('#compatibilityStatus')).toContainText('未設定');await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);
 await expect(page.locator('#compatibilityStatus')).toContainText('必要版：v0.14.0');await page.locator('#settings [data-close]').click();
 const snapshot=await page.evaluate(async()=>{const marker=await(await library.getFile(root,'.gameportal/compatibility.json')).text();const game=games[0];await localState.writeLocalSave(localLibrary,game.id,{level:'keep'});return {marker,id:localLibrary,game:game.id};});
 const older=await open('/older');await older.locator('#settingsButton').click();await older.locator('#chooseFolder').click();await older.waitForFunction(()=>!busy);
 await expect(older.locator('#status')).toContainText('v0.14.0 以上');await expect(older.locator('#compatibilityNotice')).toContainText('v0.13.9');await expect(older.locator('#postButton')).toBeDisabled();assert.equal(await older.evaluate(()=>root),null);
 const patch=await open('/patch');await patch.locator('#settingsButton').click();await patch.locator('#chooseFolder').click();await expect(patch.locator('#folderName')).toHaveText('shared');
 await patch.locator('#settingsButton').click();await expect(patch.locator('#compatibilityStatus')).toContainText('v'+patchVersion);await patch.locator('#settings [data-close]').click();
 assert.equal(await patch.evaluate(async()=>await(await library.getFile(root,'.gameportal/compatibility.json')).text()),snapshot.marker);
 await page.bringToFront();await page.locator('.game-title-link').click();await expect(page.locator('#frame')).toBeVisible();await page.waitForFunction(()=>!busy);const session=await page.evaluate(()=>activePlay.frameToken='same-session');
 // Simulate a peer requiring a future reader while this page has an old list.
 await patch.evaluate(async()=>{const marker=JSON.parse(await(await library.getFile(root,'.gameportal/compatibility.json')).text());await library.writeFile(root,'.gameportal/compatibility.json',JSON.stringify({...marker,minLauncherVersion:'9.0.0'}));});
 await page.evaluate(()=>syncLibrary());await expect(page.locator('#compatibilityNotice')).toContainText('v9.0.0');await expect(page.locator('#playerStatus')).toContainText('v9.0.0');await expect(page.locator('#postButton')).toBeDisabled();await expect(page.locator('#updatePlaying')).toBeDisabled();assert.equal(await page.evaluate(()=>activePlay.frameToken),session);
 await page.locator('#closePlayer').click();await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#player')).toBeHidden();await expect(page.locator('#status')).toContainText('v9.0.0');
 assert.deepEqual(await page.evaluate(({id,game})=>localState.loadLocalSave(id,game),snapshot),{level:'keep'});
 // Read-only sync and rejected APIs leave requirements and game files intact.
 assert.equal(await page.evaluate(async()=>{try{await library.saveGameSettings(root,games[0],{...games[0],title:'Blocked'});}catch(e){return e.code;}}),'LIBRARY_INCOMPATIBLE');
 assert.equal(await page.evaluate(async()=>{try{await library.postGame(root,[new File(['new'],'new.html')],preview);}catch(e){return e.code;}}),'LIBRARY_INCOMPATIBLE');
 // Corruption remains blocked. Restoring the test fixture allows manual recovery.
 await page.evaluate(()=>library.writeFile(root,'.gameportal/compatibility.json','{broken'));await page.locator('#refresh').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#compatibilityNotice')).toContainText('壊れています');
 await page.evaluate(marker=>library.writeFile(root,'.gameportal/compatibility.json',marker),snapshot.marker);await page.locator('#refresh').click();await expect(page.locator('#compatibilityNotice')).toBeHidden();await expect(page.locator('#postButton')).toBeEnabled();assert.equal(await page.evaluate(()=>localLibrary),snapshot.id);
 assert.equal(await page.evaluate(async()=>await(await library.getFile(root,'game.html')).text()),'<body><script>localStorage.setItem("level","keep")</script>Game</body>');
 assert.deepEqual(errors,[]);
 console.log('Compatibility UI passed: read-only legacy connection, verified marker initialization, instrumented old-reader rejection, compatible patch reader, peer floor change with existing play preserved, new play/write blocking, corruption and manual recovery, IDs/files/saves unchanged. Pre-0.14 HTML cannot enforce this guard.');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
