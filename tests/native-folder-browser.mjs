import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(!['win32','darwin'].includes(process.platform)){console.log('Native folder test requires Windows/macOS.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'portal-autofolder-')),disk=join(temp,'任意の名前 🕹 # +'),html=join(temp,'GAME-PORTAL.html'),ready=join(temp,'ready.json');
const libraryId='a'.repeat(32),{version}=JSON.parse(await readFile('package.json','utf8'));
let helper,context;
try{
 await mkdir(join(disk,'.gameportal'),{recursive:true});await mkdir(join(disk,'作品'));await writeFile(join(disk,'.gameportal','library-id.json'),JSON.stringify({schema:1,id:libraryId}));
 await writeFile(join(disk,'作品','index.html'),'<!doctype html><h1>Native auto game</h1><img src="image.svg"><script>localStorage.setItem("native-test","played");</script>');await writeFile(join(disk,'作品','image.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
 await writeFile(html,await readFile('GAME-PORTAL.html'));await writeFile(join(temp,'GAME-PORTAL-FOLDER.txt'),'\uFEFF./'+disk.split(/[\\/]/).at(-1)+'\n');
 const exe=resolve(process.platform==='win32'?'GAME-PORTAL-WINDOWS.exe':'GAME-PORTAL-MAC');
 helper=spawn(exe,['--headless','--html',html,'--ready-file',ready],{windowsHide:true,stdio:'pipe'});let output='';helper.stderr.on('data',data=>output+=data);
 let info;for(let n=0;n<200;n++){try{info=JSON.parse(await readFile(ready,'utf8'));break;}catch{if(helper.exitCode!==null)throw Error('Helper exited: '+output);await delay(100);}}assert(info,'Helper readiness');
 const api=(action,path='',headers={})=>fetch(info.origin+'/native/folder',{method:'POST',headers:{Origin:'null','Content-Type':'application/json','X-Game-Portal-Token':info.token,...headers},body:JSON.stringify({version,action,path})});
 assert.equal((await api('info','',{'X-Game-Portal-Token':'0'.repeat(64)})).status,403);assert.equal((await api('info','',{Origin:'https://example.invalid'})).status,403);
 for(const path of ['../GAME-PORTAL.html','/etc/passwd','作品/../index.html','作品\\index.html'])assert.equal((await api('read',path)).status,400);
 assert.equal((await api('write','作品/index.html')).status,400);
 const missing=await api('stat','missing.html');assert.equal(missing.status,400);assert.equal((await missing.json()).name,'NotFoundError');
 const outside=join(temp,'outside');await mkdir(outside);await writeFile(join(outside,'secret.txt'),'do not expose');await symlink(outside,join(disk,'linked'),process.platform==='win32'?'junction':'dir');assert.equal((await api('read','linked/secret.txt')).status,400);
 context=await chromium.launchPersistentContext(join(temp,'profile'),{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{if(window!==top)return;window.showDirectoryPicker=async()=>{throw Error('Picker must not open');};localStorage.setItem('game-portal.offline-editing','true');});
 await page.goto(pathToFileURL(html).href+'#native='+new URL(info.origin).port+'.'+info.token);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:20000});await expect(page.locator('.card')).toHaveCount(1);assert.equal(await page.evaluate(()=>localLibrary),libraryId);assert.equal(await page.evaluate(()=>location.hash),'');
 await page.locator('#settingsButton').click();await expect(page.locator('#nativeFolderNotice')).toBeVisible();await expect(page.locator('#enableEditing')).toBeDisabled();await expect(page.locator('#syncSaves')).toBeDisabled();await page.locator('#settings [data-close]').click();
 await page.locator('.game-title-link').click();await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Native auto game');await expect(page.frameLocator('#frame').locator('img')).toHaveJSProperty('naturalWidth',20);await page.waitForFunction(()=>!busy);
 await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);assert.equal((await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)))['native-test'],'played');
 assert.equal(await page.evaluate(token=>launcherSource().includes(token),info.token),false);
 // Read-only connection waits can be stopped without losing the current library/save.
 await page.evaluate(()=>{window.originalNativeFetch=window.fetch;window.stallNative=true;window.fetch=(url,options)=>window.stallNative&&String(url).includes('/native/folder')?new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})):window.originalNativeFetch(url,options);});
 await page.locator('#refresh').click();await expect(page.locator('#cancelConnection')).toBeVisible();await expect(page.locator('#helpButton')).toBeEnabled();await page.locator('#settingsButton').click();await expect(page.locator('#cancelFolderRead')).toBeVisible();await page.locator('#cancelFolderRead').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('接続待ちを中止');await expect(page.locator('#chooseFolder')).toBeEnabled();await expect(page.locator('#cancelFolderRead')).toBeHidden();
 await page.locator('#settings [data-close]').click();assert.equal(await page.evaluate(()=>localLibrary),libraryId);assert.equal((await page.evaluate(()=>localState.loadLocalSave(localLibrary,games[0].id)))['native-test'],'played');
 await page.clock.install();await page.locator('#refresh').click();await expect(page.locator('#cancelConnection')).toBeVisible();await page.clock.fastForward(10001);await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('起動補助');await page.clock.resume();await page.evaluate(()=>{window.stallNative=false;});await page.locator('#refresh').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);
 if(process.platform==='darwin'){
  await mkdir(join(disk,'windows'));const exe=Buffer.alloc(128);exe.writeUInt16LE(0x5a4d,0);exe.writeUInt32LE(64,60);exe.writeUInt32LE(0x4550,64);exe.writeUInt16LE(2,86);await writeFile(join(disk,'windows','windows.exe'),exe);
  await page.locator('#refresh').click();await expect(page.locator('.card')).toHaveCount(2);await page.locator('.game-title-link').filter({hasText:'windows'}).click();await expect(page.locator('#nativeLaunch')).toBeDisabled();await expect(page.locator('#nativeReason')).toContainText('Macでは動きません');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);
 }
 await writeFile(join(disk,'.gameportal','compatibility.json'),JSON.stringify({schema:true,minLauncherVersion:version,requiredFeatures:[]}));assert.equal((await api('info')).status,400,'boolean schema rejected');
 await writeFile(join(disk,'.gameportal','compatibility.json'),JSON.stringify({schema:1,minLauncherVersion:version,requiredFeatures:['unsupported']}));assert.equal((await api('info')).status,400,'unknown feature rejected');
 await writeFile(join(disk,'.gameportal','compatibility.json'),JSON.stringify({schema:1,minLauncherVersion:'99.0.0',requiredFeatures:[]}));assert.equal((await api('info')).status,400,'newer floor rejected');
 await writeFile(join(disk,'.gameportal','compatibility.json'),JSON.stringify({schema:1,minLauncherVersion:version,requiredFeatures:['per-game-settings-v1','content-selector-v1']}));assert.equal((await api('info')).status,200);
 await writeFile(join(disk,'.gameportal','library-id.json'),JSON.stringify({schema:1,id:'b'.repeat(32)}));assert.equal((await api('read','作品/index.html')).status,400,'library replacement rejected');assert.deepEqual(errors,[]);
 assert.equal(await readFile(join(disk,'作品','index.html'),'utf8'),'<!doctype html><h1>Native auto game</h1><img src="image.svg"><script>localStorage.setItem("native-test","played");</script>');
 // A stopped helper and a bad startup path must leave settings and manual selection usable.
 await writeFile(join(disk,'.gameportal','library-id.json'),JSON.stringify({schema:1,id:libraryId}));helper.kill();await new Promise(r=>helper.exitCode!==null?r():helper.once('exit',r));
 await page.locator('#refresh').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#status')).toContainText('起動補助');await expect(page.locator('#settingsButton')).toBeEnabled();
 await writeFile(join(temp,'GAME-PORTAL-FOLDER.txt'),'./missing-library');const ready2=join(temp,'ready2.json');helper=spawn(exe,['--headless','--html',html,'--ready-file',ready2],{windowsHide:true,stdio:'pipe'});
 let info2;for(let n=0;n<200;n++){try{info2=JSON.parse(await readFile(ready2,'utf8'));break;}catch{if(helper.exitCode!==null)throw Error('Bad-config helper must still start');await delay(100);}}assert(info2);
 await page.goto(pathToFileURL(html).href+'#native='+new URL(info2.origin).port+'.'+info2.token);await expect(page.locator('html')).toHaveAttribute('data-ready','true');await expect(page.locator('#status')).toContainText('設定');await page.locator('#helpButton').click();await expect(page.locator('#help')).toBeVisible();await page.locator('#help [data-close]').click();
 await page.evaluate(()=>{
  function folder(name,files={},dirs={}){const dir={kind:'directory',name,queryPermission:async({mode})=>mode==='read'?'granted':'denied',getFileHandle:async name=>{if(!Object.hasOwn(files,name))throw new DOMException('Missing','NotFoundError');return {kind:'file',name,getFile:async()=>new File([files[name]],name)};},getDirectoryHandle:async name=>{if(!Object.hasOwn(dirs,name))throw new DOMException('Missing','NotFoundError');return dirs[name];},async *values(){for(const name of Object.keys(files))yield await dir.getFileHandle(name);for(const entry of Object.values(dirs))yield entry;}};return dir;}
  const chosen=folder('replacement',{'replacement.html':'<h1>Replacement game</h1>'},{'.gameportal':folder('.gameportal',{'library-id.json':JSON.stringify({schema:1,id:'d'.repeat(32)})})});window.showDirectoryPicker=async()=>chosen;
 });
 await page.locator('#settingsButton').click();await expect(page.locator('#enableEditing')).not.toBeChecked();await page.locator('#chooseFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);await page.locator('.game-title-link').click();await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Replacement game');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);assert.deepEqual(errors,[]);
 console.log('Native auto-folder/recovery passed: no picker, real HTML/assets/save, read-only guards, authenticated paths/IDs, cancel and timeout/retry, helper exit, bad-config startup, help/settings and manual replacement/play.');
}finally{if(context)await context.close();if(helper){helper.kill();await new Promise(r=>helper.exitCode!==null?r():helper.once('exit',r));}await rm(temp,{recursive:true,force:true});}
