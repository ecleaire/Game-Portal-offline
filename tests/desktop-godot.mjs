import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {createServer} from 'node:net';import {setTimeout as delay} from 'node:timers/promises';import {chromium,expect} from '@playwright/test';
if(process.platform!=='win32'){console.log('Godot WebView2 test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'godot-native-check-'));let browser,child,page;
try{for(const [role,name]of[['クリエイター用','GAME-PORTAL'],['プレイ用','GAME-PORTAL-PLAY']]){
 const folder=join(temp,'library'),profile=join(temp,name),ready=join(temp,name+'.json');await mkdir(join(folder,'.gameportal'),{recursive:true});await writeFile(join(folder,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'a'.repeat(32)}));await copyFile('.tools/godot/Godot.zip',join(folder,'Godot.zip'));await writeFile(join(folder,'素材 data.bin'),'bundled');await writeFile(join(folder,'Scratch-like.html'),'<h1>HTML control ready</h1><output></output><script>const xhr=new XMLHttpRequest();xhr.open("GET","素材%20data.bin?cache=2");xhr.onload=()=>document.querySelector("output").textContent=xhr.responseText;xhr.send();</script>');
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 child=spawn(resolve('Windows',role,name+'.exe'),['--profile',profile,'--debug-port',String(port),'--ready-file',ready,'--test-mode','--library',folder],{stdio:'pipe',windowsHide:true});
 for(let n=0;n<250;n++){try{await readFile(ready);break;}catch{if(child.exitCode!==null)throw Error('App exited '+child.exitCode);await delay(100);}}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);for(let n=0;n<150;n++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}
 const logs=[];page.on('console',m=>{logs.push(m.text());console.log(role,m.type(),m.text().slice(0,1200));});page.on('pageerror',e=>console.log('PAGEERROR',e.message));await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:30000});await expect(page.locator('.card')).toHaveCount(2);
 await page.getByRole('link',{name:'Scratch-like',exact:true}).click();await expect(page.frameLocator('#frame').locator('h1')).toHaveText('HTML control ready');await expect(page.frameLocator('#frame').locator('output')).toHaveText('bundled');await page.locator('#closePlayer').click();await page.waitForFunction(()=>!busy);
 const lifetime=await page.evaluate(()=>window.nativeWindowLifetime=crypto.randomUUID());
 await page.getByRole('link',{name:'Godot',exact:true}).click();
 try{await expect.poll(()=>logs.some(line=>line.includes('GODOT_FIXTURE_READY')),{timeout:60000}).toBe(true);}catch(error){console.log('GODOT FAILURE',await page.locator('#playerStatus').innerText(),await page.frameLocator('#frame').locator('body').innerText().catch(()=>''));throw error;}
 await expect(page.frameLocator('#frame').locator('canvas')).toBeVisible();console.log('ACTUAL GODOT 4.3 WEB ZIP READY:',role);
 await page.waitForFunction(async()=>{const state=await desktopHost.playerWindowState();return state.open&&state.mainViewInPlayer&&state.launcherVisible;});const firstWindow=await page.evaluate(()=>desktopHost.playerWindowState());
 if(role==='クリエイター用'){
  await page.locator('#editPlaying').click();const title=await page.locator('#editTitle').inputValue();await page.locator('#editTitle').fill('Unsaved window draft');await page.evaluate(()=>desktopHost.closePlayerWindow());await page.waitForFunction(async()=>!(await desktopHost.playerWindowState()).closePending);await expect(page.locator('#edit')).toBeVisible();await expect(page.locator('#editTitle')).toHaveValue('Unsaved window draft');expect((await page.evaluate(()=>desktopHost.playerWindowState())).open).toBe(true);await page.locator('#editTitle').fill(title);await page.locator('#cancelEdit').click();await expect(page.locator('#edit')).toBeHidden();
 }

 // Hold the native fullscreen exit after the actual transition. A later
 // reload must win over the earlier OS close request in both shipped roles.
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement);
 await page.evaluate(()=>{window.normalFullscreenExit=document.exitFullscreen;document.exitFullscreen=async function(){await normalFullscreenExit.call(this);await new Promise(resolve=>window.finishNativeFullscreenExit=resolve);};});
 try{
  await page.evaluate(()=>desktopHost.closePlayerWindow());await page.waitForFunction(()=>!!window.finishNativeFullscreenExit&&!document.fullscreenElement);
  const readyBeforeCloseRace=logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length;
  await page.locator('#reloadPlaying').click();await expect.poll(()=>logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length,{timeout:60000}).toBeGreaterThan(readyBeforeCloseRace);
  await page.evaluate(()=>{window.retainedReloadSession=activePlay;finishNativeFullscreenExit();});
  await page.waitForFunction(async()=>!(await desktopHost.playerWindowState()).closePending);
  await expect(page.locator('#player')).toBeVisible();expect(await page.evaluate(()=>!!activePlay&&activePlay===retainedReloadSession)).toBe(true);
  console.log('NATIVE FULLSCREEN CLOSE CANNOT OVERRIDE LATER RELOAD:',role);
 }finally{await page.evaluate(()=>{document.exitFullscreen=normalFullscreenExit;window.finishNativeFullscreenExit?.();delete window.finishNativeFullscreenExit;});}

 // Simulate the reported WebView2 response-stream failure on the real EXE,
 // while retaining native filesystem IO and the actual Godot Web export.
 await page.evaluate(()=>{window.normalReadFetch=fetch;window.fallbackAttempts=0;window.fetch=(url,...args)=>{const target=new URL(url,location.href);if(target.pathname==='/io/read'&&target.searchParams.get('path')==='Godot.zip'){fallbackAttempts++;return Promise.reject(new TypeError('Failed to fetch'));}return normalReadFetch(url,...args);};});
 const readyBefore=logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length;
 await page.locator('#reloadPlaying').click();await expect.poll(()=>logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length,{timeout:60000}).toBeGreaterThan(readyBefore);await expect(page.frameLocator('#frame').locator('canvas')).toBeVisible();expect(await page.evaluate(()=>fallbackAttempts)).toBeGreaterThan(0);console.log('ACTUAL GODOT WEB ZIP READY WITH FAILED FETCH FALLBACK:',role);
 await page.evaluate(()=>window.fetch=normalReadFetch);
 expect((await page.evaluate(()=>desktopHost.playerWindowState())).instance).toBe(firstWindow.instance);
 await page.frameLocator('#frame').locator('body').evaluate(()=>localStorage.setItem('native-window-save','retained'));await page.waitForFunction(()=>activePlay?.latest?.['native-window-save']==='retained');
 await page.locator('#fullscreen').click();await page.waitForFunction(async()=>document.fullscreenElement===document.getElementById('frame')&&(await desktopHost.playerWindowState()).fullscreen);
 await page.evaluate(()=>desktopHost.closePlayerWindow());await expect(page.locator('#player')).toBeHidden();await page.waitForFunction(async()=>!(await desktopHost.playerWindowState()).open);
 expect(await page.evaluate(()=>window.nativeWindowLifetime)).toBe(lifetime);
 const nextReady=logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length;await page.getByRole('link',{name:'Godot',exact:true}).click();await expect.poll(()=>logs.filter(line=>line.includes('GODOT_FIXTURE_READY')).length,{timeout:60000}).toBeGreaterThan(nextReady);expect(await page.frameLocator('#frame').locator('body').evaluate(()=>localStorage.getItem('native-window-save'))).toBe('retained');expect((await page.evaluate(()=>desktopHost.playerWindowState())).instance).toBeGreaterThan(firstWindow.instance);console.log('NATIVE GAME WINDOW PASSED:',role);

await page.locator('#closePlayer').click();await page.waitForFunction(()=>!busy&&!pendingSave&&!flushing);await page.evaluate(()=>chrome.webview.postMessage({id:2147483646,op:'closeWindow'}));await browser.close();browser=null;
 for(let n=0;n<100&&child.exitCode===null;n++)await delay(100);if(child.exitCode===null)child.kill();child=null;page=null;
}}finally{await browser?.close().catch(()=>{});if(child)child.kill();await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
