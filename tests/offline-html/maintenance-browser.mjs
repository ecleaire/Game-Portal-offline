import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'portal-maintenance-browser-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,viewport:{width:1280,height:960}});
try {
  const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}});await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await mkdir('offline-release/ui-checks',{recursive:true});
  await page.locator('#helpButton').click();await expect(page.locator('#help')).toBeVisible();await expect(page.locator('#helpTitle')).toBeFocused();await expect(page.locator('#helpButton')).toHaveText('ヘルプ');await expect(page.locator('#helpTitle')).toHaveText('ヘルプ');assert.equal(await page.locator('#help .help-section').count(),11);await page.screenshot({path:'offline-release/ui-checks/help-guide.png',fullPage:true});
  // The index remains available while the independent document scrolls.
  const indexBefore=await page.locator('.help-index').boundingBox();
  await page.locator('[data-help-topic="helpScratch"]').click();await expect(page.locator('#helpScratch')).toBeFocused();await expect(page.locator('#helpScratch')).toBeInViewport();await expect(page.locator('[data-help-topic="helpScratch"]')).toHaveAttribute('aria-current','location');
  await expect(page.locator('#helpScratch')).toContainText('Plain HTML');await expect(page.locator('#helpScratch')).toContainText('sb3');const packagerLink=page.locator('#helpScratch a').first();await expect(packagerLink).toHaveAttribute('href','https://packager.turbowarp.org/?import_from=https://turbowarp.org');await expect(packagerLink).toHaveAttribute('target','_blank');await expect(packagerLink).toHaveAttribute('rel',/noopener/);
  const indexAfter=await page.locator('.help-index').boundingBox();assert.equal(indexBefore.y,indexAfter.y);assert.equal(indexBefore.height,indexAfter.height);assert(await page.locator('#helpContent').evaluate(e=>e.scrollTop>0));assert.equal(await page.locator('#help').evaluate(e=>e.scrollTop),0);
  await page.screenshot({path:'offline-release/ui-checks/help-scratch.png',fullPage:true});
  await page.locator('#helpContent').evaluate(e=>e.scrollTop=e.scrollHeight);await expect(page.locator('[data-help-topic="helpTrouble"]')).toHaveAttribute('aria-current','location');await expect(page.locator('[data-help-topic="helpSetup"]')).toBeInViewport();
  await page.locator('[data-help-topic="helpTitle"]').click();await expect(page.locator('#helpTitle')).toBeFocused();assert.equal(await page.locator('#helpContent').evaluate(e=>e.scrollTop),0);
  await page.locator('[data-help-topic="helpPost"]').click();await expect(page.locator('#helpPost')).toBeFocused();await expect(page.locator('#helpPost')).toBeInViewport();await expect(page.locator('#helpPost')).toContainText('追加する');await page.locator('[data-help-topic="helpTitle"]').click();await expect(page.locator('#helpTitle')).toBeFocused();assert.equal(await page.locator('#help').evaluate(dialog=>dialog.scrollTop),0);await page.keyboard.press('Escape');await expect(page.locator('#help')).toBeHidden();await expect(page.locator('#helpButton')).toBeFocused();assert.deepEqual(await page.evaluate(()=>({root:root===null,editing:editingEnabled})),{root:true,editing:false});
  await page.setViewportSize({width:640,height:720});await page.locator('#helpButton').click();await page.locator('[data-help-topic="helpShare"]').click();await expect(page.locator('#helpShare')).toBeInViewport();const bounds=await page.locator('#help').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=640);await page.screenshot({path:'offline-release/ui-checks/help-guide-narrow.png',fullPage:true});await page.locator('#help [data-close]').last().click();await page.setViewportSize({width:1280,height:960});

  await expect(page.locator('#postReason')).toContainText('フォルダー');
  await page.evaluate(async()=>{
    const opfs=await navigator.storage.getDirectory(),root=await opfs.getDirectoryHandle('maintenance',{create:true});window.testRoot=root;window.showDirectoryPicker=async()=>root;
    window.testWrite=async(dir,name,text)=>{const w=await(await dir.getFileHandle(name,{create:true})).createWritable();await w.write(text);await w.close();};
    const admin=await root.getDirectoryHandle('.gameportal',{create:true});await window.testWrite(admin,'library-id.json',JSON.stringify({schema:1,id:'1'.repeat(32)}));
    const game=await root.getDirectoryHandle('canvas',{create:true});window.testGameDir=game;
    await window.testWrite(game,'index.html','<canvas width="960" height="540"></canvas><script>const c=document.querySelector("canvas"),ctx=c.getContext("2d");function draw(){ctx.fillStyle="#32cc77";ctx.fillRect(0,0,960,540);ctx.fillStyle="#123";ctx.fillRect(50,50,150,150);requestAnimationFrame(draw);}draw();</script>');
    await window.testWrite(game,'index.html.gameportal.json',JSON.stringify({schema:1,id:'a'.repeat(32),title:'Canvas Game',tags:['アクション'],developmentEnvironment:'HTML',description:'Canvasの概要',instructions:'Space：開始\n← →：移動',thumbnail:null,updatedAt:new Date().toISOString()}));
  });
  await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();
  const card=title=>page.locator('.card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  const closeGame=async()=>{await page.waitForFunction(()=>!closingPlayer);if(await page.locator('#player').isVisible()){await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();}};
  const openGame=async title=>{await closeGame();await card(title).locator('.game-title-link').click();await expect(page.locator('#player')).toBeVisible();await page.waitForFunction(()=>!busy);};
  const editFromCard=async title=>{await openGame(title);await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();await expect(page.locator('#edit')).toBeVisible();};
  const saveEditor=async()=>{await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>!busy);if(!await page.locator('#edit').isVisible())await closeGame();};
  await expect(card('Canvas Game')).toBeVisible();await expect(page.locator('#postReason')).toContainText('オンに');await expect(card('Canvas Game').locator('button')).toHaveCount(0);
  await openGame('Canvas Game');const sessionBeforeHelp=await page.evaluate(()=>activePlay?.game.id);await page.locator('#playerHelpButton').click();await expect(page.locator('#help')).toBeVisible();await page.locator('[data-help-topic="helpUpdate"]').click();await expect(page.locator('#helpUpdate')).toContainText('前の本体に戻す');await page.keyboard.press('Escape');await expect(page.locator('#player')).toBeVisible();assert.equal(await page.evaluate(()=>activePlay?.game.id),sessionBeforeHelp);await expect(page.frameLocator('#frame').locator('canvas')).toBeVisible();await expect(page.locator('#playerDescription')).toHaveText('Canvasの概要');await expect(page.locator('#playerInstructions')).toHaveText('Space：開始\n← →：移動');await expect(page.locator('#editPlaying')).toBeHidden();await expect(page.locator('#captureButton')).toBeHidden();await page.locator('#playerDescription').scrollIntoViewIfNeeded();await page.screenshot({path:'offline-release/ui-checks/game-details.png',fullPage:true});await closeGame();
  await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.locator('#settings [data-close]').click();
  await expect(page.locator('#postReason')).toHaveText('');await expect(card('Canvas Game').locator('button')).toHaveCount(0);
  await openGame('Canvas Game');await expect(page.frameLocator('#frame').locator('canvas')).toBeVisible();
  await page.locator('#captureButton').click();await expect(page.locator('#capture')).toBeVisible();
  await page.screenshot({path:'offline-release/ui-checks/capture.png',fullPage:true});
  assert(await page.locator('#capturePreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=1;c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,500,300,1,1,0,0,1,1);return ctx.getImageData(0,0,1,1).data[1]>150;}),'Captured green game pixels');
  await page.locator('#saveCapture').click();await expect(page.locator('#capture')).toBeHidden();await expect(card('Canvas Game').locator('img')).toHaveCount(1);
  const saved=await page.evaluate(async()=>JSON.parse(await(await(await window.testGameDir.getFileHandle('index.html.gameportal.json')).getFile()).text()));
  assert.equal(saved.id,'a'.repeat(32));assert.equal(saved.title,'Canvas Game');assert.deepEqual(saved.tags,['アクション']);assert.equal(saved.developmentEnvironment,'HTML');assert.match(saved.thumbnail,/^data:image\/webp;base64,/);
  assert.equal(saved.description,'Canvasの概要');assert.equal(saved.instructions,'Space：開始\n← →：移動');
  // Concurrent metadata edits must win over an old player session's image save.
  await page.locator('#captureButton').click();await expect(page.locator('#capture')).toBeVisible();
  await page.evaluate(async()=>{const file=await(await window.testGameDir.getFileHandle('index.html.gameportal.json')).getFile();const data=JSON.parse(await file.text());data.title='Concurrent';await window.testWrite(window.testGameDir,'index.html.gameportal.json',JSON.stringify(data));});
  await page.locator('#saveCapture').click();await expect(page.locator('#capture [data-dialog-status]')).toContainText('更新されています');await page.locator('#capture [data-close]').click();
  await page.locator('#closePlayer').click();await page.locator('#refresh').click();await expect(card('Concurrent')).toBeVisible();
  await editFromCard('Concurrent');await page.locator('#editTitle').fill('Renamed');await page.locator('#tabDescription').click();await page.locator('#editDescription').fill('Changed description');await page.locator('#tabDescription').click();await page.locator('#editInstructions').fill('Changed instructions');await saveEditor();await expect(card('Renamed')).toBeVisible();
  await editFromCard('Renamed');await page.locator('#historyButton').click();await expect(page.locator('#history')).toBeVisible();
  await page.locator('#historyEntries button').filter({hasText:'保存前：Concurrent'}).click();await expect(page.locator('#historyPreview img')).toBeVisible();
  await page.screenshot({path:'offline-release/ui-checks/history.png',fullPage:true});
  page.once('dialog',d=>d.accept());await page.locator('#restoreHistory').click();await expect(page.locator('#history')).toBeHidden();await expect(page.locator('#playerDescription')).toHaveText(saved.description);await expect(card('Concurrent').locator('img')).toHaveCount(1);await closeGame();
  const restored=await page.evaluate(async()=>JSON.parse(await(await(await window.testGameDir.getFileHandle('index.html.gameportal.json')).getFile()).text()));assert.equal(restored.id,saved.id);assert.deepEqual(restored.tags,saved.tags);assert.equal(restored.thumbnail,saved.thumbnail);
  assert.equal(restored.description,saved.description);assert.equal(restored.instructions,saved.instructions);
  // Search/filter controls and form feedback operate together.
  await expect(page.locator('#filterDetails')).not.toHaveAttribute('open','');await page.locator('#search').focus();await page.locator('#filterDetails summary').click();await page.locator('#searchScope').selectOption('description');await page.locator('#search').fill('Space 移動');await expect(card('Concurrent')).toBeVisible();
  await page.locator('#kindFilter').selectOption('zip');await expect(page.locator('.card')).toHaveCount(0);await expect(page.locator('#searchSummary')).toContainText('0件を表示');
  await expect(page.locator('#activeFilters')).toContainText('形式：WebゲームZIP');await page.locator('#activeFilters').getByRole('button',{name:'形式：WebゲームZIPを解除',exact:true}).click();await expect(card('Concurrent')).toBeVisible();await expect(page.locator('#kindFilter')).toHaveValue('');await expect(page.locator('#search')).toHaveValue('Space 移動');
  await page.locator('#search').fill('存在しない作品');await expect(page.locator('#emptyReset')).toBeVisible();await page.locator('#emptyReset').click();await expect(page.locator('#searchScope')).toHaveValue('all');await expect(page.locator('#kindFilter')).toHaveValue('');await expect(card('Concurrent')).toBeVisible();await expect(page.locator('#activeFilters')).toBeHidden();
  await page.locator('#environmentFilter').selectOption('HTML');await expect(card('Concurrent')).toBeVisible();await page.locator('#clearFilters').click();
  await editFromCard('Concurrent');await page.locator('#editTitle').fill('   ');assert.equal(await page.locator('#editTitle').evaluate(e=>e.checkValidity()),false);await page.locator('#editTitle').fill('Concurrent');
  await page.locator('#editTags').fill(Array.from({length:13},(_,i)=>'tag'+i).join(','));assert.equal(await page.locator('#editTags').evaluate(e=>e.checkValidity()),false);await page.locator('#editTags').fill('アクション');
  await page.locator('#tabDescription').click();await page.locator('#editDescription').fill('12345');await expect(page.locator('#editDescriptionCount')).toHaveText('5 / 2000');
  await expect(page.locator('#editDirty')).toBeVisible();await page.screenshot({path:'offline-release/ui-checks/form-improved.png',fullPage:true});page.once('dialog',d=>d.dismiss());await page.locator('#cancelEdit').click();await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#editDescription')).toHaveValue('12345');page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await expect(page.locator('#edit')).toBeVisible();page.once('dialog',d=>d.accept());await page.locator('#cancelEdit').click();await closeGame();
  // Read-only mode inspection includes games hidden by uploading markers.
  await page.locator('#settingsButton').click();await page.locator('#enableEditing').uncheck();await page.locator('#settings [data-close]').click();
  await page.evaluate(async()=>{
    const root=window.testRoot;
    await window.testWrite(root,'broken.html','<h1>broken</h1>');await window.testWrite(root,'broken.html.gameportal.json','{bad');
    const s={schema:1,id:'b'.repeat(32),title:'duplicate',tags:['別タグ'],developmentEnvironment:'',thumbnail:null};
    for(const name of ['one','two']){await window.testWrite(root,name+'.html','<h1>'+name+'</h1>');await window.testWrite(root,name+'.html.gameportal.json',JSON.stringify(s));}
    await window.testWrite(root,'gone.html.gameportal.json',JSON.stringify({...s,id:'c'.repeat(32)}));
    await window.testWrite(root,'missing.html','<script src="missing.js"></script>');
    const pending=await root.getDirectoryHandle('pending',{create:true});await window.testWrite(pending,'.gameportal-uploading','pending');
    window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=()=>{throw new Error('Inspection attempted a write');};
  });
  await page.locator('#settingsButton').click();await page.locator('#inspectButton').click();await expect(page.locator('#inspectionSummary')).toContainText('点検完了');
  for(const text of ['ファイル不足','設定の確認','重複ID','投稿途中'])await expect(page.locator('#inspectionResults')).toContainText(text);
  await page.locator('#inspectionFilter').selectOption('upload');await expect(page.locator('#inspectionResults .maintenance-item')).toHaveCount(1);await expect(page.locator('#inspectionResults')).toContainText('pending/.gameportal-uploading');
  await page.locator('#inspectionFilter').selectOption('all');
  await mkdir('offline-release/ui-checks',{recursive:true});await page.screenshot({path:'offline-release/ui-checks/inspection.png',fullPage:true});
  await page.locator('#inspection [data-close]').click();
  await page.locator('#refresh').click();await page.locator('#filterDetails').evaluate(e=>e.open=true);await page.locator('#tagFilters').getByRole('button',{name:'アクション',exact:true}).click();await page.locator('#tagFilters').getByRole('button',{name:'別タグ',exact:true}).click();await expect(page.locator('.card')).toHaveCount(0);
  await page.locator('#tagMatch').selectOption('any');await expect(page.locator('.card')).toHaveCount(3);await expect(card('Concurrent')).toBeVisible();await page.locator('#sortGames').selectOption('updated');await page.screenshot({path:'offline-release/ui-checks/search-options.png',fullPage:true});
  await page.locator('.card .game-title-link').filter({hasText:'duplicate'}).first().click();await expect(page.locator('#player')).toBeVisible();await expect(page.locator('#frame')).toBeHidden();await expect(page.locator('#playerStatus')).toContainText('ID');await expect(page.locator('#editPlaying')).toBeHidden();await closeGame();await page.locator('#clearFilters').click();
  await page.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=window.originalWritable;});
  await page.locator('#search').focus();await page.locator('#filterDetails summary').click();await expect(page.locator('#searchScope')).toBeHidden();
  for(const width of [800,480,360]){await page.setViewportSize({width,height:960});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`offline-release/ui-checks/library-${width}.png`,fullPage:true});}
  await page.setViewportSize({width:1280,height:960});
  // A corrupt library that cannot be connected is still inspectable separately.
  await page.evaluate(async()=>{const opfs=await navigator.storage.getDirectory(),dir=await opfs.getDirectoryHandle('invalid-library',{create:true});const admin=await dir.getDirectoryHandle('.gameportal',{create:true});await window.testWrite(admin,'library.json','{invalid');await window.testWrite(admin,'library-id.json','{invalid');window.showDirectoryPicker=async()=>dir;});
  await page.locator('#settingsButton').click();await page.locator('#inspectButton').click();await page.locator('#inspectionFolder').click();await expect(page.locator('#inspectionSummary')).toContainText('invalid-library');await expect(page.locator('#inspectionResults')).toContainText('library.json');await expect(page.locator('#inspectionResults')).toContainText('library-id.json');
  await page.setViewportSize({width:480,height:960});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'offline-release/ui-checks/inspection-480.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Maintenance UI passed: embedded guide/navigation/Escape/focus/narrow layout and active-play preservation, read-only inspection, all four issue types, inaccessible library inspection, disabled reasons, real canvas capture, stale-image conflict rejection and history restore with IDs/images preserved.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
