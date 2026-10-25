import {chromium,expect} from '@playwright/test';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html');
const server=createServer((q,r)=>r.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=await mkdtemp(join(tmpdir(),'portal-search-'));let context;
try{
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{
  const root=await(await navigator.storage.getDirectory()).getDirectoryHandle('検索追加検証',{create:true});window.showDirectoryPicker=async()=>root;
  for(const [name,title,tags] of [['one.html','検索テスト',['パズル','1人用','長いタグ'.repeat(8)]],['two.html','別の作品',['アクション']]]){
   await library.writeFile(root,name,'<h1>Game ready</h1>');
   await library.writeFile(root,name+'.gameportal.json',JSON.stringify({schema:1,id:await library.gameId(name),title,tags,developmentEnvironment:'Godot',description:'キーワード概要',instructions:'矢印キー',thumbnail:null}));
  }
 });
 await page.locator('#setupFolder').click();await page.waitForFunction(()=>!busy);
 await expect(page.locator('.card')).toHaveCount(2);
 await page.locator('#search').focus();await page.keyboard.press('Tab');await expect(page.locator('#filterDetails summary')).toBeFocused();await page.keyboard.press('Enter');
 await page.locator('#searchScope').selectOption('description');await page.locator('#search').fill('キーワード');await expect(page.locator('.card')).toHaveCount(2);
 await page.locator('#search').fill('存在しない');await expect(page.locator('.card')).toHaveCount(0);
 await page.locator('#clearFilters').click();await expect(page.locator('.card')).toHaveCount(2);
 await page.locator('#tagFilters button').filter({hasText:'パズル'}).click();await expect(page.locator('.card')).toHaveCount(1);
 await page.locator('#clearFilters').click();await expect(page.locator('.card')).toHaveCount(2);
 await mkdir('offline-release/ui-checks',{recursive:true});
 let cases=0;
 for(const theme of ['dark','light'])for(const [width,height,font] of [[1920,1080,15],[1280,720,15],[800,600,15],[640,400,15],[390,700,15],[320,568,15],[640,480,24],[320,568,24]]){
  await page.setViewportSize({width,height});await page.evaluate(({theme,font})=>{applyTheme(theme);document.documentElement.style.fontSize=font+'px';document.querySelector('#filterDetails').open=true;},{theme,font});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),`${theme}/${width}/${font}: document overflow`);
  for(const selector of ['#searchScope','#kindFilter','#environmentFilter','#tagMatch','#sortGames','#tagSearch','#tagCategory','#filterDetails summary']){
   const control=page.locator(selector);await control.scrollIntoViewIfNeeded();
   assert(await control.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit);}),`${selector}: covered ${width}/${font}`);
  }
  // Controls must remain usable after scrolling through long tag lists.
  await page.locator('#tagSearch').fill('パズル');await expect(page.locator('#tagFilters button:visible')).toHaveCount(1);await page.locator('#tagSearch').fill('');
  if(width===390&&font===15){await page.locator('#filterDetails summary').scrollIntoViewIfNeeded();await page.screenshot({path:`offline-release/ui-checks/search-${theme}.png`});}
  await page.locator('.game-title-link').filter({hasText:'検索テスト'}).click();await page.waitForFunction(()=>!busy);await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Game ready');
  for(const selector of ['#fullscreen','#reloadPlaying','#closePlayer']){
   const button=page.locator(selector);await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();assert(box.height>=48);
   assert(await button.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===hit||e.contains(hit);}),`${selector}: covered ${width}/${font}`);
  }
  assert(await page.locator('#player').evaluate(e=>e.scrollWidth<=e.clientWidth+2),`player overflow ${width}/${font}`);
  if(theme==='dark'&&width===1280){
   await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement?.id==='frame');
   await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement);
   await page.evaluate(()=>document.querySelector('#frame').requestFullscreen=()=>Promise.reject(new Error('全画面を許可できません')));
   await page.locator('#fullscreen').click();await expect(page.locator('#playerStatus')).toHaveText('全画面を許可できません');
   await expect(page.frameLocator('#frame').locator('h1')).toHaveText('Game ready');
   await page.evaluate(()=>delete document.querySelector('#frame').requestFullscreen);
  }
  await page.locator('#closePlayer').click();await expect(page.locator('#player')).toBeHidden();cases++;
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.card').first().hover();assert.equal(await page.locator('.card').first().evaluate(e=>getComputedStyle(e).transform),'none');
 assert.deepEqual(errors,[]);console.log(`Search/readability passed: ${cases} theme/viewport/font cases; keyboard opening, zero results, clear, tag search, control hit targets, fullscreen entry/exit and denial preserving play, repeated play/return. Native picker remains simulated.`);
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
