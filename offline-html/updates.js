// Publish a complete hidden release by changing one small selector file.
// Original game bytes and all earlier releases remain available for recovery.
const selector='.gameportal-content.json',pendingName='.gameportal-content-pending.json';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function canUpdateGame(game){return !!game&&game.kind!=='exe'&&/^game-[0-9a-f-]{36}\//.test(game.path)&&uuid.test(game.path.split('/')[0].slice(5));}
async function ownerOf(root,path,tools){tools.safePath(path);if(!canUpdateGame({path}))throw new Error('本体更新は「投稿」で追加した作品に対応しています。');return root.getDirectoryHandle(path.split('/')[0]);}
async function optionalText(dir,name,limit=name===pendingName?2500000:600000){try{const file=await(await dir.getFileHandle(name)).getFile();if(file.size>limit)throw new Error('本体更新の設定が大きすぎます。');return await file.text();}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
function record(value,path,tools){
  if(!value||!['html','zip','pyxapp'].includes(value.kind))throw new Error('本体更新の形式を確認してください。');tools.safePath(value.entry);
  const extension=value.entry.split('.').at(-1).toLowerCase();if((value.kind==='html'?!['html','htm'].includes(extension):extension!==value.kind))throw new Error('本体更新の起動ファイルが一致しません。');
  if(value.version===null){if(value.entry!==path.split('/').slice(1).join('/'))throw new Error('元の本体の保存先が一致しません。');return value;}
  if(!uuid.test(value.version)||!Array.isArray(value.files)||!value.files.length||value.files.length>500)throw new Error('本体更新の記録を確認してください。');
  let bytes=0;const names=new Set();for(const file of value.files){tools.safePath(file.path);if(names.has(file.path.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||!/^[0-9a-f]{64}$/.test(file.sha256))throw new Error('本体更新のファイル記録が不正です。');names.add(file.path.toLowerCase());bytes+=file.size;}
  if(bytes>200*1024*1024||!value.files.some(f=>f.path===value.entry))throw new Error('本体更新の容量・起動ファイルを確認してください。');return value;
}
function parseSelector(text,path,id,tools){
  const value=JSON.parse(text);if(value.schema!==1||value.gamePath!==path||!/^[0-9a-f]{32}$/.test(value.gameId)||id&&value.gameId!==id||!uuid.test(value.revision))throw new Error('本体更新の作品ID・保存先が一致しません。');
  record(value.active,path,tools);record(value.previous,path,tools);return value;
}
async function selectedState(owner,path,id,tools){const text=await optionalText(owner,selector);let value=null;if(text)value=parseSelector(text,path,id,tools);return {text,value};}
async function location(owner,release,tools){let folder=owner;if(release.version!==null)folder=await(await owner.getDirectoryHandle('.gameportal-versions')).getDirectoryHandle(release.version);for(const name of tools.safePath(release.entry).slice(0,-1))folder=await folder.getDirectoryHandle(name);const entry=release.entry.split('/').at(-1),handle=await folder.getFileHandle(entry);return {folder,entry,handle,kind:release.kind};}
export async function resolveGameContent(root,path,tools){
  if(!canUpdateGame({path}))return {};
  let pending=false;
  try{const owner=await ownerOf(root,path,tools);pending=await optionalText(owner,pendingName)!==null;const state=await selectedState(owner,path,null,tools);
    if(!state.value)return {contentRevision:null,contentPending:pending,contentWarning:state.text===''?'本体更新の設定が空のため、最初の本体を使用しています。更新状態・バックアップを確認してください。':''};
    return {...await location(owner,state.value.active,tools),contentRevision:state.value.revision,contentPrevious:true,contentPending:pending,contentGameId:state.value.gameId};
  }catch(error){return {contentError:'ゲーム本体の更新設定を確認してください：'+error.message,contentPending:pending};}
}
async function validateIdentity(root,game,libraryId,tools){if(await tools.loadLibraryId(root)!==libraryId)throw new Error('保管フォルダーのIDが変わりました。再接続してください。');const settings=await tools.loadGameSettings(root,game.path);if(settings.data?.id!==game.id)throw new Error('更新対象の作品ID・設定が変わりました。再読み込みしてください。');}
async function verifyRelease(owner,release,tools){
  await location(owner,release,tools);if(release.version===null)return;
  const dir=await(await owner.getDirectoryHandle('.gameportal-versions')).getDirectoryHandle(release.version);
  for(const item of release.files){const file=await tools.getFile(dir,item.path);if(file.size!==item.size||await digest(await file.arrayBuffer())!==item.sha256)throw new Error('更新ファイルを確認できません。元の本体を保持しています：'+item.path);}
}
function unknown(error){const result=new Error('更新結果未確認です。元の本体と更新ファイルは保持しています。再更新せず、接続を戻して「更新状態を確認」を押してください。'+(error?.message?' '+error.message:''));result.code='CONTENT_UPDATE_UNCONFIRMED';return result;}
async function commit(root,owner,game,libraryId,before,next,tools){
  const after=JSON.stringify(next,null,2)+'\n';parseSelector(after,game.path,game.id,tools);
  if(new TextEncoder().encode(after).length>600000)throw new Error('更新ファイル一覧が大きすぎます。ファイル名・件数を整理してください。元の本体は保持しています。');
  const handle=await owner.getFileHandle(selector,{create:true}),writer=await handle.createWritable({mode:'exclusive'});let attempted=false;
  try{
    const current=await optionalText(owner,selector);if((current||null)!==(before.text||null))throw new Error('他の画面でゲーム本体が更新されています。再読み込みしてください。');
    if(await optionalText(owner,pendingName)!==null)throw new Error('前回の更新結果が未確認です。先に「更新状態を確認」を押してください。');
    await validateIdentity(root,game,libraryId,tools);await verifyRelease(owner,next.active,tools);
    const receipt={schema:1,gamePath:game.path,gameId:game.id,libraryId,before:before.text||null,after};
    await tools.writeFile(owner,pendingName,JSON.stringify(receipt));
    attempted=true;await writer.write(after);await writer.close();
    if(await optionalText(owner,selector)!==after)throw new Error('更新後の確認内容が一致しません。');
    await owner.removeEntry(pendingName);return next;
  }catch(error){await writer.abort().catch(()=>{});if(attempted)throw unknown(error);if(before.text===null)try{if(await optionalText(owner,selector)===''&&await optionalText(owner,pendingName)===null)await owner.removeEntry(selector);}catch{}throw error;}
}
export async function replaceGameContent(root,game,input,libraryId,tools,preview,checkUpload,onProgress=()=>{}){
  if(game.settingsError)throw new Error('作品の設定を確認してから更新してください。');
  const files=[...input],check=await checkUpload(files,tools,preview),owner=await ownerOf(root,game.path,tools);
  await validateIdentity(root,game,libraryId,tools);const before=await selectedState(owner,game.path,game.id,tools);
  if((before.value?.revision||null)!==(game.contentRevision||null))throw new Error('他の画面でゲーム本体が更新されています。再読み込みしてください。');
  if(await optionalText(owner,pendingName)!==null)throw new Error('前回の更新結果が未確認です。先に「更新状態を確認」を押してください。');
  const single=files.length===1&&!files[0].webkitRelativePath,entry=single?files[0].name:check.entry,kind=/\.pyxapp$/i.test(entry)?'pyxapp':/\.zip$/i.test(entry)?'zip':'html';
  const version=crypto.randomUUID(),versions=await owner.getDirectoryHandle('.gameportal-versions',{create:true}),staged=await versions.getDirectoryHandle(version,{create:true}),records=[];
  // Each file is verified against its source snapshot before publishing.
  try{for(let i=0;i<files.length;i++){const path=files[i].webkitRelativePath?files[i].webkitRelativePath.split('/').slice(1).join('/'):files[i].name;const bytes=await files[i].arrayBuffer();await tools.writeFile(staged,path,bytes);records.push({path,size:bytes.byteLength,sha256:await digest(bytes)});onProgress({current:i+1,total:files.length});}}
  catch(cause){const error=new Error('更新ファイルの準備に失敗しました。元の本体を保持しています。接続を確認し、「起動を再試行」で元のゲームを開けます：'+cause.message,{cause});error.name=cause.name;throw error;}
  const original={version:null,entry:game.path.split('/').slice(1).join('/'),kind:game.kind};
  const next={schema:1,gamePath:game.path,gameId:game.id,revision:crypto.randomUUID(),active:{version,entry,kind,files:records},previous:before.value?.active||original,updatedAt:new Date().toISOString()};
  await tools.writeFile(staged,'.gameportal-before.json',JSON.stringify({before:before.text||null}));
  return commit(root,owner,game,libraryId,before,next,tools);
}
export async function restoreGameContent(root,game,libraryId,tools){
  const owner=await ownerOf(root,game.path,tools),before=await selectedState(owner,game.path,game.id,tools);
  if(!before.value||(before.value.revision!==(game.contentRevision||null)))throw new Error('更新状態が変わりました。再読み込みしてください。');
  const next={...before.value,active:before.value.previous,previous:before.value.active,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()};return commit(root,owner,game,libraryId,before,next,tools);
}
export async function verifyContentUpdate(root,game,libraryId,tools){
  await validateIdentity(root,game,libraryId,tools);const owner=await ownerOf(root,game.path,tools),text=await optionalText(owner,pendingName);if(text===null)return {state:'none'};
  const receipt=JSON.parse(text);if(receipt.schema!==1||receipt.gamePath!==game.path||receipt.gameId!==game.id||receipt.libraryId!==libraryId||typeof receipt.after!=='string'||receipt.before!==null&&typeof receipt.before!=='string')throw new Error('本体更新の確認記録を確認してください。');
  const desired=parseSelector(receipt.after,game.path,game.id,tools);if(receipt.before)parseSelector(receipt.before,game.path,game.id,tools);
  const current=await optionalText(owner,selector);if(current===receipt.after){await verifyRelease(owner,desired.active,tools);await owner.removeEntry(pendingName);return {state:'confirmed'};}
  if((current||null)===(receipt.before||null)){await verifyRelease(owner,desired.previous,tools);if(current==='')await owner.removeEntry(selector);await owner.removeEntry(pendingName);return {state:'not-saved'};}
  return {state:'changed'};
}
export async function inspectGameContent(root,game,tools){
  const owner=await ownerOf(root,game.path,tools),state=await selectedState(owner,game.path,game.id,tools),issues=[];
  if(await optionalText(owner,pendingName)!==null)issues.push('ゲーム本体の更新結果が未確認です。「本体を更新」から更新状態を確認してください。');
  if(state.text==='')issues.push('本体更新の設定が空です。最初の本体を使用しています。更新状態・バックアップを確認してください。');
  if(state.value)await verifyRelease(owner,state.value.active,tools);
  return issues;
}
// Read-only references for capacity reports, including libraries that cannot play.
export async function describeContentStorage(root,ownerName,tools){
  const owner=await ownerOf(root,ownerName+'/entry.html',tools);
  const text=await optionalText(owner,selector),pending=await optionalText(owner,pendingName);
  let value=null;
  if(text!==null){
    if(!text)throw new Error('本体更新の設定が空です。保存版の用途を確定できません。');
    const candidate=JSON.parse(text);tools.safePath(candidate.gamePath);
    if(candidate.gamePath.split('/')[0]!==ownerName)throw new Error('本体更新の保存先が一致しません。');
    value=parseSelector(text,candidate.gamePath,null,tools);
  }
  return {active:value?.active.version??null,previous:value?.previous.version??null,pending:pending!==null,
    fingerprint:await digest(new TextEncoder().encode(JSON.stringify([text,pending])))};
}
