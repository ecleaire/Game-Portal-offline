import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');
assert(!html.toString().includes('C:/Users/echo0'));
assert(!html.toString().includes('C:\\Users\\echo0'));
const temporary=await mkdtemp(join(tmpdir(),'portal-transfer-'));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
try{
 const senderContext=await browser.newContext(),receiverContext=await browser.newContext(),sender=await senderContext.newPage(),receiver=await receiverContext.newPage(),errors=[];
 for(const page of [sender,receiver])page.on('pageerror',error=>errors.push(error.message));
 // Start the moved/renamed single HTML with no sibling assets in a new profile.
 const moved=join(temporary,'別の保存場所','受け取ったゲーム一覧.html');await mkdir(join(temporary,'別の保存場所'));await writeFile(moved,html);
 const localPage=await receiverContext.newPage();await receiverContext.setOffline(true);await localPage.goto(pathToFileURL(moved).href);await expect(localPage.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await expect(localPage.locator('#folderName')).toHaveText('未選択');await expect(localPage.locator('#modeLabel')).toHaveText('あそぶ');assert.equal(await localPage.evaluate(()=>typeof showDirectoryPicker),'function');await localPage.close();await receiverContext.setOffline(false);
 const origin='http://127.0.0.1:'+server.address().port;
 await sender.goto(origin);await expect(sender.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
 await sender.evaluate(async()=>{
   const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('original-library',{create:true});window.showDirectoryPicker=async()=>dir;
   library.setSettingsSaveObserver(async()=>{});await library.ensureLibraryId(dir);await library.postGame(dir,[new File(['<h1>Portable game</h1><script>document.body.dataset.previous=localStorage.getItem("level")||"none";localStorage.setItem("level","receiver");</script>'],'game.html')],preview);
   const game=(await library.scan(dir,await library.loadMetadata(dir)))[0],canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;canvas.getContext('2d').fillRect(0,0,32,18);
   // Fixture construction uses the same per-game writer, without attaching personal state.
   library.setSettingsSaveObserver(async()=>{});await library.saveGameSettings(dir,game,{...game,title:'移行した作品',tags:['持ち運び'],developmentEnvironment:'HTML',description:'移行した概要',instructions:'移行した操作方法',thumbnail:canvas.toDataURL('image/webp')});const fresh=(await library.scan(dir,await library.loadMetadata(dir)))[0];await updateTools.replaceGameContent(dir,fresh,[new File(['<body data-version="updated"><script>document.body.dataset.previous=localStorage.getItem("level")||"none";localStorage.setItem("level","receiver");</script></body>'],'updated-name.html')],await library.loadLibraryId(dir),library,preview,(files,tools,packages)=>improvements.checkUpload(files,tools,packages,maintenance.localResources));
 });
 await sender.locator('#settingsButton').click();await sender.locator('#chooseFolder').click();
 await sender.waitForFunction(()=>!busy);await expect(sender.getByRole('heading',{name:'移行した作品',exact:true})).toBeVisible();
 const ids=await sender.evaluate(async()=>{await localState.writeLocalSave(localLibrary,games[0].id,{level:'sender-only'});return {library:localLibrary,game:games[0].id};});
 const files=await sender.evaluate(async()=>{const result=[];async function walk(dir,prefix=''){for await(const entry of dir.values()){if(entry.kind==='directory')await walk(entry,prefix+entry.name+'/');else result.push([prefix+entry.name,[...new Uint8Array(await(await entry.getFile()).arrayBuffer())]]);}}await walk(root);return result;});
 assert(files.some(([path])=>path==='.gameportal/library-id.json'));assert(files.some(([path])=>path.endsWith('/game.html.gameportal.json')));assert(files.some(([path])=>path.startsWith('.gameportal/history/')));
 await receiver.goto(origin+'/renamed-launcher.html');await expect(receiver.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await expect(receiver.locator('#folderName')).toHaveText('未選択');await expect(receiver.locator('#modeLabel')).toHaveText('あそぶ');assert.equal(await receiver.evaluate(()=>remembered),null);
 await receiver.evaluate(async files=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('別PCの別フォルダー',{create:true});for(const [path,bytes]of files)await library.writeFile(dir,path,new Uint8Array(bytes));window.showDirectoryPicker=async()=>dir;},files);
 const requests=[];receiverContext.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});await receiverContext.setOffline(true);
 await receiver.locator('#settingsButton').click();await receiver.locator('#chooseFolder').click();await expect(receiver.getByRole('heading',{name:'移行した作品',exact:true})).toBeVisible();await expect(receiver.locator('.card img')).toHaveCount(1);
 assert.deepEqual(await receiver.evaluate(()=>({library:localLibrary,game:games[0].id})),ids);assert.deepEqual(await receiver.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{});
 const history=await receiver.evaluate(()=>maintenance.loadSettingsHistory(root,games[0],library));assert.equal(history.complete,true);assert.equal(history.entries.length,2);assert.equal(history.entries[0].error,'');
 await receiver.locator('.game-title-link').click();await receiver.waitForFunction(()=>!busy);await expect(receiver.locator('#playerDescription')).toHaveText('移行した概要');await expect(receiver.locator('#playerInstructions')).toHaveText('移行した操作方法');await expect(receiver.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous','none');await expect(receiver.frameLocator('#frame').locator('body')).toHaveAttribute('data-version','updated');await expect(receiver.locator('#editPlaying')).toBeHidden();await receiver.locator('#closePlayer').click();
 assert.deepEqual(await receiver.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'receiver'});assert.deepEqual(await sender.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'sender-only'});
 assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log('Portability passed: moved/renamed file HTML starts in a fresh profile; copied library in a different profile/folder retains IDs, per-game metadata/image/history, plays offline and keeps saves separate. Physical second PC/macOS/NAS remain untested.');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
