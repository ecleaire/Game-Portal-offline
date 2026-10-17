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
  for(const file of distributionFiles){const path=owned(file.source);if(file.source.endsWith('.app')){await mkdir(join(path,'Contents/MacOS'),{recursive:true});await writeFile(join(path,'Contents/MacOS/test'),'signed fixture '+file.source);}else await writeFile(path,'fixture '+file.source);}
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
