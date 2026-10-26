import {test} from 'node:test';import assert from 'node:assert/strict';import {loadGameViews,updateGameView} from '../offline-html/local-state.js';
test('game preferences reject malformed identity and unexpected fields before database access',async()=>{
 const id='a'.repeat(32);
 for(const identity of [null,[id],'invalid']){await assert.rejects(updateGameView(identity,id,{favorite:true}),/ゲーム情報/);await assert.rejects(updateGameView(id,identity,{played:true}),/ゲーム情報/);}
 for(const change of [null,[],{favorite:'yes'},{played:false},{title:'private game'}])await assert.rejects(updateGameView(id,id,change),/表示設定の形式/);
 assert.deepEqual(await loadGameViews(null),[]);assert.deepEqual(await loadGameViews([id]),[]);
});
