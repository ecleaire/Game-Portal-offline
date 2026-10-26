import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { packageWebFiles } from '../../assets/zip-upload.js';

const temp = await mkdtemp(join(tmpdir(), 'portal-html-'));
const main = resolve('offline-release/GAME-PORTAL.html'), html = await readFile(main);
const expectedVersion = 'v' + JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
const server = createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(html); });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launchPersistentContext(join(temp,'profile'),{ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, headless:true,viewport:{width:1200,height:850} });
const context = browser;
let peer;
const peerTrace = [];
const page = await context.newPage(); const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if(message.type()==='error') console.log('Console:',message.text().slice(0,600)); });
context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
try {
  // This instance's managed Chrome may forbid file: navigation administratively.
  // CI verifies this on standard Chromium; a local policy denial is reported.
  const filePage = await context.newPage();
  try {
    await filePage.goto(pathToFileURL(main).href);
    assert.equal(await filePage.evaluate(()=>isSecureContext && typeof showDirectoryPicker==='function'),true);
    await expect(filePage.getByRole('heading',{name:/ゲーム/,level:1})).toBeVisible(); await expect(filePage.locator('html')).toHaveAttribute('data-ready','true');
    console.log('file:// startup and folder picker availability passed.');
  } catch(e) {
    if (!String(e.message).includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw e;
    console.log('file:// startup NOT RUN: managed browser administrator policy blocks file URLs.');
  } finally { await filePage.close(); }
  await page.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}});await page.goto(origin); await expect(page.getByRole('heading',{name:/ゲーム/,level:1})).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#appVersion')).toHaveText(expectedVersion);
  peer = await context.newPage(); await peer.goto(origin); await expect(peer.getByRole('heading',{name:/ゲーム/,level:1})).toBeVisible(); peer.on('pageerror',error=>errors.push(error.message)); await expect(peer.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    window.testRoot = await opfs.getDirectoryHandle('games',{create:true});
    window.showDirectoryPicker = async options => { window.testPickerOptions = options; return window.testRoot; };
  });
  await expect(page.locator('#modeLabel')).toHaveText('あそぶ');
  await expect(page.locator('#refresh')).toBeDisabled();
  await page.locator('#setupFolder').click();
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#folderName')).toHaveText('games');
  await expect(page.locator('#setupFolder')).toBeHidden();
  assert.equal(await page.evaluate(()=>window.testPickerOptions.mode),'read');
  await expect(page.locator('#postButton')).toBeDisabled();
  await page.getByRole('button',{name:'設定',exact:true}).click(); await page.locator('#enableEditing').check(); await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(page.locator('#modeLabel')).toHaveText('追加・編集');
  await context.setOffline(true); const before = requests.length;
  const gameFile = join(temp,'Sample.html');
  await writeFile(gameFile,'<h1>HTML offline</h1><script>document.body.dataset.previous=localStorage.getItem("level")||"none";localStorage.setItem("level","saved");document.body.dataset.parent=(()=>{try{return parent.document.title}catch{return "blocked"}})();fetch("https://example.com/forbidden").then(()=>document.body.dataset.network="allowed",()=>document.body.dataset.network="blocked");</script>');
  await writeFile(gameFile,(await readFile(gameFile,'utf8')).replace('<script>','<script>document.body.dataset.compiler=Function("return 7")();'));
  async function post(filename, configure=false) { await page.getByRole('button',{name:'＋ ゲームを追加',exact:true}).click();await expect(page.locator('#post')).toBeVisible(); await page.locator('#postFiles').setInputFiles(filename);await expect(page.locator('#postSummary')).toContainText('追加先：');await page.locator('#confirmPost').click(); await expect(page.locator('#post')).not.toBeVisible();await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#postEditNotice')).toBeVisible();await page.waitForFunction(()=>!busy);if(!configure)await page.locator('#edit [data-close]').click(); }
  const card = title => page.locator('.card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  const closeGame=async()=>{await page.waitForFunction(()=>!closingPlayer);if(await page.locator('#player').isVisible()){await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();}};
  const openGame=async title=>{await closeGame();await card(title).locator('.game-title-link').click();await expect(page.locator('#player')).toBeVisible();await page.waitForFunction(()=>!busy);};
  const editFromCard=async title=>{await openGame(title);await page.waitForFunction(()=>!busy);await page.locator('#editPlaying').click();await expect(page.locator('#edit')).toBeVisible();};
  const saveEditor=async()=>{await page.getByRole('button',{name:'保存',exact:true}).click();await page.waitForFunction(()=>!busy);if(!await page.locator('#edit').isVisible())await closeGame();};
  await expect(page.locator('#emptyPost')).toBeVisible();await page.locator('#emptyPost').click();await expect(page.locator('#post')).toBeVisible();await expect(page.locator('#confirmPost')).toBeDisabled();await page.locator('#postFiles').setInputFiles(gameFile);await expect(page.locator('#post')).toBeVisible();await expect(page.locator('#edit')).toBeHidden();await expect(page.locator('.card')).toHaveCount(0);await expect(page.locator('#postSummary')).toContainText('追加先：games');
  assert.equal(await page.evaluate(async()=>{let count=0;for await(const e of window.testRoot.values())if(e.name.startsWith('game-'))count++;return count;}),0);
  await mkdir('offline-release/ui-checks',{recursive:true});await page.screenshot({path:'offline-release/ui-checks/post-selection.png',fullPage:true});
  await page.locator('#post [data-close]').click();await page.locator('#postButton').click();await expect(page.locator('#post')).toBeVisible();await expect(page.locator('#confirmPost')).toBeDisabled();
  await page.locator('#postFiles').setInputFiles({name:'broken.zip',mimeType:'application/zip',buffer:Buffer.from('broken')});await expect(page.locator('#postCheck')).toContainText('ZIPを読み取れません');await expect(page.locator('#confirmPost')).toBeDisabled();await expect(page.locator('#post')).toBeVisible();
  await page.evaluate(()=>{window.originalPostWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){if(this.name==='Sample.html')return new Promise(resolve=>{window.releasePosting=()=>resolve(window.originalPostWritable.apply(this,args));});return window.originalPostWritable.apply(this,args);};});
  await page.locator('#postFiles').setInputFiles(gameFile);await page.locator('#confirmPost').click();await page.waitForFunction(()=>!!window.releasePosting);await expect(page.locator('#postFiles')).toBeDisabled();await expect(page.locator('#post [data-dialog-status]')).toContainText('コピー');await page.locator('#post [data-close]').click();await expect(page.locator('#post')).toBeVisible();
  await page.evaluate(()=>{window.releasePosting();FileSystemFileHandle.prototype.createWritable=window.originalPostWritable;});await expect(page.locator('#edit')).toBeVisible();await page.waitForFunction(()=>!busy);
  await expect(card('Sample')).toBeVisible();await expect(page.locator('#editTitle')).toHaveValue('Sample');await expect(page.locator('#cancelEdit')).toHaveText('あとで設定');
  await expect(page.locator('#tagCategories summary')).toHaveText(['ジャンル','プレイ形式','画面・視点','操作','ゲームの特徴','雰囲気・デザイン','開発環境','対応環境']);
  const actionTag = page.locator('#tagChoices').getByRole('button',{name:'アクション',exact:true});
  await actionTag.click(); await expect(page.locator('#editTags')).toHaveValue('アクション'); await expect(actionTag).toHaveAttribute('aria-pressed','true');
  await actionTag.click(); await expect(page.locator('#editTags')).toHaveValue('');
  await page.locator('#editEnvironment').fill('Godot 4.5'); await page.locator('#editTitle').fill('My portable game'); await page.locator('#editTags').fill('アクション, お気に入り');
  const description='気軽に遊べるゲームです。\n<img src=x onerror="window.infoInjected=true">';const instructions='← →：移動\nSpace：ジャンプ';
  await page.locator('#tabDescription').click();await page.locator('#editDescription').fill(description);await page.locator('#tabDescription').click();await page.locator('#editInstructions').fill(instructions);
  const cover = await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const ctx=c.getContext('2d');ctx.fillStyle='#67ddc4';ctx.fillRect(0,0,64,36);return c.toDataURL().split(',')[1];});
  await page.locator('#tabImage').click();await page.locator('#editImage').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(cover,'base64')});
  await expect(page.locator('#editImagePreview')).toBeVisible();
  await page.locator('#editImagePreview').scrollIntoViewIfNeeded();await page.screenshot({path:'offline-release/ui-checks/post-image-preview.png',fullPage:true});
  await saveEditor(); await expect(card('My portable game')).toBeVisible();
  await expect(card('My portable game').locator('img')).toHaveCount(1);
  const readSettings = () => page.evaluate(async () => {
    for await (const dir of window.testRoot.values()) if (dir.kind === 'directory' && dir.name.startsWith('game-')) {
      for await (const entry of dir.values()) if (entry.name === 'Sample.html.gameportal.json') return { path: dir.name + '/' + entry.name, data: JSON.parse(await (await entry.getFile()).text()) };
    }
  });
  const initialSettings = await readSettings();
  assert.equal(initialSettings.data.title, 'My portable game');
  assert.equal(initialSettings.data.developmentEnvironment, 'Godot 4.5');
  assert.equal(initialSettings.data.description,description);assert.equal(initialSettings.data.instructions,instructions);
  assert.deepEqual(initialSettings.data.tags, ['アクション', 'お気に入り', 'Godot 4.5']);
  assert.match(initialSettings.data.thumbnail, /^data:image\/webp;base64,/);
  await editFromCard('My portable game');
  await expect(page.locator('#editEnvironment')).toHaveValue('Godot 4.5');
  await expect(page.locator('#tagChoices').getByRole('button',{name:'お気に入り',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#editEnvironment').fill('Godot 4.6');
  await saveEditor();
  await expect(page.locator('#edit')).not.toBeVisible();
  const updatedSettings = await readSettings();
  assert.equal(updatedSettings.path, initialSettings.path);
  assert.equal(updatedSettings.data.developmentEnvironment, 'Godot 4.6');
  assert.equal(updatedSettings.data.thumbnail, initialSettings.data.thumbnail);
  assert.equal(updatedSettings.data.id, initialSettings.data.id);
  await openGame('My portable game');
  await expect(page.locator('#playerDescription')).toHaveText(description);await expect(page.locator('#playerInstructions')).toHaveText(instructions);await expect(page.locator('#playerDescription img')).toHaveCount(0);assert.equal(await page.evaluate(()=>window.infoInjected),undefined);
  await closeGame();
  await page.locator('#search').fill('Godot 4.6'); await expect(page.locator('.card')).toHaveCount(1); await page.locator('#search').fill('');

  await page.evaluate(()=>{const s=document.querySelector('#search');for(const value of ['','My','missing']){s.value=value;s.dispatchEvent(new Event('input'));}});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));await expect(page.locator('.card')).toHaveCount(0);await page.locator('#search').fill('');
  await page.locator('#search').fill('missing'); await expect(page.locator('.card')).toHaveCount(0); await page.locator('#search').fill('お気に入り'); await expect(page.locator('.card')).toHaveCount(1); await page.locator('#search').fill('');
  await page.locator('#filterDetails').evaluate(e=>e.open=true);await page.locator('#tagFilters').getByRole('button',{name:'アクション',exact:true}).click(); await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#search').fill('missing'); await expect(page.locator('#emptyState')).toBeVisible();
  await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#tagFilters').getByRole('button',{name:'アクション',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.card')).toHaveCount(1); await expect(page.locator('#clearFilters')).toBeHidden();
  await openGame('My portable game');
  const frame = page.frameLocator('#frame'); await expect(frame.getByRole('heading',{name:'HTML offline'})).toBeVisible();
  await page.locator('#captureButton').click();await expect(page.locator('#playerStatus')).toContainText('撮影できるゲーム画面がありません');await expect(page.locator('#player')).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-previous','saved'); await expect(frame.locator('body')).toHaveAttribute('data-parent','blocked'); await expect(frame.locator('body')).toHaveAttribute('data-network','blocked');
  await expect(frame.locator('body')).toHaveAttribute('data-compiler','7');
  await frame.locator('body').evaluate(()=>{localStorage.propertySave=42;localStorage.setItem('temporary-property','remove');delete localStorage['temporary-property'];});
  assert.equal(await frame.locator('body').evaluate(()=>localStorage.getItem('propertySave')),'42','property-style Storage writes must use the persistent save snapshot');
  assert.equal(await frame.locator('body').evaluate(()=>localStorage.getItem('temporary-property')),null,'property deletion must remove a stored key');
  await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  await openGame('My portable game');
  await expect(frame.locator('body')).toHaveAttribute('data-previous','saved');
  assert.equal(await frame.locator('body').evaluate(()=>localStorage.propertySave),'42','property-style save survives reopening');
  assert(await frame.locator('body').evaluate(()=>Object.keys(localStorage).includes('propertySave')),'enumerating Storage includes saved properties');
  assert.equal(await frame.locator('body').evaluate(()=>{try{localStorage.largeProperty='あ'.repeat(180000);return 'allowed';}catch(error){return error.name;}}),'QuotaExceededError','named writes enforce the save limit');
  assert.equal(await frame.locator('body').evaluate(()=>localStorage.getItem('largeProperty')),null,'rejected named writes leave the previous save intact');
  assert.equal(await frame.locator('body').evaluate(()=>{try{localStorage.setItem('large','あ'.repeat(180000));return 'allowed';}catch(error){return error.name;}}),'QuotaExceededError');
  if(!await page.locator('#exportSave').isVisible())await page.locator('#playerMoreTools summary').click();
  const exported = page.waitForEvent('download'); await page.getByRole('button',{name:'セーブ書き出し',exact:true}).click();
  const download = await exported; const exportName=join(temp,'save.json'); await download.saveAs(exportName);
  const exportedData=JSON.parse(await readFile(exportName,'utf8')); assert.equal(exportedData.data.level,'saved');
  assert.equal(exportedData.gameId,initialSettings.data.id);
  // A second tab must not overwrite saves from an active session.
  peer.on('crash',()=>peerTrace.push('renderer crashed')); peer.on('close',()=>peerTrace.push('page closed'));
  await peer.evaluate(async()=>{const opfs=await navigator.storage.getDirectory();const dir=await opfs.getDirectoryHandle('games');window.showDirectoryPicker=async()=>dir;});
  await peer.getByRole('button',{name:'設定',exact:true}).click();await peer.locator('#chooseFolder').click();
  await expect(peer.locator('#folderName')).toHaveText('games');
  await expect(peer.locator('#postButton')).toBeDisabled();
  const peerCard=peer.locator('.card').filter({has:peer.getByRole('heading',{name:'My portable game',exact:true})});
  await expect(peerCard.locator('button:not(.game-tag):not(.game-tags-more):not(.favorite-button)')).toHaveCount(0);
  await peerCard.locator('.game-title-link').click(); await expect(peer.locator('#status')).toContainText('別のタブで起動中');
  await expect(peer.locator('#player')).not.toBeVisible();
  await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  await peerCard.locator('.game-title-link').click(); await expect(peer.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous','saved');
  await peer.getByRole('button',{name:'← ゲーム一覧',exact:true}).click(); await peer.close();
  assert.equal(await page.evaluate(async()=>{const dir=await window.testRoot.getDirectoryHandle('.gameportal');try{await dir.getDirectoryHandle('saves');return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}}),false,'Playing must never create shared NAS saves');
  const zip = await packageWebFiles([new File(['<h1>ZIP offline</h1><script>fetch(new URL("data.json",document.baseURI)).then(r=>r.json()).then(d=>document.body.dataset.loaded=d.value);const audio=new AudioContext();audio.audioWorklet.addModule("test-worklet.js").then(()=>document.body.dataset.worklet="ready",()=>document.body.dataset.worklet="failed");audio.audioWorklet.addModule("https://example.com/external.js").then(()=>document.body.dataset.externalWorklet="allowed",()=>document.body.dataset.externalWorklet="blocked");</script>'],'index.html'),new File(['{"value":"local"}'],'data.json'),new File(['registerProcessor("portal-test",class extends AudioWorkletProcessor{process(){return true;}});'],'test-worklet.js')]);
  const zipName=join(temp,'Package.zip'); await writeFile(zipName,Buffer.from(await zip.arrayBuffer())); await post(zipName);
  assert.deepEqual(await readSettings(), updatedSettings);
  await openGame('Package'); await expect(frame.getByRole('heading',{name:'ZIP offline'})).toBeVisible(); await expect(frame.locator('body')).toHaveAttribute('data-loaded','local'); await expect(frame.locator('body')).toHaveAttribute('data-worklet','ready'); await expect(frame.locator('body')).toHaveAttribute('data-external-worklet','blocked'); await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  // Move all bytes (not browser handles or cached state) into a fresh folder.
  await page.evaluate(async () => {
    const opfs=await navigator.storage.getDirectory(), target=await opfs.getDirectoryHandle('copied-library',{create:true});
    async function copy(from,to) { for await(const entry of from.values()) if(entry.kind==='directory')await copy(entry,await to.getDirectoryHandle(entry.name,{create:true}));else{const w=await(await to.getFileHandle(entry.name,{create:true})).createWritable();await w.write(await entry.getFile());await w.close();} }
    await copy(window.testRoot,target); await (await target.getDirectoryHandle('.gameportal')).removeEntry('library-id.json'); window.testRoot=target; window.showDirectoryPicker=async()=>target;
  });
  await page.getByRole('button',{name:'設定',exact:true}).click(); await page.locator('#chooseFolder').click();
  await expect(page.locator('#folderName')).toHaveText('copied-library'); await expect(card('My portable game').locator('.type')).toHaveText('Godot 4.6'); await expect(card('My portable game').locator('img')).toHaveCount(1);
  await openGame('My portable game'); await expect(frame.locator('body')).toHaveAttribute('data-previous','none'); await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  // Imported legacy/exported saves stay on this PC; wrong-game files are refused.
  await openGame('My portable game');
  await expect(frame.locator('body')).toHaveAttribute('data-previous','saved');
  await page.locator('#importSave').setInputFiles({name:'wrong.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,gameId:'0'.repeat(32)}))});
  await expect(page.locator('#status')).toContainText('別のゲーム');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,data:{level:'imported'}}))});
  await expect(frame.locator('body')).toHaveAttribute('data-previous','imported');
  for (const value of ['restart-1','restart-2']) { page.once('dialog',dialog=>dialog.accept()); await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,data:{level:value}}))}); await expect(frame.locator('body')).toHaveAttribute('data-previous',value); }
  // Quota/write failure keeps the pending snapshot and does not close the player.
  await page.evaluate(()=>{window.originalSavePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='saves')throw new DOMException('Test full disk','QuotaExceededError');return window.originalSavePut.apply(this,args);};});
  await frame.locator('body').evaluate(()=>localStorage.setItem('level','unsaved'));
  await expect(page.locator('#playerStatus')).toContainText('セーブできません');
  await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click(); await expect(page.locator('#player')).toBeVisible();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalSavePut;});
  await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click(); await expect(page.locator('#player')).not.toBeVisible();
  await openGame('My portable game');await expect(frame.locator('body')).toHaveAttribute('data-previous','unsaved');await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  const source='import pyxel\nfrom js import document\npyxel.init(32,32,title="Offline Pyxel")\ndocument.body.dataset.pyxel="running"\ndef update():\n    pass\ndef draw():\n    pyxel.cls(3)\npyxel.run(update,draw)\n';
  const app = await packageWebFiles([new File(['main.py'],'test/.pyxapp_startup_script'),new File([source],'test/main.py')]);
  const appName=join(temp,'Tiny.pyxapp'); await writeFile(appName,Buffer.from(await app.arrayBuffer())); await post(appName);
  await openGame('Tiny');
  await expect(frame.locator('#pyxel-prompt')).toBeVisible({timeout:90000});
  await frame.locator('#canvas').click(); await expect(frame.locator('body')).toHaveAttribute('data-pyxel','running',{timeout:30000});
  await expect.poll(()=>frame.locator('body').evaluate(()=>window.pyxelContext.pyodide.runPython('import pyxel; pyxel.frame_count'))).toBeGreaterThan(0);
  await page.locator('#captureButton').click();await expect(page.locator('#capture')).toBeVisible();await expect(page.locator('#capturePreview')).toHaveAttribute('src',/^data:image\/webp;base64,/);
  await page.locator('#saveCapture').click();await expect(page.locator('#capture')).toBeHidden();await expect(card('Tiny').locator('img')).toHaveCount(1);
  await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();
  // Reopening Pyxel reuses immutable runtime information; old browsers use fallback codecs.
  await page.evaluate(()=>{window.firstRuntimeObject=pyxelRuntime;window.nativeFromBase64=Uint8Array.fromBase64;window.nativeToBase64=Uint8Array.prototype.toBase64;Uint8Array.fromBase64=undefined;Uint8Array.prototype.toBase64=undefined;});
  await context.addInitScript(()=>{Uint8Array.fromBase64=undefined;Uint8Array.prototype.toBase64=undefined;});
  await openGame('Tiny');await expect(frame.locator('#pyxel-prompt')).toBeVisible({timeout:90000});await frame.locator('#canvas').click();await expect(frame.locator('body')).toHaveAttribute('data-pyxel','running',{timeout:30000});assert.equal(await page.evaluate(()=>pyxelRuntime===window.firstRuntimeObject),true);assert.equal(await frame.locator('body').evaluate(()=>typeof Uint8Array.fromBase64),'undefined');await page.getByRole('button',{name:'← ゲーム一覧',exact:true}).click();await page.evaluate(()=>{Uint8Array.fromBase64=window.nativeFromBase64;Uint8Array.prototype.toBase64=window.nativeToBase64;});
  // Existing installations keep their title/tags/cover when first saved to a sidecar.
  const folderExport=join(temp,'FolderGame');await mkdir(folderExport);await writeFile(join(folderExport,'index.html'),'<h1>Folder game</h1>');
  await page.locator('#postButton').click();await expect(page.locator('#post')).toBeVisible();await page.locator('#postDirectory').setInputFiles(folderExport);
  await page.locator('#confirmPost').click();
  await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#editTitle')).toHaveValue('FolderGame');await expect(page.locator('#postEditNotice')).toBeVisible();
  await page.waitForFunction(()=>!busy);await page.locator('#edit [data-close]').click();await expect(card('FolderGame')).toBeVisible();
  await page.evaluate(async image => {
    async function write(dir, name, bytes) { const writer = await (await dir.getFileHandle(name,{create:true})).createWritable(); await writer.write(bytes); await writer.close(); }
    await write(window.testRoot,'Legacy.html','<h1>Legacy</h1>');
    const admin = await window.testRoot.getDirectoryHandle('.gameportal',{create:true});
    const thumbs = await admin.getDirectoryHandle('thumbnails',{create:true});
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Legacy.html'));
    const id = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    await write(thumbs,id+'.webp',Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0)));
    await write(admin,'library.json',JSON.stringify({schema:1,revision:'legacy',games:{'Legacy.html':{title:'Legacy saved name',tags:['legacy'],thumbnail:true}}}));
  },initialSettings.data.thumbnail);
  await page.locator('#refresh').click();
  await expect(card('Legacy saved name').locator('img')).toHaveCount(1);
  await editFromCard('Legacy saved name');
  await page.locator('#editEnvironment').fill('Scratch');
  await saveEditor();
  await expect(page.locator('#edit')).not.toBeVisible();
  const legacy = await page.evaluate(async()=>JSON.parse(await(await(await window.testRoot.getFileHandle('Legacy.html.gameportal.json')).getFile()).text()));
  assert.equal(legacy.title,'Legacy saved name'); assert.deepEqual(legacy.tags,['legacy','Scratch']); assert.equal(legacy.thumbnail,initialSettings.data.thumbnail);
  await editFromCard('Legacy saved name');
  await page.evaluate(async()=>{const handle=await window.testRoot.getFileHandle('Legacy.html.gameportal.json');const data=JSON.parse(await(await handle.getFile()).text());data.title='Updated elsewhere';const w=await handle.createWritable();await w.write(JSON.stringify(data));await w.close();});
  await page.locator('#editTitle').fill('Stale overwrite'); await saveEditor();
  await expect(page.locator('#status')).toContainText('更新されています');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await expect(page.locator('#edit')).toBeHidden();
  await closeGame();await page.locator('#refresh').click(); await expect(card('Updated elsewhere')).toBeVisible();
  assert.equal(requests.length,before,'No HTTP requests may start after loading the single HTML');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(temp,'offline-html.png'),fullPage:true});
  console.log('Offline HTML passed: read-only browsing, local saves, cross-tab play lock, save import/export and failed-save retry, real browser folder writes, posting HTML/ZIP/PYXAPP, metadata and thumbnail, tags/search, isolated play, save persistence, portable folder copy, real Pyxel canvas, no runtime HTTP.');
} catch(e) {
  console.error('Original failure:',e);
  console.log('Search diagnosis:',await page.evaluate(()=>({query:document.querySelector('#search').value,scope:document.querySelector('#searchScope').value,kind:document.querySelector('#kindFilter').value,environment:document.querySelector('#environmentFilter').value,tags:[...selectedTags],games:games.map(g=>({title:g.title,tags:g.tags}))})).catch(()=>null));
  const child=page.frames().find(f=>f!==page.mainFrame());
  if(child)console.error('Frame diagnosis:',await child.evaluate(()=>({body:document.body?.innerHTML.slice(0,1500),links:[...document.querySelectorAll('link')].map(x=>x.href),runtime:!!window.pyxelContext,resources:performance.getEntriesByType('resource').slice(-10).map(x=>x.name)})).catch(()=>null));
  console.error('Browser status:',await page.locator('#status').textContent().catch(()=>''),'Player:',await page.locator('#playerStatus').textContent().catch(()=>''));console.error('Browser errors:',errors);
  const peerState=peer&&!peer.isClosed()?await peer.evaluate(()=>({status:document.querySelector('#status')?.textContent,folder:document.querySelector('#folderName')?.textContent,cards:[...document.querySelectorAll('.card h2')].map(n=>n.textContent),settings:document.querySelector('#settings')?.open})).catch(()=>null):null;
  console.error('Peer state:',peerState);
  if(process.env.GITHUB_ACTIONS)console.log('::error title=Offline HTML::'+(String(e.stack||e)+'\nPeer state: '+JSON.stringify(peerState)+'\nPeer trace: '+JSON.stringify(peerTrace)).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D'));
  throw e;
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); await rm(temp,{recursive:true,force:true,maxRetries:10}); }
