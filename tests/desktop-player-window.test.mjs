import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {installDesktopPlayerWindow} from '../desktop/player-window.js';
function fixture(){
 let mutation;const calls=[],nodes={player:{open:false},playerTitle:{textContent:'Game'},playerStatus:{textContent:''}};
 const state={other:null,dirty:false,closes:0};
 const context={window:{},openedGame:{kind:'html'},hasEditChanges:()=>state.dirty,MutationObserver:class{constructor(fn){mutation=fn;}observe(){}},document:{getElementById:id=>nodes[id],querySelector:()=>state.other,fullscreenElement:null,async exitFullscreen(){this.fullscreenElement=null;}},host:{async playerWindow(open,title){calls.push({open,title});}}};
 nodes.closePlayer={async onclick(){state.closes++;if(state.wait)await state.wait;nodes.player.open=false;mutation();}};
 vm.runInNewContext('('+installDesktopPlayerWindow.toString()+')(host)',context);
 return {context,nodes,calls,state,mutate:()=>mutation(),settle:()=>new Promise(r=>setImmediate(r))};
}
test('native player window follows open/title changes without creating duplicate requests',async()=>{
 const f=fixture();await f.settle();f.nodes.player.open=true;f.mutate();f.mutate();await f.settle();assert.deepEqual(f.calls,[{open:false,title:'Game'},{open:true,title:'Game'}]);f.nodes.playerTitle.textContent='Other';f.mutate();await f.settle();assert.deepEqual(f.calls.at(-1),{open:true,title:'Other'});
});
test('native EXE games retain their existing external process window',async()=>{
 const f=fixture();await f.settle();f.context.openedGame.kind='exe';f.nodes.player.open=true;f.mutate();await f.settle();assert.equal(f.calls.length,1);
});
test('native close waits for the existing save/close operation and coalesces repeated requests',async()=>{
 const f=fixture();f.nodes.player.open=true;f.mutate();await f.settle();let release;f.state.wait=new Promise(r=>release=r);
 const first=f.context.window.gamePortalReturnToLibrary(),second=f.context.window.gamePortalReturnToLibrary();assert.equal(first,second);assert.equal(f.state.closes,1);assert.equal(f.nodes.player.open,true);release();assert.equal(await first,true);await f.settle();assert.equal(f.calls.at(-1).open,false);
});
for(const guard of ['dirty','other'])test('native close retains '+guard+' input instead of losing it',async()=>{
 const f=fixture();f.nodes.player.open=true;f.mutate();await f.settle();f.state[guard]=guard==='dirty'?true:{};assert.equal(await f.context.window.gamePortalReturnToLibrary(),false);assert.equal(f.state.closes,0);assert.equal(f.nodes.player.open,true);assert(f.nodes.playerStatus.textContent.includes('未保存'));
});
test('a stale fullscreen exit cannot close the newly selected player window',async()=>{
 const f=fixture();f.nodes.player.open=true;f.mutate();await f.settle();const before=f.calls.filter(c=>!c.open).length;let release;f.context.document.fullscreenElement={};f.context.document.exitFullscreen=()=>new Promise(r=>release=()=>{f.context.document.fullscreenElement=null;r();});
 f.nodes.player.open=false;f.mutate();await f.settle();f.nodes.player.open=true;f.nodes.playerTitle.textContent='Newest';f.mutate();await f.settle();release();await f.settle();assert.deepEqual(f.calls.at(-1),{open:true,title:'Newest'});assert.equal(f.calls.filter(c=>!c.open).length,before);
});
test('a failed save leaves the game window open and reports the error',async()=>{
 const f=fixture();f.nodes.player.open=true;f.nodes.closePlayer.onclick=async()=>{throw Error('save unavailable');};assert.equal(await f.context.window.gamePortalReturnToLibrary(),false);assert.equal(f.nodes.player.open,true);assert(f.nodes.playerStatus.textContent.includes('save unavailable'));
});
