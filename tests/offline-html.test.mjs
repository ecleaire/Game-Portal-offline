import {connectionInfo,portableLauncher} from '../offline-html/folder-sharing.js';
import {measureLibraryUsage} from '../offline-html/usage.js';
import * as contentStorage from '../offline-html/updates.js';
import {checkCompatibility,ensureCompatibility,LAUNCHER_VERSION} from '../offline-html/compatibility.js';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, tagsFrom, gameId, validatePyxapp, embeddedPyxel, loadMetadata, saveMetadata, loadGameSettings, saveGameSettings, scan, readTree, postGame, loadLibraryId, ensureLibraryId } from '../offline-html/library.js';
import { validSave, validSaveBackups } from '../offline-html/local-state.js';
import { libraryViewKey } from '../offline-html/sync.js';
import { replaceGameContent,restoreGameContent,verifyContentUpdate } from '../offline-html/updates.js';

test('shared library comparison ignores fresh handles but detects settings and identity errors',()=>{
  const game={path:'a.html',id:'one',title:'A',tags:['tag'],settingsText:null,handle:{},folder:{}};
  assert.equal(libraryViewKey([game]),libraryViewKey([{...game,handle:{new:true},folder:{new:true}}]));
  for(const change of [{title:'B'},{tags:['other']},{settingsText:'changed'},{settingsError:'duplicate ID'},{thumbnail:'image'},{description:'overview'}])assert.notEqual(libraryViewKey([game]),libraryViewKey([{...game,...change}]));
  assert.notEqual(libraryViewKey([game]),libraryViewKey([]));
});
import { packageWebFiles } from '../assets/zip-upload.js';
import { unpackPrivateZip } from '../assets/private-preview.js';
import * as library from '../offline-html/library.js';
import { inspectLibrary, localResources, loadSettingsHistory, restoreSettingsHistory } from '../offline-html/maintenance.js';
import * as preview from '../assets/private-preview.js';
import {searchGames} from '../offline-html/search.js';
import {checkUpload,cropRect} from '../offline-html/improvements.js';
import {analyzeDependencies,inspectUploadDependencies} from '../offline-html/dependencies.js';

test('upload preflight detects missing static/Godot resources and malformed archives without a destination or writes',async()=>{
  const file=(name,text)=>new File([text],name,{type:'text/html'});
  await assert.rejects(checkUpload([file('game.html','<script src="game.js"></script>')],library,preview,localResources),/game.js/);
  await assert.rejects(checkUpload([file('game.html','const GODOT_CONFIG = {"fileSizes":{"game.wasm":10}};')],library,preview,localResources),/game.wasm/);
  await assert.rejects(checkUpload([file('broken.zip','invalid')],library,preview,localResources),/ZIPを読み取れません/);
  const zip=await packageWebFiles([file('release/index.html','<script src="game.js"></script>'),new File(['x'],'release/game.js')]);
  const result=await checkUpload([new File([zip],'game.zip')],library,preview,localResources);assert.equal(result.entry,'index.html');assert.deepEqual(result.missing,[]);
  const folder=[file('index.html','<img src="picture.png">'),new File(['pixels'],'picture.png')];for(const f of folder)Object.defineProperty(f,'webkitRelativePath',{value:'release/'+f.name});
  assert.equal((await checkUpload(folder,library,preview,localResources)).entry,'index.html');
  await assert.rejects(checkUpload([{name:'big.zip',size:51*1024*1024}],library,preview,localResources),/50MB/);
  await assert.rejects(checkUpload([file('A.html','a'),file('a.html','b')],library,preview,localResources),/同じ名前/);
});
test('oversized single-file uploads fail before buffering or creating destination files',async()=>{
  for(const name of ['large.html','large.zip','large.pyxapp']){
    const memory=memoryFolder();let reads=0;
    await assert.rejects(postGame(memory.root,[{name,size:51*1024*1024,arrayBuffer:async()=>{reads++;throw Error('must not buffer');}}],preview),/50MB/);
    assert.equal(reads,0);assert.equal(memory.files.size,0);assert.equal(memory.folders.size,0);
  }
});

test('image crop stays inside the source for wide/tall images, endpoints and zoom',()=>{
  for(const [w,h]of [[1200,300],[300,1200],[960,540]])for(const z of [1,2,3])for(const p of [0,50,100]){
    const r=cropRect(w,h,z,p,p);assert(r.x>=0&&r.y>=0&&r.x+r.width<=w+1e-8&&r.y+r.height<=h+1e-8);assert(Math.abs(r.width/r.height-16/9)<1e-8);
  }
  assert.equal(cropRect(1200,540,1,0,50).x,0);assert.equal(cropRect(1200,540,1,100,50).x,240);
});

test('folder uploads reject portal records and conflicting paths before reading or writing',async()=>{
  const selections=[
    ['release/index.html','release/.gameportal-content.json'],
    ['release/index.html','release/index.html.gameportal.json'],
    ['release/index.html','release/.gameportal-versions/old/data'],
    ['release/index.html','release/assets','release/assets/data.bin'],
    ['release/index.html','release/Assets/a.bin','release/assets/b.bin'],
    ['release/index.html','release/IMAGE.png','release/image.png'],
    ['first/index.html','second/data.bin'],
    ['release/index.html','loose.bin']
  ];
  for(const paths of selections){
    let reads=0;const files=paths.map(path=>{const f=new File(['<h1>Game</h1>'],path.split('/').at(-1));if(path.includes('/'))Object.defineProperty(f,'webkitRelativePath',{value:path});f.arrayBuffer=async()=>{reads++;throw Error('must not read');};return f;});
    await assert.rejects(checkUpload(files,library,preview,localResources),/保存先|管理用|同じ名前|フォルダー/);
    const m=memoryFolder();await assert.rejects(postGame(m.root,files,preview),/保存先|管理用|同じ名前|フォルダー/);
    assert.equal(reads,0);assert.equal(m.folders.size,0);assert.equal(m.files.size,0);
  }
  const m=await postedFixture(),files=['index.html','.gameportal-content.json'].map(name=>{const f=new File(['{}'],name);Object.defineProperty(f,'webkitRelativePath',{value:'release/'+name});return f;});
  await assert.rejects(replaceGameContent(m.root,m.game,files,m.id,library,preview,updateCheck),/管理用/);
  assert.equal(m.owner.folders.has('.gameportal-versions'),false);assert.equal(m.owner.files.has('.gameportal-content.json'),false);
});

test('game folder traversal bounds empty directories and depth before reading game bytes',async()=>{
  let visited=0,reads=0;
  const empty={name:'empty',kind:'directory',async *values(){}};
  const many={async *values(){for(let i=0;i<10001;i++){visited++;yield {...empty,name:'d'+i};}yield {name:'index.html',kind:'file',getFile:async()=>{reads++;return new File(['game'],'index.html');}};}};
  await assert.rejects(readTree(many),/フォルダー|項目/);assert.equal(visited,10001);assert.equal(reads,0);
  const deep=depth=>({name:'d',kind:'directory',async *values(){if(depth)yield deep(depth-1);else yield {name:'index.html',kind:'file',getFile:async()=>{reads++;return new File(['game'],'index.html');}};}});
  await assert.rejects(readTree(deep(21)),/階層/);assert.equal(reads,0);
  assert.equal(new TextDecoder().decode((await readTree(deep(20))).get('d/'.repeat(20)+'index.html')),'game');
});

test('portable paths reject traversal, alternate streams and Windows aliases', () => {
  for(const path of ['../secret','/secret','x/../secret','C:/secret','x\\y','a:stream','con.txt','x/COM1','x.','x ','a//b','a/\u0000b']) assert.throws(()=>safePath(path));
  assert.deepEqual(safePath('日本語ゲーム/assets/my-file.png'),['日本語ゲーム','assets','my-file.png']);
});

test('search combines scope, format, environment and AND/OR tags without mutating the library', () => {
  const games=[{path:'a',title:'Ａlpha',kind:'html',tags:['action','solo'],developmentEnvironment:'Godot',description:'blue sky',instructions:'Space jump',updatedAt:'2026-10-14T00:00:00Z'},{path:'b',title:'Beta',kind:'zip',tags:['action'],developmentEnvironment:'Scratch',description:'blue ocean',instructions:'mouse',updatedAt:'2026-10-15T00:00:00Z'},{path:'c',title:'Gamma',kind:'pyxapp',tags:['solo'],developmentEnvironment:'Pyxel',description:'green forest',instructions:'Space',updatedAt:''}];
  const names=o=>searchGames(games,o).map(g=>g.title);
  assert.deepEqual(names({query:'alpha GODOT'}),['Ａlpha']);assert.deepEqual(names({query:'Space',scope:'description'}),['Ａlpha','Gamma']);
  assert.deepEqual(names({query:'blue',scope:'title'}),[]);
  assert.deepEqual(names({kind:'zip',environment:'Scratch',query:'blue'}),['Beta']);
  assert.deepEqual(names({tags:['action','solo']}),['Ａlpha']);assert.equal(names({tags:['action','solo'],tagMatch:'any'}).length,3);
  assert.deepEqual(names({sort:'updated'}),['Beta','Ａlpha','Gamma']);assert.deepEqual(names({sort:'name-desc'}),['Gamma','Beta','Ａlpha']);
  assert.deepEqual(games.map(g=>g.path),['a','b','c']);
});
test('relative game IDs survive root relocation and tags are bounded and deduplicated', async () => {
  assert.equal(await gameId('game/main.html'),await gameId('game/main.html'));
  assert.notEqual(await gameId('game/main.html'),await gameId('other/main.html'));
  assert.deepEqual(tagsFrom(' action, パズル、action\nお気に入り '),['action','パズル','お気に入り']);
  assert.equal(tagsFrom(Array.from({length:20},(_,i)=>String(i)).join(',')).length,12);
  assert.equal(tagsFrom('a'.repeat(100))[0].length,32);
});
test('PYXAPP requires valid bounded ZIP directory and Pyxel startup marker', async () => {
  const app=await packageWebFiles([new File(['main.py'],'app/.pyxapp_startup_script'),new File(['import pyxel'],'app/main.py')]);
  const buffer=await app.arrayBuffer(); assert.doesNotThrow(()=>validatePyxapp(buffer));
  assert.throws(()=>validatePyxapp(new Uint8Array(20)));
  const noMarker=await packageWebFiles([new File(['x'],'app/main.py')]);const noMarkerBytes=await noMarker.arrayBuffer();assert.throws(()=>validatePyxapp(noMarkerBytes));
  const encrypted=new Uint8Array(buffer.slice(0)), view=new DataView(encrypted.buffer);
  for(let at=0;at<encrypted.length-46;at++)if(view.getUint32(at,true)===0x02014b50){view.setUint16(at+8,1,true);break;}
  assert.throws(()=>validatePyxapp(encrypted));
  assert.equal(embeddedPyxel('<script src="https://cdn.example/pyxel.js"></script><script>launchPyxel({base64:"YWJjZA=="})</script>'),'YWJjZA==');
  assert.equal(embeddedPyxel('<script>evil({base64:"YWJjZA=="})</script>'),null);
});
test('metadata version and stale revision errors preserve existing files', async () => {
  let text=JSON.stringify({schema:1,revision:'new',games:{}}), writes=0;
  const root={getDirectoryHandle:async()=>root,getFileHandle:async()=>({getFile:async()=>new File([text],'library.json'),createWritable:async()=>({write:async v=>{writes++;text=v;},close:async()=>{},abort:async()=>{}})})};
  await assert.rejects(saveMetadata(root,{schema:1,revision:'old',games:{}}),/更新/);assert.equal(writes,0);
  text=JSON.stringify({schema:2,revision:'new',games:{}});await assert.rejects(loadMetadata(root));assert.equal(writes,0);
  text='{invalid';await assert.rejects(loadMetadata(root));assert.equal(writes,0);
});

function memoryFolder(hooks = {}) {
  const files = new Map(), folders = new Map(), locks = new Set();
  const root = { name: 'games', kind: 'directory',
    getDirectoryHandle: async (name, options) => {
      if (!folders.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!folders.has(name)) { const child = memoryFolder(hooks); child.root.name = name; folders.set(name, child); }
      return folders.get(name).root;
    },
    removeEntry: async name => {await hooks.remove?.(name);files.delete(name);folders.delete(name);},
    getFileHandle: async (name, options) => {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!files.has(name) && options?.create) files.set(name, '');
      return { name, kind: 'file', getFile: async () => {await hooks.read?.(name,files);return new File([files.get(name)], name);}, createWritable: async options => {
        if (locks.has(name)) throw new DOMException('Locked','NoModificationAllowedError');
        if (options?.mode === 'exclusive') locks.add(name);
        await hooks.open?.(name, options, files);
        let pending; return { write: async value => { await hooks.write?.(name, value); pending = value; },
          close: async () => { await hooks.close?.(name,pending,files); files.set(name, pending); locks.delete(name); }, abort: async () => { locks.delete(name); } };
      }};
    }, async *values() { for (const name of files.keys()) yield await root.getFileHandle(name); for (const child of folders.values()) yield child.root; }
  };
  return { root, files, folders };
}

test('unconfirmed readback uses its exact history to classify confirmed, unchanged and changed without writes',async()=>{
  let arm=false,unreadable=false,writes=0;
  const m=memoryFolder({write:async()=>writes++,close:async name=>{if(arm&&name==='one.html.gameportal.json')unreadable=true;},read:async name=>{if(unreadable&&name==='one.html.gameportal.json')throw new DOMException('Disconnected during verification','NetworkError');}});
  m.files.set('one.html','game');let [game]=await scan(m.root,{games:{}});const values={title:'Initial',tags:[],developmentEnvironment:'',thumbnail:null};await saveGameSettings(m.root,game,values);[game]=await scan(m.root,{games:{}});const before=m.files.get('one.html.gameportal.json');arm=true;
  let error;try{await saveGameSettings(m.root,game,{...values,title:'Committed'});}catch(e){error=e;}assert.equal(error.code,'SETTINGS_SAVE_UNCONFIRMED');assert.match(error.message,/再保存せず/);unreadable=false;arm=false;const committed=m.files.get('one.html.gameportal.json'),count=writes;
  assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,'confirmed');m.files.set('one.html.gameportal.json',before);assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,'not-saved');
  m.files.set('one.html.gameportal.json',JSON.stringify({...JSON.parse(before),title:'External'}));assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,'changed');m.files.set('one.html.gameportal.json',committed);
  await assert.rejects(library.verifySettingsSave(m.root,{...error.attempt,expectedHash:'0'.repeat(64)}),/履歴が一致/);await assert.rejects(library.verifySettingsSave(m.root,{...error.attempt,libraryId:'f'.repeat(32)}),/別のライブラリ/);assert.equal(writes,count);
});
test('a close error is unconfirmed whether the stream committed or retained the old settings',async()=>{
  for(const committed of [false,true]){let arm=false;const m=memoryFolder({close:async(name,pending,files)=>{if(arm&&name==='one.html.gameportal.json'){if(committed)files.set(name,pending);throw new DOMException('Lost connection during close','NetworkError');}}});m.files.set('one.html','game');let [game]=await scan(m.root,{games:{}});const values={title:'Before',tags:[],developmentEnvironment:'',thumbnail:null};await saveGameSettings(m.root,game,values);[game]=await scan(m.root,{games:{}});arm=true;let error;try{await saveGameSettings(m.root,game,{...values,title:'After'});}catch(e){error=e;}assert.equal(error.code,'SETTINGS_SAVE_UNCONFIRMED');assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,committed?'confirmed':'not-saved');}
});
test('an unconfirmed initial post retains copies and the uploading marker instead of deleting a possibly committed game',async()=>{
  const m=memoryFolder({close:async(name,pending,files)=>{if(name.endsWith('.gameportal.json')){files.set(name,pending);throw new DOMException('Close result lost','NetworkError');}}});let error;try{await postGame(m.root,[new File(['<h1>Game</h1>'],'game.html')],{});}catch(e){error=e;}assert.equal(error.code,'SETTINGS_SAVE_UNCONFIRMED');const folder=m.folders.get(error.attempt.uploadFolder);assert(folder.files.has('game.html'));assert(folder.files.has('.gameportal-uploading'));assert.equal((await scan(m.root,{games:{}})).length,0);assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,'confirmed');
});
test('dependency checks resolve JS module and document bases and ignore comments, quoted source and regex',()=>{
  const js=`// fetch('comment.png')\nconst text="fetch('string.png')";const regex=/fetch('regex.png')/;import item from './module.js';export {item} from '../other.js';fetch('assets/data.json');new Worker(new URL('./worker.js',import.meta.url));import('./late.js');fetch(prefix+'.json');import('pkg');`;
  const r=analyzeDependencies(js,'js/main.js','js','index.html');assert.deepEqual(r.required.sort(),['js/module.js','other.js','assets/data.json','js/worker.js','js/late.js'].sort());assert(r.unverified.some(v=>v.includes('動的')));assert(r.unverified.some(v=>v.includes('import map')));
  const css=analyzeDependencies(`/* url(no.png) */ @import './theme.css';.a{background:url('../images/a.png?v=2');src:url(data:image/png;base64,x)}`,'css/main.css','css');assert.deepEqual(css.required.sort(),['css/theme.css','images/a.png'].sort());
  const html=analyzeDependencies('<img srcset="one.png 1x, two.png 2x"><style>.a{background:url(bg.png)}</style><script>fetch("https://example.test/data");fetch(variable);</script>','index.html','html');assert.deepEqual(html.required.sort(),['one.png','two.png','bg.png'].sort());assert.equal(html.external.length,1);assert(html.unverified.length>0);
  const embedded='<script>const css="<style>.x{background:url(fake.png)}</style>";const comment="<!-- <img src=fake2.png> -->";fetch("actual.png");</script><!-- <script>fetch("comment.png")</script> -->';assert.deepEqual(analyzeDependencies(embedded,'index.html','html').required,['actual.png']);assert.deepEqual(localResources(embedded,'index.html'),[]);
  assert.deepEqual(analyzeDependencies('<script data="encoded > style=\'url(fake.png)\'"></script><object data="actual.bin"></object>','index.html','html').required,['actual.bin']);
});
test('upload checks follow CSS import chains and JS literal imports, report dynamic/external refs and respect analysis budgets',async()=>{
  const text=(name,value)=>new File([value],name);const files=new Map([['index.html',text('index.html','<link rel="stylesheet" href="css/main.css"><script src="js/main.js"></script>')],['css/main.css',text('main.css','@import "theme.css";')],['css/theme.css',text('theme.css','.x{background:url(../missing.png)}')],['js/main.js',text('main.js','import "./child.js";fetch(variable);fetch("https://example.test/api");')],['js/child.js',text('child.js','import "./main.js";')]]);
  let result=await inspectUploadDependencies(files,'index.html',localResources);assert.deepEqual(result.missing,['missing.png']);assert.equal(result.external.length,1);assert(result.unverified.length>0);assert.equal(result.checkedFiles,5);
  files.set('css/main.css',{size:9*1024*1024,text:async()=>{throw new Error('Must not read over-budget text');}});result=await inspectUploadDependencies(files,'index.html',localResources);assert(result.unverified.some(v=>v.includes('容量上限')));
});
test('worker fetch/importScripts and nested HTML use their own document base',async()=>{
  const f=text=>new File([text],'file');const files=new Map([['index.html',f('<script src="js/main.js"></script><iframe src="pages/child.html"></iframe>')],['js/main.js',f('new Worker(new URL("./worker.js",import.meta.url));')],['js/worker.js',f('importScripts("lib/util.js");fetch("data.json");')],['js/lib/util.js',f('fetch("data.json");')],['js/data.json',f('{}')],['pages/child.html',f('<script>fetch("data.json")</script>')],['pages/data.json',f('{}')]]);
  const r=await inspectUploadDependencies(files,'index.html',localResources);assert.deepEqual(r.missing,[]);assert.deepEqual(r.unverified,[]);
});
test('explicit retry repairs only a verified empty initial placeholder and refuses already saved or changed settings',async()=>{
  let fail=true;const m=memoryFolder({close:async name=>{if(fail&&name==='one.html.gameportal.json')throw new DOMException('Close failed before commit','NetworkError');}});m.files.set('one.html','game');const [game]=await scan(m.root,{games:{}});let error;try{await saveGameSettings(m.root,game,{title:'Desired',tags:[],developmentEnvironment:'',thumbnail:null});}catch(e){error=e;}assert.equal(error.code,'SETTINGS_SAVE_UNCONFIRMED');assert.equal(m.files.get('one.html.gameportal.json'),'');assert.equal((await library.verifySettingsSave(m.root,error.attempt)).state,'not-saved');fail=false;await library.retrySettingsSave(m.root,error.attempt);assert.equal(JSON.parse(m.files.get('one.html.gameportal.json')).title,'Desired');await assert.rejects(library.retrySettingsSave(m.root,error.attempt),/上書きしません/);
});

test('a Godot data-only ZIP is rejected with Web export guidance before library writes', async () => {
  const { root, files, folders } = memoryFolder();
  files.set('existing.html', '<h1>existing</h1>');
  const zip = await packageWebFiles([new File(['game data'], 'project.binary')]);
  await assert.rejects(postGame(root, [new File([await zip.arrayBuffer()], 'snake.zip')], { unpackPrivateZip }), /起動用HTMLがありません.*Web書き出し/);
  assert.equal(folders.size, 0);
  assert.deepEqual([...files], [['existing.html', '<h1>existing</h1>']]);
});
test('failed post cleanup reports its remaining marker and never removes existing games',async()=>{
  const m=memoryFolder({write:async name=>{if(name==='new.html')throw new DOMException('Copy disconnected','NetworkError');},remove:async name=>{if(name.startsWith('game-'))throw new DOMException('Cleanup disconnected','NetworkError');}});m.files.set('existing.html','existing');await assert.rejects(postGame(m.root,[new File(['<h1>New</h1>'],'new.html')],{}),/追加途中.*ライブラリ点検/);assert.equal(m.files.get('existing.html'),'existing');const folder=[...m.folders.values()][0];assert(folder.files.has('.gameportal-uploading'));assert.equal((await scan(m.root,{games:{}})).length,1);
});

test('inspection finds missing files, broken settings, duplicate IDs and hidden uploads without any writes', async () => {
  let writes = 0;
  const {root,files} = memoryFolder({write:async()=>{writes++;}});
  await ensureLibraryId(root);writes=0;
  const settings={schema:1,id:'a'.repeat(32),title:'Example',tags:[],developmentEnvironment:'',thumbnail:null};
  files.set('one.html','<script src="missing.js"></script>');files.set('two.html','<h1>two</h1>');files.set('broken.html','<h1>broken</h1>');
  files.set('one.html.gameportal.json',JSON.stringify(settings));files.set('two.html.gameportal.json',JSON.stringify(settings));
  files.set('broken.html.gameportal.json','{broken');files.set('gone.html.gameportal.json',JSON.stringify({...settings,id:'b'.repeat(32)}));
  const pending=await root.getDirectoryHandle('pending',{create:true});
  const marker=await pending.getFileHandle('.gameportal-uploading',{create:true});const writer=await marker.createWritable();await writer.write('pending');await writer.close();writes=0;
  const before=JSON.stringify([...files]);const report=await inspectLibrary(root,library,preview);
  assert.equal(report.complete,true);assert.equal(report.checked,3);
  for(const kind of ['missing','config','duplicate','upload'])assert.ok(report.issues.some(i=>i.kind===kind),kind);
  assert.equal(report.issues.filter(i=>i.kind==='duplicate').length,2);
  assert.ok(report.issues.some(i=>i.kind==='missing'&&i.message.includes('missing.js')));
  assert.equal(writes,0);assert.equal(JSON.stringify([...files]),before);
});

test('resource inspection handles relative paths and Godot files, ignores comments, inline source and external URLs', () => {
  const html='<script src="../lib/game.js?v=1"></script><script>const text="<img src=\"not-an-asset.png\">";</script><!-- <img src="comment.png"> --><img src="cover.png"><img src="data:image/png;base64,x"><script src="https://example.com/external.js"></script>\nconst GODOT_CONFIG = {"fileSizes":{"game.wasm":10,"game.pck":20}};';
  assert.deepEqual(localResources(html,'games/index.html').sort(),['lib/game.js','games/cover.png','games/game.wasm','games/game.pck'].sort());
});

test('inspection catches explicit IDs that collide with a legacy game without a settings sidecar', async () => {
  const {root,files}=memoryFolder();await ensureLibraryId(root);
  files.set('legacy.html','<h1>legacy</h1>');files.set('new.html','<h1>new</h1>');
  files.set('new.html.gameportal.json',JSON.stringify({schema:1,id:await gameId('legacy.html'),title:'New',tags:[],developmentEnvironment:'',thumbnail:null}));
  const report=await inspectLibrary(root,library,preview);
  assert.equal(report.issues.filter(i=>i.kind==='duplicate').length,2);
});

test('inspection reports data-only ZIPs and unreadable folders without treating a partial scan as healthy', async () => {
  const {root,files}=memoryFolder();await ensureLibraryId(root);
  const zip=await packageWebFiles([new File(['data'],'project.binary')]);
  // memoryFolder returns File objects from strings or Blob-backed values.
  files.set('data.zip',zip);
  const report=await inspectLibrary(root,library,preview);assert.ok(report.issues.some(i=>i.kind==='missing'&&i.message.includes('HTML')));
  const denied={name:'denied',async *values(){throw new DOMException('Access denied','NotAllowedError');},getDirectoryHandle:async()=>{throw new DOMException('Access denied','NotAllowedError');}};
  const partial=await inspectLibrary(denied,library,preview);assert.equal(partial.complete,false);assert.ok(partial.issues.some(i=>i.kind==='unreadable'));
});

test('history restores name, tags, environment and image while retaining the game ID and recording a new history entry', async () => {
  const {root,files}=memoryFolder();files.set('one.html','<h1>one</h1>');
  const first={title:'Before',tags:['tag'],developmentEnvironment:'Godot',description:'Before description',instructions:'Before controls',thumbnail:'data:image/webp;base64,YWJjZA=='};
  let [game]=await scan(root,{games:{}});await saveGameSettings(root,game,first);
  [game]=await scan(root,{games:{}});const id=game.id;await saveGameSettings(root,game,{title:'After',tags:[],developmentEnvironment:'',description:'Changed',instructions:'Changed controls',thumbnail:null});
  [game]=await scan(root,{games:{}});const history=await loadSettingsHistory(root,game,library);
  const entry=history.entries.find(e=>e.before?.title==='Before');assert.ok(entry);
  await restoreSettingsHistory(root,game,entry.name,library);
  const {data}=await loadGameSettings(root,game.path);assert.equal(data.id,id);
  for(const key of Object.keys(first))assert.deepEqual(data[key],first[key]);
  assert.equal((await loadSettingsHistory(root,game,library)).entries.length,3);
});

test('optional descriptions remain compatible with old settings, survive image saves and reject invalid values before writes', async () => {
  const {root,files}=memoryFolder();files.set('one.html','<h1>one</h1>');
  const old={schema:1,id:'a'.repeat(32),title:'Old',tags:[],developmentEnvironment:'',thumbnail:null};files.set('one.html.gameportal.json',JSON.stringify(old));
  assert.equal((await loadGameSettings(root,'one.html')).data.description,'');
  let [game]=await scan(root,{games:{}});assert.equal(game.instructions,'');
  await saveGameSettings(root,game,{...old,description:'概要\n2行目',instructions:'Space：ジャンプ'});
  [game]=await scan(root,{games:{}});await saveGameSettings(root,game,{title:game.title,tags:game.tags,developmentEnvironment:game.developmentEnvironment,thumbnail:'data:image/webp;base64,YWJjZA=='});
  const saved=(await loadGameSettings(root,'one.html')).data;assert.equal(saved.description,'概要\n2行目');assert.equal(saved.instructions,'Space：ジャンプ');
  [game]=await scan(root,{games:{}});const before=files.get('one.html.gameportal.json');
  for(const values of [{description:'a'.repeat(2001)},{instructions:'a'.repeat(4001)},{description:123},{instructions:null}]) {
    if(values.instructions===null){assert.throws(()=>library.parseGameSettings(JSON.stringify({...saved,instructions:null})),/形式/);continue;}
    await assert.rejects(saveGameSettings(root,game,{...saved,...values}),/概要/);assert.equal(files.get('one.html.gameportal.json'),before);
  }
  assert.throws(()=>library.parseGameSettings(JSON.stringify({...old,description:[]})),/形式/);
});

test('history rejects a wrong game ID and stale restore without overwriting current settings', async () => {
  const {root,files}=memoryFolder();files.set('one.html','<h1>one</h1>');
  let [game]=await scan(root,{games:{}});await saveGameSettings(root,game,{title:'Before',tags:[],developmentEnvironment:'',thumbnail:null});
  [game]=await scan(root,{games:{}});await saveGameSettings(root,game,{title:'After',tags:[],developmentEnvironment:'',thumbnail:null});
  [game]=await scan(root,{games:{}});const entry=(await loadSettingsHistory(root,game,library)).entries.find(e=>e.before);
  const concurrent=JSON.parse(files.get(game.path+'.gameportal.json'));concurrent.title='Concurrent';files.set(game.path+'.gameportal.json',JSON.stringify(concurrent));
  await assert.rejects(restoreSettingsHistory(root,game,entry.name,library),/更新されています/);assert.equal(JSON.parse(files.get(game.path+'.gameportal.json')).title,'Concurrent');
  await library.writeFile(root,`.gameportal/history/${game.id}/aaaa.json`,JSON.stringify({schema:1,gamePath:game.path,savedAt:new Date().toISOString(),before:JSON.stringify({...concurrent,id:'f'.repeat(32)})}));
  const forged=(await loadSettingsHistory(root,game,library)).entries.find(e=>e.name==='aaaa.json');assert.match(forged.error,/ID/);
  await assert.rejects(restoreSettingsHistory(root,game,'aaaa.json',library),/ID/);
  await assert.rejects(restoreSettingsHistory(root,game,'../evil.json',library),/ファイル名/);
});
test('per-game files preserve settings, thumbnails and identity without changing other games', async () => {
  const { root, files } = memoryFolder(); files.set('one.html', '<h1>one</h1>'); files.set('two.html', '<h1>two</h1>');
  const metadata = { games: {} }, games = await scan(root, metadata);
  const image = 'data:image/webp;base64,YWJjZA==';
  await saveGameSettings(root, games[0], { title: 'Edited', tags: ['日本語'], developmentEnvironment: 'Godot 4.5', thumbnail: image });
  assert.equal(files.has('two.html.gameportal.json'), false);
  const [first] = (await scan(root, metadata)).filter(g => g.title === 'Edited');
  assert.equal(first.thumbnail, image); assert.equal(first.developmentEnvironment, 'Godot 4.5'); assert.equal(first.id, games[0].id);
  assert.equal((await readTree(root)).has('one.html.gameportal.json'), false);
  await assert.rejects(saveGameSettings(root, games[0], { title: 'Stale', tags: [], developmentEnvironment: '', thumbnail: null }), /更新/);
  const settings = await loadGameSettings(root, 'one.html');
  files.set('one.html.gameportal.json', JSON.stringify({ ...settings.data, title: 'Hand edited' }));
  await assert.rejects(saveGameSettings(root, first, { title: 'Stale', tags: [], developmentEnvironment: '', thumbnail: null }), /更新/);
  assert.equal((await loadGameSettings(root, 'one.html')).data.title, 'Hand edited');
  files.set('one.html.gameportal.json', JSON.stringify({ ...settings.data, schema: 2 }));
  await assert.rejects(loadGameSettings(root, 'one.html'), /形式/);
});
test('legacy metadata remains available until a game is edited into its own settings file', async () => {
  const { root, files } = memoryFolder(); files.set('old.html', 'game');
  const old = { games: { 'old.html': { title: 'Old title', tags: ['old'], thumbnail: true } } };
  const [game] = await scan(root, old); assert.equal(game.title, 'Old title'); assert.equal(game.thumbnail, true);
  await saveGameSettings(root, game, { title: 'New title', tags: game.tags, developmentEnvironment: 'Scratch', thumbnail: null });
  assert.equal((await scan(root, old))[0].title, 'New title'); assert.equal(old.games['old.html'].title, 'Old title');
});

test('offline tag suggestions retain the public portal categories without network dependencies', async () => {
  const presets = JSON.parse(await readFile(new URL('../offline-html/tag-presets.json', import.meta.url)));
  assert.equal(presets.tags.length, 77);
  assert.deepEqual([...new Set(presets.tags.map(t => t.category))], ['ジャンル','プレイ形式','画面・視点','操作','ゲームの特徴','雰囲気・デザイン','開発環境','対応環境']);
  for (const tag of presets.tags) { assert.equal(typeof tag.name,'string'); assert.ok(tag.name.length <= 32); }
});

test('settings keep recovery history and preserve the committed file when the NAS write fails', async () => {
  let fail = false;
  const {root,files,folders} = memoryFolder({ write: async name => { if(fail && name === 'one.html.gameportal.json') throw new Error('NAS disconnected'); } });
  files.set('one.html','game');
  let [game] = await scan(root,{games:{}});
  const values = {title:'Initial',tags:[],developmentEnvironment:'Godot',thumbnail:null};
  await saveGameSettings(root,game,values); [game] = await scan(root,{games:{}});
  const original=files.get('one.html.gameportal.json'); fail=true;
  await assert.rejects(saveGameSettings(root,game,{...values,title:'Unsaved edit'}),/NAS disconnected/);
  assert.equal(files.get('one.html.gameportal.json'),original);
  const history=folders.get('.gameportal').folders.get('history').folders.get(game.id).files;
  const attempts=[...history.values()].map(text=>JSON.parse(text));
  assert.equal(attempts.length,2);
  const failed=attempts.find(item=>JSON.parse(item.after).title==='Unsaved edit');
  assert.equal(failed.before,original);
  fail=false;[game]=await scan(root,{games:{}});const id=game.id;
  await saveGameSettings(root,game,{...values,title:'Recovered after reconnect'});
  [game]=await scan(root,{games:{}});assert.equal(game.id,id);assert.equal(game.title,'Recovered after reconnect');
});
test('settings recheck after acquiring the exclusive writer and reject simultaneous writers', async () => {
  let mutate=false;
  const {root,files} = memoryFolder({ open: async (name,options,stored) => {
    assert.equal(options.mode,'exclusive');
    if(mutate && name==='one.html.gameportal.json') { mutate=false; const current=JSON.parse(stored.get(name));current.title='External edit';stored.set(name,JSON.stringify(current)); }
  }});
  files.set('one.html','game');let [game]=await scan(root,{games:{}});
  const values={title:'Initial',tags:[],developmentEnvironment:'',thumbnail:null};
  await saveGameSettings(root,game,values);[game]=await scan(root,{games:{}});mutate=true;
  await assert.rejects(saveGameSettings(root,game,{...values,title:'Stale edit'}),/更新/);
  assert.equal(JSON.parse(files.get('one.html.gameportal.json')).title,'External edit');
  [game]=await scan(root,{games:{}});
  const results=await Promise.allSettled([saveGameSettings(root,game,{...values,title:'First'}),saveGameSettings(root,game,{...values,title:'Second'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('a corrupt settings file and duplicate IDs cannot break unrelated games', async () => {
  const {root,files}=memoryFolder();files.set('one.html','one');files.set('two.html','two');
  files.set('one.html.gameportal.json','{invalid');
  const list=await scan(root,{games:{}});assert.equal(list.length,2);
  assert.ok(list.find(g=>g.path==='one.html').settingsError);assert.equal(list.find(g=>g.path==='two.html').settingsError,'');
  files.delete('one.html.gameportal.json');const [game]=await scan(root,{games:{}});
  await saveGameSettings(root,game,{title:'First',tags:[],developmentEnvironment:'',thumbnail:null});
  files.set('two.html.gameportal.json',files.get('one.html.gameportal.json'));
  assert.ok((await scan(root,{games:{}})).every(g=>g.identityConflict));
});
test('posting is hidden until complete and interrupted imports remove only their own folder', async () => {
  let root, seenDuringCopy, fail=false;
  const memory=memoryFolder({write:async name=>{if(name==='Sample.html'){seenDuringCopy=await scan(root,{games:{}});if(fail)throw new Error('NAS disconnected');}}});
  root=memory.root;memory.files.set('existing.html','unchanged');
  await postGame(root,[new File(['<h1>game</h1>'],'Sample.html')],{});
  assert.equal(seenDuringCopy.length,1);assert.equal((await scan(root,{games:{}})).length,2);
  const before=[...memory.folders.keys()]; fail=true;
  await assert.rejects(postGame(root,[new File(['<h1>game</h1>'],'Sample.html')],{}),/NAS disconnected/);
  assert.deepEqual([...memory.folders.keys()],before);assert.equal(memory.files.get('existing.html'),'unchanged');
});

test('local save validation counts UTF-8 bytes and rejects non-string or oversized data', () => {
  assert.equal(validSave({level:'日本語'}),true);
  for(const value of [[],{level:1},{level:'あ'.repeat(180000)},Object.fromEntries(Array.from({length:1001},(_,i)=>[String(i),'value']))]) assert.equal(!!validSave(value),false);
});

test('a newly appearing upload marker also hides a folder during enumeration', async () => {
  const {root,files,folders}=memoryFolder();files.set('complete.html','complete');
  const child=await root.getDirectoryHandle('incomplete',{create:true});
  folders.get('incomplete').files.set('.gameportal-uploading','pending');folders.get('incomplete').files.set('index.html','partial');
  const original=child.getFileHandle;let first=true;
  child.getFileHandle=async(name,...args)=>{if(name==='.gameportal-uploading'&&first){first=false;throw new DOMException('Not visible yet','NotFoundError');}return original(name,...args);};
  assert.deepEqual((await scan(root,{games:{}})).map(game=>game.path),['complete.html']);
});

test('a library ID is initialized once, remains read-only for viewers, and separates libraries', async () => {
  const first=memoryFolder(), second=memoryFolder();
  assert.equal(await loadLibraryId(first.root),null); assert.equal(first.folders.size,0);
  const id=await ensureLibraryId(first.root);assert.match(id,/^[a-f0-9]{32}$/);
  assert.equal(await ensureLibraryId(first.root),id);assert.equal(await loadLibraryId(first.root),id);
  assert.notEqual(await ensureLibraryId(second.root),id);
  first.folders.get('.gameportal').files.set('library-id.json','{invalid');
  await assert.rejects(ensureLibraryId(first.root)); assert.equal(first.folders.get('.gameportal').files.get('library-id.json'),'{invalid');
});

async function postedFixture(hooks={}){
 const memory=memoryFolder(hooks),id=await ensureLibraryId(memory.root);await postGame(memory.root,[new File(['<h1>Original</h1>'],'old.html')],preview);const [game]=await scan(memory.root,{games:{}});return {...memory,game,id,owner:memory.folders.get(game.path.split('/')[0])};
}
const updateCheck=(files,tools,packages)=>checkUpload(files,tools,packages,localResources);
test('content release publishes changed filename without changing information or IDs and restores original bytes',async()=>{
 const m=await postedFixture(),before=m.owner.files.get('old.html.gameportal.json');
 await replaceGameContent(m.root,m.game,[new File(['<h1>New</h1>'],'new.html')],m.id,library,preview,updateCheck);
 let [game]=await scan(m.root,{games:{}});assert.equal(game.id,m.game.id);assert.equal(game.path,m.game.path);assert.equal(await(await game.handle.getFile()).text(),'<h1>New</h1>');assert.equal(m.owner.files.get('old.html.gameportal.json'),before);assert.equal(m.owner.files.get('old.html') instanceof File,true);
 await assert.rejects(replaceGameContent(m.root,m.game,[new File(['stale'],'newer.html')],m.id,library,preview,updateCheck),/他の画面/);
 await restoreGameContent(m.root,game,m.id,library);[game]=await scan(m.root,{games:{}});assert.equal(await(await game.handle.getFile()).text(),'<h1>Original</h1>');assert.equal(game.id,m.game.id);assert.equal(m.owner.files.get('old.html.gameportal.json'),before);
});
test('failed staged copy leaves original playable and never publishes a selector',async()=>{
 let armed=false;const m=await postedFixture({write:async name=>{if(armed&&name==='new.html')throw new DOMException('Disconnected','NetworkError');}});armed=true;
 await assert.rejects(replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck),/Disconnected/);const [game]=await scan(m.root,{games:{}});assert.equal(await(await game.handle.getFile()).text(),'<h1>Original</h1>');assert.equal(game.settingsError,'');assert.equal(m.owner.files.has('.gameportal-content.json'),false);
});
test('uncertain selector close is persistent and distinguishes committed and original content without repeating the update',async()=>{
 for(const committed of [false,true]){let armed=false;const m=await postedFixture({close:async(name,pending,files)=>{if(armed&&name==='.gameportal-content.json'){if(committed)files.set(name,pending);throw new DOMException('Close result unknown','NetworkError');}}});armed=true;
 await assert.rejects(replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck),error=>error.code==='CONTENT_UPDATE_UNCONFIRMED');assert(m.owner.files.has('.gameportal-content-pending.json'));armed=false;let [game]=await scan(m.root,{games:{}});assert.equal(game.contentPending,true);assert.equal(await(await game.handle.getFile()).text(),committed?'new':'<h1>Original</h1>');assert.equal((await verifyContentUpdate(m.root,game,m.id,library)).state,committed?'confirmed':'not-saved');[game]=await scan(m.root,{games:{}});assert.equal(game.contentPending,false);assert.equal(game.settingsError,'');
 }
});
test('rollback refuses altered backup bytes and a traversal selector only disables its own game',async()=>{
 const m=await postedFixture();await library.writeFile(m.root,'other.html','other');
 await replaceGameContent(m.root,m.game,[new File(['v2'],'second.html')],m.id,library,preview,updateCheck);let game=(await scan(m.root,{games:{}})).find(g=>g.path===m.game.path);
 await replaceGameContent(m.root,game,[new File(['v3'],'third.html')],m.id,library,preview,updateCheck);game=(await scan(m.root,{games:{}})).find(g=>g.path===m.game.path);
 const selector=JSON.parse(m.owner.files.get('.gameportal-content.json')),backup=m.owner.folders.get('.gameportal-versions').folders.get(selector.previous.version);backup.files.set('second.html','tampered');const before=m.owner.files.get('.gameportal-content.json');
 await assert.rejects(restoreGameContent(m.root,game,m.id,library),/更新ファイル/);assert.equal(m.owner.files.get('.gameportal-content.json'),before);
 selector.active.entry='../outside.html';m.owner.files.set('.gameportal-content.json',JSON.stringify(selector));const games=await scan(m.root,{games:{}});assert(games.find(g=>g.path===m.game.path).settingsError);assert.equal(games.find(g=>g.path==='other.html').settingsError,'');
});

test('library inspection checks the active release and detects missing updated files and pending content confirmation',async()=>{
 const m=await postedFixture();await replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck);
 assert.equal((await inspectLibrary(m.root,library,preview)).issues.length,0);
 const selector=JSON.parse(m.owner.files.get('.gameportal-content.json'));m.owner.folders.get('.gameportal-versions').folders.get(selector.active.version).files.set('new.html','tampered');
 assert((await inspectLibrary(m.root,library,preview)).issues.some(i=>i.type==='config'||i.kind==='config'));
});

test('failed initial release verification removes only its empty selector and preserves original play',async()=>{
 let armed=false;const m=await postedFixture({close:async(name,pending,files)=>{if(armed&&name==='new.html')files.set(name,'changed');},read:async(name,files)=>{if(armed&&name==='new.html')files.set(name,'changed');}});armed=true;
 await assert.rejects(replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck),/更新ファイル/);const [game]=await scan(m.root,{games:{}});assert.equal(game.settingsError,'');assert.equal(await(await game.handle.getFile()).text(),'<h1>Original</h1>');assert.equal(m.owner.files.has('.gameportal-content.json'),false);
});

test('a damaged selector keeps pending confirmation accessible and confirmation never overwrites a different result',async()=>{
 let armed=false;const m=await postedFixture({close:async(name,pending,files)=>{if(armed&&name==='.gameportal-content.json'){files.set(name,pending);throw new DOMException('Unknown close','NetworkError');}}});armed=true;await assert.rejects(replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck),e=>e.code==='CONTENT_UPDATE_UNCONFIRMED');armed=false;m.owner.files.set('.gameportal-content.json','{partial');const [game]=await scan(m.root,{games:{}});assert(game.contentError);assert.equal(game.contentPending,true);assert.equal((await verifyContentUpdate(m.root,game,m.id,library)).state,'changed');assert.equal(m.owner.files.get('.gameportal-content.json'),'{partial');assert(m.owner.files.has('.gameportal-content-pending.json'));
});


test('compatibility reads legacy libraries without writes and initializes a verified minimum only on editing',async()=>{
  let writes=0;const m=memoryFolder({write:()=>writes++});
  assert.equal(await checkCompatibility(m.root),null);assert.equal(m.folders.size,0);assert.equal(writes,0);
  const info=await ensureCompatibility(m.root);assert.equal(info.minLauncherVersion,'0.14.0');assert(info.requiredFeatures.includes('content-selector-v1'));
  const bytes=m.folders.get('.gameportal').files.get('compatibility.json');const count=writes;
  assert.equal((await checkCompatibility(m.root,'0.14.1')).minLauncherVersion,'0.14.0');
  await ensureCompatibility(m.root);assert.equal(writes,count);assert.equal(m.folders.get('.gameportal').files.get('compatibility.json'),bytes);
  assert.equal(LAUNCHER_VERSION,JSON.parse(await readFile(new URL('../package.json',import.meta.url))).version);
});
test('minimum version uses numeric components and rejects older launchers without changing the marker',async()=>{
  const m=memoryFolder();await ensureCompatibility(m.root);const files=m.folders.get('.gameportal').files,original=files.get('compatibility.json');
  for(const version of ['0.9.99','0.13.99','0.14.0-beta'])await assert.rejects(checkCompatibility(m.root,version),e=>e.code==='LIBRARY_INCOMPATIBLE');
  assert.equal((await checkCompatibility(m.root,'0.100.0')).schema,1);assert.equal(files.get('compatibility.json'),original);
});
test('unknown formats, capabilities, damaged and oversized compatibility records fail closed before game writes',async()=>{
  const m=memoryFolder();await ensureCompatibility(m.root);const files=m.folders.get('.gameportal').files,original=JSON.parse(files.get('compatibility.json'));
  for(const record of ['', '{broken',JSON.stringify({...original,schema:2}),JSON.stringify({...original,requiredFeatures:['future-feature']}),JSON.stringify({...original,minLauncherVersion:'9.0.0'}),JSON.stringify({...original,minLauncherVersion:'0.14'}),'x'.repeat(8193)]){
    files.set('compatibility.json',record);
    for(const task of [()=>ensureLibraryId(m.root),()=>saveGameSettings(m.root,{path:'a.html',id:'a'.repeat(32),settingsText:null},{title:'No',tags:[],developmentEnvironment:'',thumbnail:null}),()=>postGame(m.root,[new File(['game'],'a.html')],{})])await assert.rejects(task(),e=>e.code==='LIBRARY_INCOMPATIBLE');
    assert.equal(files.get('compatibility.json'),record);assert.equal(m.files.size,0);assert.equal([...m.folders.keys()].length,1);
  }
});
test('initial compatibility close/readback failures prevent library initialization and retain recovery evidence',async()=>{
  for(const mode of ['close','readback']){
    let committed=false;const m=memoryFolder({close:async(name,pending,files)=>{if(name==='compatibility.json'){files.set(name,pending);committed=true;if(mode==='close')throw new DOMException('Disconnected','NetworkError');}},read:async(name)=>{if(committed&&mode==='readback'&&name==='compatibility.json')throw new DOMException('Disconnected','NetworkError');}});
    await assert.rejects(ensureLibraryId(m.root));assert.equal(m.folders.get('.gameportal').files.has('library-id.json'),false);assert(m.folders.get('.gameportal').files.get('compatibility.json').includes('0.14.0'));
  }
});
test('initial compatibility creation rechecks a concurrent newer requirement and never lowers it',async()=>{
  const data=JSON.stringify({schema:1,minLauncherVersion:'9.0.0',requiredFeatures:['content-selector-v1']});
  const m=memoryFolder({open:async(name,options,files)=>{if(name==='compatibility.json')files.set(name,data);}});
  await assert.rejects(ensureCompatibility(m.root),e=>e.code==='LIBRARY_INCOMPATIBLE');assert.equal(m.folders.get('.gameportal').files.get('compatibility.json'),data);
});


test('save backup validation bounds personal data, record identity, reasons and history length',()=>{
  const record={schema:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason:'before-update',contentRevision:'original',data:{level:'日本語'}};
  assert.equal(validSaveBackups([]),true);assert.equal(validSaveBackups([record]),true);
  for(const value of [null,{},[record,record],Array.from({length:11},()=>({...record,id:crypto.randomUUID()})),[{...record,schema:2}],[{...record,createdAt:'invalid'}],[{...record,reason:'unknown'}],[{...record,contentRevision:'x'.repeat(101)}],[{...record,data:{level:1}}],[{...record,data:{big:'a'.repeat(500001)}}]])assert.equal(!!validSaveBackups(value),false);
});


test('capacity includes root, hidden management, initial files and active/previous/other/empty releases without writes',async()=>{
  let writes=0;const m=await postedFixture({write:()=>writes++});
  await replaceGameContent(m.root,m.game,[new File(['new'],'v2.html')],m.id,library,preview,updateCheck);
  let game=(await scan(m.root,{games:{}}))[0];await replaceGameContent(m.root,game,[new File(['next'],'v3.html')],m.id,library,preview,updateCheck);
  const other=crypto.randomUUID(),empty=crypto.randomUUID(),ownerName=m.game.path.split('/')[0];
  await library.writeFile(m.root,ownerName+'/.gameportal-versions/'+other+'/partial.bin',new Uint8Array(7));
  await(await m.owner.root.getDirectoryHandle('.gameportal-versions')).getDirectoryHandle(empty,{create:true});
  await library.writeFile(m.root,'loose.html','root');await library.writeFile(m.root,'(root)/asset.dat','separate');
  let actualBytes=0,actualFiles=0;async function total(folder){for await(const entry of folder.values()){if(entry.kind==='directory')await total(entry);else{actualFiles++;actualBytes+=(await entry.getFile()).size;}}}await total(m.root);const before=writes;
  const report=await measureLibraryUsage(m.root,library,contentStorage);assert.equal(report.complete,true);assert.equal(report.bytes,actualBytes);assert.equal(report.files,actualFiles);assert.equal(writes,before);
  assert(report.rows.some(row=>row.kind==='management'));assert(report.rows.some(row=>row.path==='.'&&row.bytes===4));assert(report.rows.some(row=>row.path==='(root)'&&row.bytes===8));
  const row=report.rows.find(row=>row.kind==='posted');assert.equal(row.releases.length,4);assert.equal(row.releases.filter(r=>r.status==='active').length,1);assert.equal(row.releases.filter(r=>r.status==='previous').length,1);assert.equal(row.releases.find(r=>r.id===other).status,'other');assert.equal(row.releases.find(r=>r.id===empty).files,0);
  assert.equal(row.bytes,row.originalBytes+row.metadataBytes+row.activeBytes+row.previousBytes+row.otherBytes+row.unknownBytes);assert.equal(JSON.stringify(report).includes('getFileHandle'),false);
});
test('capacity does not classify releases when a selector is damaged or an update is pending',async()=>{
  const m=await postedFixture();await replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck);
  const original=m.owner.files.get('.gameportal-content.json');
  for(const pending of [false,true]){
    if(pending){m.owner.files.set('.gameportal-content.json',original);m.owner.files.set('.gameportal-content-pending.json','pending');}else m.owner.files.set('.gameportal-content.json','{broken');
    const report=await measureLibraryUsage(m.root,library,contentStorage),row=report.rows.find(r=>r.kind==='posted');assert.equal(report.complete,false);assert(row.releases.every(r=>r.status==='unknown'));assert(row.unknownBytes>0);assert(report.warnings.length>0);
  }
});
test('capacity marks selector changes during scanning and library ID changes as partial',async()=>{
  const m=await postedFixture();await replaceGameContent(m.root,m.game,[new File(['new'],'new.html')],m.id,library,preview,updateCheck);
  let calls=0;const changed={...contentStorage,describeContentStorage:async(...args)=>{const info=await contentStorage.describeContentStorage(...args);if(++calls>1)info.fingerprint='changed';return info;}};
  const report=await measureLibraryUsage(m.root,library,changed);assert.equal(report.complete,false);assert(report.rows.find(r=>r.kind==='posted').releases.every(r=>r.status==='unknown'));
  const changedTools={...library,getFile:async(...args)=>{const f=await library.getFile(...args);return new File([String(++calls)],f.name);}};const other=await measureLibraryUsage(m.root,changedTools,contentStorage);assert.equal(other.complete,false);assert(other.warnings.some(w=>w.message.includes('ライブラリID')));
});
test('capacity returns an explicit partial result on unreadable files and depth/entry limits',async()=>{
  const m=memoryFolder({read:async name=>{if(name==='bad.dat')throw new DOMException('Offline','NotReadableError');}});m.files.set('bad.dat','bad');m.files.set('good.dat','good');
  await library.writeFile(m.root,Array.from({length:22},(_,i)=>'d'+i).join('/')+'/deep.dat','deep');
  let report=await measureLibraryUsage(m.root,library,contentStorage);assert.equal(report.complete,false);assert.equal(report.bytes,4);assert(report.warnings.some(w=>w.path==='bad.dat'));assert(report.warnings.some(w=>w.message.includes('20階層')));
  const many=memoryFolder();for(let i=0;i<10005;i++)many.files.set(i+'.dat','x');report=await measureLibraryUsage(many.root,library,contentStorage);assert.equal(report.complete,false);assert.equal(report.files,10000);assert.equal(report.visited,10000);assert(report.warnings.some(w=>w.message.includes('10,000')));
});
test('capacity cancellation stops without publishing an empty successful report or writing files',async()=>{
  let writes=0;const m=memoryFolder({write:()=>writes++});for(let i=0;i<100;i++)m.files.set(i+'.dat','x');const controller=new AbortController();
  await assert.rejects(measureLibraryUsage(m.root,library,contentStorage,{signal:controller.signal,onProgress:()=>controller.abort()}),e=>e.name==='AbortError');assert.equal(writes,0);
});
test('capacity accounts for incomplete posts without making them visible or altering markers',async()=>{
  const m=await postedFixture();m.owner.files.set('.gameportal-uploading','pending');const report=await measureLibraryUsage(m.root,library,contentStorage);assert.equal(report.complete,false);assert(report.rows.find(r=>r.kind==='posted').uploading);assert.equal((await scan(m.root,{games:{}})).length,0);assert.equal(m.owner.files.get('.gameportal-uploading'),'pending');
});


test('portable folder hints retain only bounded public connection fields',()=>{
 const value={schema:1,libraryId:'a'.repeat(32),name:'Games',path:'//NAS/Games',handle:{secret:1},saves:{secret:1}};
 assert.deepEqual(connectionInfo(value),{schema:1,libraryId:value.libraryId,name:'Games',path:'//NAS/Games'});
 assert.equal(connectionInfo(null),null);
 for(const changes of [{schema:2},{libraryId:'bad'},{name:''},{path:'x'.repeat(1001)},{path:'bad'+String.fromCharCode(0)}])assert.throws(()=>connectionInfo({...value,...changes}));
});
test('portable launcher escapes script-breaking hints and updates its unique marker only',()=>{
 const source='<html><head><script id="folderConnection" type="application/json">null</script></head><body>UNCHANGED</body></html>';
 const info={schema:1,libraryId:'b'.repeat(32),name:'Games',path:'</script><script>alert(1)</script>'};
 const result=portableLauncher(source,info);assert(!result.includes(info.path));assert(result.endsWith('<body>UNCHANGED</body></html>'));
 const data=result.split('application/json">')[1].split('</script>')[0];assert.deepEqual(JSON.parse(data),info);
 assert.equal(portableLauncher(result,info),result);assert.throws(()=>portableLauncher('bad',info));assert.throws(()=>portableLauncher(source+source,info));
});
test('game loading overlaps at most four reads, preserves paths and reuses only this launch HTML', async () => {
  let active=0, peak=0, reads=0;
  const m=memoryFolder({read:async()=>{reads++;active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;}});
  m.files.set('index.html','old');for(let n=0;n<12;n++)m.files.set(`data-${n}.bin`,String(n));
  const child=memoryFolder();child.root.name='assets';child.files.set('image.png','image');m.folders.set('assets',child);
  m.files.set('.hidden','skip');m.files.set('index.html.gameportal.json','skip');m.files.set('archive.zip','skip');
  const html=new TextEncoder().encode('current');
  const files=await readTree(m.root,new Map([['index.html',html]]));
  assert.equal(peak,4);assert.equal(active,0);assert.equal(reads,12);
  assert.deepEqual([...files.keys()],['index.html',...Array.from({length:12},(_,n)=>`data-${n}.bin`),'assets/image.png']);
  assert.equal(files.get('index.html'),html);assert.equal(new TextDecoder().decode(files.get('assets/image.png')),'image');
  m.files.set('index.html','updated');assert.equal(new TextDecoder().decode((await readTree(m.root)).get('index.html')),'updated');
});

test('parallel game loading drains in-flight reads on failure and returns no partial game',async()=>{
  let active=0;
  const m=memoryFolder({read:async name=>{active++;await new Promise(setImmediate);active--;if(name==='1.bin')throw new Error('Disconnected');}});
  for(let n=0;n<12;n++)m.files.set(`${n}.bin`,'data');
  await assert.rejects(readTree(m.root),/Disconnected/);assert.equal(active,0);
  const oversized={async *values(){for(let n=0;n<4;n++)yield {name:`${n}.bin`,kind:'file',getFile:async()=>({size:110*1024*1024,arrayBuffer:async()=>new ArrayBuffer(0)})};}};
  await assert.rejects(readTree(oversized),/200MB/);
  const many=memoryFolder();for(let n=0;n<501;n++)many.files.set(`${n}.bin`,'');
  await assert.rejects(readTree(many.root),/500ファイル/);
});
test('library scans overlap four settings reads while preserving duplicate IDs, errors and fresh metadata',async()=>{
  let active=0,peak=0,writes=0;
  const m=memoryFolder({read:async name=>{if(name.endsWith('.gameportal.json')){active++;peak=Math.max(peak,active);await new Promise(setImmediate);active--;}},write:async()=>writes++});
  const shared='a'.repeat(32);
  for(let n=0;n<10;n++){const path=`game-${n}.html`;m.files.set(path,'<body>Game');m.files.set(path+'.gameportal.json',JSON.stringify({schema:1,id:n<2?shared:await gameId(path),title:'Game '+n,tags:[],developmentEnvironment:'Godot',thumbnail:null}));}
  m.files.set('game-9.html.gameportal.json','broken');
  let games=await scan(m.root,{games:{}});assert.equal(peak,4);assert.equal(active,0);assert.equal(games.length,10);assert.equal(games.filter(g=>g.identityConflict).length,2);assert.match(games.find(g=>g.path==='game-9.html').settingsError,/JSON/);assert.equal(writes,0);
  const path='game-2.html.gameportal.json',data=JSON.parse(m.files.get(path));data.title='Updated';m.files.set(path,JSON.stringify(data));games=await scan(m.root,{games:{}});assert.equal(games.find(g=>g.path==='game-2.html').title,'Updated');assert.equal(writes,0);
});
test('file-backed loading avoids binary reads, rewrites HTML/CSS, enforces size limits and reacquires changed files',async()=>{
  const reads=[];
  const entries=new Map([['index.html','<body>Game'],['style.css','body{color:red}'],['game.wasm','wasm'],['game.pck','pck'],['image.png','image'],['script.js','script']]);
  const folder={async *values(){for(const [name,data] of entries){const file=new File([data],name);file.arrayBuffer=async()=>{reads.push(name);return new TextEncoder().encode(data).buffer;};yield {name,kind:'file',getFile:async()=>file};}}};
  const files=await readTree(folder,new Map(),{fileBacked:true});assert.deepEqual(reads.sort(),['index.html','style.css']);assert(files.get('index.html') instanceof Uint8Array);assert(files.get('style.css') instanceof Uint8Array);
  for(const name of ['game.wasm','game.pck','image.png','script.js'])assert(files.get(name) instanceof File);
  entries.set('game.pck','updated-pck');const latest=await readTree(folder,new Map(),{fileBacked:true});assert.equal(await latest.get('game.pck').text(),'updated-pck');assert.equal(await files.get('game.pck').text(),'pck');
  const oversized={async *values(){yield {name:'game.pck',kind:'file',getFile:async()=>({size:201*1024*1024,arrayBuffer:async()=>{throw Error('Must not read oversized data');}})};}};
  await assert.rejects(readTree(oversized,new Map(),{fileBacked:true}),/200MB/);
});
test('cancelled background scans stop queued reads, drain active reads and never publish a partial list',async()=>{
  const controller=new AbortController();let armed=true,active=0,reads=0;const release=[];
  const m=memoryFolder({read:async name=>{if(armed&&name.endsWith('.gameportal.json')){reads++;active++;await new Promise(resolve=>release.push(resolve));active--;}}});
  for(let n=0;n<20;n++){const path=`game-${n}.html`;m.files.set(path,'Game');m.files.set(path+'.gameportal.json',JSON.stringify({schema:1,id:await gameId(path),title:path,tags:[],developmentEnvironment:'',thumbnail:null}));}
  const pending=scan(m.root,{games:{}},{signal:controller.signal});pending.catch(()=>{});
  while(release.length<4)await new Promise(setImmediate);controller.abort();for(const resolve of release)resolve();
  await assert.rejects(pending,error=>error===controller.signal.reason);assert.equal(active,0);assert.equal(reads,4);
  armed=false;assert.equal((await scan(m.root,{games:{}})).length,20);
  await assert.rejects(scan(m.root,{games:{}},{signal:controller.signal}),error=>error===controller.signal.reason);
});

test('binary codecs preserve full byte values, subarray offsets and old-browser fallbacks',async()=>{
  const {decodeBase64,encodeBase64}=await import('../offline-html/player.js');
  const from=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64'),to=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toBase64');
  const vectors=[new Uint8Array(),new Uint8Array([0]),new Uint8Array([255,128]),Uint8Array.from({length:70003},(_,i)=>i%256).subarray(1,70002)];
  try{
    Object.defineProperty(Uint8Array,'fromBase64',{configurable:true,writable:true,value:undefined});Object.defineProperty(Uint8Array.prototype,'toBase64',{configurable:true,writable:true,value:undefined});
    for(const bytes of vectors){const base64=Buffer.from(bytes).toString('base64');assert.equal(encodeBase64(bytes),base64);assert.deepEqual(decodeBase64(base64),bytes);}
    assert.throws(()=>decodeBase64('!!!'));
    let calls=0;Uint8Array.fromBase64=value=>{calls++;return new Uint8Array(Buffer.from(value,'base64'));};Uint8Array.prototype.toBase64=function(){calls++;return Buffer.from(this).toString('base64');};
    for(const bytes of vectors)assert.deepEqual(decodeBase64(encodeBase64(bytes)),bytes);assert.equal(calls,vectors.length*2);
  }finally{if(from)Object.defineProperty(Uint8Array,'fromBase64',from);else delete Uint8Array.fromBase64;if(to)Object.defineProperty(Uint8Array.prototype,'toBase64',to);else delete Uint8Array.prototype.toBase64;}
});

test('deflated ZIP output is exact across chunks and refuses declared size mismatches',async()=>{
  const {deflateRawSync}=await import('node:zlib');const text='<body>'+Array.from({length:90000},(_,n)=>String(n%1000)).join(',')+'</body>';
  const original=Buffer.from(await(await packageWebFiles([new File([text],'index.html')])).arrayBuffer());
  const endAt=original.length-22,centralAt=original.readUInt32LE(endAt+16),start=30+original.readUInt16LE(26)+original.readUInt16LE(28),raw=new TextEncoder().encode(text),packed=deflateRawSync(raw);
  function archive(delta){const header=Buffer.from(original.subarray(0,start)),central=Buffer.from(original.subarray(centralAt,endAt)),end=Buffer.from(original.subarray(endAt));header.writeUInt16LE(8,8);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(raw.length+delta,22);central.writeUInt16LE(8,10);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(raw.length+delta,24);end.writeUInt32LE(start+packed.length,16);return Buffer.concat([header,packed,central,end]);}
  assert.equal(new TextDecoder().decode((await unpackPrivateZip(archive(0))).get('index.html')),text);
  await assert.rejects(unpackPrivateZip(archive(-1)),/invalid_preview/);await assert.rejects(unpackPrivateZip(archive(1)),/invalid_preview/);
});
test('ZIP and extracted folders share nested wrapper detection without treating macOS metadata as games',async()=>{
  const paths=['Outer/Build/jump.html','Outer/Build/jump.js','Outer/Build/assets/data.bin','.DS_Store','__MACOSX/Outer/._jump.html'];
  assert.deepEqual(preview.webArchiveLayout(paths),{root:'Outer/Build/',entry:'jump.html'});
  assert.deepEqual(preview.webArchiveLayout(['Outer/Build/index.htm','Outer/Build/help.html','Outer/Build/game.js']),{root:'Outer/Build/',entry:'index.htm'});
  assert.equal(preview.webArchiveLayout(['one/index.html','two/index.html']),null);
  assert.equal(preview.webArchiveLayout(['a/'.repeat(8)+'index.html']),null);
  const texts=['<body><script src="jump.js"></script>','fetch("assets/data.bin")','data','metadata','metadata'];
  const input=paths.map((path,i)=>{const file=new File([texts[i]],path.split('/').at(-1));Object.defineProperty(file,'webkitRelativePath',{value:'Extracted/'+path});return file;});
  const zip=await packageWebFiles(input),contents=await unpackPrivateZip(await zip.arrayBuffer());assert.equal(new TextDecoder().decode(contents.get('assets/data.bin')),'data');assert.equal(contents.has('__MACOSX/Outer/._jump.html'),false);assert.equal(contents.has('.DS_Store'),false);
  const check=await checkUpload(input,library,preview,localResources);assert.equal(check.entry,'Outer/Build/jump.html');assert.deepEqual(check.missing,[]);
  const root=memoryFolder();const posted=await postGame(root.root,input,{webArchiveLayout:preview.webArchiveLayout,unpackPrivateZip});const games=await scan(root.root,{games:{}});assert.equal(games.length,1);assert.equal(games[0].path,posted);assert.equal(games[0].entry,'jump.html');assert.equal(games[0].settingsError,'');assert.equal((await readTree(games[0].folder)).has('assets/data.bin'),true);
  const inspection=await inspectLibrary(root.root,library,preview);assert.equal(inspection.issues.some(issue=>issue.path.includes('__MACOSX')),false);
});
