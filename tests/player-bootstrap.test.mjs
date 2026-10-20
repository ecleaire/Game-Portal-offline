import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {startPlayer} from '../offline-html/player.js';

// Execute the actual serialized sandbox bootstrap. Announcing while srcdoc is
// still loading lets document.open race the initial navigation in Chromium.
for(const kind of ['html','pyxapp'])for(const initialState of ['loading','complete'])test(kind+' bootstrap announces only after its initial document load ('+initialState+')',()=>{
 const originalWindow=globalThis.window;
 globalThis.window={addEventListener(){},removeEventListener(){}};
 let stop;
 try{
  const frame={contentWindow:{postMessage(){}},srcdoc:''};
  stop=startPlayer(frame,{kind},{privatePreviewDocument:()=>''},()=>{});
  const script=frame.srcdoc.slice(frame.srcdoc.indexOf('<script>')+8,frame.srcdoc.lastIndexOf('</script>'));
  const messages=[],listeners=new Map(),document={readyState:initialState};
  runInNewContext(script,{TextDecoder,window:{},document,parent:{postMessage(message){messages.push(message);}},addEventListener(type,callback,options){listeners.set(type,{callback,options});}});
  if(initialState==='loading'){
   assert.equal(messages.length,0,'must not replace a document whose initial navigation is unfinished');
   const loaded=listeners.get('load');assert(loaded);assert.equal(loaded.options.once,true);
   document.readyState='complete';loaded.callback();
  }
  assert.equal(messages.length,1);assert.equal(messages[0].type,'offline-bootstrap-ready');assert.match(messages[0].nonce,/^[a-f0-9-]{36}$/);
 }finally{stop?.();if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
});
