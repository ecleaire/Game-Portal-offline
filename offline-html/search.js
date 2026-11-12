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
 const index={records,orders:new Map(),lastQuery:null};catalogues.set(games,index);return index;
}
const timeFor=record=>record.time??(record.time=Date.parse(record.updatedAt)||0);
const byTitle=(a,b)=>collator.compare(a.title,b.title)||collator.compare(a.path,b.path);
function ordered(index,sort){
 const key=sort==='updated'?'updated':sort==='name-desc'?'name-desc':'name';
 if(!index.orders.has(key)){const compare=key==='updated'?(a,b)=>timeFor(b)-timeFor(a)||byTitle(a,b):key==='name-desc'?(a,b)=>-byTitle(a,b):byTitle;const alreadySorted=index.records.every((record,i)=>!i||compare(index.records[i-1],record)<=0);index.orders.set(key,alreadySorted?index.records:[...index.records].sort(compare));}
 return index.orders.get(key);
}
function optionsFor(options){
 const words=normalized(options.query).trim().split(/\s+/).filter(Boolean),tags=[...(options.tags||[])];
 return {...options,words,tags,scope:options.scope||'all'};
}
function queryShape(options){
 return JSON.stringify([options.scope,options.kind,options.environment,options.tags,options.tagMatch,options.sort]);
}
function candidatesFor(index,query,shape){
 const previous=index.lastQuery;
 // If every previous term is still required (possibly as part of a longer
 // term), any new match had to be in the previous result. A backspace, changed
 // filter or replaced catalogue uses the full ordered list again.
 if(previous?.shape===shape&&previous.words.every(word=>query.words.some(next=>next.includes(word))))return previous.matches;
 return ordered(index,query.sort);
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
 const records=ordered(index,query.sort);
 for(let i=0;i<records.length;i++){const record=records[i];if(matches(record,query))result.push(record.game);}
 return result;
}
// Yield during large/cold searches instead of blocking typing, List or Reload.
// All cached records are validated before reuse, including in-place tag edits.
export async function searchGamesAsync(games,options={}, {signal}={}){
 signal?.throwIfAborted();
 if(games.length>1000){await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();}
 const query=optionsFor(options),records=[];let deadline=performance.now()+8;
 async function yieldToInput(){
  await new Promise(resolve=>setTimeout(resolve,0));signal?.throwIfAborted();deadline=performance.now()+8;
 }
 for(let i=0;i<games.length;i++){records.push(recordFor(games[i]));if((i&31)===31&&performance.now()>=deadline)await yieldToInput();}
 const index=catalogueFor(games,records),shape=queryShape(query),candidates=candidatesFor(index,query,shape),matched=[];
 for(let i=0;i<candidates.length;i++){const record=candidates[i];if(matches(record,query))matched.push(record);if((i&31)===31&&performance.now()>=deadline)await yieldToInput();}
 signal?.throwIfAborted();
 index.lastQuery=query.words.length?{shape,words:query.words,matches:matched}:null;
 return matched.map(record=>record.game);
}
