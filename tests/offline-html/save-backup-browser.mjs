import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:960}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('backup-library',{create:true});window.showDirectoryPicker=async()=>folder;});
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
 await page.locator('#postButton').click();await page.locator('#postFiles').setInputFiles({name:'original.html',mimeType:'text/html',buffer:Buffer.from('<body data-version="old"><script>document.body.dataset.level=localStorage.getItem("level")||"empty";</script>Old game</body>')});await page.locator('#confirmPost').click();await expect(page.locator('#edit')).toBeVisible();await page.locator('#cancelEdit').click();
 await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);
 await page.locator('#saveBackupsButton').click();await expect(page.locator('#saveBackupSummary')).toContainText('まだありません');await page.locator('#saveBackups [data-close]').click();
 await page.evaluate(()=>receiveSave(activePlay,{level:'before-update'}));
 await page.locator('#updatePlaying').click();await page.locator('#updateFiles').setInputFiles({name:'new.html',mimeType:'text/html',buffer:Buffer.from('<body data-version="new"><script>document.body.dataset.level=localStorage.getItem("level")||"empty";</script>New game</body>')});await expect(page.locator('#confirmContentUpdate')).toBeEnabled();
 // A failed final save keeps the running frame available and offers the right recovery.
 await page.evaluate(()=>{window.originalSave=localState.writeLocalSave;localState.writeLocalSave=async()=>{throw new DOMException('No save space','QuotaExceededError');};receiveSave(activePlay,{level:'before-update'});});
 await page.locator('#confirmContentUpdate').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('ゲーム画面を閉じず');await expect(page.locator('#frame')).toBeVisible();assert.equal(await page.evaluate(()=>!!stopGame),true);
 await page.evaluate(async()=>{localState.writeLocalSave=window.originalSave;await flushSave();});
 // A failed backup must prevent the content switch, preserving files and save.
 await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='settings'&&Array.isArray(key)&&key[0]==='save-backups')throw new DOMException('No backup space','QuotaExceededError');return window.originalPut.call(this,value,key);};});
 await page.locator('#confirmContentUpdate').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('本体は変更していません');assert.equal(await page.evaluate(()=>games[0].contentRevision||null),null);
 assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'before-update'});assert.deepEqual(await page.evaluate(()=>localState.loadSaveBackups(localLibrary,games[0].id)),[]);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;window.originalBackup=localState.backupLocalSave;localState.backupLocalSave=async(...args)=>{await new Promise(r=>window.finishBackup=r);return window.originalBackup(...args);};});
 await page.locator('#confirmContentUpdate').click();await page.waitForFunction(()=>!!window.finishBackup);
 assert.match(await page.evaluate(async()=>{try{await localState.acquirePlaySession(localLibrary,games[0].id);}catch(e){return e.message;}}),/別のタブ/);
 await page.evaluate(()=>{localState.backupLocalSave=window.originalBackup;window.finishBackup();});await expect(page.locator('#updateContent')).toBeHidden();
 const identity=await page.evaluate(()=>({library:localLibrary,game:games[0].id}));const first=await page.evaluate(()=>localState.loadSaveBackups(localLibrary,games[0].id));assert.equal(first.length,1);assert.equal(first[0].reason,'before-update');assert.deepEqual(first[0].data,{level:'before-update'});
 await page.locator('#retryPlaying').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-level','before-update');
 await page.evaluate(()=>receiveSave(activePlay,{level:'new-incompatible'}));await page.locator('#saveBackupsButton').click();await expect(page.locator('[data-save-backup]')).toHaveCount(1);await mkdir('offline-release/ui-checks',{recursive:true});await page.screenshot({path:'offline-release/ui-checks/save-backups-desktop.png',fullPage:true});await page.setViewportSize({width:640,height:900});await page.screenshot({path:'offline-release/ui-checks/save-backups-narrow.png',fullPage:true});await page.setViewportSize({width:1280,height:960});
 const downloadEvent=page.waitForEvent('download');await page.locator('[data-export-backup]').click();const download=await downloadEvent;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(exported,{schema:1,gameId:identity.game,data:{level:'before-update'}});
 // If restoring the actual save fails, the new backup must also roll back.
 await page.evaluate(async()=>{await flushSave();window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='saves')throw new DOMException('Restore failed','QuotaExceededError');return window.originalPut.call(this,value,key);};});
 await page.locator('[data-restore-backup]').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('変更前のセーブは保持');assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'new-incompatible'});assert.equal((await page.evaluate(()=>localState.loadSaveBackups(localLibrary,games[0].id))).length,1);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});await page.locator('[data-restore-backup]').click();await expect(page.locator('#saveBackups')).toBeHidden();
 let rows=await page.evaluate(()=>localState.loadSaveBackups(localLibrary,games[0].id));assert.equal(rows.length,2);assert.equal(rows[0].reason,'before-save-restore');assert.deepEqual(rows[0].data,{level:'new-incompatible'});
 await page.locator('#retryPlaying').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-level','before-update');await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-version','new');
 // Restoring a save never switches game content, and restoring is itself reversible.
 await page.locator('#saveBackupsButton').click();await page.locator('[data-restore-backup]').first().click();await expect(page.locator('#saveBackups')).toBeHidden();assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'new-incompatible'});
 await page.locator('#retryPlaying').click();await page.waitForFunction(()=>!busy);await page.locator('#updatePlaying').click();await page.locator('#restoreContent').click();await expect(page.locator('#updateContent')).toBeHidden();rows=await page.evaluate(()=>localState.loadSaveBackups(localLibrary,games[0].id));assert.equal(rows[0].reason,'before-content-restore');
 // A history opened by another tab cannot replace a save while this tab plays.
 await page.locator('#retryPlaying').click();await page.waitForFunction(()=>!busy);const peer=await context.newPage();await peer.goto('http://127.0.0.1:'+server.address().port);await expect(peer.locator('html')).toHaveAttribute('data-ready','true');
 const locked=await peer.evaluate(async({library,game})=>{try{await localState.acquirePlaySession(library,game);}catch(e){return e.message;}},identity);assert.match(locked,/別のタブ/);await peer.close();await page.bringToFront();
 // Per-game and per-library isolation, bounded retention and no restoration of missing IDs.
 await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
 await page.evaluate(async()=>{const id=games[0].id;for(let i=0;i<12;i++){await localState.writeLocalSave(localLibrary,id,{level:String(i)});await localState.backupLocalSave(localLibrary,id,'manual');}window.bounded=await localState.loadSaveBackups(localLibrary,id);});
 rows=await page.evaluate(()=>window.bounded);assert.equal(rows.length,10);assert.deepEqual(rows[0].data,{level:'11'});assert.deepEqual(rows.at(-1).data,{level:'2'});assert.deepEqual(await page.evaluate(()=>localState.loadSaveBackups('a'.repeat(32),games[0].id)),[]);assert.deepEqual(await page.evaluate(()=>localState.loadSaveBackups(localLibrary,'b'.repeat(32))),[]);
 assert.match(await page.evaluate(async()=>{try{await localState.restoreLocalSaveBackup(localLibrary,games[0].id,'missing');}catch(e){return e.message;}}),/見つかりません/);assert.deepEqual(await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)),{level:'11'});
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-ready','true');assert.equal((await page.evaluate(({library,game})=>localState.loadSaveBackups(library,game),identity)).length,10);
 assert.deepEqual(errors,[]);console.log('Save backup UI passed: automatic pre-update/rollback snapshots, backup failure blocks content switch, atomic restore/undo with failure rollback, JSON export, actual game reads restored save, game-content independence, play locks, bounded retention, profile reload and identity isolation.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
