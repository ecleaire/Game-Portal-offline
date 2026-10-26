import {test} from 'node:test';import assert from 'node:assert/strict';import {validSave,commitSaveSync} from '../offline-html/local-state.js';import {validClock} from '../offline-html/shared-saves.js';
test('save data and synchronization clocks reject non-record objects',async()=>{
 const id='a'.repeat(32);
 for(const value of [new Date(),new Map(),new Set(),new String('score'),new Uint8Array()]){
  assert.equal(validSave(value),false);assert.equal(validClock(value),false);
  await assert.rejects(commitSaveSync(id,id,{data:{},state:{}},{schema:1,base:null,clock:value,pending:null}),/セーブ同期の形式/);
 }
 const save=Object.create(null);save.score='42';assert.equal(validSave(save),true);const clock=Object.create(null);clock[id]=1;assert.equal(validClock(clock),true);
});
