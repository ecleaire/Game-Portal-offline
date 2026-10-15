import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html'),server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const temp=await mkdtemp(join(tmpdir(),'portal-folder-names-'));let context;
try{
 context=await chromium.launchPersistentContext(join(temp,'profile'),{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
 await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 for(const name of ['日本語の保管場所 🕹️','Games # % & + [2026] (v1)','.gameportal','__MACOSX','   ']){
  await page.evaluate(async name=>{window.testFolder=await(await navigator.storage.getDirectory()).getDirectoryHandle(name,{create:true});await library.writeFile(testFolder,'game.html','<body><script>document.body.dataset.saved=localStorage.getItem("level")||"none";</script>Folder game');window.showDirectoryPicker=async()=>testFolder;},name);
  await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);assert.equal(await page.locator('#folderName').textContent(),name);const id=await page.evaluate(()=>localLibrary);
  await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
  await page.locator('#postButton').click();await page.locator('#postFiles').setInputFiles({name:'new.html',mimeType:'text/html',buffer:Buffer.from('<h1>Added game</h1>')});await page.locator('#confirmPost').click();await expect(page.locator('#edit')).toBeVisible();await page.locator('#cancelEdit').click();assert.equal(await page.locator('.card').count(),2);
  await page.evaluate(async()=>{const game=games.find(g=>g.path==='game.html');await localState.writeLocalSave(localLibrary,game.id,{level:'keep'});});await page.locator('#settingsButton').click();await page.locator('#syncSaves').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#sharedSaveStatus')).toContainText('変更 1件');
  await page.locator('#sharingDetails summary').click();const hint='  \\\\NAS\\'+name+'\\'+'p'.repeat(1200)+'  ';await page.locator('#sharedFolderPath').fill(hint);
  const download=page.waitForEvent('download');await page.locator('#exportSharedLauncher').click();const exported=await readFile(await(await download).path(),'utf8');await page.waitForFunction(()=>!busy);
  const text=exported.split('<script id="folderConnection" type="application/json">')[1].split('</script>')[0];assert.deepEqual(JSON.parse(text),{schema:1,libraryId:id,name,path:hint});assert(!exported.includes('"level":"keep"'));
  await page.locator('#settings [data-close]').click();await page.locator('.card').filter({has:page.getByRole('heading',{name:'game',exact:true})}).locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-saved','keep');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true');assert.equal(await page.locator('#folderName').textContent(),name);assert.equal(await page.evaluate(()=>localLibrary),id);
 }
 assert.deepEqual(errors,[]);console.log('Folder names passed: Unicode/emoji, spaces, punctuation and management-like root names; connect/post/play/shared save/export/reload with exact untrimmed hints. OPFS simulation; OS/browser access rules still apply.');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
