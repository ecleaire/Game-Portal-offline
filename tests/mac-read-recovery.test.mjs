import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {macDesktopPage} from '../scripts/macos/desktop-page.mjs';
const generated=macDesktopPage(await readFile('GAME-PORTAL.html','utf8'),await readFile('desktop/bootstrap.js','utf8'),'');
async function fixture(){
 const page=await generated,start=page.indexOf('const desktopHost=(()=>{'),end=page.indexOf('const desktopOriginalNativeFolder=',start);
 assert(start>=0&&end>start);
 const timers=new Map(),sent=[];let serial=0;
 const window={};window.top=window;
 const context={window,location:{pathname:'/'},document:{getElementById:()=>null},localState:{},nativeTools:{},nativeReadControls:()=>{},setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},DOMException,File,Blob,AbortController,ArrayBuffer,Uint8Array,player:{decodeBase64:()=>new Uint8Array([1])}};
 window.__portalSend=text=>{const request=JSON.parse(text);sent.push({...request,timer:serial});let value;
  if(request.op==='restore')value={token:'stalled',secret:'secret',name:'NAS'};
  else if(request.op==='selectPath')value={token:'healthy',secret:'other-secret',name:'other-games'};
  else if(request.op==='file')value=true;
  else if(request.op==='beginRead')value={reader:'reader-'+request.id,size:1};
  else if(request.root==='healthy'&&request.op==='readChunk')value={size:1,data:'AQ=='};
  else if(request.root==='healthy'&&request.op==='endRead')value=true;
  else return; // readChunk/abortRead remain queued behind the stalled NAS.
  queueMicrotask(()=>window.gamePortalReply({id:request.id,ok:true,value}));
 };
 vm.runInNewContext(page.slice(start,end)+'\nglobalThis.host=desktopHost;',context);
 const file=await (await context.host.current()).handle.getFileHandle('game.html');
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 return {context,file,sent,timers,tick,expire(op){const request=sent.findLast(x=>x.op===op),fn=timers.get(request.timer);assert(fn,'operation has a bounded timeout');timers.delete(request.timer);fn();}};
}
test('Mac read timeouts release all four slots even when native cleanup never replies, allowing another folder to load',async()=>{
 const f=await fixture();
 for(let index=0;index<4;index++){
  const reading=f.file.getFile();const rejected=assert.rejects(reading,{name:'TimeoutError'});
  await f.tick();f.expire('readChunk');await rejected;
 }
 assert.equal(f.sent.filter(x=>x.op==='abortRead').length,4);
 const folder=await f.context.host.fromPath('/other-games'),file=await folder.getFileHandle('another.html');
 assert.equal((await file.getFile()).size,1);
 for(const request of f.sent.filter(x=>x.op==='abortRead'))assert(f.timers.has(request.timer),'cleanup requests also time out');
 f.context.host.cancel();await f.tick();
});
test('Mac cancellation settles reads without waiting for queued abortRead and allows a new folder read',async()=>{
 const f=await fixture(),reading=f.file.getFile(),rejected=assert.rejects(reading,{name:'NativeReadCancelled'});
 await f.tick();f.context.host.cancel();await rejected;
 const folder=await f.context.host.fromPath('/other-games'),file=await folder.getFileHandle('another.html');
 assert.equal((await file.getFile()).size,1);
 f.context.host.cancel();await f.tick();
});
