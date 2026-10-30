const normalized=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
const collator=new Intl.Collator('ja');
// Weak keys release removed libraries and games. Searchable snapshots refer to
// existing games without copying thumbnails/handles or persisting catalogues.
const gameRecords=new WeakMap(),catalogues=new WeakMap();
function recordFor(game){
 const old=gameRecords.get(game),tags=game.tags;
 if(old&&old.title===game.title&&old.path===game.path&&old.kind===game.kind&&old.environment===game.developmentEnvironment&&old.description===game.description&&old.instructions===game.instructions&&old.updatedAt===game.updatedAt&&old.tags.length===tags.length&&old.tags.every((tag,i)=>tag===tags[i]))return old;
 const record={game,title:game.title,path:game.path,kind:game.kind,environment:game.developmentEnvironment,description:game.description,instructions:game.instructions,updatedAt:game.updatedAt,time:null,tags:[...tags],text:new Map()};
 gameRecords.set(game,record);return record;
}
function catalogueFor(games,records){
 const old=catalogues.get(games);
 if(old&&old.records.length===records.length&&old.records.every((record,i)=>record===records[i]))return old;
 const index={records,orders:new Map()};catalogues.set(games,index);return index;
}
const timeFor=record=>record.time??(record.time=Date.parse(record.updatedAt)||0);
const byTitle=(a,b)=>collator.compare(a.title,b.title)||collator.compare(a.path,b.path);
function ordered(index,sort){
 const key=sort==='updated'?'updated':'name';
 if(!index.orders.has(key)){const compare=key==='updated'?(a,b)=>timeFor(b)-timeFor(a)||byTitle(a,b):byTitle;const alreadySorted=index.records.every((record,i)=>!i||compare(index.records[i-1],record)<=0);index.orders.set(key,alreadySorted?index.records:[...index.records].sort(compare));}
 return index.orders.get(key);
}
function optionsFor(options){
 const words=normalized(options.query).trim().split(/\s+/).filter(Boolean),tags=[...(options.tags||[])];
 return {...options,words,tags,scope:options.scope||'all'};
}
function matches(record,options){
 if(options.kind&&record.kind!==options.kind||options.environment&&record.environment!==options.environment)return false;
 if(options.tags.length&&!(options.tagMatch==='any'?options.tags.some(tag=>record.tags.includes(tag)):options.tags.every(tag=>record.tags.includes(tag))))return false;
 // Browsing and tag-only filtering do not normalize descriptions at all.
 if(!options.words.length)return true;
 const scope=options.scope;
 if(!record.text.has(scope)){
  const fields={title:record.title,tags:record.tags.join(' '),environment:record.environment,description:(record.description||'')+' '+(record.instructions||'')};
  if(record.text.size>=2)record.text.delete(record.text.keys().next().value);
  record.text.set(scope,normalized(scope==='all'?Object.values(fields).join(' '):Object.hasOwn(fields,scope)?fields[scope]:''));
 }
 return options.words.every(word=>record.text.get(scope).includes(word));
}
export function searchGames(games,options={}){
 const query=optionsFor(options),index=catalogueFor(games,games.map(recordFor)),result=[];
 const records=ordered(index,query.sort),reverse=query.sort==='name-desc';
 for(let i=0;i<records.length;i++){const record=records[reverse?records.length-1-i:i];if(matches(record,query))result.push(record.game);}
 return result;
}
// Yield during large/cold searches instead of blocking typing, List or Reload.
// All cached records are validated before reuse, including in-place tag edits.
export async function searchGamesAsync(games,options={}, {signal}={}){
 signal?.throwIfAborted();
 if(games.length>1000){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
 const query=optionsFor(options),records=[];let deadline=performance.now()+8;
 async function checkpoint(i){
  signal?.throwIfAborted();
  if((i&31)===31&&performance.now()>=deadline){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();deadline=performance.now()+8;}
 }
 for(let i=0;i<games.length;i++){records.push(recordFor(games[i]));if((i&31)===31)await checkpoint(i);}
 const index=catalogueFor(games,records),sorted=ordered(index,query.sort),result=[],reverse=query.sort==='name-desc';
 for(let i=0;i<sorted.length;i++){const record=sorted[reverse?sorted.length-1-i:i];if(matches(record,query))result.push(record.game);if((i&31)===31)await checkpoint(i);}
 signal?.throwIfAborted();return result;
}
