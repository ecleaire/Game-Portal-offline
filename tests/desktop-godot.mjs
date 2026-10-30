import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {setTimeout as delay} from 'node:timers/promises';import {chromium,expect} from '@playwright/test';
if(process.platform!=='win32'){console.log('Godot WebView2 test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'godot-native-check-'));let browser,child,page;
try{for(const [role,name]of[['クリエイター用','GAME-PORTAL'],['プレイ用','GAME-PORTAL-PLAY']]){
 const folder=join(temp,'library'),profile=join(temp,name),ready=join(temp,name+'.json');await mkdir(join(folder,'.gameportal'),{recursive:true});await writeFile(join(folder,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'a'.repeat(32)}));await copyFile('.tools/godot/Godot.zip',join(folder,'Godot.zip'));await writeFile(join(folder,'Scratch-like.html'),'<h1>HTML control ready</h1>');
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 child=spawn(resolve('Windows',role,name+'.exe'),['--profile',profile,'--debug-port',String(port),'--ready-file',ready,'--test-mode','--library',folder],{stdio:'pipe',windowsHide:true});
 for(let n=0;n<250;n++){try{await readFile(ready);break;}catch{if(child.exitCode!==null)throw Error('App exited '+child.exitCode);await delay(100);}}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);for(let n=0;n<150;n++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}
 const logs=[];page.on('console',m=>{logs.push(m.text());console.log(role,m.type(),m.text().slice(0,1200));});page.on('pageerror',e=>console.log('PAGEERROR',e.message));await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:30000});await expect(page.locator('.card')).toHaveCount(2);
 await page.getByRole('link',{name:'Scratch-like',exact:true}).click();await expect(page.frameLocator('#frame').locator('h1')).toHaveText('HTML control ready');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!busy);
 await page.getByRole('link',{name:'Godot',exact:true}).click();
 try{await expect.poll(()=>logs.some(line=>line.includes('GODOT_FIXTURE_READY')),{timeout:60000}).toBe(true);}catch(error){console.log('GODOT FAILURE',await page.locator('#playerStatus').innerText(),await page.frameLocator('#frame').locator('body').innerText().catch(()=>''));throw error;}
 await expect(page.frameLocator('#frame').locator('canvas')).toBeVisible();console.log('ACTUAL GODOT 4.3 WEB ZIP READY:',role);
 await page.locator('#reloadPlaying').click();await page.waitForTimeout(2000);await page.locator('#closePlayer').click();await page.waitForFunction(()=>!busy&&!pendingSave&&!flushing);await page.evaluate(()=>chrome.webview.postMessage({id:2147483646,op:'closeWindow'}));await browser.close();browser=null;
 for(let n=0;n<100&&child.exitCode===null;n++)await delay(100);if(child.exitCode===null)child.kill();child=null;page=null;
}}finally{await browser?.close().catch(()=>{});if(child)child.kill();await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
