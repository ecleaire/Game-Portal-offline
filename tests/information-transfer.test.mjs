import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as library from '../offline-html/library.js';
import {createInformationArchive,parseInformationArchive,planInformationImport,applyInformationImport,informationFilename,INFORMATION_LIMIT} from '../offline-html/information-transfer.js';

function fixture(count=2){
 const files=new Map(),directories=new Set(['','.gameportal']),writes=[],reads=[];let beforeClose=async()=>{};
 files.set('.gameportal/library-id.json',JSON.stringify({schema:1,id:'a'.repeat(32)}));
 const missing=()=>new DOMException('Missing','NotFoundError');
 const folder=path=>({name:path||'Library',async getDirectoryHandle(name,{create=false}={}){const next=path?path+'/'+name:name;if(create)directories.add(next);if(!directories.has(next))throw missing();return folder(next);},async getFileHandle(name,{create=false}={}){const next=path?path+'/'+name:name;if(create&&!files.has(next))files.set(next,'');if(!files.has(next))throw missing();return {kind:'file',name,async getFile(){reads.push(next);if(next.endsWith('.html'))throw Error('Game bytes must not be read');return new File([files.get(next)],name);},async createWritable(){let pending;return {async write(value){pending=value;},async close(){await beforeClose(next,pending);files.set(next,pending);writes.push(next);},async abort(){}};}};}});
 const games=Array.from({length:count},(_,index)=>{const game={path:'game'+index+'.html',id:(index+1).toString(16).padStart(32,'0'),kind:'html',title:'Game '+index,tags:['tag'+index],developmentEnvironment:'Godot',thumbnail:null,description:'Description '+index,instructions:'Space',settingsError:'',contentPending:false};files.set(game.path,'game bytes');const text=JSON.stringify({schema:1,...game});files.set(game.path+'.gameportal.json',text);return {...game,settingsText:text};});
 return {root:folder(''),files,games,writes,reads,setClose:hook=>beforeClose=hook};
}
const modify=(text,change)=>{const data=JSON.parse(text);change(data);return JSON.stringify(data);};

test('single and selected exports preserve editable information and exclude native/profile/game data',async()=>{
 const m=fixture(3);m.games[0].secret='must not export';
 const text=await createInformationArchive(m.root,[m.games[0],m.games[2]],library),data=parseInformationArchive(text,library);
 assert.equal(data.games.length,2);assert.equal(data.games[1].path,'game2.html');assert.equal(data.games[0].description,'Description 0');assert(!text.includes('must not export'));assert(!text.includes('settingsText'));assert(!text.includes('game bytes'));assert.equal(m.writes.length,0);assert(!m.reads.some(path=>path.endsWith('.html')));
 assert(informationFilename('con:/sample').startsWith('ゲーム情報_con__sample'));assert(new TextEncoder().encode(informationFilename('😀'.repeat(60))).length<=255);assert.equal(JSON.parse(await createInformationArchive(m.root,[m.games[1]],library)).games.length,1);
});
test('archives reject damaged, duplicate, traversal, invalid image and wrong-save files before writing',async()=>{
 const m=fixture(),text=await createInformationArchive(m.root,m.games,library);
 for(const bad of ['{',JSON.stringify({schema:1,type:'save',games:[]}),modify(text,d=>d.games.push(d.games[0])),modify(text,d=>d.games[0].path='../escape.html'),modify(text,d=>d.games[0].thumbnail='https://example.com/image.png'),modify(text,d=>d.games[0].tags='oops'),modify(text,d=>d.games[0].tags=Array.from({length:33},(_,i)=>'tag'+i)),modify(text,d=>d.games[0].instructions='x'.repeat(4001))])assert.throws(()=>parseInformationArchive(bad,library));
 assert.throws(()=>parseInformationArchive(' '.repeat(INFORMATION_LIMIT+1),library),/64MB/);assert.equal(m.writes.length,0);
});
test('bulk import matches identity, preserves IDs and game bytes and creates normal history per game',async()=>{
 const m=fixture(),text=modify(await createInformationArchive(m.root,m.games,library),d=>{for(const game of d.games){game.title+=' Updated';game.tags=Array.from({length:32},(_,i)=>'tag'+i);game.description='New overview';}}),archive=parseInformationArchive(text,library),plan=await planInformationImport(m.root,archive,m.games,library);
 assert(plan.rows.every(row=>row.exact&&!row.blocked&&!row.unchanged));const result=await applyInformationImport(m.root,plan,[0,1],library);assert.equal(result.error,null);assert.deepEqual(result.completed,[0,1]);
 for(const game of m.games){const saved=JSON.parse(m.files.get(game.path+'.gameportal.json'));assert.equal(saved.id,game.id);assert.equal(saved.title,game.title+' Updated');assert.equal(saved.tags.length,32);assert.equal(m.files.get(game.path),'game bytes');assert([...m.files.keys()].some(path=>path.startsWith('.gameportal/history/'+game.id+'/')));}
 assert.equal(JSON.parse(m.files.get('.gameportal/compatibility.json')).minLauncherVersion,'0.22.0');assert(!m.reads.some(path=>path.endsWith('.html')));
});
test('path-only matches require explicit selection and no matches or duplicate target IDs are not guessed',async()=>{
 const m=fixture(),text=modify(await createInformationArchive(m.root,m.games,library),d=>{d.games[0].id='d'.repeat(32);d.games[0].title='Other';d.games[1].path='missing.html';d.games[1].id='e'.repeat(32);}),plan=await planInformationImport(m.root,parseInformationArchive(text,library),m.games,library);
 assert.equal(plan.rows[0].exact,false);assert.equal(plan.rows[0].blocked,false);assert.equal(plan.rows[1].blocked,true);const imported=await applyInformationImport(m.root,plan,[0],library);assert.deepEqual(imported.completed,[0]);assert.equal(JSON.parse(m.files.get('game0.html.gameportal.json')).id,m.games[0].id);
});
test('matching IDs from another library are marked for explicit confirmation',async()=>{
 const m=fixture(),text=modify(await createInformationArchive(m.root,m.games,library),data=>{data.libraryId='b'.repeat(32);data.games[0].title='Foreign library';});
 const plan=await planInformationImport(m.root,parseInformationArchive(text,library),m.games,library);assert.equal(plan.rows[0].exact,true);assert.equal(plan.rows[0].sameLibrary,false);assert.equal(m.writes.length,0);
});
test('all selected targets are checked before first write; stale metadata and changed root stop import',async()=>{
 for(const identity of [false,true]){const m=fixture(),archive=parseInformationArchive(modify(await createInformationArchive(m.root,m.games,library),d=>d.games.forEach(g=>g.title+=' Changed')),library),plan=await planInformationImport(m.root,archive,m.games,library);
  if(identity)m.files.set('.gameportal/library-id.json',JSON.stringify({schema:1,id:'b'.repeat(32)}));else m.files.set('game1.html.gameportal.json',m.games[1].settingsText+' ');
  const result=await applyInformationImport(m.root,plan,[0,1],library);assert(result.error);assert.deepEqual(result.completed,[]);assert.equal(m.writes.length,0);
 }
});
test('cancellation drains the current write and leaves all remaining games unchanged',async()=>{
 const m=fixture(),archive=parseInformationArchive(modify(await createInformationArchive(m.root,m.games,library),d=>d.games.forEach(g=>g.title+=' Changed')),library),plan=await planInformationImport(m.root,archive,m.games,library),controller=new AbortController();let release,started;
 m.setClose(async path=>{if(path==='game0.html.gameportal.json'){started=true;await new Promise(resolve=>release=resolve);}});
 const work=applyInformationImport(m.root,plan,[0,1],library,{signal:controller.signal});while(!started)await new Promise(resolve=>setImmediate(resolve));controller.abort();let settled=false;work.then(()=>settled=true);await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();const result=await work;assert.equal(result.cancelled,true);assert.deepEqual(result.completed,[0]);assert.equal(m.files.get('game1.html.gameportal.json'),m.games[1].settingsText);
});
test('uncertain save stops a batch and retains the standard verification receipt/history',async()=>{
 const m=fixture(),archive=parseInformationArchive(modify(await createInformationArchive(m.root,m.games,library),d=>d.games.forEach(g=>g.title+=' Changed')),library),plan=await planInformationImport(m.root,archive,m.games,library);
 m.setClose(async(path,text)=>{if(path==='game0.html.gameportal.json'){m.files.set(path,text);throw new DOMException('Unknown close','NetworkError');}});
 const result=await applyInformationImport(m.root,plan,[0,1],library);assert.equal(result.error.code,'SETTINGS_SAVE_UNCONFIRMED');assert.deepEqual(result.completed,[]);assert.equal(m.files.get('game1.html.gameportal.json'),m.games[1].settingsText);assert.equal((await library.verifySettingsSave(m.root,result.error.attempt)).state,'confirmed');
});
test('export reads at most four metadata files concurrently and can stop stalled reads without writes',async()=>{
 const m=fixture(10);let active=0,maximum=0;
 const bounded={...library,loadGameSettings:async(...args)=>{active++;maximum=Math.max(maximum,active);try{await new Promise(resolve=>setImmediate(resolve));return await library.loadGameSettings(...args);}finally{active--;}}};
 await createInformationArchive(m.root,m.games,bounded);assert.equal(maximum,4);assert.equal(active,0);
 const controller=new AbortController();let started=0;const blocked={...library,loadGameSettings:()=>{started++;return new Promise(()=>{});}},work=createInformationArchive(m.root,m.games,blocked,{signal:controller.signal});
 while(started<4)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(started,4);assert.equal(m.writes.length,0);
});
test('legacy thumbnails are embedded while a stale source is never exported as current',async()=>{
 const m=fixture();m.games[0].thumbnail=true;m.games[0].settingsText=null;m.files.delete('game0.html.gameportal.json');
 const get=m.root.getDirectoryHandle;m.root.getDirectoryHandle=async function(name,options){if(name!=='.gameportal')return get.call(this,name,options);const folder=await get.call(this,name,options),getDir=folder.getDirectoryHandle;folder.getDirectoryHandle=async function(child,opts){if(child==='thumbnails')return {getFileHandle:async()=>({getFile:async()=>new File(['pixels'],'image.webp')})};return getDir.call(this,child,opts);};return folder;};
 const record=JSON.parse(await createInformationArchive(m.root,[m.games[0]],library)).games[0];assert.equal(record.thumbnail,'data:image/webp;base64,cGl4ZWxz');assert.equal(m.writes.length,0);
 m.files.set('game1.html.gameportal.json',m.games[1].settingsText+' ');await assert.rejects(createInformationArchive(m.root,[m.games[1]],library),/更新/);
});
