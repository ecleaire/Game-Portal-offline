import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html'),playerHtml=await readFile('offline-release/GAME-PORTAL-PLAY.html'),server=createServer((q,r)=>r.end(q.url==='/player'?playerHtml:html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const temp=await mkdtemp(join(tmpdir(),'portal-shared-saves-')),contexts=[];
try{
  const pages=[],errors=[];
  for(const name of ['A','B']){
    const context=await chromium.launchPersistentContext(join(temp,name),{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});contexts.push(context);
    await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
    const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.clock.install();await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
    await page.evaluate(async()=>{window.fixtureRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('shared-library',{create:true});window.showDirectoryPicker=async()=>fixtureRoot;});
  }
  const [a,b]=pages;
  const files=page=>page.evaluate(async()=>{const result=[];async function walk(dir,prefix=''){for await(const entry of dir.values()){if(entry.kind==='directory')await walk(entry,prefix+entry.name+'/');else result.push([prefix+entry.name,await(await entry.getFile()).text()]);}}await walk(window.fixtureRoot||root);return result;});
  const copy=async(from,to)=>to.evaluate(async entries=>{for(const [path,text]of entries){await library.writeFile(fixtureRoot,path,text);if(/^\.gameportal\/shared-saves\/[a-f0-9]{32}\//.test(path)){const id=path.split('/')[2];await(await(await(await fixtureRoot.getDirectoryHandle('.gameportal')).getDirectoryHandle('shared-saves')).getDirectoryHandle(id)).getDirectoryHandle('@eaDir',{create:true});}}},await files(from));
  const connect=async page=>{await page.locator('#settingsButton').click();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);};
  await a.evaluate(async()=>{await library.writeFile(fixtureRoot,'game.html','<body><script>document.body.dataset.level=localStorage.getItem("level")||"none";</script>Game');});await connect(a);await copy(a,b);await connect(b);
  const ids=await a.evaluate(()=>({library:localLibrary,game:games[0].id}));assert.deepEqual(await b.evaluate(()=>({library:localLibrary,game:games[0].id})),ids);
  const sync=async page=>{if(!await page.locator('#settings').isVisible())await page.locator('#settingsButton').click();await page.locator('#syncSaves').click();await page.waitForFunction(()=>!busy);};
  const editSave=(page,level)=>page.evaluate(async level=>localState.writeLocalSave(localLibrary,games[0].id,{level}),level);
  const data=page=>page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id));
  await editSave(a,'1');await sync(a);await expect(a.locator('#sharedSaveStatus')).toContainText('変更 1件');
  // Copying/browsing NAS folders can leave OS metadata alongside save snapshots.
  await a.evaluate(async()=>{const path='.gameportal/shared-saves/'+games[0].id+'/';const dir=await(await(await root.getDirectoryHandle('.gameportal')).getDirectoryHandle('shared-saves')).getDirectoryHandle(games[0].id);let snapshot;for await(const entry of dir.values())if(/^[a-f0-9]{32}\.json$/.test(entry.name)){snapshot=entry.name;break;}await dir.getDirectoryHandle('@eaDir',{create:true});for(const name of ['.DS_Store','Thumbs.db','desktop.ini','._'+snapshot])await library.writeFile(root,path+name,'OS metadata');});
  await copy(a,b);
  // Closing during an in-flight IDB import retains the play lock until it drains.
  await b.evaluate(()=>{window.originalCommit=localState.commitSaveSync;localState.commitSaveSync=async(...args)=>{await new Promise(r=>window.finishImport=r);return originalCommit(...args);};});
  await b.locator('.game-title-link').click();await b.waitForFunction(()=>!!window.finishImport);await b.locator('#closePlayer').click();await b.waitForFunction(()=>!closingPlayer);
  assert.equal(await b.evaluate(async()=>{try{const release=await localState.acquirePlaySession(localLibrary,games[0].id);release();return false;}catch{return true;}}),true);
  await b.evaluate(()=>{localState.commitSaveSync=originalCommit;window.finishImport();});await b.waitForFunction(()=>!busy);
  await b.locator('.game-title-link').click();await b.waitForFunction(()=>!busy);await expect(b.frameLocator('#frame').locator('body')).toHaveAttribute('data-level','1');await b.locator('#closePlayer').click();await b.waitForFunction(()=>!closingPlayer);assert.deepEqual(await data(b),{level:'1'});
  await editSave(a,'2');await editSave(b,'B');await sync(a);await copy(a,b);await sync(b);await expect(b.locator('#sharedSaveResults')).toContainText('別々のPC');assert.deepEqual(await data(b),{level:'B'});
  // The panel remains open while another tab/import changes the local save.
  const sharedBefore=await files(b);await editSave(b,'new local progress');
  b.once('dialog',dialog=>dialog.accept());await b.getByRole('button',{name:/共有セーブ 1 を使う/}).click();await b.waitForFunction(()=>!busy);
  await expect(b.locator('#status')).toContainText('このPCのセーブが変わりました');await expect(b.locator('#operationErrorText')).toContainText('STALE_SAVE_CHOICE');assert.deepEqual(await data(b),{level:'new local progress'});assert.deepEqual(await files(b),sharedBefore);
  await sync(b);await expect(b.locator('#sharedSaveResults')).toContainText('別々のPC');
  b.once('dialog',dialog=>dialog.accept());await b.getByRole('button',{name:/共有セーブ 1 を使う/}).click();await b.waitForFunction(()=>!busy);assert.deepEqual(await data(b),{level:'2'});
  assert.deepEqual(await b.evaluate(async()=>{const backups=await localState.loadSaveBackups(localLibrary,games[0].id);return backups[0].data;}),{level:'new local progress'});await copy(b,a);await sync(a);
  // Actual IDB transaction aborts and stale snapshots cannot half-apply a download.
  assert.equal(await a.evaluate(async()=>{const before=await localState.loadSaveSync(localLibrary,games[0].id),history=await localState.loadSaveBackups(localLibrary,games[0].id),original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(Array.isArray(key)&&key[0]==='save-sync')throw new DOMException('No room','QuotaExceededError');return original.call(this,value,key);};let rejected=false;try{await localState.commitSaveSync(localLibrary,games[0].id,before,before.state,{level:'must not commit'});}catch{rejected=true;}finally{IDBObjectStore.prototype.put=original;}return rejected&&JSON.stringify(await localState.loadSaveSync(localLibrary,games[0].id))===JSON.stringify(before)&&JSON.stringify(await localState.loadSaveBackups(localLibrary,games[0].id))===JSON.stringify(history);}),true);
  assert.equal(await a.evaluate(async()=>{const before=await localState.loadSaveSync(localLibrary,games[0].id);await localState.writeLocalSave(localLibrary,games[0].id,{level:'3'});try{await localState.commitSaveSync(localLibrary,games[0].id,before,before.state,{level:'bad'});return false;}catch{return (await localState.loadLocalSave(localLibrary,games[0].id)).level==='3';}}),true);
  await a.evaluate(()=>{window.originalWritable=FileSystemFileHandle.prototype.createWritable;FileSystemFileHandle.prototype.createWritable=function(...args){const result=originalWritable.apply(this,args);return /^[a-f0-9]{32}\.json$/.test(this.name)?result.then(w=>({write:v=>w.write(v),abort:()=>w.abort(),close:async()=>{await w.close();throw new DOMException('Lost close result','NetworkError');}})):result;};});
  await sync(a);await expect(a.locator('#sharedSaveResults')).toContainText('共有結果');const pending=await a.evaluate(async()=>{const value=await localState.loadSaveSync(localLibrary,games[0].id);return value.state.pending.revision;});assert(pending);assert.deepEqual(await data(a),{level:'3'});
  await a.reload();await expect(a.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});await expect(a.locator('#folderName')).toHaveText('shared-library');await sync(a);assert.equal(await a.evaluate(async()=>(await localState.loadSaveSync(localLibrary,games[0].id)).state.pending),null);assert.equal((await files(a)).filter(([path])=>path.endsWith('/'+pending+'.json')).length,1);
  await a.locator('#settings [data-close]').click();await editSave(a,'4');await a.locator('body').dispatchEvent('pointermove');await a.clock.fastForward(179000);assert.equal(await a.evaluate(async()=>(await localState.loadSaveSync(localLibrary,games[0].id)).state.base),'{"level":"3"}');await a.clock.fastForward(10000);await a.waitForFunction(()=>!syncPromise);await expect(a.locator('#sharedSaveStatus')).toContainText('変更 1件');assert.equal(await a.evaluate(async()=>(await localState.loadSaveSync(localLibrary,games[0].id)).state.base),'{"level":"4"}');
  // The Player edition uses the same metadata-tolerant pre-play download.
  await copy(a,b);await b.goto('http://127.0.0.1:'+server.address().port+'/player');await expect(b.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
  await b.evaluate(async()=>{window.fixtureRoot=await(await navigator.storage.getDirectory()).getDirectoryHandle('shared-library');window.showDirectoryPicker=async()=>fixtureRoot;});await connect(b);
  await b.locator('.game-title-link').click();await b.waitForFunction(()=>!busy);await expect(b.frameLocator('#frame').locator('body')).toHaveAttribute('data-level','4');await b.locator('#closePlayer').click();await b.waitForFunction(()=>!closingPlayer);
  for(const page of [a,b])assert.equal((await files(page)).filter(([path,text])=>path.startsWith('.gameportal/shared-saves/')&&text==='OS metadata').length,4);
  for(const page of [a,b])assert.equal(await page.evaluate(async()=>{
   const id=games[0].id,original=await localState.loadSaveSync(localLibrary,id),db=await new Promise((resolve,reject)=>{const r=indexedDB.open('game-portal-offline-folder-v1',3);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const put=(store,key,value)=>new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
   try{
    await put('settings',['save-sync',localLibrary,id],{...original.state,clock:new Date()});let rejected=false;try{await localState.loadSaveSync(localLibrary,id);}catch(e){rejected=e.message.includes('同期記録');}if(!rejected)return false;
    if(JSON.stringify(await localState.loadLocalSave(localLibrary,id))!==JSON.stringify(original.data))return false;
    await put('settings',['save-sync',localLibrary,id],original.state);await put('saves',[localLibrary,id],new Map());rejected=false;try{await localState.loadLocalSave(localLibrary,id);}catch(e){rejected=e.message.includes('セーブ形式');}return rejected;
   }finally{await put('settings',['save-sync',localLibrary,id],original.state);await put('saves',[localLibrary,id],original.data);db.close();}
  }),true);
  assert.deepEqual(errors,[]);console.log('Shared saves passed: independent profiles with simulated folder transfer, OS metadata preservation in Creator and Player, pre-play download, conflict choice and backups, atomic IDB abort/stale rejection, uncertain close/reload confirmation and three-minute idle publication. Physical NAS remains untested.');
}finally{await Promise.all(contexts.map(context=>context.close()));await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
