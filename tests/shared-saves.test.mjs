import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncSave,saveText,saveHeads} from '../offline-html/shared-saves.js';
import {validSave} from '../offline-html/local-state.js';
const libraryId='a'.repeat(32),gameId='b'.repeat(32);
function folder(){
  const files=new Map(),dirs=new Map();
  return {files,dirs,queryPermission:async()=> 'granted',async getDirectoryHandle(name,{create=false}={}){if(!dirs.has(name)){if(!create)throw new DOMException('Missing','NotFoundError');dirs.set(name,folder());}return dirs.get(name);},async getFileHandle(name){if(!files.has(name))throw new DOMException('Missing','NotFoundError');return {name,kind:'file',getFile:async()=>new File([files.get(name)],name)};},async removeEntry(name){files.delete(name);},async *values(){for(const name of files.keys())yield await this.getFileHandle(name);}};
}
function client(device='1'.repeat(32),data={}){
  let current={data,state:{schema:1,base:null,clock:{},pending:null}};const backups=[];
  return {validSave,backups,loadSaveSync:async()=>structuredClone(current),saveDeviceId:async()=>device,
    async commitSaveSync(l,g,expected,state,data=expected.data){assert.deepEqual(current,expected);if(saveText(data)!==saveText(current.data))backups.push(current.data);current=structuredClone({data,state});},
    edit(data){current.data=structuredClone(data);},peek:()=>structuredClone(current)};
}
function fixture(){const root=folder();let actualId=libraryId,hook=null;const tools={loadLibraryId:async()=>actualId,writeFile:async(dir,name,text)=>{await hook?.(dir,name,text);dir.files.set(name,text);}};return {root,tools,setId:value=>actualId=value,setHook:value=>hook=value,run:(local,options)=>syncSave(root,libraryId,gameId,tools,local,options),dir:()=>root.dirs.get('.gameportal')?.dirs.get('shared-saves')?.dirs.get(gameId)};}
test('shared saves move between independent PCs, preserve local backup and retain concurrent progress',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{level:'1'}),b=client('2'.repeat(32));
  assert.equal((await f.run(a)).state,'uploaded');assert.equal((await f.run(b)).state,'downloaded');assert.deepEqual(b.peek().data,{level:'1'});
  a.edit({level:'2'});await f.run(a);await f.run(b);assert.deepEqual(b.peek().data,{level:'2'});assert.deepEqual(b.backups.at(-1),{level:'1'});
  a.edit({level:'A'});b.edit({level:'B'});await f.run(a);const conflict=await f.run(b);assert.equal(conflict.state,'conflict');assert.deepEqual(b.peek().data,{level:'B'});
  await f.run(b,{resolution:{revision:'local',fingerprint:conflict.fingerprint}});await f.run(a);assert.deepEqual(a.peek().data,{level:'B'});assert.deepEqual(a.backups.at(-1),{level:'A'});
});
test('initial different saves require a choice, and stale choices do not overwrite newer shared progress',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'A'}),b=client('2'.repeat(32),{v:'B'});await f.run(a);const conflict=await f.run(b);assert.equal(conflict.state,'conflict');
  a.edit({v:'C'});await f.run(a);await assert.rejects(f.run(b,{resolution:{revision:'local',fingerprint:conflict.fingerprint}}),/変わりました/);assert.deepEqual(b.peek().data,{v:'B'});
  const next=await f.run(b);await f.run(b,{resolution:{revision:next.heads[0].revision,fingerprint:next.fingerprint}});assert.deepEqual(b.peek().data,{v:'C'});assert.deepEqual(b.backups.at(-1),{v:'B'});
});
test('concurrent publications create separate files and conflict without data loss or clock-based winner',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'base'}),b=client('2'.repeat(32));await f.run(a);await f.run(b);a.edit({v:'A'});b.edit({v:'B'});
  let entered=0,release;const gate=new Promise(r=>release=r);f.setHook(async()=>{if(++entered===2)release();await gate;});await Promise.all([f.run(a),f.run(b)]);f.setHook(null);
  assert.equal(f.dir().files.size,3);assert.equal((await f.run(a)).state,'conflict');assert.equal((await f.run(b)).state,'conflict');assert.deepEqual(a.peek().data,{v:'A'});assert.deepEqual(b.peek().data,{v:'B'});
  const heads=saveHeads([...f.dir().files.values()].map(JSON.parse));assert.equal(heads.length,2);
});
test('uncertain shared close persists one intent and verifies the same file on retry',async()=>{
  for(const committed of [false,true]){
    const f=fixture(),a=client('1'.repeat(32),{v:'keep'});f.setHook(async(dir,name,text)=>{if(committed)dir.files.set(name,text);throw new DOMException('Disconnected','NetworkError');});
    await assert.rejects(f.run(a),/共有結果/);const revision=a.peek().state.pending.revision;assert.deepEqual(a.peek().data,{v:'keep'});f.setHook(null);await f.run(a);assert.equal(a.peek().state.pending,null);assert(f.dir().files.has(revision+'.json'));assert.equal(f.dir().files.size,1);
  }
});
test('identity changes, corruption, permissions and cancellation never replace the local save',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'keep'});f.setId('c'.repeat(32));await assert.rejects(f.run(a),/ID/);assert.equal(f.dir(),undefined);f.setId(libraryId);
  f.root.queryPermission=async()=> 'prompt';await assert.rejects(f.run(a),/許可/);assert.deepEqual(a.peek().data,{v:'keep'});f.root.queryPermission=async()=> 'granted';await f.run(a);
  const [name]=f.dir().files.keys(),original=f.dir().files.get(name);f.dir().files.set(name,'{broken');await assert.rejects(f.run(a),/壊れ/);assert.deepEqual(a.peek().data,{v:'keep'});f.dir().files.set(name,original);
  const controller=new AbortController();controller.abort();await assert.rejects(f.run(a,{signal:controller.signal}),e=>e.name==='AbortError');
});
test('empty/unchanged and play-time pull checks never write; snapshot retention stays bounded',async()=>{
  const f=fixture(),a=client('1'.repeat(32));assert.equal((await f.run(a)).state,'unchanged');assert.equal(f.dir(),undefined);
  a.edit({v:'local'});assert.equal((await f.run(a,{pullOnly:true})).state,'local');assert.equal(f.dir(),undefined);
  for(let i=0;i<40;i++){a.edit({v:String(i)});await f.run(a);}assert(f.dir().files.size<=12);const b=client('2'.repeat(32));await f.run(b);assert.deepEqual(b.peek().data,{v:'39'});
});
test('a rolled-back or deleted shared folder cannot replace newer local progress or reset its clock',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'1'});await f.run(a);const original=[...f.dir().files];a.edit({v:'2'});await f.run(a);
  f.dir().files.clear();for(const [name,text]of original)f.dir().files.set(name,text);
  let conflict=await f.run(a,{pullOnly:true});assert.equal(conflict.state,'conflict');assert.deepEqual(a.peek().data,{v:'2'});
  f.dir().files.clear();conflict=await f.run(a);assert.equal(conflict.state,'conflict');await f.run(a,{resolution:{revision:'local',fingerprint:conflict.fingerprint}});
  assert.equal(a.peek().state.clock['1'.repeat(32)],3);assert.deepEqual(a.peek().data,{v:'2'});
});
test('conflict choices detect externally changed contents even when the snapshot filename is unchanged',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'A'}),b=client('2'.repeat(32),{v:'B'});await f.run(a);const conflict=await f.run(b),[name]=f.dir().files.keys(),record=JSON.parse(f.dir().files.get(name));record.data={v:'externally changed'};f.dir().files.set(name,JSON.stringify(record));
  await assert.rejects(f.run(b,{resolution:{revision:record.revision,fingerprint:conflict.fingerprint}}),/変わりました/);assert.deepEqual(b.peek().data,{v:'B'});
});

test('canceling stalled shared-save reads settles before the disk responds and never imports late data',async()=>{
  for(const stage of ['identity','directory','enumeration','file','text']){
    const f=fixture(),a=client('1'.repeat(32),{v:'remote'}),b=client('2'.repeat(32));await f.run(a);
    let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
    const stall=async()=>{entered();await gate;};
    if(stage==='identity'){const original=f.tools.loadLibraryId;f.tools.loadLibraryId=async()=>{await stall();return original();};}
    else if(stage==='directory'){const original=f.root.getDirectoryHandle;f.root.getDirectoryHandle=async function(...args){await stall();return original.apply(this,args);};}
    else{const dir=f.dir(),original=dir.values;dir.values=async function*(){if(stage==='enumeration')await stall();for await(const entry of original.call(this)){const get=entry.getFile;entry.getFile=async()=>{if(stage==='file')await stall();const file=await get();if(stage==='text')file.text=async()=>{await stall();return f.dir().files.get(entry.name);};return file;};yield entry;}};}
    const controller=new AbortController(),work=f.run(b,{signal:controller.signal}),settled=work.then(()=>false,error=>error.name==='AbortError');await started;controller.abort();
    const canceled=await Promise.race([settled,new Promise(resolve=>setTimeout(()=>resolve(false),100))]);release();await settled;assert.equal(canceled,true,stage+' read must stop waiting');assert.deepEqual(b.peek().data,{});assert.deepEqual(b.backups,[]);
  }
});

test('cancellation drains a publication already started but prevents a new intent after device lookup',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{v:'keep'});let release,entered;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);f.setHook(async()=>{entered();await gate;});
  const controller=new AbortController(),work=f.run(a,{signal:controller.signal}),settled=work.then(()=>true,()=>true);await started;controller.abort();
  assert.equal(await Promise.race([settled,new Promise(resolve=>setTimeout(()=>resolve(false),100))]),false,'in-flight publication must keep waiting for confirmation');
  release();await work;assert.equal(a.peek().state.pending,null);assert.deepEqual(a.peek().data,{v:'keep'});assert.equal(f.dir().files.size,1);
  const other=fixture(),b=client('2'.repeat(32),{v:'local'}),abort=new AbortController();b.saveDeviceId=async()=>{abort.abort();return '2'.repeat(32);};await assert.rejects(other.run(b,{signal:abort.signal}),error=>error.name==='AbortError');assert.equal(b.peek().state.pending,null);assert.equal(other.dir(),undefined);
});

test('OS metadata in a shared-save folder cannot block play or sync and is never read or removed',async()=>{
  const f=fixture(),a=client('1'.repeat(32),{level:'1'}),b=client('2'.repeat(32));await f.run(a);
  const dir=f.dir(),snapshot=[...dir.files.keys()][0],metadata=['.DS_Store','Thumbs.db','desktop.ini','._'+snapshot];
  for(const name of metadata)dir.files.set(name,'OS metadata, not JSON');
  const get=dir.getFileHandle;dir.getFileHandle=async function(name,...args){const handle=await get.call(this,name,...args);if(metadata.includes(name))handle.getFile=async()=>{throw Error('Metadata must not be opened');};return handle;};
  assert.equal((await f.run(b,{pullOnly:true})).state,'downloaded');assert.deepEqual(b.peek().data,{level:'1'});
  b.edit({level:'2'});assert.equal((await f.run(b)).state,'uploaded');await f.run(a);assert.deepEqual(a.peek().data,{level:'2'});
  for(const name of metadata)assert.equal(dir.files.get(name),'OS metadata, not JSON');
  for(const name of ['notes.json','unknown.tmp','._notes.json']){dir.files.set(name,'keep');await assert.rejects(f.run(a),/不明なファイル/);assert.equal(dir.files.get(name),'keep');dir.files.delete(name);}
  const values=dir.values;dir.values=async function*(){yield {name:'.DS_Store',kind:'directory'};yield* values.call(this);};await assert.rejects(f.run(a),/不明なファイル/);dir.values=values;
  dir.files.set(snapshot,'{broken');await assert.rejects(f.run(a),/壊れて/);assert.deepEqual(a.peek().data,{level:'2'});
});

test('NAS thumbnail directory is ignored without traversal while unknown directories remain errors',async()=>{
 const f=fixture(),a=client('1'.repeat(32),{level:'keep'}),b=client('2'.repeat(32));await f.run(a);const dir=f.dir(),values=dir.values;
 let name='@eaDir';dir.values=async function*(){yield {name,kind:'directory',values(){throw Error('Must not traverse NAS metadata');}};yield* values.call(this);};
 assert.equal((await f.run(b,{pullOnly:true})).state,'downloaded');assert.deepEqual(b.peek().data,{level:'keep'});
 b.edit({level:'next'});assert.equal((await f.run(b)).state,'uploaded');await f.run(a);assert.deepEqual(a.peek().data,{level:'next'});
 for(name of ['unknown','@eaDir-backup','.DS_Store'])await assert.rejects(f.run(a),/不明なファイル/);
 name='@eaDir';const snapshot=[...dir.files.keys()][0];dir.files.set(snapshot,'{broken');await assert.rejects(f.run(a),/壊れて/);
});
