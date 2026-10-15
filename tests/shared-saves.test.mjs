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
