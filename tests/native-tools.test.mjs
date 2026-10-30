import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeLayout,validateExe,nativeConnection,nativePageConnection,launchNative,nativeFolder} from '../offline-html/native-tools.js';
import {describeError} from '../offline-html/errors.js';
import {canUpdateGame} from '../offline-html/updates.js';

function exe(flags=2){const bytes=new Uint8Array(128),view=new DataView(bytes.buffer);view.setUint16(0,0x5a4d,true);view.setUint32(60,64,true);view.setUint32(64,0x4550,true);view.setUint16(86,flags,true);return new File([bytes],'game.exe');}

test('native reload capability is bound to its exact file history entry',()=>{
  const page='file:///C:/portal.html',fragment='#native=32123.'+'a'.repeat(64),state={gamePortalNative:{page,fragment}};
  assert.deepEqual(nativePageConnection(page,state,'reload'),nativeConnection(page+fragment));
  for(const anchor of ['#main','#libraryTitle'])assert.deepEqual(nativePageConnection(page+anchor,state,'reload'),nativeConnection(page+fragment));
  for(const type of ['navigate','back_forward',undefined])assert.equal(nativePageConnection(page,state,type),null);
  for(const url of [page+'#other',page+'?other',page.replace('portal','copy'),'https://example.com/portal.html'])assert.equal(nativePageConnection(url,state,'reload'),null);
  for(const saved of [null,{}, {page,fragment:23},{page,fragment:'#native=80.'+'a'.repeat(64)},{page,fragment:'#native=32123.bad'}])assert.equal(nativePageConnection(page,{gamePortalNative:saved},'reload'),null);
  assert.equal(nativePageConnection(page,null,'reload'),null);
  const fresh=page+'#native=32124.'+'b'.repeat(64);assert.deepEqual(nativePageConnection(fresh,state,'reload'),nativeConnection(fresh));
});

test('native entry selection keeps dependencies and recognizes Godot and Unity helpers',()=>{
  assert.deepEqual(nativeLayout(['game.exe','assets/data.bin']),{kind:'exe',root:'',entry:'game.exe'});
  assert.equal(nativeLayout(['game.exe','game.console.exe']).entry,'game.exe');
  assert.equal(nativeLayout(['game.exe','UnityCrashHandler64.exe']).entry,'game.exe');
  assert.equal(nativeLayout(['index.html','GAME-PORTAL-WINDOWS.exe']),null);
  assert.equal(nativeLayout(['__MACOSX/game.exe','.cache/game.exe']),null);
  assert.throws(()=>nativeLayout(['one.exe','two.exe']),/複数/);
  assert.throws(()=>nativeLayout(['nested/game.exe']),/直接/);
});

test('native reads time out while receiving the body, release pending state and remain retryable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let receiving,hang=true;const bodyReady=new Promise(resolve=>receiving=resolve),counts=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {action}=JSON.parse(options.body);
    if(action==='info')return {ok:true,json:async()=>({configured:true,name:'library'})};
    if(action==='stat')return {ok:true,json:async()=>({kind:'file'})};
    return {ok:true,arrayBuffer:()=>{throw Error('Must not allocate an intermediate binary ArrayBuffer');},blob:()=>{if(!hang)return Promise.resolve(new Blob(['game']));receiving();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}};
  });
  const root=await nativeFolder({origin:'http://127.0.0.1:12345',token:'test'},'1.0.0',undefined,{onPendingChange:count=>counts.push(count)}),file=await root.getFileHandle('game.html');
  const reading=file.getFile();await bodyReady;assert.equal(root.pendingReads,1);const rejected=assert.rejects(reading,error=>error.name==='TimeoutError'&&error.message.includes('設定')&&describeError(error).message.includes('起動補助'));t.mock.timers.tick(120000);await rejected;
  assert.equal(root.pendingReads,0);assert.equal(counts.at(-1),0);hang=false;assert.equal(await(await file.getFile()).text(),'game');assert.equal(root.pendingReads,0);
});

test('canceling native reads preserves the handle and does not abort later reads',async t=>{
  let waiting,hang=true;const started=new Promise(resolve=>waiting=resolve);
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const {action}=JSON.parse(options.body);if(action==='info')return {ok:true,json:async()=>({configured:true,name:'library'})};
    if(hang){waiting();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
    return {ok:true,json:async()=>({entries:[]})};
  });
  const root=await nativeFolder({origin:'http://127.0.0.1:12345',token:'test'},'1.0.0');
  const reading=Array.fromAsync(root.values());await started;const rejected=assert.rejects(reading,{name:'NativeReadCancelled'});root.cancelReads();await rejected;assert.equal(root.pendingReads,0);hang=false;assert.deepEqual(await Array.fromAsync(root.values()),[]);
});

test('native resource preflight validates sizes and carries the reserved limit to the read',async t=>{
  let size=3,reads=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='info')return {ok:true,json:async()=>({configured:true,name:'library'})};
    if(body.action==='stat')return {ok:true,json:async()=>({kind:'file',size})};
    reads++;assert.equal(body.limit,3);return {ok:true,blob:async()=>new Blob(['abc'])};
  });
  const root=await nativeFolder({origin:'http://127.0.0.1:12345',token:'test'},'1.0.0'),file=await root.getFileHandle('game.wasm');
  assert.deepEqual(await file.getFileInfo(),{size:3});assert.equal((await file.getFile()).size,3);
  for(const invalid of [-1,NaN,'3',201*1024*1024,Number.MAX_SAFE_INTEGER+1]){size=invalid;await assert.rejects(file.getFileInfo(),/200MB/);}
  assert.equal(reads,1);
});

test('EXE validation reads bounded headers and rejects corrupt executables and renamed DLLs',async()=>{
  await validateExe(exe());
  await assert.rejects(validateExe(exe(0x2002)),/EXE/);
  await assert.rejects(validateExe(exe(0)),/EXE/);
  await assert.rejects(validateExe(new File(['bad'],'broken.exe')),/EXE/);
  await assert.rejects(validateExe({size:201*1024*1024,slice(){throw Error('must not read');}}),/200MB/);
  const bytes=new Uint8Array(await exe().arrayBuffer());new DataView(bytes.buffer).setUint32(60,127,true);
  await assert.rejects(validateExe(new File([bytes],'corrupt.exe')),/壊れ/);
  let reads=0;const file=exe();await validateExe({size:file.size,slice(start,end){reads+=end-start;return file.slice(start,end);}});assert.equal(reads,88);
});

test('native bridge accepts only bounded file-page capabilities; absent helper cannot launch',async()=>{
  const token='a'.repeat(64),url='file:///C:/portal.html#native=32123.'+token;
  assert.deepEqual(nativeConnection(url),{origin:'http://127.0.0.1:32123',token});
  for(const bad of [url.replace('file:///C:','https://example.com'),url.replace('32123','80'),url.replace('32123','65536'),url+'extra','file:///C:/portal.html'])assert.equal(nativeConnection(bad),null);
  await assert.rejects(launchNative(null,'id',{},'0.19.0'),/GAME-PORTAL-WINDOWS/);
  assert.equal(canUpdateGame({kind:'exe',path:'game-abc/game.exe'}),false);
});


test('native entry selection excludes both launcher editions while retaining actual games',()=>{
 assert.equal(nativeLayout(['GAME-PORTAL.exe','GAME-PORTAL-PLAY.exe','GAME-PORTAL-WINDOWS.exe']),null);
 assert.equal(nativeLayout(['GAME-PORTAL.exe','game.exe']).entry,'game.exe');
 assert.equal(nativeLayout(['GAME-PORTAL-PLAY.exe','GAME-PORTAL-ADVENTURE.exe']).entry,'GAME-PORTAL-ADVENTURE.exe');
});
