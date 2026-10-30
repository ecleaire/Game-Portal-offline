import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWithSignal,prepareTogether} from '../offline-html/read-task.js';
import {readTree,scan} from '../offline-html/library.js';

test('cancelled reads reject immediately and consume late success or failure',async()=>{
 for(const fail of [false,true]){
  const controller=new AbortController();let finish;const pending=readWithSignal(()=>new Promise((resolve,reject)=>finish=()=>fail?reject(Error('late failure')):resolve('late bytes')),controller.signal);
  await Promise.resolve();controller.abort();await assert.rejects(pending,{name:'AbortError'});finish();await new Promise(resolve=>setImmediate(resolve));
 }
 const controller=new AbortController();controller.abort();let reads=0;await assert.rejects(readWithSignal(()=>reads++,controller.signal),{name:'AbortError'});assert.equal(reads,0);
});

test('cancelling a resource tree stops waiting and prevents queued file reads',async()=>{
 const controller=new AbortController(),late=[];let reads=0;
 const root={async *values(){for(let n=0;n<12;n++)yield {kind:'file',name:n+'.css',getFile:()=>{reads++;return new Promise(resolve=>late.push(()=>resolve(new File(['body{}'],n+'.css'))));}};}};
 const pending=readTree(root,new Map(),{signal:controller.signal});
 while(reads<4)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(reads,4);late.forEach(finish=>finish());await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,4);
});

test('startup preparations overlap and preserve the order of independent results',async()=>{
 let active=0,maximum=0;const releases=[];
 const task=value=>async()=>{maximum=Math.max(maximum,++active);await new Promise(resolve=>releases.push(resolve));active--;return value;};
 const work=prepareTogether([task('files'),task('save')]);while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));assert.equal(maximum,2);releases.reverse().forEach(release=>release());assert.deepEqual(await work,['files','save']);
});

test('startup failure cancels reads but drains an already started save before releasing',async()=>{
 let fail,finish,settled=false;const expected=Error('bad game');
 const work=prepareTogether([()=>new Promise((resolve,reject)=>fail=()=>reject(expected)),()=>new Promise(resolve=>finish=()=>resolve('saved'))]);work.catch(()=>{}).finally(()=>settled=true);
 while(!finish)await new Promise(resolve=>setImmediate(resolve));fail();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);finish();await assert.rejects(work,error=>error===expected);
 const controller=new AbortController();controller.abort();let started=0;await assert.rejects(prepareTogether([()=>started++],controller.signal),{name:'AbortError'});assert.equal(started,0);
});


test('cancelled library scans release stalled enumeration and ignore late results',{timeout:2000},async()=>{
 for(const failure of [false,true]){
  const controller=new AbortController();let release,reads=0;
  const root={getFileHandle:async()=>{throw new DOMException('Missing','NotFoundError');},async *values(){await new Promise((resolve,reject)=>release=()=>failure?reject(Error('Late NAS failure')):resolve());yield {kind:'file',name:'game.html'};reads++;}};
  const pending=scan(root,{games:{}},{signal:controller.signal});
  while(!release)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,{name:'AbortError'});
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);
 }
});

test('cancelled library scans release all metadata workers without starting queued games',{timeout:2000},async()=>{
 for(const failure of [false,true]){
  const controller=new AbortController(),releases=[];let reads=0;
  const root={getFileHandle:async name=>{if(name==='.gameportal-uploading')throw new DOMException('Missing','NotFoundError');reads++;return new Promise((resolve,reject)=>releases.push(()=>failure?reject(Error('Late settings failure')):resolve({getFile:async()=>new File(['{}'],'settings.json')})));},async *values(){for(let i=0;i<12;i++)yield {kind:'file',name:'game'+i+'.html'};}};
  const pending=scan(root,{games:{}},{signal:controller.signal});
  while(reads<4)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(reads,4);
  releases.forEach(release=>release());await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,4);
 }
});
