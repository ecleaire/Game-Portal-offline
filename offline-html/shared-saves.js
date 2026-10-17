// Immutable, per-game snapshots: concurrent PCs publish different filenames.
// Vector clocks detect concurrent progress without trusting wall-clock times.
import {readWithSignal} from './read-task.js';
const id=/^[a-f0-9]{32}$/;
export const saveText=data=>JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(key=>[key,data[key]])));
export function validClock(clock){return !!clock&&typeof clock==='object'&&!Array.isArray(clock)&&Object.keys(clock).length<=128&&Object.entries(clock).every(([key,n])=>id.test(key)&&Number.isSafeInteger(n)&&n>0);}
const covers=(a,b)=>Object.entries(b).every(([key,n])=>(a[key]||0)>=n);
const combine=records=>{const clock={};for(const record of records)for(const [key,n]of Object.entries(record.clock))clock[key]=Math.max(clock[key]||0,n);return clock;};
export function validSnapshot(value,libraryId,gameId,validSave){return !!value&&value.schema===1&&value.libraryId===libraryId&&value.gameId===gameId&&id.test(value.revision)&&id.test(value.deviceId)&&validClock(value.clock)&&value.clock[value.deviceId]>0&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt))&&validSave(value.data);}
export function saveHeads(records){return records.filter(a=>!records.some(b=>a!==b&&covers(b.clock,a.clock)&&!covers(a.clock,b.clock)));}
const cancelled=signal=>signal?.throwIfAborted();
async function checkRoot(root,libraryId,tools,signal){if(await readWithSignal(()=>tools.loadLibraryId(root),signal)!==libraryId)throw Error('セーブの共有先IDが変わりました。フォルダーを再接続してください。');}
async function directory(root,gameId,create=false){try{return await(await(await root.getDirectoryHandle('.gameportal',{create})).getDirectoryHandle('shared-saves',{create})).getDirectoryHandle(gameId,{create});}catch(error){if(!create&&error.name==='NotFoundError')return null;throw error;}}
async function readRecords(dir,libraryId,gameId,local,signal){
  const records=[];let total=0,count=0;if(!dir)return records;
  const read=operation=>readWithSignal(operation,signal),iterator=dir.values()[Symbol.asyncIterator]();
  for(;;){
    const next=await read(()=>iterator.next());if(next.done)break;const entry=next.value;
    cancelled(signal);if(entry.kind!=='file'||!/^([a-f0-9]{32})\.json$/.test(entry.name))throw Error('共有セーブに不明なファイルがあります。元データを残して確認してください。');
    if(++count>256)throw Error('共有セーブの記録が多すぎます。フォルダーをバックアップして確認してください。');
    const file=await read(()=>entry.getFile());total+=file.size;if(file.size>510000||total>16*1024*1024)throw Error('共有セーブの容量が大きすぎます。');
    const text=await read(()=>file.text());let record;try{record=JSON.parse(text);}catch{throw Error('共有セーブが壊れているか保存途中です。保存したPCで同期を再試行してください。');}
    if(!validSnapshot(record,libraryId,gameId,local.validSave)||entry.name!==record.revision+'.json')throw Error('共有セーブの形式・作品IDを確認してください。');
    records.push(record);
  }
  return records;
}
export async function syncSave(root,libraryId,gameId,tools,local,{signal,pullOnly=false,resolution=null}={}){
  if(!id.test(libraryId)||!id.test(gameId))throw Error('セーブのライブラリ・作品IDを確認してください。');
  const read=operation=>readWithSignal(operation,signal);
  cancelled(signal);await checkRoot(root,libraryId,tools,signal);
  let current=await read(()=>local.loadSaveSync(libraryId,gameId)),dir=await read(()=>directory(root,gameId));
  const finish=async()=>{
    // Persisted intent makes an uncertain close retry the SAME snapshot only.
    const record=current.state.pending,text=JSON.stringify(record),name=record.revision+'.json';
    if(await root.queryPermission({mode:'readwrite'})!=='granted')throw Error('セーブを共有する保存許可が必要です。設定の「今すぐセーブを同期」を押してください。');
    await checkRoot(root,libraryId,tools);dir||=await directory(root,gameId,true);
    let existing=null;try{existing=await(await(await dir.getFileHandle(name)).getFile()).text();}catch(error){if(error.name!=='NotFoundError')throw error;}
    if(existing&&existing!==text)throw Error('共有セーブの確認記録が一致しません。元データを保持しています。');
    if(!existing){try{await tools.writeFile(dir,name,text);}catch(cause){throw Error('セーブの共有結果を確認できません。このPCのデータと確認記録を残しました。同じPCで同期を再試行してください。',{cause});}}
    if(await(await(await dir.getFileHandle(name)).getFile()).text()!==text)throw Error('共有セーブの保存結果が一致しません。再試行してください。');
    await checkRoot(root,libraryId,tools);
    await local.commitSaveSync(libraryId,gameId,current,{schema:1,base:saveText(record.data),clock:record.clock,pending:null});
    current=await local.loadSaveSync(libraryId,gameId);
  };
  if(current.state.pending){if(pullOnly)throw Error('前回のセーブ共有を確認できていません。設定から同期を再試行してください。');await finish();}
  cancelled(signal);
  const records=await readRecords(dir,libraryId,gameId,local,signal),heads=saveHeads(records),remoteClock=combine(records),clock=combine([...records,{clock:current.state.clock}]),dataText=saveText(current.data),base=current.state.base;
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(records.toSorted((a,b)=>a.revision.localeCompare(b.revision))))))].map(n=>n.toString(16).padStart(2,'0')).join('');
  cancelled(signal);
  if(resolution&&resolution.fingerprint!==fingerprint)throw Error('ほかのPCでセーブが変わりました。もう一度確認してください。');
  const distinct=new Set(heads.map(r=>saveText(r.data))),remote=heads[0],dirty=base===null?Object.keys(current.data).length>0:dataText!==base;
  const rolledBack=!!remote&&dataText!==saveText(remote.data)&&covers(current.state.clock,remoteClock)&&!covers(remoteClock,current.state.clock);
  const conflict=distinct.size>1||rolledBack||!remote&&base!==null&&Object.keys(current.data).length>0||!!remote&&dirty&&dataText!==saveText(remote.data)&&!covers(current.state.clock,remoteClock);
  if(conflict&&!resolution)return {state:'conflict',heads,fingerprint,reason:rolledBack||!remote?'共有セーブが見つからないか、このPCより古くなっています。このPCのデータを残し、使うセーブを確認してください。':null};
  let chosen=current.data;
  if(resolution){
    if(resolution.revision!=='local'){const selected=heads.find(r=>r.revision===resolution.revision);if(!selected)throw Error('選択したセーブが変わりました。');chosen=selected.data;}
  }else if(remote&&(!dirty||dataText===saveText(remote.data))){
    cancelled(signal);await checkRoot(root,libraryId,tools,signal);
    cancelled(signal);
    await local.commitSaveSync(libraryId,gameId,current,{schema:1,base:saveText(remote.data),clock,pending:null},remote.data);
    return {state:dataText===saveText(remote.data)?'unchanged':'downloaded'};
  }else if(!dirty)return {state:'unchanged'};
  if(pullOnly)return {state:'local'};
  cancelled(signal);
  if(await read(()=>root.queryPermission({mode:'readwrite'}))!=='granted')throw Error('セーブを共有する保存許可が必要です。設定の「今すぐセーブを同期」を押してください。');
  const deviceId=await local.saveDeviceId();clock[deviceId]=(clock[deviceId]||0)+1;
  cancelled(signal);
  const record={schema:1,libraryId,gameId,revision:crypto.randomUUID().replaceAll('-',''),deviceId,clock,createdAt:new Date().toISOString(),data:chosen};
  if(!validSnapshot(record,libraryId,gameId,local.validSave))throw Error('セーブの共有履歴が上限に達しました。元データを残して確認してください。');
  // After persisting this intent, drain publication/verification even if canceled.
  await local.commitSaveSync(libraryId,gameId,current,{...current.state,pending:record},chosen);
  current=await local.loadSaveSync(libraryId,gameId);await finish();
  // Remove only observed ancestors after verified publication, retaining ten
  // snapshots. New concurrent files are never deleted by this pass.
  const generations=value=>Object.values(value.clock).reduce((sum,n)=>sum+n,0);
  const keep=new Set([record.revision,...heads.map(r=>r.revision),...records.toSorted((a,b)=>generations(b)-generations(a)).slice(0,10).map(r=>r.revision)]);
  for(const old of records)if(!keep.has(old.revision)&&covers(record.clock,old.clock))try{await dir.removeEntry(old.revision+'.json');}catch{/* Safe to retain an extra backup. */}
  return {state:'uploaded'};
}
