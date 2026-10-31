import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile('desktop/bootstrap.js','utf8')).split('const desktopOriginalNativeFolder=')[0];
async function fixture({fetch=async()=>{throw new TypeError('Failed to fetch');},part,bytes=Uint8Array.from({length:524301},(_,i)=>i%251)}={}){
 let reply;const calls=[],window={};window.top=window;
 const context={window,location:{origin:'https://gameportal.desktop.invalid',pathname:'/'},document:{getElementById:()=>null},localState:{},nativeTools:{},nativeReadControls(){},setTimeout,clearTimeout,AbortController,DOMException,File,Blob,ArrayBuffer,Uint8Array,fetch,player:{decodeBase64:value=>new Uint8Array(Buffer.from(value,'base64'))}};
 context.chrome=window.chrome={webview:{addEventListener(_,fn){reply=fn;},postMessage(request){calls.push(request);queueMicrotask(()=>{
   let value;if(request.op==='restore')value={token:'root',secret:'secret',name:'Library'};
   else if(request.op==='file')value=true;
   else if(request.op==='readPart'){if(part){const override=part(request);if(override===null)return;if(override)value=override;}value??={offset:request.offset,size:bytes.length,stamp:'123456',data:Buffer.from(bytes.subarray(request.offset,request.offset+262144)).toString('base64')};}
   reply({data:{id:request.id,ok:true,value}});
 });}}};
 vm.runInNewContext(source+'\nglobalThis.host=desktopHost;',context);
 const folder=(await context.host.current()).handle,file=await folder.getFileHandle('Godot #.zip');return {file,host:context.host,calls,bytes};
}
test('Windows Failed to fetch falls back to bounded native reads with byte-identical ZIP data',async()=>{
 const f=await fixture();assert.deepEqual(new Uint8Array(await(await f.file.getFile()).arrayBuffer()),f.bytes);assert.equal(f.calls.filter(x=>x.op==='readPart').length,3);assert.equal(f.host.pending,0);
});
test('successful stream reads never invoke the fallback',async()=>{
 const f=await fixture({fetch:async()=>new Response(new Uint8Array([1,2]),{headers:{'Content-Length':'2'}})});assert.equal((await f.file.getFile()).size,2);assert.equal(f.calls.some(x=>x.op==='readPart'),false);
});
test('truncated response streams fall back without returning a damaged file',async()=>{
 const f=await fixture({fetch:async()=>new Response(new Uint8Array([1]),{headers:{'Content-Length':'2'}})});assert.equal((await f.file.getFile()).size,f.bytes.length);
});
test('permission denial is authoritative and does not retry via native parts',async()=>{
 const f=await fixture({fetch:async()=>new Response(JSON.stringify({name:'NotAllowedError',message:'denied'}),{status:400})});await assert.rejects(f.file.getFile(),{name:'NotAllowedError'});assert(!f.calls.some(x=>x.op==='readPart'));assert.equal(f.host.pending,0);
});
for(const field of ['stamp','size','offset','data'])test('changed or malformed native '+field+' fails closed with a specific diagnostic',async()=>{
 const f=await fixture({part:r=>r.offset===0?undefined:{offset:r.offset,size:524301,stamp:'123456',data:'AQ==',[field]:field==='stamp'?'changed':field==='data'?'':0}});await assert.rejects(f.file.getFile(),{code:'DESKTOP_READ_FALLBACK_FAILED'});assert.equal(f.host.pending,0);
});
test('cancelling a stalled native part settles immediately and starts no further reads',async()=>{
 const f=await fixture({part:()=>null}),controller=new AbortController();const reading=f.file.getFile({signal:controller.signal});const rejected=assert.rejects(reading,{name:'AbortError'});await new Promise(r=>setImmediate(r));controller.abort();await rejected;assert.equal(f.host.pending,0);assert.equal(f.calls.filter(x=>x.op==='readPart').length,1);
});
test('cancelled ordinary streams never activate the fallback',async()=>{
 const controller=new AbortController(),f=await fixture({fetch:async()=>{controller.abort();throw new TypeError('Failed to fetch');}});await assert.rejects(f.file.getFile({signal:controller.signal}),{name:'AbortError'});assert(!f.calls.some(x=>x.op==='readPart'));assert.equal(f.host.pending,0);
});

test('WebView2 stream COM failure reported through JSON also activates the read fallback',async()=>{
 const f=await fixture({fetch:async()=>new Response(JSON.stringify({name:'NetworkError',message:'stream unavailable'}),{status:400})});assert.equal((await f.file.getFile()).size,f.bytes.length);assert.equal(f.calls.filter(x=>x.op==='readPart').length,3);
});
