import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
if(process.platform!=='win32'){console.log('Desktop information test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'portal-desktop-information-')),disk=join(temp,'Library'),exe=join(temp,'GAME-PORTAL.exe');let app,browser,page;const errors=[];
try{
 await copyFile(resolve(process.env.PORTAL_DESKTOP_EXE||'GAME-PORTAL.exe'),exe);
 await mkdir(join(disk,'.gameportal'),{recursive:true});await writeFile(join(disk,'.gameportal/library-id.json'),JSON.stringify({schema:1,id:'a'.repeat(32)}));
 for(const [name,id]of[['Alpha','1'],['Beta','2']]){await writeFile(join(disk,name+'.html'),'<h1>'+name+'</h1>');await writeFile(join(disk,name+'.html.gameportal.json'),JSON.stringify({schema:1,id:id.repeat(32),title:name,tags:['Godot'],developmentEnvironment:'Godot',thumbnail:null,description:name+' overview',instructions:'Space'}));}
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const ready=join(temp,'ready.json');
 app=spawn(exe,['--profile',join(temp,'profile'),'--library',disk,'--debug-port',String(port),'--ready-file',ready,'--test-mode'],{windowsHide:true});
 for(let n=0;n<250;n++){try{await readFile(ready);break;}catch{if(app.exitCode!==null||n===249)throw Error('App not ready: '+app.exitCode);await delay(100);}}
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);for(let n=0;n<150;n++){page=browser.contexts()[0]?.pages().find(p=>p.url().includes('gameportal.desktop.invalid'));if(page)break;await delay(100);}assert(page);page.on('pageerror',error=>errors.push(error.message));
 await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:20000});await expect(page.locator('.card')).toHaveCount(2,{timeout:20000});
 await page.locator('#settingsButton').click();await page.locator('#enableEditing').check();await page.waitForFunction(()=>!busy);await page.locator('#settings [data-close]').click();
 // Browser download serialization is covered separately. Capture that payload
 // here so the native SaveFileDialog never waits for an unattended user.
 await page.evaluate(()=>{downloadInformation=text=>window.testInformation=JSON.parse(text);});
 const capture=async selector=>{await page.locator(selector).click();await page.waitForFunction(()=>!busy);return page.evaluate(()=>testInformation);};
 const saved=async name=>JSON.parse(await readFile(join(disk,name+'.html.gameportal.json'),'utf8'));
 await page.getByRole('link',{name:'Alpha',exact:true}).click();await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Alpha');await page.locator('#editPlaying').click();await page.locator('#gameInformationTools summary').click();
 const original=await capture('#exportGameInformation');assert.equal(original.games.length,1);assert.equal(original.games[0].title,'Alpha');
 const changed=structuredClone(original);changed.games[0].id='f'.repeat(32);changed.games[0].title='Imported Alpha';changed.games[0].tags=['Godot','Imported'];changed.games[0].description='New overview';changed.games[0].instructions='Enter';
 changed.games[0].thumbnail=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=9;c.getContext('2d').fillRect(0,0,16,9);return c.toDataURL('image/webp');});
 const single=join(temp,'single.json');await writeFile(single,JSON.stringify(changed));await page.locator('#gameInformationFile').setInputFiles(single);await page.waitForFunction(()=>!busy);await expect(page.locator('#editTitle')).toHaveValue('Imported Alpha');assert.equal((await saved('Alpha')).title,'Alpha');
 await page.locator('#saveGameSettings').click();await expect(page.locator('#edit')).toBeHidden();await page.waitForFunction(()=>!busy);assert.equal((await saved('Alpha')).title,'Imported Alpha');assert.equal((await saved('Alpha')).id,'1'.repeat(32));assert.equal((await saved('Alpha')).thumbnail,changed.games[0].thumbnail);
 await page.locator('#closePlayer').click();await page.waitForFunction(()=>!closingPlayer);await page.locator('#settingsButton').click();await page.locator('#informationTools summary').click();await page.locator('#openInformationExport').click();
 const all=await capture('#confirmInformationExport');assert.equal(all.games.length,2);all.games.forEach(game=>{game.title+=' Bulk';game.instructions='Bulk controls';});await page.locator('#information [data-close]').click();
 const bulk=join(temp,'bulk.json');await writeFile(bulk,JSON.stringify(all));await page.locator('#settingsButton').click();await page.locator('#informationFile').setInputFiles(bulk);await page.waitForFunction(()=>!busy);await expect(page.locator('#informationRows input:checked')).toHaveCount(2);assert.equal((await saved('Beta')).title,'Beta');
 await page.locator('#confirmInformationImport').click();await page.waitForFunction(()=>!busy);await expect(page.locator('#informationSummary')).toContainText('2件を保存');
 for(const [name,id,title]of[['Alpha','1','Imported Alpha Bulk'],['Beta','2','Beta Bulk']]){const data=await saved(name);assert.equal(data.title,title);assert.equal(data.id,id.repeat(32));assert.equal(data.instructions,'Bulk controls');assert.equal(await readFile(join(disk,name+'.html'),'utf8'),'<h1>'+name+'</h1>');}
 const history=await page.evaluate(()=>maintenance.loadSettingsHistory(root,games.find(game=>game.path==='Alpha.html'),library));assert(history.entries.some(entry=>entry.before?.title==='Alpha'));assert(history.entries.some(entry=>entry.before?.title==='Imported Alpha'));assert.deepEqual(errors,[]);
 await page.locator('#information [data-close]').click();await page.waitForFunction(()=>!busy&&!syncPromise&&!pendingSave&&!flushing);await page.evaluate(()=>chrome.webview.postMessage({id:2147483646,op:'closeWindow'}));for(let n=0;n<150&&app.exitCode===null;n++)await delay(100);assert.equal(app.exitCode,0);app=null;
 console.log('Actual Windows information transfer passed: saved single export, draft import then normal Save, thumbnail, selected/all metadata export, two real disk imports, unchanged IDs/game bytes, per-game history, no page errors.');
}catch(error){if(page)console.error('Information state:',await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,summary:document.querySelector('#informationSummary')?.textContent})).catch(()=>null));throw error;}
finally{await browser?.close().catch(()=>{});if(app?.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}await rm(temp,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
