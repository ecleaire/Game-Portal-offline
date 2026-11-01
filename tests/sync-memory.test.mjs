import {test} from 'node:test';import assert from 'node:assert/strict';
import {sameLibraryView,cardViewKey,sameCardView} from '../offline-html/sync.js';
const fixture=()=>({id:'a',path:'game.html',kind:'html',title:'Game',tags:['tag'],thumbnail:'data:image/webp;base64,'+'A'.repeat(256*1024),settingsText:'settings',description:'overview',handle:{},folder:{}});
test('catalogue and card comparisons do not serialize large image strings',async t=>{
 const game=fixture(),copy={...game,tags:[...game.tags],handle:{fresh:true},folder:{fresh:true}};
 t.mock.method(JSON,'stringify',()=>{throw Error('Catalogue serialization would duplicate large images');});
 assert.equal(await sameLibraryView([game],[copy]),true);assert.equal(sameCardView(cardViewKey(game),copy),true);
 copy.thumbnail+='B';assert.equal(await sameLibraryView([game],[copy]),false);assert.equal(sameCardView(cardViewKey(game),copy),false);
});
test('card snapshots detect in-place visible edits and ignore non-visible metadata changes',()=>{
 const game=fixture(),snapshot=cardViewKey(game);game.tags.push('new');assert.equal(sameCardView(snapshot,game),false);
 game.tags.pop();game.title='Edited';assert.equal(sameCardView(snapshot,game),false);game.title='Game';
 game.instructions='new instructions';game.contentRevision='later';assert.equal(sameCardView(snapshot,game),true);
});
test('catalogue comparison detects order, nested metadata and fields removed by a peer',async()=>{
 const first=fixture(),second={...fixture(),id:'b',path:'b.html'},copy={...first,tags:[...first.tags],extra:{version:'one'}};
 assert.equal(await sameLibraryView([first,second],[second,first]),false);
 assert.equal(await sameLibraryView([copy],[{...copy,extra:{version:'two'}}]),false);
 assert.equal(await sameLibraryView([copy],[first]),false);
 assert.equal(await sameLibraryView([first],[{...first,optional:undefined}]),true);
});
test('large catalogue comparisons yield and abort obsolete synchronizations',async()=>{
 const game=fixture(),games=Array.from({length:2000},()=>({...game})),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),0);
 await assert.rejects(sameLibraryView(games,[...games],{signal:controller.signal}),{name:'AbortError'});clearTimeout(timer);
 const stopped=new AbortController();stopped.abort();await assert.rejects(sameLibraryView([],[],{signal:stopped.signal}),{name:'AbortError'});
});
