import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(process.platform!=='win32'){console.log('Native forget test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'portal-forget-audit-'));
let child,browser;
try {
 for (const [role,name] of [['クリエイター用','GAME-PORTAL'],['プレイ用','GAME-PORTAL-PLAY']]) {
  const base=join(temp,name),disk=join(base,'Library'),profile=join(base,'profile'),exe=join(base,name+'.exe');
  await mkdir(join(disk,'.gameportal'),{recursive:true});await copyFile(resolve('Windows',role,name+'.exe'),exe);
  await writeFile(join(disk,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'a'.repeat(32)}));await writeFile(join(disk,'game.html'),'<h1>test</h1>');
  await writeFile(join(base,'GAME-PORTAL-CONNECTION.json'),JSON.stringify({schema:1,kind:'relative',path:'Library',libraryId:'a'.repeat(32)}));
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));const ready=join(base,'ready.json');
  child=spawn(exe,['--profile',profile,'--debug-port',String(port),'--ready-file',ready,'--test-mode','--library',disk],{windowsHide:true,stdio:'pipe'});
  for(let i=0;;i++){try{await readFile(ready);break;}catch{if(child.exitCode!==null||i>250)throw Error('startup');await delay(100);}}
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);let page;
  for(let i=0;i<150;i++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}
  assert(page);await expect(page.locator('html')).toHaveAttribute('data-ready','true');await page.waitForFunction(()=>!busy&&!starting);
  const before=JSON.parse(await readFile(join(base,'GAME-PORTAL-CONNECTION.json'),'utf8'));assert.equal(before.kind,'relative');
  const result=await page.evaluate(async()=>{const before=await desktopHost.current();await localState.forgetHandle();const after=await desktopHost.current();return {before:!!before,after:!!after,same:before?.token===after?.token};});
  assert.equal(result.before,true);assert.equal(result.after,false);assert.equal(result.same,false);await expect(page.locator('.card')).toHaveCount(1);
  assert.deepEqual(JSON.parse(await readFile(join(base,'GAME-PORTAL-CONNECTION.json'),'utf8')),before,'shared default remains unchanged');
  await page.evaluate(()=>chrome.webview.postMessage({id:2000000,op:'closeWindow'}));await browser.close();browser=null;
  for(let i=0;child.exitCode===null&&i<100;i++)await delay(100);assert.equal(child.exitCode,0);child=null;
  const restartServer=createServer();await new Promise(r=>restartServer.listen(0,'127.0.0.1',r));const restartPort=restartServer.address().port;await new Promise(r=>restartServer.close(r));const restartReady=join(base,'restart-ready.json');
  child=spawn(exe,['--profile',profile,'--debug-port',String(restartPort),'--ready-file',restartReady,'--test-mode'],{windowsHide:true,stdio:'pipe'});
  for(let i=0;;i++){try{await readFile(restartReady);break;}catch{if(child.exitCode!==null||i>250)throw Error('restart');await delay(100);}}
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+restartPort);page=null;
  for(let i=0;i<150;i++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}
  assert(page);await expect(page.locator('html')).toHaveAttribute('data-ready','true');await page.waitForFunction(()=>!busy&&!starting);await expect(page.locator('.card')).toHaveCount(0);assert.equal(await page.evaluate(()=>root),null);
  await page.locator('#settingsButton').click();await page.locator('#desktopFolderPath').fill(disk);await page.locator('#desktopConnectPath').click();await expect(page.locator('.card')).toHaveCount(1);await page.waitForFunction(()=>!busy);
  assert.equal(await page.evaluate(async()=>!!(await desktopHost.current())),true,'manual selection resumes remembering');
  assert.deepEqual(JSON.parse(await readFile(join(base,'GAME-PORTAL-CONNECTION.json'),'utf8')),before,'manual selection preserves peer default');
  console.log('Native forget passed ('+role+'): current connection retained, shared default preserved, restart stays disconnected, explicit selection resumes remembering.');
  await page.evaluate(()=>chrome.webview.postMessage({id:2000000,op:'closeWindow'}));await browser.close();browser=null;
  for(let i=0;child.exitCode===null&&i<100;i++)await delay(100);assert.equal(child.exitCode,0);child=null;
 }
}finally{await browser?.close();if(child&&child.exitCode===null)child.kill();await rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:200});}


