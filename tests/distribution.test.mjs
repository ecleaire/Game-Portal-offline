import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {distributionFiles,materializeDistribution,publishDistribution,verifyPublishedDistribution} from '../scripts/distribution.mjs';

test('platform packages preserve their roles, hydrate build inputs and detect stale copies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'portal-distribution-test-'));
 const owned=path=>{const full=resolve(root,path);assert(full.startsWith(resolve(root)+'/')||full.startsWith(resolve(root)+'\\'));return full;};
 try{
  for(const file of distributionFiles){const path=owned(file.source);if(file.source.endsWith('.app')||file.source.startsWith('offline-release/Swift-')){await mkdir(join(path,'Contents/MacOS'),{recursive:true});await writeFile(join(path,'Contents/MacOS/test'),'signed fixture '+file.source);}else await writeFile(path,'fixture '+file.source);}
  await writeFile(join(root,'GAME-PORTAL-CONNECTION.json'),'private connection');
  for(const group of new Set(distributionFiles.map(file=>file.group)))await publishDistribution(group,root);
  await verifyPublishedDistribution(root);
  for(const file of distributionFiles)await rm(owned(file.source),{recursive:true,force:true});
  await materializeDistribution(root);await verifyPublishedDistribution(root);
  assert.equal(await readFile(join(root,'GAME-PORTAL.html'),'utf8'),'fixture GAME-PORTAL.html');
  await assert.rejects(readFile(join(root,'HTML/プレイ用/GAME-PORTAL-CONNECTION.json')),{code:'ENOENT'});
  await writeFile(join(root,'HTML/プレイ用/GAME-PORTAL-PLAY.html'),'stale player copy');
  await assert.rejects(verifyPublishedDistribution(root),/Distribution output differs/);
 }finally{assert(resolve(root).startsWith(resolve(tmpdir())));await rm(root,{recursive:true,force:true});}
});


test('modern Mac packaging can publish both Mojave apps without a separately built legacy helper',async()=>{
 const root=await mkdtemp(join(tmpdir(),'portal-mojave-apps-'));
 try{
  for(const file of distributionFiles.filter(file=>file.group==='mojave'&&file.source.endsWith('.app'))){await mkdir(join(root,file.source,'Contents'),{recursive:true});await writeFile(join(root,file.source,'Contents','fixture'),'signed app');}
  await publishDistribution('mojave-apps',root);
  for(const role of ['プレイ用','クリエイター用']){
   const name=role==='プレイ用'?'GAME-PORTAL-PLAY-MOJAVE.app':'GAME-PORTAL-MOJAVE.app';assert.equal(await readFile(join(root,'Mac',role,name,'Contents/fixture'),'utf8'),'signed app');
   await assert.rejects(readFile(join(root,'HTML',role,'起動補助/_runtime/GAME-PORTAL-MOJAVE')),{code:'ENOENT'});
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
