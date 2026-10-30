import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-improvements-'));
const browser=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,viewport:{width:1280,height:960}});
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}});await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await mkdir('offline-release/ui-checks',{recursive:true});
 await page.evaluate(async()=>{
  const opfs=await navigator.storage.getDirectory(),root=await opfs.getDirectoryHandle('improvements',{create:true});window.testRoot=root;window.showDirectoryPicker=async()=>root;
  window.writeTest=async(name,value)=>{const w=await(await root.getFileHandle(name,{create:true})).createWritable();await w.write(value);await w.close();};
  for(let i=0;i<130;i++){
   const name='game'+String(i).padStart(3,'0')+'.html';await window.writeTest(name,'<h1>Test game</h1>');
   await window.writeTest(name+'.gameportal.json',JSON.stringify({schema:1,id:(i+1).toString(16).padStart(32,'0'),title:'Game '+String(i).padStart(3,'0'),tags:i%2?['パズル']:['アクション','テスト用'],developmentEnvironment:'HTML',thumbnail:null,description:'説明',instructions:'操作'}));
  }
 });
 await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();
 await expect(page.locator('.card')).toHaveCount(60);await expect(page.locator('#searchSummary')).toContainText('130件');
 await expect(page.locator('#searchSummary')).toBeHidden();await expect(page.locator('.search-help')).toBeHidden();await expect(page.locator('#postReason')).toBeHidden();await expect(page.locator('#libraryInfo')).toBeHidden();await expect(page.locator('#storageNotice')).toBeHidden();await page.screenshot({path:'offline-release/ui-checks/simple-library.png'});
 await page.locator('#search').fill('no-match-please');await expect(page.locator('.card')).toHaveCount(0);await expect(page.locator('#searchSummary')).toBeHidden();await page.locator('#filterDetails summary').click();await expect(page.locator('#searchSummary')).toBeVisible();await expect(page.locator('#searchSummary')).toContainText('0件を表示');await expect(page.locator('.search-help')).toBeVisible();await page.screenshot({path:'offline-release/ui-checks/search-options-open.png'});await page.locator('#filterDetails summary').click();await expect(page.locator('#searchSummary')).toBeHidden();await expect(page.locator('.search-help')).toBeHidden();await page.locator('#search').fill('');await expect(page.locator('.card')).toHaveCount(60);

 await page.locator('#loadMore').click();await expect(page.locator('.card')).toHaveCount(120);await page.locator('#loadMore').click();await expect(page.locator('.card')).toHaveCount(130);await expect(page.locator('#loadMore')).toBeHidden();
 await page.evaluate(()=>{window.retainedCard=document.querySelector('.card');window.originalScan=library.scan;window.scanCalls=0;library.scan=(...args)=>{window.scanCalls++;return window.originalScan(...args);};});
 await page.locator('#search').fill('Game 000');await expect(page.locator('.card')).toHaveCount(1);assert(await page.evaluate(()=>document.querySelector('.card')===window.retainedCard));
 await page.locator('#search').fill('Game 00');await expect(page.locator('.card')).toHaveCount(11);assert.equal(await page.evaluate(()=>window.scanCalls),0);
 await page.locator('#filterDetails summary').click();await page.locator('#tagSearch').fill('テスト');await expect(page.locator('#tagFilters button')).toHaveCount(1);await expect(page.locator('#tagFilters')).toContainText('65');
 await page.locator('#tagCategory').selectOption('ジャンル');await expect(page.locator('#tagFilters button')).toHaveCount(0);await page.locator('#clearFilters').click();
 await page.screenshot({path:'offline-release/ui-checks/library-130.png',fullPage:true});
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.locator('#settings [data-close]').click();
 // Missing resources are reported before confirmation, with no created folders.
 const countDirs=()=>page.evaluate(async()=>{let n=0;for await(const e of window.testRoot.values())if(e.kind==='directory')n++;return n;});const before=await countDirs();
 await page.locator('#postButton').click();await expect(page.locator('#post')).toBeVisible();await page.locator('#postFiles').setInputFiles({name:'missing.html',mimeType:'text/html',buffer:Buffer.from('<script src="missing.js"></script>')});await expect(page.locator('#postCheck')).toContainText('missing.js');await expect(page.locator('#confirmPost')).toBeDisabled();assert.equal(await countDirs(),before);
 await page.locator('#postFiles').setInputFiles({name:'valid.html',mimeType:'text/html',buffer:Buffer.from('<h1>Valid</h1>')});await expect(page.locator('#confirmPost')).toBeEnabled();assert.equal(await countDirs(),before);
 const openEditor=async()=>{await page.locator('#search').fill('Game 000');await expect(page.locator('.card')).toHaveCount(1);await expect(page.locator('.game-title-link')).toHaveText('Game 000');await page.locator('.game-title-link').click();await expect(page.locator('#player')).toBeVisible();await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();};
 const closeGame=async()=>{await page.waitForFunction(()=>!busy);await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();await page.waitForFunction(()=>!busy);};
 // Custom data methods are not missing files: upload, persist and play the actual game.
 await page.locator('#postFiles').setInputFiles({name:'method-game.html',mimeType:'text/html',buffer:Buffer.from('<h1>Method game</h1><script>const scores={fetch(name){return name==="best-score"?"42":"0";}};document.body.dataset.score=scores.fetch("best-score");</script>')});
 await expect(page.locator('#postCheck')).toContainText('確認が必要なこと');await expect(page.locator('#confirmPost')).toBeEnabled();assert.equal(await countDirs(),before);await page.locator('#confirmPost').click();await expect(page.locator('#edit')).toBeVisible();await page.locator('#cancelEdit').click();await expect(page.locator('#edit')).toBeHidden();
 await page.locator('#search').fill('method-game');await expect(page.locator('.card')).toHaveCount(1);await expect(page.locator('.game-title-link')).toHaveText('method-game');await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-score','42');await closeGame();
 for(const ext of ['jpg','png']){
  await openEditor();await expect(page.locator('#panelBasic')).toBeVisible();await expect(page.locator('#panelDescription')).toBeHidden();await page.locator('#tabBasic').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#tabDescription')).toHaveAttribute('aria-selected','true');await expect(page.locator('#panelDescription')).toBeVisible();
  await page.locator('#tabImage').click();const type=ext==='jpg'?'image/jpeg':'image/png';
  const data=await page.evaluate(type=>{const c=document.createElement('canvas');c.width=1440;c.height=540;const x=c.getContext('2d');x.fillStyle='#f00';x.fillRect(0,0,720,540);x.fillStyle='#00f';x.fillRect(720,0,720,540);return c.toDataURL(type).split(',')[1];},type);
  await page.locator('#editImage').setInputFiles({name:'cover.'+ext,mimeType:type,buffer:Buffer.from(data,'base64')});await expect(page.locator('#cropControls')).toBeVisible();
  await expect(page.locator('#enableCrop')).not.toBeChecked();await expect(page.locator('#cropControls')).not.toHaveAttribute('open','');
  const fullImage=await page.locator('#editImagePreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=960;c.height=540;const x=c.getContext('2d');x.drawImage(img,0,0);return [[...x.getImageData(50,270,1,1).data],[...x.getImageData(900,270,1,1).data]];});assert(fullImage[0][0]>200&&fullImage[1][2]>200);
  await page.locator('#cropControls summary').click();await page.locator('#enableCrop').check();
  await page.locator('#cropZoom').fill('2');await page.locator('#cropX').fill('100');await expect(page.locator('#cropZoomValue')).toHaveText('2.00倍');await page.screenshot({path:`offline-release/ui-checks/crop-${ext}.png`,fullPage:true});
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#edit')).toBeHidden();await page.waitForFunction(()=>!busy);await expect(page.locator('#playerStatus')).toContainText('作品情報を保存しました');
  const pixel=await page.evaluate(async()=>{const data=JSON.parse(await(await(await window.testRoot.getFileHandle('game000.html.gameportal.json')).getFile()).text());const img=await createImageBitmap(await(await fetch(data.thumbnail)).blob());const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(img,480,270,1,1,0,0,1,1);const p=[...x.getImageData(0,0,1,1).data];img.close();return p;});assert(pixel[2]>200&&pixel[0]<50);await closeGame();
 }
 // Simulated NAS disconnect: failed writes keep input and committed metadata.
 await openEditor();await page.locator('#editTitle').fill('Disconnected draft');
 await page.evaluate(()=>{window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){if(this.name==='game000.html.gameportal.json')throw new DOMException('Simulated NAS disconnected','NetworkError');return window.originalWritable.apply(this,args);};});
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#edit [data-dialog-status]')).toContainText('通信に失敗');await expect(page.locator('#operationErrorText')).toContainText('CONNECTION_FAILED');await expect(page.locator('#operationErrorText')).toContainText('Simulated NAS disconnected');await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#editTitle')).toHaveValue('Disconnected draft');
 assert.equal(await page.evaluate(async()=>JSON.parse(await(await(await window.testRoot.getFileHandle('game000.html.gameportal.json')).getFile()).text()).title),'Game 000');
 await page.evaluate(()=>{FileSystemFileHandle.prototype.createWritable=window.originalWritable;});await page.locator('#editTitle').fill('Game 000');
 // Save succeeds, following scan fails: report committed success separately.
 await page.locator('#editEnvironment').fill('HTML updated');await page.evaluate(()=>{library.scan=async()=>{library.scan=window.originalScan;throw new DOMException('Simulated NAS read disconnect','NetworkError');};});
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('#edit')).toBeHidden();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('作品情報を保存しました。 一覧更新だけ失敗');await expect(page.locator('#playerStatus')).toContainText('再保存せず');
 const id=await page.evaluate(async()=>JSON.parse(await(await(await window.testRoot.getFileHandle('game000.html.gameportal.json')).getFile()).text()).id);
 await closeGame();await page.locator('#settingsButton').click();await expect(page.locator('#reconnect')).toBeVisible();await page.locator('#reconnect').click();await expect(page.locator('#settings')).toBeHidden();
 await page.locator('#search').fill('Game 000');await expect(page.locator('.card')).toHaveCount(1);await expect(page.locator('.card .type')).toHaveText('HTML updated');assert.equal(await page.evaluate(()=>games.find(g=>g.title==='Game 000').id),id);
 // A timer renderer leaves a blank buffer until an explicit capture redraw.
 await page.evaluate(async()=>{await window.writeTest('capture-timer.html','<canvas width="960" height="540"></canvas><script>const canvas=document.querySelector("canvas");const vm={runtime:{renderer:{canvas,draw(){const x=canvas.getContext("2d");x.fillStyle="#00ff00";x.fillRect(0,0,960,540);}}}};</script>');});
 await page.locator('#clearFilters').click();await page.locator('#refresh').click();await page.locator('#search').fill('capture-timer');await expect(page.locator('.card')).toHaveCount(1);await page.locator('.game-title-link').click();await page.waitForFunction(()=>!busy);
 await page.locator('#captureButton').click();await expect(page.locator('#capture')).toBeVisible();const capturePixel=await page.locator('#capturePreview').evaluate(async img=>{await img.decode();const c=document.createElement('canvas');c.width=1;c.height=1;const x=c.getContext('2d');x.drawImage(img,0,0,1,1);return [...x.getImageData(0,0,1,1).data];});assert(capturePixel[1]>200&&capturePixel[3]===255);await page.locator('#capture [data-close]').click();await closeGame();

 const notificationPage=await browser.newPage();await notificationPage.goto('http://127.0.0.1:'+server.address().port);await expect(notificationPage.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await notificationPage.clock.install({time:new Date('2026-10-16T12:00:00Z')});await notificationPage.clock.pauseAt(new Date('2026-10-16T12:00:01Z'));
 await notificationPage.evaluate(()=>status('一覧を更新しました。'));await notificationPage.clock.fastForward(9999);await expect(notificationPage.locator('#status')).toHaveText('一覧を更新しました。');await notificationPage.clock.fastForward(1);await expect(notificationPage.locator('#status')).toHaveText('');
 await notificationPage.evaluate(()=>status('一覧を更新しました。'));await notificationPage.clock.fastForward(9000);await notificationPage.evaluate(()=>status('一覧を更新しました。'));await notificationPage.clock.fastForward(1001);await expect(notificationPage.locator('#status')).toHaveText('一覧を更新しました。');await notificationPage.clock.fastForward(8999);await expect(notificationPage.locator('#status')).toBeEmpty();
 await notificationPage.evaluate(()=>status('一覧を更新しました。'));await notificationPage.clock.fastForward(5000);await notificationPage.evaluate(()=>status('保存結果未確認です。確認してください。'));await notificationPage.clock.fastForward(30000);await expect(notificationPage.locator('#status')).toHaveText('保存結果未確認です。確認してください。');await notificationPage.close();
 assert.deepEqual(errors,[]);console.log('Improvements UI passed: 130-game paging/card reuse, tag search/category/counts, read-only upload checks and custom-method game upload/play, editor tabs/keyboard, JPG/PNG crop saved pixels, simulated NAS write/read disconnect and same-ID reconnect.');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
