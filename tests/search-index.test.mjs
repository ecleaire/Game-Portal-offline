import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameId} from '../offline-html/library.js';
import {searchGames,searchGamesAsync} from '../offline-html/search.js';
const normalized=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
function reference(games,o={}){
 const words=normalized(o.query).trim().split(/\s+/).filter(Boolean),tags=[...(o.tags||[])],scope=o.scope||'all';
 const list=games.filter(g=>{
  if(o.kind&&g.kind!==o.kind||o.environment&&g.developmentEnvironment!==o.environment)return false;
  if(tags.length&&!(o.tagMatch==='any'?tags.some(t=>g.tags.includes(t)):tags.every(t=>g.tags.includes(t))))return false;
  const f={title:g.title,tags:g.tags.join(' '),environment:g.developmentEnvironment,description:(g.description||'')+' '+(g.instructions||'')};
  return words.every(w=>normalized(scope==='all'?Object.values(f).join(' '):f[scope]).includes(w));
 });
 const title=(a,b)=>a.title.localeCompare(b.title,'ja')||a.path.localeCompare(b.path,'ja');
 return list.sort((a,b)=>o.sort==='name-desc'?-title(a,b):o.sort==='updated'?(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||title(a,b):title(a,b));
}
const catalogue=count=>Array.from({length:count},(_,i)=>({path:'folder/'+i+'.html',title:(i%3?'ゲーム ':'Ａlpha ')+(i%101),kind:['html','zip','pyxapp','exe'][i%4],tags:['tag'+i%7,i%2?'パズル':'アクション'],developmentEnvironment:i%2?'Godot':'Scratch',description:'normalization-marker 概要 '+i%13,instructions:'Space 矢印キー '+i%5,updatedAt:i%3?'2026-10-'+String(i%28+1).padStart(2,'0')+'T00:00:00Z':''}));

test('indexed searches preserve scope, tag AND/OR, Unicode and sort results',async()=>{
 const games=catalogue(1500),original=[...games];
 for(let i=0;i<150;i++){
  const o={query:['','alpha','概要','Space 矢印','パズル','Godot','no-match'][i%7],scope:['all','title','tags','description','environment'][i%5],sort:['name-asc','name-desc','updated'][i%3],tags:i%4?[]:['tag0','パズル'],tagMatch:i%2?'all':'any',kind:i%6?'':['html','zip','pyxapp','exe'][i%4]};
  const expected=reference(games,o);assert.deepEqual(searchGames(games,o),expected);assert.deepEqual(await searchGamesAsync(games,o),expected);
 }
 assert.deepEqual(games,original);
});
test('warm indexes invalidate field edits, in-place tags, membership and ordering',async()=>{
 const games=catalogue(80);searchGames(games,{query:'概要'});
 const changes=[()=>games[0].title='new unique title',()=>games[1].tags.push('unique-tag'),()=>games[2].description='new unique description',()=>games[3].updatedAt='2029-01-01',()=>games.reverse(),()=>games.splice(3,1),()=>games.push({...games[0],path:'replacement.html',title:'Replacement'})];
 for(const change of changes){change();for(const o of [{query:'unique'},{query:'unique-tag',scope:'tags'},{sort:'updated'},{sort:'name-desc'},{tags:['unique-tag']}])assert.deepEqual(await searchGamesAsync(games,o),reference(games,o));}
});
test('browsing skips text normalization and subsequent queries reuse prepared text',t=>{
 const games=catalogue(240),normalize=String.prototype.normalize;let fieldNormalizations=0;
 t.mock.method(String.prototype,'normalize',function(...args){if(String(this).includes('normalization-marker'))fieldNormalizations++;return normalize.apply(this,args);});
 searchGames(games,{});searchGames(games,{tags:['パズル']});searchGames(games,{query:'ゲーム',scope:'title'});assert.equal(fieldNormalizations,0);
 searchGames(games,{query:'概要'});assert.equal(fieldNormalizations,240);searchGames(games,{query:'Space'});searchGames(games,{query:'different'});assert.equal(fieldNormalizations,240);
 games[4].description+=' changed';searchGames(games,{query:'概要'});assert.equal(fieldNormalizations,241);
});
test('large searches yield to interaction and abort obsolete results',async()=>{
 const games=catalogue(9000),controller=new AbortController();let interacted=false;
 const timer=setTimeout(()=>{interacted=true;controller.abort();},0);
 await assert.rejects(searchGamesAsync(games,{query:'概要'},{signal:controller.signal}),{name:'AbortError'});clearTimeout(timer);assert(interacted);
 const already=new AbortController();already.abort();await assert.rejects(searchGamesAsync(games,{}, {signal:already.signal}),{name:'AbortError'});
 assert.deepEqual(searchGames(games,{query:'Ａlpha',scope:'title'}),reference(games,{query:'Ａlpha',scope:'title'}));
});


test('repeated folder scans reuse deterministic IDs and retry failed hashes',async t=>{
 const digest=crypto.subtle.digest.bind(crypto.subtle);let calls=0,fail=true;
 t.mock.method(crypto.subtle,'digest',async(...args)=>{calls++;if(new TextDecoder().decode(args[1])==='retry-hash.html'&&fail)throw Error('Temporary crypto failure');return digest(...args);});
 const path='id-cache-fixture/game.html',expected=Buffer.from(await digest('SHA-256',new TextEncoder().encode(path))).toString('hex').slice(0,32);
 assert.deepEqual(await Promise.all([gameId(path),gameId(path)]),[expected,expected]);assert.equal(await gameId(path),expected);assert.equal(calls,1);
 await assert.rejects(gameId('retry-hash.html'),/Temporary/);fail=false;assert.equal((await gameId('retry-hash.html')).length,32);assert.equal(calls,3);
 assert.notEqual(await gameId('ガ.html'),await gameId('カ\u3099.html'));
});


test('descending sorting preserves source order for distinct Unicode paths with equal collation',async()=>{
 const games=['ガ.html','カ\u3099.html','Ｇ.html','G.html'].map(path=>({path,title:'同じタイトル',tags:[],updatedAt:''}));
 for(const sort of ['name-asc','name-desc','updated']){
  const options={sort};assert.deepEqual(searchGames(games,options),reference(games,options));assert.deepEqual(await searchGamesAsync(games,options),reference(games,options));
 }
});
