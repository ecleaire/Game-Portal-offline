import {test} from 'node:test';import assert from 'node:assert/strict';import {validSave,commitSaveSync} from '../offline-html/local-state.js';import {validClock} from '../offline-html/shared-saves.js';
test('save data and synchronization clocks reject non-record objects',async()=>{
 const id='a'.repeat(32);
 for(const value of [new Date(),new Map(),new Set(),new String('score'),new Uint8Array()]){
  assert.equal(validSave(value),false);assert.equal(validClock(value),false);
  await assert.rejects(commitSaveSync(id,id,{data:{},state:{}},{schema:1,base:null,clock:value,pending:null}),/セーブ同期の形式/);
 }
 const save=Object.create(null);save.score='42';assert.equal(validSave(save),true);const clock=Object.create(null);clock[id]=1;assert.equal(validClock(clock),true);
});

test('settings receipts reject coerced identifiers before opening storage',async()=>{
 const {trackSettingsReceipt}=await import('../offline-html/local-state.js');
 const receipt={schema:1,libraryId:'a'.repeat(32),id:'b'.repeat(32),gamePath:'Game.html',historyName:'abc.json',expectedHash:'c'.repeat(64),beforeHash:null,kind:'edit',uploadFolder:null};
 for(const field of ['libraryId','id','historyName','expectedHash','beforeHash','uploadFolder']){
  const text=field==='beforeHash'?'d'.repeat(64):field==='uploadFolder'?'game-abcd':receipt[field];
  for(const value of [[text],new String(text)])await assert.rejects(trackSettingsReceipt({...receipt,[field]:value}),/保存確認記録の形式/);
 }
});

test('backup history rejects missing array entries',async()=>{
 const {validSaveBackups}=await import('../offline-html/local-state.js');
 const backup={schema:1,id:'a'.repeat(36),createdAt:'2026-10-27T00:00:00Z',reason:'manual',contentRevision:'original',data:{score:'42'}};
 assert.equal(validSaveBackups([backup]),true);
 assert.equal(validSaveBackups(new Array(1)),false);
 assert.equal(validSaveBackups([backup,,]),false);
});
