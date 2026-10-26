import {chromium,expect} from '@playwright/test';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {packageWebFiles} from '../../assets/zip-upload.js';
const html=await readFile('offline-release/GAME-PORTAL.html'),temp=await mkdtemp(join(tmpdir(),'portal-archive-layout-'));
const server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
try{
 const folder=join(temp,'Extracted'),source=new Map([
  ['Outer/Build/jump.html','<body><script src="jump.js"></script></body>'],
  ['Outer/Build/jump.js','fetch("assets/素材 data.bin").then(r=>r.text()).then(value=>{document.body.dataset.asset=value;document.body.dataset.previous=localStorage.getItem("level")||"none";localStorage.setItem("level","kept");});'+('/* compressible */'.repeat(100))],
  ['Outer/Build/assets/素材 data.bin','game-data'],['.DS_Store','metadata'],['__MACOSX/._jump.html','metadata']
 ]);
 const inputs=[];for(const [path,text] of source){await mkdir(join(folder,path,'..'),{recursive:true});await writeFile(join(folder,path),text);inputs.push(new File([text],path));}
 const zip=await packageWebFiles(inputs),zipPath=join(temp,'Compressed.zip');await writeFile(zipPath,Buffer.from(await zip.arrayBuffer()));
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{try{localStorage.setItem('game-portal.remember-folder','false');}catch{}FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
 await page.evaluate(async()=>{const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('archive-library',{create:true});window.showDirectoryPicker=async()=>root;});await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
 async function post(input,path){await page.locator('#postButton').click();await expect(page.locator('#post')).toBeVisible();await page.locator(input).setInputFiles(path);await expect(page.locator('#confirmPost')).toBeEnabled();await expect(page.locator('#postTechnicalCheck')).not.toContainText('見つかりません');await page.locator('#confirmPost').click();await expect(page.locator('#edit')).toBeVisible();await page.waitForFunction(()=>!busy);await page.locator('#edit [data-close]').click();}
 await post('#postFiles',zipPath);await post('#postDirectory',folder);await expect(page.locator('.card')).toHaveCount(2);const identities=await page.evaluate(()=>games.map(g=>({id:g.id,path:g.path,kind:g.kind})));
 const play=async(name,previous)=>{await page.locator('.card').filter({has:page.getByRole('heading',{name,exact:true})}).locator('.game-title-link').click();await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-asset','game-data');await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous',previous);};
 await play('Compressed','none');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);await play('Extracted','none');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);await play('Compressed','kept');
 // Replace a ZIP with its extracted folder, then restore it; IDs and saves persist.
 await page.locator('#updatePlaying').click();await page.locator('#updateDirectory').setInputFiles(folder);await expect(page.locator('#confirmContentUpdate')).toBeEnabled();await page.locator('#confirmContentUpdate').click();await expect(page.locator('#updateContent')).toBeHidden();await page.locator('#retryPlaying').click();await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-asset','game-data');await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous','kept');
 const active=await page.evaluate(()=>games.find(g=>g.title==='Compressed'));assert.equal(active.id,identities.find(g=>g.kind==='zip').id);assert.equal(active.kind,'html');
 await page.locator('#updatePlaying').click();await page.locator('#restoreContent').click();await expect(page.locator('#updateContent')).toBeHidden();await page.locator('#retryPlaying').click();await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous','kept');assert.equal(await page.evaluate(()=>games.find(g=>g.title==='Compressed').kind),'zip');
 assert.deepEqual(errors,[]);console.log('Archive parity passed: nested ZIP and extracted-folder upload, custom HTML/JS/Unicode assets, metadata exclusions, isolated and persistent saves, ZIP-to-folder update and rollback with stable IDs.');
}finally{await browser.close();await rm(temp,{recursive:true,force:true});await new Promise(r=>server.close(r));}
