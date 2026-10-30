import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';import {gzipSync} from 'node:zlib';import assert from 'node:assert/strict';
// A real, locally authored scene exported with Godot 4.3; the official engine
// is prepared separately and never included in the product/source archive.
const pages={creator:gzipSync(await readFile('offline-release/GAME-PORTAL.html')),player:gzipSync(await readFile('offline-release/GAME-PORTAL-PLAY.html'))},game=await readFile('.tools/godot/Godot.zip');
const server=createServer((q,r)=>{const zip=q.url==='/fixture.zip',body=zip?game:pages[q.url.slice(1)];if(!body){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':zip?'application/zip':'text/html; charset=utf-8',...(zip?{}:{'Content-Encoding':'gzip'})});r.end(body);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const temp=await mkdtemp(join(tmpdir(),'portal-godot-'));const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{for(const role of ['creator','player']){
 const context=await browser.newContext();try{
 await context.addInitScript(()=>{FileSystemDirectoryHandle.prototype.queryPermission=async()=> 'granted';FileSystemDirectoryHandle.prototype.requestPermission=async()=> 'granted';});
 const page=await context.newPage(),logs=[],errors=[],external=[];page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/'+role);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:20000});
 const parentCapability=await page.evaluate(()=> 'serviceWorker' in navigator);
 await page.evaluate(async()=>{const folder=await(await navigator.storage.getDirectory()).getDirectoryHandle('actual-godot',{create:true}),metadata=await folder.getDirectoryHandle('.gameportal',{create:true});for(const [dir,name,bytes]of[[metadata,'library-id.json',JSON.stringify({schema:1,id:'a'.repeat(32)})],[folder,'Godot.zip',await(await fetch('/fixture.zip')).arrayBuffer()]]){const w=await(await dir.getFileHandle(name,{create:true})).createWritable();await w.write(bytes);await w.close();}window.showDirectoryPicker=async()=>folder;});
 await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);await expect(page.locator('.card')).toHaveCount(1);page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});
 for(let cycle=0;cycle<2;cycle++){
  logs.length=0;if(cycle)await page.locator('#reloadPlaying').click();else await page.locator('.game-title-link').click();
  await expect.poll(()=>logs.some(line=>line.includes('GODOT_FIXTURE_READY')),{timeout:60000}).toBe(true);
  const frame=page.frameLocator('#frame');await expect(frame.locator('canvas')).toBeVisible();assert.equal(await frame.locator('body').evaluate(()=> 'serviceWorker' in navigator),false);
  assert.equal(await frame.locator('body').evaluate(()=>{try{void parent.document;return false;}catch{return true;}}),true);
  if(cycle)assert.equal(await frame.locator('body').evaluate(()=>localStorage.getItem('godot-test-save')),'retained');
  await frame.locator('body').evaluate(()=>localStorage.setItem('godot-test-save','retained'));await page.waitForFunction(()=>activePlay?.latest?.['godot-test-save']==='retained');
  assert.equal(await page.evaluate(()=> 'serviceWorker' in navigator),parentCapability,'game guard must not alter parent navigator');
 }
 await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('Real Godot 4.3 Web ZIP passed ('+role+'): scene-ready, canvas, reload, save, isolated parent and no external requests.');
 }finally{await context.close();}
}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
