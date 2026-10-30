import {chromium,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const html=await readFile('offline-release/GAME-PORTAL.html'),server=createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined,headless:true});
const expectBug=process.argv.includes('--expect-bug');
try{
 for(const path of ['/ascii/launcher.html','/日本語と空白 folder/launcher.html']){
   const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+server.address().port+path);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
   page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
   await page.evaluate(async simple=>{
     const encode=s=>new TextEncoder().encode(s);
     const game=simple?'<body><script>fetch("game.wasm").then(r=>r.arrayBuffer()).then(()=>document.body.dataset.loaded="yes").catch(e=>document.body.dataset.failure=e.message);</script>':
       '<body><script src="script%20name.js"></script><script>Promise.all([fetch("game.wasm").then(r=>r.arrayBuffer()),fetch("素材%20data.bin").then(r=>r.text()),fetch("100%.dat").then(r=>r.text()),fetch("https://example.invalid/blocked").then(()=>"allowed",()=>"blocked")]).then(async values=>{document.body.dataset.loaded="yes";document.body.dataset.size=values[0].byteLength;document.body.dataset.unicode=values[1];document.body.dataset.percent=values[2];document.body.dataset.network=values[3];if(typeof AudioContext!=="undefined"){const audio=new AudioContext();if(audio.audioWorklet){await audio.audioWorklet.addModule("worklet%20file.js");document.body.dataset.worklet="yes";}await audio.close();}}).catch(e=>document.body.dataset.failure=e.message);</script>';
     let files=new Map([['index.html',encode(game)],['game.wasm',new Uint8Array([0,97,115,109])],['素材 data.bin',encode('unicode')],['100%.dat',encode('percent')],['script name.js',encode('document.body.dataset.staticResource="yes";')],['worklet file.js',encode('class Quiet extends AudioWorkletProcessor{process(){return true;}}registerProcessor("quiet",Quiet);')]]);
     if(!simple&&decodeURIComponent(location.pathname).includes('日本語')){
       const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('file-backed-resources',{create:true});
       for(const [name,bytes] of files)await library.writeFile(dir,name,bytes);
       files=await library.readTree(dir,new Map([['index.html',files.get('index.html')]]),{fileBacked:true});
       if(!(files.get('game.wasm') instanceof File))throw new Error('WASM should remain file-backed');
     }
     // Two names share a buffer, as with a renamed HTML or stored ZIP entry.
     files.set('same-wasm.bin',files.get('game.wasm'));
     window.resourceTestFiles=files;
     document.querySelector('#player').showModal();window.resourceTestStop=player.startPlayer(document.querySelector('#frame'),{kind:'html',files,saved:{}},preview,()=>{});
   },expectBug);
   const body=page.frameLocator('#frame').locator('body');
   if(!expectBug){
     const xhrResult=await body.evaluate(async()=>{
       const read=(url,type='text')=>new Promise(resolve=>{
         const xhr=new XMLHttpRequest();
         xhr.onload=()=>resolve({ok:true,status:xhr.status,value:type==='arraybuffer'?[...new Uint8Array(xhr.response)]:xhr.responseText});
         xhr.onerror=()=>resolve({ok:false});
         try{xhr.open('GET',url,true);xhr.responseType=type;xhr.send();}catch{resolve({ok:false});}
       });
       const sync=new XMLHttpRequest();sync.open('GET',new String('素材%20data.bin?cache=2'),false);sync.send();
       const aborted=await new Promise(resolve=>{const xhr=new XMLHttpRequest();xhr.onabort=()=>resolve(true);xhr.onload=()=>resolve(false);xhr.open('GET','game.wasm');xhr.send();xhr.abort();});
       return {binary:await read('game.wasm?version=2','arraybuffer'),unicode:await read('素材%20data.bin'),inline:await read('data:text/plain,inline'),sync:sync.responseText,aborted,missing:await read('missing.bin'),external:await read('https://example.invalid/blocked')};
     });
     assert.deepEqual(xhrResult,{binary:{ok:true,status:200,value:[0,97,115,109]},unicode:{ok:true,status:200,value:'unicode'},inline:{ok:true,status:200,value:'inline'},sync:'unicode',aborted:true,missing:{ok:false},external:{ok:false}},'XMLHttpRequest must resolve bundled resources without enabling external requests');
   }
   assert.equal(await body.evaluate(()=> 'serviceWorker' in navigator),false,'opaque game capability probes must not expose unavailable service workers');
   assert.equal(await body.evaluate(()=>{try{void parent.document;return false;}catch{return true;}}),true,'game stays isolated from launcher');
   if(expectBug&&path.includes('日本語')){await expect(body).toHaveAttribute('data-failure','Game resource unavailable');console.log('Reproduced resource failure under a URL with Japanese/space directory names.');}
   else{
     await expect(body).toHaveAttribute('data-loaded','yes');
     if(!expectBug){await expect(body).toHaveAttribute('data-static-resource','yes');await expect(body).toHaveAttribute('data-unicode','unicode');await expect(body).toHaveAttribute('data-percent','percent');await expect(body).toHaveAttribute('data-network','blocked');await expect(body).toHaveAttribute('data-size','4');await expect(body).toHaveAttribute('data-worklet','yes');}
   }
   assert.equal(await page.evaluate(()=>{const file=window.resourceTestFiles.get('game.wasm');return file instanceof File?file.size===4:file.byteLength===0;}),true,'assets retain file backing or transfer their buffers');
   assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);await page.close();
 }
 if(!expectBug){
   const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await expect(page.locator('html')).toHaveAttribute('data-ready','true',{timeout:15000});
   const failure=await page.evaluate(()=>{
     const random=crypto.randomUUID,post=window.postMessage,nonce='resource-transfer-failure';let result;
     let stop;
     try{
       crypto.randomUUID=()=>nonce;
       stop=player.startPlayer({contentWindow:window,srcdoc:''},{kind:'html',files:new Map([['index.html',new Uint8Array([1])]])},preview,message=>result=message);
       window.postMessage=()=>{throw new DOMException('Simulated unreadable file','DataCloneError');};
       window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'offline-bootstrap-ready',nonce}}));
       return result;
     }finally{crypto.randomUUID=random;window.postMessage=post;stop?.();}
   });assert.equal(failure.type,'error');assert.match(failure.message,/起動を再試行/);await page.close();
   console.log('Resource paths passed: byte transfers and file-backed resources, ASCII/Unicode paths, scripts, WASM, XMLHttpRequest, AudioWorklet, external-network rejection and transfer failure guidance.');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
