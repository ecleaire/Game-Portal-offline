import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html'),server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-layout-'));let context;
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});const page=await context.newPage(),errors=[],issues=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true');await mkdir('offline-release/ui-checks',{recursive:true});
 const sizes=[[1920,1080,15],[2560,1440,15],[1280,720,15],[800,600,15],[640,400,15],[390,700,15],[320,568,15],[1280,360,15],[640,480,24],[320,568,24]];
 for(const [width,height,font]of sizes){
  await page.setViewportSize({width,height});await page.evaluate(font=>document.documentElement.style.fontSize=font+'px',font);
  for(const scenario of ['home','settings','help','edit','player','post','updateContent','inspection','history','capture','saveBackups','saveVerification']){
   await page.evaluate(scenario=>{
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    document.body.classList.toggle('editing-mode',scenario!=='home');
    if(scenario==='home')return;
    const dialog=document.querySelector('#'+scenario);dialog.showModal();dialog.scrollTop=0;
    if(scenario==='settings'){
     document.querySelector('#settingFolder').textContent='日本語の長い保存先フォルダー🕹️'.repeat(40);for(const details of dialog.querySelectorAll('details'))details.open=true;
     document.querySelector('#sharedSaveResults').innerHTML='<article class="maintenance-item"><strong>長い名前の作品</strong><p>'+('保存結果を確認してください。'.repeat(30))+'</p><button class="secondary">共有セーブを使う（2026/10/16 12:34:56）</button></article>';
    }
    if(scenario==='edit'){
     document.querySelector('#editTarget').textContent='長いゲーム名'.repeat(24);document.querySelector('#editDirty').hidden=false;document.querySelector('#postEditNotice').hidden=false;
     dialog.querySelector('[data-dialog-status]').textContent='保存結果が未確認です。接続を戻して再試行してください。'.repeat(20);document.querySelector('#editContent').scrollTop=0;
    }
    if(scenario==='player'){
     document.querySelector('#playerTitle').textContent='長いゲーム名'.repeat(24);for(const id of ['editPlaying','updatePlaying','captureButton','retryPlaying'])document.querySelector('#'+id).hidden=false;
     document.querySelector('#playerStatus').textContent='ファイルを読み込めませんでした。保存先の接続を確認してください。'.repeat(10);document.querySelector('#playerDescription').textContent='ゲームについての説明。'.repeat(100);
    }
    if(scenario==='post')document.querySelector('#postCheck').textContent='ファイルが不足しています。'.repeat(80);
    if(scenario==='updateContent')document.querySelector('#updateTarget').textContent='長い起動ファイル名'+('a'.repeat(400))+'.html';
   },scenario);
   const result=await page.evaluate(scenario=>{
    const container=scenario==='home'?document.documentElement:document.querySelector('#'+scenario),out=[];
    if(container.scrollWidth>container.clientWidth+2)out.push('horizontal overflow '+container.scrollWidth+'/'+container.clientWidth);
    if(scenario==='edit'){
     const content=document.querySelector('#editContent').getBoundingClientRect(),tabs=document.querySelector('#edit .edit-tabs').getBoundingClientRect(),actions=document.querySelector('.editor-actions').getBoundingClientRect();
     if(content.height<48)out.push('editor content collapsed: '+content.height);
     if(content.top<tabs.bottom-1||content.bottom>actions.top+1)out.push('editor sections overlap');
    }
    if(scenario==='player'){
     const title=document.querySelector('#playerTitle').getBoundingClientRect(),buttons=document.querySelector('#player .playerbar>.buttons').getBoundingClientRect();
     if(Math.min(title.right,buttons.right)-Math.max(title.left,buttons.left)>1&&Math.min(title.bottom,buttons.bottom)-Math.max(title.top,buttons.top)>1)out.push('player title/buttons overlap');
    }
    return out;
   },scenario);
   if(result.length){issues.push({width,height,font,scenario,result});await page.screenshot({path:`offline-release/ui-checks/layout-${scenario}-${width}-${height}-${font}.png`});}
   if(!result.length&&(scenario==='player'&&width===800||scenario==='edit'&&width===1280&&height===360))await page.screenshot({path:`offline-release/ui-checks/layout-${scenario}-${width}-${height}-${font}-fixed.png`});
   if(scenario==='edit'&&!result.length){
    for(const selector of ['#editTitle','#saveGameSettings','#cancelEdit']){
     await page.locator(selector).scrollIntoViewIfNeeded();const reachable=await page.locator(selector).evaluate(element=>{const rect=element.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=(rect.top+rect.bottom)/2,hit=document.elementFromPoint(x,y);return !!hit&&(element===hit||element.contains(hit));});if(!reachable)issues.push({width,height,font,scenario,result:['covered control '+selector]});
    }
   }
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(issues,[]);console.log('Layout passed: 12 screens/dialogs at 2560/1920/1280/800/640/390/320 widths, low heights and enlarged text; no horizontal overflow, collapsed editor or covered save controls.');
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
