import {checkCompatibility,LAUNCHER_VERSION} from './compatibility.js';
import {readWithSignal} from './read-task.js';

export const INFORMATION_LIMIT=64*1024*1024;
const LIMIT=1000,fields=['title','tags','developmentEnvironment','thumbnail','description','instructions'];
const bytes=text=>new TextEncoder().encode(text).length;
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const plans=new WeakMap(),archives=new WeakSet();
function values(game){return Object.fromEntries(fields.map(key=>[key,key==='tags'?[...game.tags]:game[key]??(key==='thumbnail'?null:'')]));}
function validateGame(record,library){
 if(!record||!validId(record.id)||!['html','zip','pyxapp','exe'].includes(record.kind))throw Error('ゲーム情報の形式を確認してください。');
 library.safePath(record.path);
 if(record.path.split('/').some(part=>/^\.gameportal(?:$|[-.])/i.test(part))||/\.gameportal\.json$/i.test(record.path))throw Error('ゲーム情報の保存場所を確認してください。');
 if(!Array.isArray(record.tags)||!record.tags.every(tag=>typeof tag==='string'&&tag.trim()===tag&&tag.length&& !/[,、\r\n]/.test(tag))||new Set(record.tags).size!==record.tags.length)throw Error('タグの形式を確認してください。');
 const data=library.parseGameSettings(JSON.stringify({schema:1,id:record.id,...values(record)}),record.path);
 const result={id:record.id,path:record.path,kind:record.kind,...values(data)};
 Object.freeze(result.tags);return Object.freeze(result);
}
export function parseInformationArchive(text,library){
 if(typeof text!=='string'||bytes(text)>INFORMATION_LIMIT)throw Error('ゲーム情報ファイルは64MB以内にしてください。');
 let data;try{data=JSON.parse(text);}catch{throw Error('ゲーム情報ファイルのJSONが壊れています。');}
 if(!data||data.schema!==1||data.type!=='GAME-PORTAL-GAME-INFORMATION'||!Array.isArray(data.games)||!data.games.length||data.games.length>LIMIT||data.libraryId!==null&&!validId(data.libraryId))throw Error('GAME PORTALから書き出したゲーム情報ファイルを選んでください。');
 const ids=new Set(),paths=new Set(),games=data.games.map(record=>{const game=validateGame(record,library),path=game.path.toLowerCase();if(ids.has(game.id)||paths.has(path))throw Error('同じ作品IDや保存場所が重複しています。');ids.add(game.id);paths.add(path);return game;});
 const archive=Object.freeze({schema:1,type:data.type,libraryId:data.libraryId,games:Object.freeze(games)});archives.add(archive);return archive;
}
async function together(items,operation,signal){
 let cursor=0,failure;const result=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(!failure&&!signal?.aborted&&cursor<items.length){const index=cursor++;try{result[index]=await operation(items[index],index);}catch(error){failure=error;}}}));
 signal?.throwIfAborted();if(failure)throw failure;return result;
}
async function snapshot(root,game,library,signal){
 if(game.settingsError||game.contentPending)throw Error('「'+game.title+'」は設定や更新状態の確認が必要です。');
 const saved=await readWithSignal(()=>library.loadGameSettings(root,game.path),signal);
 if(saved.text!==game.settingsText)throw Error('「'+game.title+'」の情報が更新されています。一覧を更新してからやり直してください。');
 let thumbnail=game.thumbnail||null;
 if(thumbnail===true){
  const file=await readWithSignal(()=>library.getFile(root,'.gameportal/thumbnails/'+game.id+'.webp'),signal);
  if(file.size>1500*1024)throw Error('サムネイルが大きすぎます。');
  const data=new Uint8Array(await readWithSignal(()=>file.arrayBuffer(),signal));let binary='';for(let at=0;at<data.length;at+=0x8000)binary+=String.fromCharCode(...data.subarray(at,at+0x8000));thumbnail='data:image/webp;base64,'+btoa(binary);
 }
 return validateGame({...game,thumbnail},library);
}
export async function createInformationArchive(root,games,library,{signal,onProgress,metadataRevision}={}){
 if(!Array.isArray(games)||!games.length||games.length>LIMIT)throw Error('保存するゲームを1〜1000件選んでください。');
 await readWithSignal(()=>checkCompatibility(root),signal);
 const libraryId=await readWithSignal(()=>library.loadLibraryId(root),signal),legacy=await readWithSignal(()=>library.loadMetadata(root),signal);
 if(metadataRevision!==undefined&&legacy.revision!==metadataRevision)throw Error('ゲーム情報が更新されています。一覧を更新してください。');
 let total=0,completed=0;const records=await together(games,async game=>{const record=await snapshot(root,game,library,signal);total+=bytes(JSON.stringify(record));if(total>INFORMATION_LIMIT-4096)throw Error('情報が64MBを超えます。選ぶゲームを減らしてください。');onProgress?.(++completed,games.length);return record;},signal);
 if(await readWithSignal(()=>library.loadLibraryId(root),signal)!==libraryId||(await readWithSignal(()=>library.loadMetadata(root),signal)).revision!==legacy.revision)throw Error('保存先やゲーム情報が変わりました。一覧を更新してください。');
 const text=JSON.stringify({schema:1,type:'GAME-PORTAL-GAME-INFORMATION',launcherVersion:LAUNCHER_VERSION,libraryId,exportedAt:new Date().toISOString(),games:records});
 if(bytes(text)>INFORMATION_LIMIT||new Set(records.map(record=>record.id)).size!==records.length||new Set(records.map(record=>record.path.toLowerCase())).size!==records.length)throw Error('情報が大きすぎるか、作品ID・保存場所が重複しています。');return text;
}
export function informationFilename(title){return 'ゲーム情報_'+(title?Array.from(title).slice(0,50).join('').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_'):new Date().toISOString().slice(0,10))+'.json';}
export async function planInformationImport(root,archive,games,library,{signal,onProgress,blockedPaths=[]}={}){
 if(!archives.has(archive))throw Error('ゲーム情報ファイルを確認し直してください。');
 await readWithSignal(()=>checkCompatibility(root),signal);const libraryId=await readWithSignal(()=>library.loadLibraryId(root),signal);
 if(!validId(libraryId))throw Error('編集モードをオンにして保存先を初期設定してください。');
 const ids=new Map(),paths=new Map();for(const game of games){for(const [map,key]of[[ids,game.id],[paths,game.path]])map.set(key,[...(map.get(key)||[]),game]);}
 let completed=0;const rows=await together(archive.games,async(source,index)=>{
  const found=ids.get(source.id)||paths.get(source.path)||[],target=found.length===1?found[0]:null;let reason='',current=null;
  if(found.length>1)reason='同じ作品ID・保存場所が重複しています。';
  else if(!target)reason='保存先に対応するゲームがありません。';
  else if(target.kind!==source.kind)reason='ゲームの形式が一致しません。';
  else if(target.settingsError||target.contentPending||blockedPaths.includes(target.path))reason='設定・更新・保存結果の確認が必要です。';
  else {current=await snapshot(root,target,library,signal);}
  const unchanged=!!current&&JSON.stringify(values(current))===JSON.stringify(values(source));
  onProgress?.(++completed,archive.games.length);
  return Object.freeze({index,source,target:target?Object.freeze({...target}):null,blocked:!!reason,reason,unchanged,exact:target?.id===source.id,sameLibrary:archive.libraryId===libraryId});
 },signal);
 const used=new Set();for(const row of rows)if(!row.blocked){if(used.has(row.target.path))throw Error('複数の情報が同じゲームを指しています。個別に読み込んでください。');used.add(row.target.path);}
 if(await readWithSignal(()=>library.loadLibraryId(root),signal)!==libraryId)throw Error('保存先が変わりました。');
 const plan=Object.freeze({libraryId,rows:Object.freeze(rows)});plans.set(plan,{root});return plan;
}
export async function applyInformationImport(root,plan,indexes,library,{signal,onProgress,beforeWrite}={}){
 if(plans.get(plan)?.root!==root||!Array.isArray(indexes)||!indexes.length||new Set(indexes).size!==indexes.length)throw Error('読み込む情報を確認し直してください。');
 const selected=indexes.map(index=>{const row=plan.rows[index];if(!Number.isInteger(index)||!row||row.blocked||row.unchanged)throw Error('読み込めないゲームが選ばれています。');return row;});
 const check=async()=>{await readWithSignal(()=>checkCompatibility(root),signal);if(await readWithSignal(()=>library.loadLibraryId(root),signal)!==plan.libraryId)throw Error('保存先のIDが変わりました。');};
 const completed=[];let current=null,writing=false;
 try{
  await check();
  // Check every selected target before the first write. The normal per-game
  // writer checks again under its lock and retains history/uncertain receipts.
  await together(selected,async row=>{const parts=library.safePath(row.target.path);let folder=root;for(const name of parts.slice(0,-1))folder=await readWithSignal(()=>folder.getDirectoryHandle(name),signal);await readWithSignal(()=>folder.getFileHandle(parts.at(-1)),signal);const now=await readWithSignal(()=>library.loadGameSettings(root,row.target.path),signal);if(now.text!==row.target.settingsText)throw Error('「'+row.target.title+'」は確認後に変更されています。読み込みをやり直してください。');},signal);
  for(const row of selected){current=row;signal?.throwIfAborted();await check();await beforeWrite?.(row);signal?.throwIfAborted();writing=true;
   await library.saveGameSettings(root,row.target,values(row.source));writing=false;completed.push(row.index);onProgress?.(completed.length,selected.length,row.index);
  }
  return {completed,cancelled:false,error:null};
 }catch(error){return {completed,cancelled:!writing&&!!signal?.aborted,error:!writing&&signal?.aborted?null:error,failed:current?.index??null};}
}
