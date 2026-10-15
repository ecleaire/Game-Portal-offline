const $ = selector => document.querySelector(selector);
// Keep only the initial UI shell; copy the bundled runtime lazily on export.
const exportRuntimeNode=$('#runtime'),exportAppNode=document.currentScript;
function initialLauncherShell(node){
  const copy=node.cloneNode(false);
  if(node===exportRuntimeNode){copy.textContent='__PORTAL_EXPORT_RUNTIME__';return copy;}
  if(node===exportAppNode){copy.textContent='__PORTAL_EXPORT_APP__';return copy;}
  for(const child of node.childNodes)copy.append(initialLauncherShell(child));return copy;
}
const originalLauncher='<!doctype html>\n'+initialLauncherShell(document.documentElement).outerHTML;
function launcherSource(){return originalLauncher.replace('__PORTAL_EXPORT_RUNTIME__',()=>exportRuntimeNode.textContent).replace('__PORTAL_EXPORT_APP__',()=>exportAppNode.textContent);}
const folderScope=location.pathname;
let portableConnection=null,connectionError='',lastFolderRevision='',folderWatchPromise=null,folderChannel=null;
try{portableConnection=folderSharing.connectionInfo(JSON.parse($('#folderConnection').textContent));}catch(error){connectionError=error.message;}
try{folderChannel=new BroadcastChannel('game-portal-folder:'+folderScope);folderChannel.onmessage=()=>{void checkSharedFolder();};}catch{}

let root = null, remembered = null, metadata = null, games = [], editing = null, busy = false, localLibrary = null;
let openedGame = null, stopGame = null, pendingSave = null, saveTimer, flushing = null, activePlay = null, closingPlayer = false;
let editingEnabled = false, starting = true;
let inspectionRoot = null, inspectionReport = null, selectedHistory = null, capturedImage = null;
let usageReport=null,usageController=null,usageLimit=60;
let postSelection = [], editImageRevision = 0;
let postCheck=null,postCheckRevision=0,cropBitmap=null,renderLimit=60,searchTimer;
let imageProcessing=false,imageError='',playRevision=0;
let settingsReceipts=[];
let contentTarget=null,contentSelection=[],contentCheck=null,contentCheckRevision=0;
function contentControls(){
  $('#confirmContentUpdate').disabled=!editingEnabled||syncPaused||!contentTarget||!contentCheck?.valid||!!contentTarget.contentPending;
  $('#restoreContent').disabled=!editingEnabled||syncPaused||!contentTarget?.contentPrevious||!!contentTarget.contentPending;
  $('#verifyContentUpdate').hidden=!contentTarget?.contentPending;
  for(const input of document.querySelectorAll('#updateContent input'))input.disabled=!!contentTarget?.contentPending;
}
let syncPromise=null, syncPaused=false, compatibilityProblem='';
function compatibilityFailure(error){
  if(error.code!=='LIBRARY_INCOMPATIBLE')return;
  compatibilityProblem=error.message;syncPaused=true;
  $('#compatibilityNotice').textContent=error.message;$('#compatibilityNotice').hidden=false;
  $('#compatibilityStatus').textContent=error.message;syncStatus(error.message);
  if($('#player').open)$('#playerStatus').textContent=error.message;
}
async function checkLibraryCompatibility(handle=root){
  try{
    const info=await compatibilityTools.checkCompatibility(handle);
    if(compatibilityProblem&&$('#playerStatus').textContent===compatibilityProblem)$('#playerStatus').textContent='互換性を確認しました。プレイ中のゲームは続けられます。';
    compatibilityProblem='';$('#compatibilityNotice').hidden=true;
    $('#compatibilityStatus').textContent=info?`このHTML：v${compatibilityTools.LAUNCHER_VERSION} ／ このフォルダーの必要版：v${info.minLauncherVersion} 以上（対応しています）`:'互換性情報は未設定です。追加・編集を有効にすると保存します。共有する全PCのHTMLを先に交換してください。';
    return info;
  }catch(error){compatibilityFailure(error);throw error;}
}
const syncStatus=message=>{$('#syncStatus').textContent=message;$('#syncStatus').hidden=!syncPaused||!!compatibilityProblem;};
async function requireLibraryConnection(forWrite=false){
  if(!root||syncPaused)throw new Error(compatibilityProblem||'保管フォルダーへの接続を確認し、再読み込み・再接続してください。');
  await checkLibraryCompatibility();
  if(localLibrary&&await library.loadLibraryId(root)!==localLibrary){syncPaused=true;$('#reconnect').hidden=false;syncStatus('保管フォルダーのIDが変わりました。設定からフォルダーを指定し直してください。');throw new Error('保管フォルダーのIDが変わりました。フォルダーを指定し直してください。');}
}
try { $('#rememberFolder').checked=localStorage.getItem('game-portal.remember-folder')!=='false';$('#autoSync').checked=localStorage.getItem('game-portal.auto-sync')!=='false'; } catch {}
const pendingSettings=path=>settingsReceipts.some(a=>a.libraryId===localLibrary&&a.gamePath===path);
library.setSettingsSaveObserver(async(stage,attempt)=>{
  const receipt={...attempt,libraryId:localLibrary};
  await localState.trackSettingsReceipt(receipt,stage!=='started');
  settingsReceipts=await localState.loadSettingsReceipts();
});
function renderSaveVerification(rebuild=false){
  $('#saveVerificationNotice').hidden=!settingsReceipts.length;$('#saveVerificationNoticeText').textContent=`保存結果未確認の操作が${settingsReceipts.length}件あります。再保存せず確認してください。`;
  if(rebuild){$('#saveVerificationResults').replaceChildren();for(const receipt of settingsReceipts){const box=document.createElement('div');box.className='maintenance-item';const path=document.createElement('strong');path.textContent=receipt.gamePath;const text=document.createElement('p');text.textContent=receipt.libraryId===localLibrary?'この保管フォルダーで確認できます。':'保存した保管フォルダーを指定してください。';box.append(path,text);$('#saveVerificationResults').append(box);}}
  $('#verifySettingsSaves').disabled=!root||!settingsReceipts.some(a=>a.libraryId===localLibrary);
  for(const button of document.querySelectorAll('[data-verify-settings]'))button.hidden=!settingsReceipts.some(a=>a.libraryId===localLibrary);
}
function openSaveVerification(){renderSaveVerification(true);$('#saveVerification').showModal();}
$('#openSaveVerification').onclick=openSaveVerification;
for(const button of document.querySelectorAll('[data-verify-settings]'))button.onclick=openSaveVerification;
$('#verifySettingsSaves').onclick=()=>action(async()=>{
  await requireLibraryConnection(editingEnabled);
  if(!root)throw new Error('保存した保管フォルダーを指定してください。');
  if(await root.requestPermission({mode:editingEnabled?'readwrite':'read'})!=='granted')throw new Error('保管フォルダーへのアクセスを許可してください。');
  settingsReceipts=await localState.loadSettingsReceipts();const results=[];let confirmedAny=false;
  for(const receipt of [...settingsReceipts].filter(a=>a.libraryId===localLibrary)){
    const result=await library.verifySettingsSave(root,receipt);const box=document.createElement('div');box.className='maintenance-item';const label=document.createElement('strong');label.textContent=receipt.gamePath;const text=document.createElement('p');
    if(result.state==='confirmed'){
      if(receipt.uploadFolder){if(!editingEnabled)throw new Error('追加済み作品を一覧へ反映するには編集を有効にしてください。');if(!/^game-[0-9a-f-]+$/.test(receipt.uploadFolder)||receipt.gamePath.split('/')[0]!==receipt.uploadFolder)throw new Error('投稿確認の保存先が一致しません。');const dir=await root.getDirectoryHandle(receipt.uploadFolder);try{await dir.removeEntry('.gameportal-uploading');}catch(error){if(error.name!=='NotFoundError')throw error;}}
      await localState.trackSettingsReceipt(receipt,true);settingsReceipts=await localState.loadSettingsReceipts();confirmedAny=true;text.textContent='保存済みを確認しました。再保存は不要です。';
      if(editing?.path===receipt.gamePath&&$('#edit').open){$('#history').close();$('#edit').close();}
      if(receipt.kind==='capture')$('#capture').close();if(receipt.kind==='post')$('#post').close();
    }else{
      text.textContent=result.state==='not-saved'?'今回の保存内容は反映されていません。入力・履歴を確認してから、必要な場合に手動で保存してください。':'現在の設定は保存予定とも保存前とも異なります。他の変更を上書きせず、再読み込みと設定履歴を確認してください。';
      if(receipt.kind==='post')text.textContent+=' 投稿フォルダーは点検で確認できます。作品を自動で削除・再投稿しません。';
      if(result.state==='not-saved'){
        const retry=document.createElement('button');retry.className='secondary';retry.dataset.retrySettings='';retry.textContent='履歴の保存内容を再試行';retry.disabled=!editingEnabled;retry.onclick=()=>action(async()=>{
          await requireLibraryConnection(true);if(!editingEnabled)throw new Error('設定で編集を有効にしてください。');
          if((await library.verifySettingsSave(root,receipt)).state!=='not-saved')throw new Error('現在の設定が変わりました。保存結果をもう一度確認してください。');
          await localState.trackSettingsReceipt(receipt,true);settingsReceipts=await localState.loadSettingsReceipts();await library.retrySettingsSave(root,receipt);
          if(receipt.uploadFolder){const dir=await root.getDirectoryHandle(receipt.uploadFolder);try{await dir.removeEntry('.gameportal-uploading');}catch(error){if(error.name!=='NotFoundError')throw error;}$('#post').close();}
          if(editing?.path===receipt.gamePath){$('#history').close();$('#edit').close();}if(receipt.kind==='capture')$('#capture').close();text.textContent='履歴の保存内容を保存しました。';retry.remove();return savedResult('履歴の保存内容を保存しました。');
        });box.append(retry);
      }
      const done=document.createElement('button');done.className='secondary';done.textContent='結果を確認しました';done.onclick=()=>action(async()=>{await localState.trackSettingsReceipt(receipt,true);settingsReceipts=await localState.loadSettingsReceipts();renderSaveVerification(true);return '確認記録を閉じました。設定は変更していません。';});box.append(done);
    }
    box.prepend(label,text);results.push(box);
  }
  renderSaveVerification();$('#saveVerificationResults').replaceChildren(...results);
  if(confirmedAny)return savedResult('保存済みを確認しました。再保存は不要です。');
  return '現在の設定との比較が完了しました。結果を確認してください。';
});
const cardCache=new Map();
function resetCards(){for(const url of imageURLs)URL.revokeObjectURL(url);imageURLs=[];cardCache.clear();renderLimit=60;}
let editBaseline = '';
function editValues() {
  return JSON.stringify(['editTitle','editEnvironment','editTags','editDescription','editInstructions','cropZoom','cropX','cropY'].map(id=>$('#'+id).value).concat($('#clearImage').checked,$('#enableCrop').checked,[...$('#editImage').files].map(f=>[f.name,f.size,f.lastModified])));
}
function hasEditChanges(){return $('#edit').open && editValues()!==editBaseline;}
function confirmEditClose(){return !hasEditChanges()||confirm('未保存の変更を破棄して閉じますか？ ゲーム本体と保存済みの設定は残ります。');}
$('#editForm').addEventListener('input',()=>{$('#editDirty').hidden=!hasEditChanges();});
$('#editForm').addEventListener('change',()=>{$('#editDirty').hidden=!hasEditChanges();});
try { editingEnabled = localStorage.getItem('game-portal.offline-editing') === 'true'; } catch { /* A new session starts read-only. */ }
let imageURLs = [], selectedTags = new Set(), renderRevision = 0;
let statusTimer;
const status = message => { clearTimeout(statusTimer);$('#status').textContent = message; document.querySelectorAll('[data-dialog-status]').forEach(node => { node.textContent = node.closest('dialog').open ? message : ''; });if(message==='一覧を更新しました。')statusTimer=setTimeout(()=>status(''),20000); };
async function cacheHandle(value,remember=true){
  const record=await localState.cacheHandle(value,remember,folderScope);
  if(value){lastFolderRevision=record.revision;folderChannel?.postMessage('changed');}
  return record;
}
function folderSharingControls(){
  $('#exportSharedLauncher').disabled=!root||!localLibrary||syncPaused;
  const hint=portableConnection?(portableConnection.path||portableConnection.name):'';
  $('#folderSuggestion').hidden=!!root||!hint;$('#folderSuggestion').textContent=hint?'保存先：'+hint:'';
  $('#sharedConnectionHint').textContent=hint?'このHTMLの保存先：'+hint:'';
}
async function checkSharedFolder(){
  const available=()=>!starting&&!busy&&!closingPlayer&&!activePlay&&!pendingSave&&!flushing&&!document.querySelector('dialog[open]')&&!settingsReceipts.length&&!document.hidden;
  if(folderWatchPromise||!available()||!$('#rememberFolder').checked)return;
  folderWatchPromise=(async()=>{
    try{
      const record=await localState.cacheHandle();if(!available()||!record?.handle||record.scope&&record.scope!==folderScope||record.revision&&record.revision===lastFolderRevision)return;
      if(root&&await root.isSameEntry(record.handle)){lastFolderRevision=record.revision;return;}
      if(!available())return;
      await action(async()=>{
        if(await record.handle.queryPermission({mode:editingEnabled?'readwrite':'read'})!=='granted'){
          remembered=record.handle;lastFolderRevision=record.revision;$('#reconnect').hidden=false;return 'ほかの画面で保存先が変わりました。「設定」→「再接続する」で許可してください。';
        }
        lastFolderRevision=record.revision;await connect(record.handle,false,true,true);return 'ほかの画面と同じ保存先に切り替えました。';
      });
    }catch(error){lastFolderRevision='';status('保存先の共有を確認できません：'+error.message);}
  })();
  try{await folderWatchPromise;}finally{folderWatchPromise=null;}
}
setInterval(()=>{void checkSharedFolder();},5000);
window.addEventListener('focus',()=>{void checkSharedFolder();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkSharedFolder();});
window.addEventListener('storage',event=>{if(event.key==='game-portal.remember-folder')$('#rememberFolder').checked=event.newValue!=='false';});

function writeControls() {
  folderSharingControls();
  contentControls();
  renderSaveVerification();
  $('#enableEditing').disabled = starting;
  if(openedGame)updatePlayerInfo();else $('#editPlaying').disabled=true;
  $('#postButton').hidden=!editingEnabled;
  $('#postButton').disabled = !root || !editingEnabled || settingsReceipts.some(a=>a.libraryId===localLibrary&&a.kind==='post');
  $('#confirmPost').disabled = !root || !editingEnabled || !postCheck?.valid || settingsReceipts.some(a=>a.libraryId===localLibrary&&a.kind==='post');
  const postReason = !root ? '追加するにはフォルダーを選んでください。' : !editingEnabled ? '追加するには「設定」で追加・編集をオンにしてください。' : '';
  $('#postReason').textContent = postReason; $('#postButton').title = postReason; $('#postButton').setAttribute('aria-describedby','postReason');
  $('#inspectionAgain').disabled = !inspectionRoot;
  $('#exportUsage').disabled=!usageReport;$('#usageFilter').disabled=!!usageController||!usageReport;$('#usageSort').disabled=!!usageController||!usageReport;
  $('#measureUsage').disabled=!inspectionRoot;$('#cancelUsage').hidden=!usageController;$('#cancelUsage').disabled=!usageController;
  $('#restoreHistory').disabled = !editingEnabled || !selectedHistory;
  $('#captureButton').disabled = !editingEnabled || !activePlay || !stopGame;
  if(openedGame&&pendingSettings(openedGame.path))$('#captureButton').disabled=true;
  const pendingEdit=!!editing&&pendingSettings(editing.path);$('#saveGameSettings').disabled=pendingEdit||imageProcessing||!!imageError;$('#restoreHistory').disabled||=pendingEdit;
  for(const input of document.querySelectorAll('#edit input,#edit textarea'))input.disabled=pendingEdit;
  for(const [button]of tagControls)button.disabled=pendingEdit||!button.classList.contains('active')&&library.tagsFrom($('#editTags').value).length>=12;
  $('#cropFields').disabled=pendingEdit||!$('#enableCrop').checked;
  for(const button of document.querySelectorAll('[data-retry-settings]'))button.disabled=!editingEnabled;
  $('#fullscreen').disabled = !activePlay || !stopGame;
  $('#exportSave').disabled=!activePlay||!stopGame;$('#importSaveButton').disabled=!activePlay||!stopGame;
  $('#captureReason').textContent = !editingEnabled ? '画像を設定するには「設定」で追加・編集を有効にしてください。' : '';
  $('#captureButton').title = $('#captureReason').textContent; $('#captureButton').setAttribute('aria-describedby','captureReason');
  $('#enableEditing').checked = editingEnabled;
  $('#modeLabel').textContent = editingEnabled ? '追加・編集' : 'あそぶ';
  $('#editingIndicator').hidden=!editingEnabled;$('#editingIndicator').textContent='編集モード オン';
  document.body.classList.toggle('editing-mode',editingEnabled);
  $('#libraryInfo').hidden=true;$('#filters').hidden=!root||!games.length;
  $('#modeLabel').classList.toggle('editing', editingEnabled);
  $('#refresh').disabled = !root;
  document.querySelectorAll('[data-play]').forEach(button => { button.disabled = !localLibrary || button.dataset.unavailable === 'true'; });
  $('#storageNotice').hidden = true;
  document.querySelectorAll('[data-edit]').forEach(button => { button.disabled = !editingEnabled || button.dataset.invalid === 'true'; });
  if (starting) document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('#forgetFolder').disabled=!remembered;
  $('#saveBackupsButton').disabled=!openedGame||!localLibrary;
  if(syncPaused){for(const id of ['restoreContent','confirmContentUpdate','verifyContentUpdate','verifySettingsSaves','postButton','confirmPost','saveGameSettings','restoreHistory','captureButton','editPlaying'])$('#'+id).disabled=true;document.querySelectorAll('[data-play]').forEach(b=>b.disabled=true);$('#postReason').textContent=compatibilityProblem||'共有フォルダーへの接続を確認し、再読み込みまたは再接続してください。';}
  $('#updatePlaying').disabled=syncPaused||!root||!openedGame||!updateTools.canUpdateGame(openedGame)||!!openedGame.settingsError&&!(openedGame.contentError&&openedGame.contentPending)||pendingSettings(openedGame.path);
}
async function action(fn) {
  if (busy) return; busy = true;
  document.body.setAttribute('aria-busy','true');document.body.classList.add('working');
  document.querySelectorAll('button:not([data-close]):not(#closePlayer):not(#cancelUsage)').forEach(b => b.disabled = true);
  document.querySelectorAll('#post input,#updateContent input').forEach(input=>input.disabled=true);
  document.querySelectorAll('#edit input,#edit textarea,#enableEditing').forEach(input=>input.disabled=true);
  status('処理しています…');
  try { if(syncPromise)await syncPromise;const result=await fn();status(typeof result==='string'?result:''); }
  catch (e) { compatibilityFailure(e);if(remembered&&(['NotAllowedError','NotReadableError','NetworkError','InvalidStateError'].includes(e.name)||['SETTINGS_SAVE_UNCONFIRMED','CONTENT_UPDATE_UNCONFIRMED'].includes(e.code)))$('#reconnect').hidden=false;status(e.name === 'AbortError' ? '選択をキャンセルしました。' : e.message || '操作できませんでした。');if(e.code==='SETTINGS_SAVE_UNCONFIRMED'){if($('#player').open)$('#playerStatus').textContent=e.message;openSaveVerification();}if(e.code==='CONTENT_UPDATE_UNCONFIRMED'){contentTarget={...contentTarget,contentPending:true};if($('#player').open)$('#playerStatus').textContent=e.message;} }
  finally { busy = false;document.body.setAttribute('aria-busy','false');document.body.classList.remove('working'); document.querySelectorAll('button').forEach(b => b.disabled = false);document.querySelectorAll('#post input,#updateContent input').forEach(input=>input.disabled=false); writeControls(); }
}
async function refresh() {
  if (!root) return;
  await checkLibraryCompatibility();
  const nextLibrary=await library.loadLibraryId(root);
  if(localLibrary&&nextLibrary!==localLibrary){syncPaused=true;writeControls();throw new Error('保管フォルダーのIDが変わりました。設定からフォルダーを指定し直してください。');}
  const nextMetadata=await library.loadMetadata(root),nextGames=await library.scan(root,nextMetadata);
  if(await library.loadLibraryId(root)!==nextLibrary)throw new Error('読み込み中に保管フォルダーのIDが変わりました。再接続してください。');
  localLibrary=nextLibrary;syncPaused=false;syncStatus($('#autoSync').checked?'共有フォルダーの自動確認：有効（15秒ごと）':'共有フォルダーの自動確認：停止中');
  metadata=nextMetadata;games=nextGames;resetCards();
  $('#folderName').textContent = root.name; $('#settingFolder').textContent = root.name;
  selectedTags = new Set([...selectedTags].filter(t => games.some(g => g.tags.includes(t))));
  await render();updatePlayerInfo();
}
async function syncLibrary(){
  if(!root||starting||busy||syncPaused||syncPromise||closingPlayer||document.hidden||!$('#autoSync').checked||document.querySelector('dialog[open]:not(#player)'))return;
  const folder=root,libraryId=localLibrary;
  syncPromise=(async()=>{
    try{
      await checkLibraryCompatibility(folder);
      const nextId=await library.loadLibraryId(folder);
      if(libraryId&&nextId!==libraryId)throw new Error('保管フォルダーのIDが変わりました。フォルダーを指定し直してください。');
      const nextMetadata=await library.loadMetadata(folder),nextGames=await library.scan(folder,nextMetadata);
      if(await library.loadLibraryId(folder)!==nextId)throw new Error('読み込み中に保管フォルダーが変わりました。');
      if(root!==folder||busy||document.hidden||!$('#autoSync').checked||document.querySelector('dialog[open]:not(#player)'))return;
      const changed=syncTools.libraryViewKey(games)!==syncTools.libraryViewKey(nextGames)||localLibrary!==nextId;
      metadata=nextMetadata;games=nextGames;localLibrary=nextId;
      if(changed){const limit=renderLimit;resetCards();renderLimit=limit;await render();updatePlayerInfo();writeControls();}
      syncStatus('共有フォルダー確認済み：'+new Date().toLocaleTimeString('ja-JP')+(changed?'（変更を反映しました）':''));
    }catch(error){if(root!==folder)return;compatibilityFailure(error);syncPaused=true;$('#reconnect').hidden=false;syncStatus('自動確認を停止しました。再読み込み・再接続で再開：'+error.message);if(!busy)writeControls();}
  })();
  try{await syncPromise;}finally{syncPromise=null;}
}
setInterval(()=>{void syncLibrary();},15000);
async function savedResult(message){
  try{await refresh();if($('#player').open)$('#playerStatus').textContent=message;return message;}
  catch(error){if(remembered)$('#reconnect').hidden=false;const warning=message+' 一覧更新だけ失敗しました。再保存せず、接続を確認して「再読み込み」を押してください：'+error.message;if($('#player').open)$('#playerStatus').textContent=warning;return warning;}
}
function selectEditTab(name){
  for(const part of ['Basic','Description','Image']){const active=part===name;$('#panel'+part).hidden=!active;$('#tab'+part).setAttribute('aria-selected',String(active));$('#tab'+part).tabIndex=active?0:-1;}
  $('#edit').scrollTop=0;
}
for(const part of ['Basic','Description','Image']){
  $('#tab'+part).onclick=()=>selectEditTab(part);
  $('#tab'+part).onkeydown=event=>{const tabs=['Basic','Description','Image'];let at=tabs.indexOf(part);if(event.key==='ArrowRight')at=(at+1)%3;else if(event.key==='ArrowLeft')at=(at+2)%3;else if(event.key==='Home')at=0;else if(event.key==='End')at=2;else return;event.preventDefault();selectEditTab(tabs[at]);$('#tab'+tabs[at]).focus();};
}
function resetCropState(){if(cropBitmap)cropBitmap.close();cropBitmap=null;$('#cropControls').hidden=true;$('#cropControls').open=false;$('#enableCrop').checked=false;$('#cropFields').disabled=true;$('#cropZoom').value='1';$('#cropX').value='50';$('#cropY').value='50';$('#cropZoomValue').textContent='1.00倍';}
function drawThumbnail(ctx,bitmap,crop,adjustment=null){
  if(crop){const r=improvements.cropRect(bitmap.width,bitmap.height,adjustment?.zoom??$('#cropZoom').value,adjustment?.x??$('#cropX').value,adjustment?.y??$('#cropY').value);ctx.drawImage(bitmap,r.x,r.y,r.width,r.height,0,0,960,540);}
  else{const scale=Math.min(960/bitmap.width,540/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;ctx.drawImage(bitmap,(960-w)/2,(540-h)/2,w,h);}
}
function renderCropPreview(){
  if(!cropBitmap)return;const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
  drawThumbnail(canvas.getContext('2d'),cropBitmap,$('#enableCrop').checked);$('#editImagePreview').src=canvas.toDataURL('image/webp',.85);$('#editImagePreview').hidden=false;$('#cropZoomValue').textContent=Number($('#cropZoom').value).toFixed(2)+'倍';$('#editDirty').hidden=!hasEditChanges();
}
$('#enableCrop').onchange=()=>{$('#cropFields').disabled=!$('#enableCrop').checked;renderCropPreview();};
for(const id of ['cropZoom','cropX','cropY'])$('#'+id).oninput=renderCropPreview;
$('#resetCrop').onclick=()=>{$('#cropZoom').value='1';$('#cropX').value='50';$('#cropY').value='50';renderCropPreview();};
$('#edit').addEventListener('close',()=>{editImageRevision++;resetCropState();});
async function connect(handle, request = false, restoring = false, shared = false) {
  if(connectionError)throw new Error(connectionError);
  const mode = editingEnabled || request ? 'readwrite' : 'read';
  const permission = request ? await handle.requestPermission({ mode }) : await handle.queryPermission({ mode });
  if (permission !== 'granted') throw new Error('保管フォルダーへのアクセスを許可してください。');
  // Read and validate before replacing the current folder or cached handle.
  await checkLibraryCompatibility(handle);
  const scannedLibrary=await library.loadLibraryId(handle);
  if(portableConnection&&scannedLibrary!==portableConnection.libraryId)throw new Error('このHTMLの保存先と違います。「'+portableConnection.name+'」のフォルダーを選んでください。');
  const next = await library.loadMetadata(handle), nextGames = await library.scan(handle, next);
  if(await library.loadLibraryId(handle)!==scannedLibrary)throw new Error('読み込み中に保管フォルダーが変わりました。もう一度接続してください。');
  if (!await flushSave()) throw new Error('このPCへのセーブを完了してからフォルダーを切り替えてください。');
  const initialize=(editingEnabled&&!restoring)||(!scannedLibrary&&await handle.queryPermission({mode:'readwrite'})==='granted');
  const nextLocalLibrary = initialize ? await library.ensureLibraryId(handle) : scannedLibrary;
  await checkLibraryCompatibility(handle);
  resetCards();root = handle; localLibrary = nextLocalLibrary; remembered = handle; resetSearch();
  let cacheError='';try{if(!shared&&!restoring)await cacheHandle(handle,$('#rememberFolder').checked);}catch(error){cacheError=' 投稿先をこのPCに記憶できませんでした。次回はフォルダーを選び直してください：'+error.message;}
  syncPaused=false;$('#reconnect').hidden = true;
  $('#sharedFolderPath').value=portableConnection?.path||'';try{$('#sharedFolderPath').value=localStorage.getItem('game-portal.folder-path.'+localLibrary)||$('#sharedFolderPath').value;}catch{}
  metadata = next; games = nextGames; $('#folderName').textContent = handle.name; $('#settingFolder').textContent = handle.name;
  await render(); $('#settings').close();syncStatus(($('#autoSync').checked?'共有フォルダーの自動確認：有効（15秒ごと）':'共有フォルダーの自動確認：停止中')+cacheError);
}
async function render() {
  const revision = ++renderRevision, folder = root;
  const allTags = [...new Set(games.flatMap(g => g.tags))].sort((a,b) => a.localeCompare(b,'ja'));
  const tagCounts=new Map();for(const game of games)for(const tag of game.tags)tagCounts.set(tag,(tagCounts.get(tag)||0)+1);
  const environment=$('#environmentFilter').value;$('#environmentFilter').replaceChildren(new Option('すべての開発環境',''));
  for(const name of [...new Set(games.map(g=>g.developmentEnvironment).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ja')))$('#environmentFilter').append(new Option(name,name));
  $('#environmentFilter').value=[...$('#environmentFilter').options].some(o=>o.value===environment)?environment:'';
  $('#tagFilterArea').hidden = !allTags.length;
  const tagCategories=[...new Set(tagPresets.map(t=>t.category))].concat('マイタグ');
  const category=$('#tagCategory').value;$('#tagCategory').replaceChildren(new Option('すべての分類',''));for(const name of tagCategories)$('#tagCategory').append(new Option(name,name));$('#tagCategory').value=category;
  const tagQuery=$('#tagSearch').value.normalize('NFKC').toLocaleLowerCase();let shownTags=0;
  $('#tagFilters').replaceChildren(); $('#knownTags').replaceChildren();
  for (const tag of allTags) {
    const option = document.createElement('option'); option.value = tag; $('#knownTags').append(option);
    if(!tag.normalize('NFKC').toLocaleLowerCase().includes(tagQuery)||category&&(tagPresets.find(t=>t.name===tag)?.category||'マイタグ')!==category)continue;shownTags++;
    const count=tagCounts.get(tag);
    const button = document.createElement('button'); button.className = 'tag' + (selectedTags.has(tag) ? ' active' : ''); button.textContent = tag+' '+count;button.setAttribute('aria-label',tag);button.setAttribute('aria-pressed', String(selectedTags.has(tag)));
    button.onclick = () => { selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag); render().catch(e => status(e.message)); }; $('#tagFilters').append(button);
  }
  $('#tagFilterSummary').textContent=`${allTags.length}タグ中 ${shownTags}件`;
  const keyword = $('#search').value.trim().toLocaleLowerCase();
  const matches = searchTools.searchGames(games,{query:keyword,scope:$('#searchScope').value,kind:$('#kindFilter').value,environment:$('#environmentFilter').value,tags:selectedTags,tagMatch:$('#tagMatch').value,sort:$('#sortGames').value});
  $('#count').textContent = String(matches.length); $('#emptyState').hidden = matches.length > 0;
  $('#loadMore').hidden=matches.length<=renderLimit;$('#loadMore').textContent=`さらに表示（残り${Math.max(0,matches.length-renderLimit)}件）`;
  const visibleCards=[];
  $('#clearFilters').hidden = !keyword && !selectedTags.size && !$('#tagSearch').value && !$('#tagCategory').value && !$('#kindFilter').value && !$('#environmentFilter').value && $('#searchScope').value==='all' && $('#tagMatch').value==='all' && $('#sortGames').value==='name-asc';
  $('#searchSummary').textContent=`${games.length}件中 ${matches.length}件を表示`+(matches.length>renderLimit?`・先頭${renderLimit}件（続きは「さらに表示」）`:'')+(selectedTags.size?`・選択タグ ${selectedTags.size}件（${$('#tagMatch').value==='any'?'いずれか一致':'すべて一致'}）`:'');
  $('#count').setAttribute('aria-label',matches.length+'件');
  renderActiveFilters();
  $('#emptyTitle').textContent = !root ? 'ゲームをはじめよう' : games.length ? 'ゲームが見つかりません' : 'ゲームを追加しよう';
  $('#empty').hidden=!games.length;
  $('#empty').textContent = !root ? 'ゲームを保存したフォルダーを選んでください。' : games.length ? '検索する言葉や選択したタグを変えてみてください。' : editingEnabled ? '「ゲームを追加」を押してください。' : '追加するには「設定」で編集を有効にしてください。';
  $('#setupFolder').hidden = !!root;
  $('#emptyReset').hidden=!root||!games.length||matches.length>0;
  $('#emptyPost').hidden=!root||games.length>0||!editingEnabled;
  for (const game of matches.slice(0,renderLimit)) {
    const cached=cardCache.get(game.path);if(cached?.game===game){visibleCards.push(cached.node);continue;}
    const article = document.createElement('article'); article.className = 'card';
    const cover = document.createElement('div'); cover.className = 'cover'; cover.textContent = '▶\uFE0E';
    if (typeof game.thumbnail === 'string') { const img = document.createElement('img'); img.src = game.thumbnail; img.alt = ''; cover.replaceChildren(img); }
    else if (game.thumbnail) try {
      const file = await library.getFile(folder, `.gameportal/thumbnails/${game.id}.webp`);
      if (revision !== renderRevision) return;
      if (file.size <= 2 * 1024 * 1024) { const url = URL.createObjectURL(file); imageURLs.push(url); const img = document.createElement('img'); img.src = url; img.alt = ''; cover.replaceChildren(img); }
    } catch { /* A missing image does not make the game unavailable. */ }
    if (revision !== renderRevision) return;
    const body = document.createElement('div'); body.className = 'cardbody';
    const title = document.createElement('h2'); title.textContent = game.title;
    const type = document.createElement('p'); type.className = 'type'; type.textContent = game.developmentEnvironment || (game.kind === 'pyxapp' ? 'Pyxel' : 'Webゲーム');
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const tag of game.tags) { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tags.append(span); }
    const open=document.createElement('a');open.href='#player';open.className='game-title-link';open.textContent=game.title;open.onclick=event=>{event.preventDefault();action(()=>playGame(game));};title.replaceChildren(open);
    const thumb=document.createElement('a');thumb.href='#player';thumb.className='game-thumb-link';thumb.tabIndex=-1;thumb.setAttribute('aria-label',game.title+'の画面を開く');thumb.onclick=open.onclick;thumb.append(cover);
    for(const img of cover.querySelectorAll('img')){img.loading='lazy';img.decoding='async';}
    body.append(type,title,tags);
    if(game.description){const summary=document.createElement('p');summary.className='game-summary';summary.textContent=game.description.slice(0,100)+(game.description.length>100?'…':'');body.append(summary);}
    if(game.settingsError){const warning=document.createElement('p');warning.className='hint';warning.textContent='設定の確認が必要です：'+game.settingsError;body.append(warning);}
    article.append(thumb,body);cardCache.set(game.path,{game,node:article});visibleCards.push(article);
  }
  if(revision!==renderRevision)return;
  const wanted=new Set(visibleCards);for(const card of [...$('#games').children])if(!wanted.has(card))card.remove();
  visibleCards.forEach((card,index)=>{const current=$('#games').children[index];if(current!==card)$('#games').insertBefore(card,current||null);});
}
function editGame(game) {
  if (!editingEnabled || game.settingsError) return;
  autoEnvironmentTag=game.tags.includes(game.developmentEnvironment)?game.developmentEnvironment:'';
  editing = game; $('#editEnvironment').value = game.developmentEnvironment; $('#editSettingsPath').textContent = game.path + '.gameportal.json'; $('#editTitle').value = game.title; $('#editTags').value = game.tags.join(', '); $('#editImage').value = ''; $('#clearImage').checked = false; renderTagChoices(); $('#edit').showModal();
  $('#editDescription').value=game.description || '';$('#editInstructions').value=game.instructions || '';
  updateFormCounters();
  $('#postEditNotice').hidden=true;
  $('#editHeading').textContent='ゲームを編集';$('#cancelEdit').textContent='キャンセル';
  editImageRevision++;$('#editImagePreview').hidden=typeof game.thumbnail!=='string';if(typeof game.thumbnail==='string')$('#editImagePreview').src=game.thumbnail;else $('#editImagePreview').removeAttribute('src');
  resetCropState();selectEditTab('Basic');editBaseline=editValues();$('#editDirty').hidden=true;$('#edit').scrollTop=0;$('#editTitle').focus({preventScroll:true});
  imageProcessing=false;imageError='';$('#editImage').setCustomValidity('');$('#imageStatus').textContent='';
  if(!busy)writeControls();
}
function updatePlayerInfo(){
  if(!openedGame)return;
  const latest=games.find(g=>g.path===openedGame.path&&g.id===openedGame.id);if(latest)openedGame=latest;
  if(activePlay&&activePlay.game.id===openedGame.id)activePlay.game=openedGame;
  $('#playerTitle').textContent=openedGame.title;$('#playerEnvironment').textContent=openedGame.developmentEnvironment||'';$('#playerEnvironment').hidden=!openedGame.developmentEnvironment;
  $('#playerDescription').textContent=openedGame.description||'';$('#playerInstructions').textContent=openedGame.instructions||'';
  $('#playerDescription').closest('section').hidden=!openedGame.description;$('#playerInstructions').closest('section').hidden=!openedGame.instructions;
  $('#playerTags').replaceChildren();for(const tag of openedGame.tags){const span=document.createElement('span');span.className='tag';span.textContent=tag;$('#playerTags').append(span);}
  $('#editPlaying').disabled=busy||!editingEnabled||!!openedGame.settingsError||pendingSettings(openedGame.path);
  $('#editPlaying').hidden=!editingEnabled;$('#captureButton').hidden=!editingEnabled;$('#captureReason').hidden=!editingEnabled;$('#editPlayingReason').hidden=!editingEnabled;
  $('#editPlayingReason').textContent=openedGame.settingsError?'設定の確認が必要です。「ライブラリ点検」を確認してください。':!editingEnabled?'編集するには「設定」で追加・編集を有効にしてください。':'';
  $('#updatePlaying').hidden=!editingEnabled;$('#updatePlayingReason').hidden=!editingEnabled;
  $('#updatePlayingReason').textContent=!updateTools.canUpdateGame(openedGame)?'本体更新は「投稿」で追加した作品に対応しています。':openedGame.contentPending?'前回の本体更新の結果が未確認です。「本体を更新」から確認してください。':openedGame.contentWarning||'';
}
let tagControls = [], autoEnvironmentTag='';
function addEnvironmentTag(){
  const environment=$('#editEnvironment').value.trim();
  if(!environment||environment.length>32||/[,、\n]/.test(environment)){updateFormCounters();return;}
  const tags=[...new Set($('#editTags').value.split(/[,、\n]/).map(s=>s.trim()).filter(Boolean))].filter(tag=>tag!==autoEnvironmentTag||tag===environment);
  if(!tags.includes(environment))tags.push(environment);
  $('#editTags').value=tags.join(', ');autoEnvironmentTag=environment;updateTagChoices();updateFormCounters();
}
$('#editEnvironment').addEventListener('change',()=>{addEnvironmentTag();renderTagChoices();$('#editDirty').hidden=!hasEditChanges();});
function updateTagChoices() {
  const raw=[...new Set($('#editTags').value.split(/[,、\n]/).map(s=>s.trim()).filter(Boolean))];
  $('#editTags').setCustomValidity(raw.length>12?'タグは12件までにしてください。':raw.some(t=>t.length>32)?'タグは1件32文字以内にしてください。':'');
  const picked = new Set(library.tagsFrom($('#editTags').value));
  $('#tagCount').textContent = `${picked.size} / 12`;
  for (const [button, name] of tagControls) {
    const active = picked.has(name); button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active); button.disabled = !active && picked.size >= 12;
  }
}
function renderTagChoices() {
  const box = $('#tagCategories'); box.replaceChildren(); tagControls = [];
  const presets = [...tagPresets], known = new Set(presets.map(t => t.name));
  for (const name of new Set([...games.flatMap(g => g.tags), ...library.tagsFrom($('#editTags').value)])) {
    if (!known.has(name)) presets.push({ name, category: 'マイタグ' });
  }
  const selected = new Set(library.tagsFrom($('#editTags').value));
  for (const category of new Set(presets.map(t => t.category))) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = category;
    const choices = presets.filter(t => t.category === category); details.open = choices.some(t => selected.has(t.name)) || (!selected.size && category === 'ジャンル');
    const chips = document.createElement('div'); chips.className = 'tags';
    for (const { name } of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tag'; button.textContent = name;
      button.onclick = () => {
        const picked = new Set(library.tagsFrom($('#editTags').value));
        if (picked.has(name)) picked.delete(name); else if (picked.size < 12) picked.add(name);
        $('#editTags').value = [...picked].join(', '); updateTagChoices();
        $('#editDirty').hidden=!hasEditChanges();
      };
      tagControls.push([button, name]); chips.append(button);
    }
    details.append(summary, chips); box.append(details);
  }
  updateTagChoices();
}
$('#editTags').addEventListener('input', updateTagChoices);
function updateFormCounters(){
  for(const [id,limit]of[['editTitle',120],['editDescription',2000],['editInstructions',4000]])$('#'+id+'Count').textContent=$('#'+id).value.length+' / '+limit;
  $('#editTitle').setCustomValidity($('#editTitle').value.trim()?'':'ゲーム名を入力してください。');
  const environment=$('#editEnvironment').value.trim();$('#editEnvironment').setCustomValidity(!environment?'作ったソフトを入力または選択してください。':environment.length>32||/[,、\n]/.test(environment)?'作ったソフトは区切り文字を使わず32文字以内で入力してください。':'');
}
for(const id of ['editTitle','editEnvironment','editDescription','editInstructions'])$('#'+id).addEventListener('input',updateFormCounters);
async function thumbnail(file,adjust=false,adjustment=null) {
  if (file.size > 10 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(file.name) && !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('画像はJPG・PNG・WebPの10MB以内で選択してください。');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    drawThumbnail(canvas.getContext('2d'),bitmap,adjust&&(adjustment?.enabled??$('#enableCrop').checked),adjustment);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を処理できません。')), 'image/webp', .85));
  } finally { bitmap.close(); }
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (flushing) { const success = await flushing; return success && pendingSave ? flushSave() : success; }
  flushing = (async () => {
    while (pendingSave) {
      const pending = pendingSave; pendingSave = null;
      try { await localState.writeLocalSave(pending.libraryId, pending.id, pending.data); }
      catch (error) {
        if (!pendingSave) pendingSave = pending;
        $('#playerStatus').textContent = 'このPCへセーブできません。画面を閉じずに保存先の空き容量を確認し、「← ゲーム一覧」を再試行してください：' + error.message;
        return false;
      }
    }
    return true;
  })();
  try { return await flushing; } finally { flushing = null; }
}
function receiveSave(session, data) {
  if (activePlay !== session || !localState.validSave(data)) return;
  session.latest = data;
  pendingSave = { libraryId: session.libraryId, id: session.game.id, data }; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 150);
}
function stopPlayer() {
  playRevision++;
  try { if (stopGame) stopGame(); } finally { stopGame = null; if (activePlay) activePlay.release(); activePlay = null; }
}
async function playGame(game) {
  const requested=playRevision;await requireLibraryConnection();if(playRevision!==requested)return;
  $('#retryPlaying').hidden=true;
  $('#player').scrollTop=0;
  if(!localLibrary&&!game.settingsError){
    const folder=root,path=game.path;openedGame=game;$('#frame').hidden=true;$('#saveTools').hidden=true;
    $('#playerStatus').textContent='準備しています…';if(!$('#player').open)$('#player').showModal();updatePlayerInfo();
    try{
      if(await folder.queryPermission({mode:'readwrite'})!=='granted'&&await folder.requestPermission({mode:'readwrite'})!=='granted')throw new Error('初回だけフォルダーへの保存許可が必要です。「起動を再試行」を押して許可してください。');
      if(root!==folder||playRevision!==requested)return;
      const id=await library.ensureLibraryId(folder);if(root!==folder||playRevision!==requested)return;
      localLibrary=id;await refresh();if(playRevision!==requested)return;
      game=games.find(item=>item.path===path);if(!game)throw new Error('ゲームが移動・削除されています。一覧を更新してください。');
    }catch(error){if(playRevision===requested&&$('#player').open){$('#playerStatus').textContent=error.message;$('#retryPlaying').hidden=false;}throw error;}
  }
  if(!localLibrary||game.settingsError){
    if(!await flushSave()||playRevision!==requested)return;stopPlayer();openedGame=game;$('#frame').hidden=true;$('#saveTools').hidden=true;$('#player').showModal();updatePlayerInfo();
    $('#playerStatus').textContent=game.settingsError||'フォルダーに再接続してください。';return;
  }
  if (!await flushSave()||playRevision!==requested) return; stopPlayer();const launch=playRevision;
  const session = { libraryId: localLibrary, game, release: await localState.acquirePlaySession(localLibrary, game.id) };
  if(playRevision!==launch){session.release();return;}
  activePlay = session;openedGame=game;$('#frame').hidden=false;updatePlayerInfo();
  $('#playerTitle').textContent = game.title; $('#playerStatus').textContent = '読み込んでいます…'; $('#player').showModal();
  try {
    const file = await game.handle.getFile(); let options;
    const htmlBytes = game.kind === 'html' ? new Uint8Array(await file.arrayBuffer()) : null;
    const embedded = htmlBytes ? library.embeddedPyxel(new TextDecoder().decode(htmlBytes)) : null;
    $('#saveTools').hidden = game.kind === 'pyxapp' || !!embedded;
    if (game.kind === 'pyxapp' || embedded) {
      if (file.size > 50 * 1024 * 1024) throw new Error('PYXAPPは50MB以内にしてください。');
      const bytes = embedded ? Uint8Array.from(atob(embedded), c=>c.charCodeAt(0)) : new Uint8Array(await file.arrayBuffer()); library.validatePyxapp(bytes); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      options = { kind: 'pyxapp', app: btoa(binary), runtime: JSON.parse($('#runtime').textContent) };
    } else {
      let files = game.kind === 'zip' ? await preview.unpackPrivateZip(await file.arrayBuffer()) : await library.readTree(game.folder, new Map([[game.entry, htmlBytes]]));
      if (game.kind === 'html') files.set('index.html', files.get(game.entry));
      const saved = await localState.loadLocalSave(session.libraryId, game.id);
      options = { kind: game.kind, files, saved };
    }
    if (activePlay !== session) return;
    stopGame = player.startPlayer($('#frame'), options, preview, message => {
      if (activePlay !== session) return;
      if (message?.type === 'ready') {$('#playerStatus').textContent = 'ゲームを表示しました。';$('#retryPlaying').hidden=true;}
      if (message?.type === 'error' || message?.type === 'status') {$('#playerStatus').textContent = String(message.message).slice(0, 500);if(message.type==='error')$('#retryPlaying').hidden=false;}
      if (message?.type === 'save') receiveSave(session, message.data);
    });
  } catch (e) { if(activePlay!==session)return;stopPlayer();$('#playerStatus').textContent='ゲームを開けませんでした。接続・作品のファイルを確認して再試行してください：'+e.message;$('#retryPlaying').hidden=false;throw new Error($('#playerStatus').textContent); }
}

$('#retryPlaying').onclick=()=>action(async()=>{const game=openedGame;if(!game)return;await refresh();const latest=games.find(g=>g.id===game.id&&g.path===game.path);if(!latest)throw new Error('作品が移動・削除されています。ゲーム一覧を確認してください。');await playGame(latest);});
for(const id of ['helpButton','playerHelpButton'])$('#'+id).onclick=()=>{if(!$('#help').open){$('#help').scrollTop=0;$('#help').showModal();$('#helpTitle').focus();}};
for(const button of document.querySelectorAll('[data-help-topic]'))button.onclick=()=>{const section=$('#'+button.dataset.helpTopic);if(section.id==='helpTitle')$('#help').scrollTop=0;else section.scrollIntoView({block:'start'});section.focus({preventScroll:true});};
$('#settingsButton').onclick = () => $('#settings').showModal();
$('#setupFolder').onclick = () => $('#settings').showModal();
function resetSearch(){clearTimeout(searchTimer);renderLimit=60;$('#search').value='';$('#tagSearch').value='';$('#tagCategory').value='';selectedTags.clear();$('#searchScope').value='all';$('#kindFilter').value='';$('#environmentFilter').value='';$('#tagMatch').value='all';$('#sortGames').value='name-asc'; }
$('#clearFilters').onclick = () => { resetSearch();render().catch(e => status(e.message));$('#search').focus(); };
$('#emptyReset').onclick=()=>$('#clearFilters').click();
$('#emptyPost').onclick=()=>$('#postButton').click();
function renderActiveFilters(){
  const filters=[];
  if($('#search').value.trim())filters.push(['キーワード：'+$('#search').value.trim(),()=>$('#search').value='']);
  for(const [id,defaultValue,label]of [['searchScope','all','検索対象'],['kindFilter','','形式'],['environmentFilter','','環境'],['tagMatch','all','タグ条件'],['sortGames','name-asc','並び順']]){
    const input=$('#'+id);if(input.value!==defaultValue)filters.push([label+'：'+input.selectedOptions[0].textContent,()=>input.value=defaultValue]);
  }
  for(const tag of selectedTags)filters.push(['タグ：'+tag,()=>selectedTags.delete(tag)]);
  $('#filterCount').textContent=filters.length?`条件 ${filters.length}件`:'';
  $('#activeFilters').hidden=!filters.length;$('#activeFilters').replaceChildren();
  for(const [label,clear]of filters){const b=document.createElement('button');b.className='filter-chip';b.textContent=label+' ×';b.setAttribute('aria-label',label+'を解除');b.onclick=()=>{clear();render().catch(e=>status(e.message));$('#search').focus();};$('#activeFilters').append(b);}
}
for(const id of ['searchScope','kindFilter','environmentFilter','tagMatch','sortGames'])$('#'+id).onchange=()=>render().catch(e=>status(e.message));
$('#chooseFolder').onclick = () => {
  if(busy||starting)return;
  // Open the picker in the click itself; waiting for sync can lose user activation.
  let selection;
  try{
    if(!window.showDirectoryPicker)throw new Error('フォルダー選択に対応したPC版Chromeを使用してください。');
    selection=Promise.resolve(window.showDirectoryPicker({mode:editingEnabled?'readwrite':'read',id:'game-portal-library'})).then(handle=>({handle}),error=>({error}));
  }catch(error){selection=Promise.resolve({error});}
  return action(async()=>{
    const {handle,error}=await selection;
    if(error){
      if(error.name==='AbortError')throw new Error('フォルダー選択が完了しませんでした。キャンセルしていない場合は、編集モードをオフにしてゲーム専用フォルダーを選び直してください。詳細：'+error.message);
      throw error;
    }
    try{await connect(handle);}catch(error){
      if(error.name==='AbortError')throw new Error('フォルダーは選択されましたが、接続処理が中断しました。保存先への接続とアクセス権を確認してください。詳細：'+error.message);
      throw error;
    }
  });
};
$('#reconnect').onclick = () => action(() => connect(remembered, true));
$('#refresh').onclick = () => action(async()=>{await refresh();return '一覧を更新しました。';});
$('#search').oninput = () => {clearTimeout(searchTimer);renderLimit=60;searchTimer=setTimeout(()=>render().catch(e=>status(e.message)),100);};
$('#tagSearch').oninput=()=>render().catch(e=>status(e.message));$('#tagCategory').onchange=()=>render().catch(e=>status(e.message));
$('#loadMore').onclick=()=>{renderLimit+=60;render().catch(e=>status(e.message));};
function updatePostSelection() {
  const bytes=postSelection.reduce((sum,file)=>sum+file.size,0);
  $('#postSummary').hidden=!postSelection.length;$('#postCheck').hidden=!postSelection.length;$('#postDetails').hidden=!postSelection.length;
  $('#postSummary').textContent=postSelection.length ? `${postSelection.length}ファイル・${(bytes/1024/1024).toFixed(2)} MB\n${postSelection[0].webkitRelativePath?.split('/')[0] || postSelection[0].name}\n追加先：${root?.name || '未選択'}` : 'ファイルまたはフォルダーを選んでください。まだ追加されていません。';
  $('#confirmPost').disabled=!postCheck?.valid||!root||!editingEnabled||settingsReceipts.some(a=>a.libraryId===localLibrary&&a.kind==='post');
}
function renderPostCheck(result){
  const warnings=[...result.external.map(url=>'外部URL：'+url+'（オフライン実行では通常利用できません）'),...result.unverified];
  $('#postTechnicalCheck').textContent=`基本チェック完了：起動 ${result.entry}・選択 ${result.count}ファイル・参照元 ${result.checkedFiles}件`+(result.expandedBytes===null?'':`・展開／合計 ${(result.expandedBytes/1024/1024).toFixed(2)} MB`)+`。検出できた参照に不足はありません。${warnings.length?`未確認・外部参照 ${warnings.length}件があります。`:'ゲーム内動作は未確認です。'}追加後に起動確認してください。`;
  $('#postCheck').textContent=warnings.length?'確認が必要なことが'+warnings.length+'件あります。':'ファイルを確認しました。追加後に動くか確かめてください。';
  $('#postWarnings').hidden=!warnings.length;$('#postWarnings summary').textContent=`確認が必要なこと（${warnings.length}件）`;$('#postWarningList').replaceChildren();
  for(const warning of warnings.slice(0,30)){const item=document.createElement('li');item.textContent=warning.slice(0,1000);$('#postWarningList').append(item);}if(warnings.length>30){const item=document.createElement('li');item.textContent='ほか'+(warnings.length-30)+'件。未確認の参照は実行して確認してください。';$('#postWarningList').append(item);}
}
$('#postButton').onclick = () => { if (editingEnabled && root) {postCheckRevision++;postSelection=[];postCheck=null;$('#postDetails').open=false;$('#postTechnicalCheck').textContent='';$('#postWarnings').hidden=true;$('#postWarnings').open=false;$('#postCheck').textContent='選択後に起動ファイルと不足ファイルを確認します。';$('#postFiles').value='';$('#postDirectory').value='';updatePostSelection();$('#post').showModal();status('');} };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => {const dialog=button.closest('dialog');if(busy&&['post','edit','capture','history','saveVerification','updateContent','saveBackups'].includes(dialog.id)){status('処理中です。完了するまでお待ちください。');return;}if(dialog.id==='edit'&&!confirmEditClose())return;dialog.close();});
document.querySelectorAll('#post,#edit,#capture,#history,#saveVerification,#updateContent,#saveBackups').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(busy||(dialog.id==='edit'&&!confirmEditClose()))event.preventDefault();}));
for (const id of ['postFiles', 'postDirectory']) $( '#' + id).onchange = event => {
  if(busy)return;const selected=[...event.target.files];if(!selected.length)return;
  postSelection=selected;postCheck=null;$('#postTechnicalCheck').textContent='';$(id==='postFiles'?'#postDirectory':'#postFiles').value='';updatePostSelection();
  const revision=++postCheckRevision;$('#postCheck').textContent='ファイルを確認しています…';
  $('#postWarnings').hidden=true;
  improvements.checkUpload(selected,library,preview,maintenance.localResources).then(result=>{if(revision!==postCheckRevision)return;postCheck={valid:true,...result};renderPostCheck(result);updatePostSelection();}).catch(error=>{if(revision!==postCheckRevision)return;postCheck={valid:false};$('#postCheck').textContent=error.message;updatePostSelection();});
};
$('#post').addEventListener('close',()=>{postCheckRevision++;postCheck=null;postSelection=[];$('#postFiles').value='';$('#postDirectory').value='';});
$('#updatePlaying').onclick=()=>{
  if(!editingEnabled||!openedGame||!updateTools.canUpdateGame(openedGame)||pendingSettings(openedGame.path))return;
  contentTarget=games.find(g=>g.id===openedGame.id&&g.path===openedGame.path)||openedGame;
  contentSelection=[];contentCheck=null;$('#updateTarget').textContent=contentTarget.title+'（現在の起動ファイル：'+contentTarget.entry+'）';
  $('#updateCheck').textContent=contentTarget.contentPending?'更新結果未確認です。再更新せず「更新状態を確認」を押してください。':'新しいゲームを選んでください。選択だけでは保存しません。';
  $('#updateFiles').value='';$('#updateDirectory').value='';$('#updateWarnings').hidden=true;contentControls();$('#updateContent').showModal();
};
for(const id of ['updateFiles','updateDirectory'])$('#'+id).onchange=event=>{
  if(busy)return;const files=[...event.target.files];if(!files.length)return;contentSelection=files;contentCheck=null;
  $('#'+(id==='updateFiles'?'updateDirectory':'updateFiles')).value='';const revision=++contentCheckRevision;contentControls();$('#updateCheck').textContent='更新前チェック中…（まだ本体を変更していません）';$('#updateWarnings').hidden=true;
  improvements.checkUpload(files,library,preview,maintenance.localResources).then(result=>{
    if(revision!==contentCheckRevision)return;contentCheck={valid:true,...result};$('#updateCheck').textContent=`チェック完了：${result.entry} / ${result.count}ファイル / ${(result.bytes/1024/1024).toFixed(2)}MB`;
    const warnings=[...result.external,...result.unverified];$('#updateWarningList').replaceChildren(...warnings.map(message=>{const item=document.createElement('li');item.textContent=message;return item;}));$('#updateWarnings').hidden=!warnings.length;contentControls();
  }).catch(error=>{if(revision!==contentCheckRevision)return;contentCheck={valid:false};$('#updateCheck').textContent=error.message;contentControls();});
};
$('#updateContent').addEventListener('close',()=>{contentCheckRevision++;contentCheck=null;contentSelection=[];});
async function withStoppedSave(game,operation){
  const session=activePlay;
  if(session&&(session.libraryId!==localLibrary||session.game.id!==game.id))throw new Error('ゲームが切り替わっています。画面を開き直してください。');
  // Keep the play lock while final saves and the backup transaction commit.
  const release=session?null:await localState.acquirePlaySession(localLibrary,game.id);let stopped=false;
  try{
    if(!await flushSave())throw new Error('このPCへのセーブを完了してから操作してください。');
    if(stopGame){stopGame();stopGame=null;}stopped=true;playRevision++;
    $('#frame').hidden=true;$('#saveTools').hidden=true;$('#retryPlaying').hidden=false;
    if(!await flushSave())throw new Error('セーブの保存を完了できませんでした。');
    return await operation();
  }finally{if(stopped&&activePlay===session)stopPlayer();release?.();}
}
async function stopForContentUpdate(reason='before-update'){
  await requireLibraryConnection(true);if(!editingEnabled||!contentTarget||pendingSettings(contentTarget.path))throw new Error('編集を有効にし、保存結果未確認の設定を先に確認してください。');
  const game=contentTarget,libraryId=localLibrary;
  try{await withStoppedSave(game,()=>localState.backupLocalSave(libraryId,game.id,reason,game.contentRevision||'original'));}
  catch(error){const recovery=stopGame?'ゲーム画面を閉じずに保存を再試行してください。':'「起動を再試行」で再開できます。';throw new Error('セーブを退避できなかったため、本体は変更していません。このPCの保存領域を確認してください。'+recovery+error.message,{cause:error});}
}
const contentPreflight=(files,tools,packageTools)=>improvements.checkUpload(files,tools,packageTools,maintenance.localResources);
$('#confirmContentUpdate').onclick=()=>action(async()=>{
  if(!contentCheck?.valid||contentTarget?.contentPending)throw new Error('更新前チェックと前回の更新結果を確認してください。');
  const files=[...contentSelection],game=contentTarget;await stopForContentUpdate();
  await updateTools.replaceGameContent(root,game,files,localLibrary,library,preview,contentPreflight,progress=>status(`更新ファイルを準備しています：${progress.current} / ${progress.total}`));
  $('#updateContent').close();return savedResult('ゲーム本体の更新を確認しました。情報・ID・セーブは保持し、更新前のセーブを退避しました。「起動を再試行」で新版を開けます。');
});
$('#restoreContent').onclick=()=>action(async()=>{
  const game=contentTarget;await stopForContentUpdate('before-content-restore');await updateTools.restoreGameContent(root,game,localLibrary,library);
  $('#updateContent').close();return savedResult('前のゲーム本体へ戻しました。ゲーム情報は保持し、変更前のセーブを退避しました。「起動を再試行」で開けます。');
});
$('#verifyContentUpdate').onclick=()=>action(async()=>{
  await requireLibraryConnection(true);if(!editingEnabled)throw new Error('確認記録を更新するには編集を有効にしてください。');
  const result=await updateTools.verifyContentUpdate(root,contentTarget,localLibrary,library);
  await refresh();contentTarget=games.find(g=>g.id===contentTarget.id&&g.path===contentTarget.path)||contentTarget;contentControls();
  return result.state==='confirmed'?'本体更新が保存済みであることを確認しました。再更新は不要です。':result.state==='not-saved'?'本体更新は反映されていません。元の本体を保持しています。必要なら手動で更新してください。':result.state==='changed'?'現在の本体設定は確認記録と異なります。他の変更を上書きせず、フォルダーの更新設定を確認してください。':'確認待ちの本体更新はありません。';
});
$('#confirmPost').onclick=()=>action(async()=>{
  await requireLibraryConnection(true);
  if (!root || !editingEnabled) throw new Error('設定で追加・編集を有効にしてください。');
  if(settingsReceipts.some(a=>a.libraryId===localLibrary&&a.kind==='post'))throw new Error('投稿済みの可能性がある作品があります。先に保存結果を確認してください。');
  const selected=[...postSelection];if(!selected.length)throw new Error('追加する作品を選んでください。');
  if(!postCheck?.valid)throw new Error('投稿前チェックを完了してから追加してください。');
  const path=await library.postGame(root, selected, preview,progress=>status(progress.phase==='validate'?'作品の形式を確認しています…':progress.phase==='copy'?`ファイルをコピーしています：${progress.current} / ${progress.total}`:'作品情報を保存しています…'));
  $('#post').close();
  try {await refresh();}catch(error){throw new Error('ゲームの追加は完了しましたが一覧を更新できません。再投稿せず、接続を確認して「再読み込み」を押してください：'+error.message);}
  const posted=games.find(game=>game.path===path);if(posted){editGame(posted);$('#postEditNotice').hidden=false;$('#editHeading').textContent='名前や画像を決める';$('#cancelEdit').textContent='あとで設定';}
  return 'ゲームの追加が完了しました。作品情報を設定できます。';
});
$('#editImage').onchange=async()=>{
  const revision=++editImageRevision,file=$('#editImage').files[0];if(!file)return;
  imageProcessing=true;imageError='';$('#editImage').setCustomValidity('');$('#imageStatus').textContent='画像を確認しています…';$('#saveGameSettings').disabled=true;
  resetCropState();$('#editImagePreview').hidden=true;
  try {await thumbnail(file);const bitmap=await createImageBitmap(file);if(revision!==editImageRevision){bitmap.close();return;}if(cropBitmap)cropBitmap.close();cropBitmap=bitmap;$('#cropZoom').value='1';$('#cropX').value='50';$('#cropY').value='50';$('#clearImage').checked=false;$('#cropControls').hidden=false;selectEditTab('Image');renderCropPreview();}
  catch(error){if(revision===editImageRevision){imageError=/画像は/.test(error.message)?error.message:'画像を読み取れません。正常なJPG・PNGを選び直すか、サムネイルを解除してください。';$('#editImage').setCustomValidity(imageError);$('#imageStatus').textContent=imageError;status(imageError);}}
  finally{if(revision===editImageRevision){imageProcessing=false;if(!imageError)$('#imageStatus').textContent='画像の読み込みが完了しました。';if(!busy)writeControls();}}
};
$('#clearImage').onchange=()=>{
  editImageRevision++;imageProcessing=false;imageError='';$('#editImage').setCustomValidity('');$('#imageStatus').textContent='';if($('#clearImage').checked){$('#editImage').value='';$('#editImagePreview').hidden=true;resetCropState();}
  else {$('#editImagePreview').hidden=typeof editing?.thumbnail!=='string';if(typeof editing?.thumbnail==='string')$('#editImagePreview').src=editing.thumbnail;}
  if(!busy)writeControls();
};
$('#editForm').noValidate=true;
$('#editForm').onsubmit = event => { event.preventDefault();if(busy)return;addEnvironmentTag();updateFormCounters();if(imageProcessing||imageError){selectEditTab('Image');status(imageError||'画像の読み込み完了をお待ちください。');return;}if(editing&&pendingSettings(editing.path)){status('再保存せず、先に保存結果を確認してください。');return;}const invalid=[...event.target.elements].find(e=>e.willValidate&&!e.validity.valid);if(invalid){const panel=invalid.closest('[role=tabpanel]');if(panel)selectEditTab(panel.id.replace('panel',''));event.target.reportValidity();return;}
  const values={title:$('#editTitle').value,tags:library.tagsFrom($('#editTags').value),developmentEnvironment:$('#editEnvironment').value,description:$('#editDescription').value,instructions:$('#editInstructions').value},imageFile=$('#editImage').files[0],clear=$('#clearImage').checked,adjustment={enabled:$('#enableCrop').checked,zoom:$('#cropZoom').value,x:$('#cropX').value,y:$('#cropY').value};action(async () => {
  if (!editingEnabled) throw new Error('設定で追加・編集を有効にしてください。');
  let image = clear ? null : editing.thumbnail;
  const file = imageFile;
  const asDataURL = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  if (file) image = await asDataURL(await thumbnail(file,true,adjustment));
  else if (image === true) image = await asDataURL(await library.getFile(root, `.gameportal/thumbnails/${editing.id}.webp`));
  await requireLibraryConnection(true);await library.saveGameSettings(root, editing, { ...values,thumbnail: image || null }); $('#edit').close();return savedResult('作品情報を保存しました。');
}); };
$('#closePlayer').onclick = async () => {
  if(closingPlayer)return;closingPlayer=true;$('#closePlayer').disabled=true;
  try {if(!await flushSave())return;stopPlayer();$('#player').close();openedGame=null;}
  finally {closingPlayer=false;$('#closePlayer').disabled=false;}
};
$('#player').addEventListener('cancel', event => { event.preventDefault(); $('#closePlayer').click(); });
$('#fullscreen').onclick = () => $('#frame').requestFullscreen().catch(e => { $('#playerStatus').textContent = e.message; });
function initialized() { if(connectionError)status(connectionError);starting = false; document.querySelectorAll('button').forEach(button => { button.disabled = false; }); writeControls(); document.documentElement.dataset.ready = 'true'; }
if (!window.showDirectoryPicker) { status('このブラウザーはフォルダーへの保存に対応していません。PC版Google Chromeを使用してください。'); initialized(); }
else Promise.all([cacheHandle(),localState.loadSettingsReceipts()]).then(async([previous,receipts]) => {
  settingsReceipts=receipts;lastFolderRevision=previous?.revision||'';
  if(previous?.scope&&previous.scope!==folderScope)previous=null;
  if (previous?.name) $('#settingFolder').textContent = '前回：' + previous.name;
  if(previous?.handle&&$('#rememberFolder').checked){remembered=previous.handle;$('#reconnect').hidden=false;try{if(await remembered.queryPermission({mode:editingEnabled?'readwrite':'read'})==='granted')await connect(remembered,false,true);else syncStatus('前回の投稿先を使用するには「設定」→「再接続する」でアクセスを許可してください。');}catch(error){syncStatus('前回の投稿先に接続できません。「設定」から再接続してください：'+error.message);}}
}).catch(error => status('このPCの保存機能を確認してください：' + error.message)).finally(initialized);

$('#rememberFolder').onchange=()=>action(async()=>{const enabled=$('#rememberFolder').checked;if(remembered)await cacheHandle(remembered,enabled);try{localStorage.setItem('game-portal.remember-folder',String(enabled));}catch{throw new Error('このPCに設定を記憶できません。ブラウザーの保存設定を確認してください。');}return enabled?'投稿先をこのPCで記憶します。':'投稿先の記憶を解除しました。次回は選び直してください。';});
$('#forgetFolder').onclick=()=>action(async()=>{await localState.forgetHandle();$('#rememberFolder').checked=false;try{localStorage.setItem('game-portal.remember-folder','false');}catch{}return 'このPCに記憶した投稿先を削除しました。現在の接続とセーブは保持しています。';});
$('#autoSync').onchange=()=>{try{localStorage.setItem('game-portal.auto-sync',String($('#autoSync').checked));}catch{status('自動確認の設定はこの起動中だけ適用します。');}syncStatus($('#autoSync').checked?'共有フォルダーの自動確認：有効（15秒ごと）':'共有フォルダーの自動確認：停止中');};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void syncLibrary();});

$('#enableEditing').onchange = () => action(async () => {
  const requested = $('#enableEditing').checked;
  if(requested&&syncPaused)throw new Error('保管フォルダーへの接続を確認し、再読み込み・再接続してください。');
  if (requested && root && await root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('追加・編集には保管フォルダーの書き込み許可が必要です。');
  if (requested && root) {localLibrary = await library.ensureLibraryId(root);await checkLibraryCompatibility();}
  editingEnabled = requested;
  try { localStorage.setItem('game-portal.offline-editing', String(editingEnabled)); } catch { /* The setting applies for this session. */ }
  if (root) await render(); writeControls();
});
window.addEventListener('beforeunload', event => { if (pendingSave || flushing || hasEditChanges() || busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
writeControls();

$('#exportSave').onclick = () => action(async () => {
  const session = activePlay; if (!session) throw new Error('ゲームを起動してから操作してください。');
  const data = session.latest || await localState.loadLocalSave(session.libraryId, session.game.id);
  const blob = new Blob([JSON.stringify({ schema: 1, gameId: session.game.id, data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'game-save-' + session.game.id + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#importSaveButton').onclick = () => $('#importSave').click();
$('#importSave').onchange = event => action(async () => {
  const session = activePlay, file = event.target.files[0]; event.target.value = '';
  if (!session || !file) return;
  if (file.size > 600000) throw new Error('セーブは600KB以内のJSONを選択してください。');
  let parsed;try{parsed=JSON.parse(await file.text());}catch{throw new Error('セーブJSONを読み取れません。正常な書き出しファイルを選び直してください。');}let data=parsed;
  if (parsed?.schema === 1) {
    if (parsed.gameId !== session.game.id) throw new Error('別のゲームのセーブです。');
    data = parsed.data;
  }
  if (!localState.validSave(data)) throw new Error('セーブの形式を確認してください。');
  if (!confirm('このPCの現在のセーブを、選択したファイルで置き換えてゲームを再起動しますか？')) return;
  if (!await flushSave() || activePlay !== session) return;
  stopPlayer();const restart=playRevision;
  try{await localState.writeLocalSave(session.libraryId,session.game.id,data);}
  catch(error){const message='セーブの読み込みに失敗しました。既存のセーブは保持しています。このPCの保存領域を確認してください。';if(playRevision===restart&&$('#player').open){$('#frame').hidden=true;$('#playerStatus').textContent=message+'「起動を再試行」で元のセーブから再開できます。';$('#retryPlaying').hidden=false;}throw new Error(message,{cause:error});}
  if(playRevision!==restart||!$('#player').open)return 'セーブを読み込みました。ゲームは一覧から開けます。';await playGame(session.game);
});

const issueLabels = {missing:'ファイル不足',config:'設定の確認',duplicate:'重複ID',upload:'投稿途中',package:'作品形式・破損',unreadable:'読み取りエラー',limit:'点検上限'};
function renderInspection() {
  const list=$('#inspectionResults');list.replaceChildren();if(!inspectionReport)return;
  const filter=$('#inspectionFilter').value;
  const issues=inspectionReport.issues.filter(issue=>filter==='all'||issue.kind===filter);
  $('#inspectionSummary').textContent = `${inspectionReport.folder}：${inspectionReport.checked}件の作品を点検、確認事項${inspectionReport.issues.length}件。` + (inspectionReport.complete ? ' 点検完了。' : ' 一部を点検できませんでした。件数は確認できた範囲です。');
  if(!issues.length){const message=document.createElement('p');message.className='hint';message.textContent=inspectionReport.complete?'この範囲に確認事項はありません。':'この表示条件に確認事項はありません。点検できなかった範囲があります。';list.append(message);return;}
  for(const issue of issues){
    const item=document.createElement('article');item.className='maintenance-item';
    const label=document.createElement('strong');label.textContent=issueLabels[issue.kind];
    const path=document.createElement('p');path.className='issue-path';path.textContent=issue.path;
    const message=document.createElement('p');message.textContent=issue.message;
    const remedy=document.createElement('p');remedy.className='hint';remedy.textContent=issue.remedy;
    item.append(label,path,message,remedy);list.append(item);
  }
}
async function runInspection(handle) {
  usageReport=null;usageLimit=60;$('#usagePanel').hidden=true;$('#usageRows').replaceChildren();
  inspectionRoot=handle;inspectionReport=null;$('#inspectionResults').replaceChildren();$('#inspectionSummary').textContent='点検しています…';
  inspectionReport=await maintenance.inspectLibrary(handle,library,preview);renderInspection();
}
$('#inspectButton').onclick=()=>{ $('#settings').close(); $('#inspection').showModal();if(root)action(()=>runInspection(root)); };
$('#inspectionFolder').onclick=()=>action(async()=>{
  if(!window.showDirectoryPicker)throw new Error('フォルダー点検に対応したPC版Chromeを使用してください。');
  const handle=await window.showDirectoryPicker({mode:'read',id:'game-portal-inspection'});await runInspection(handle);
});
$('#inspectionAgain').onclick=()=>action(()=>runInspection(inspectionRoot));
$('#inspectionFilter').onchange=renderInspection;

function previewHistory(entry) {
  selectedHistory=entry;const box=$('#historyPreview');box.replaceChildren();
  const title=document.createElement('h3');title.textContent=entry.before.title;
  const env=document.createElement('p');env.className='hint';env.textContent=entry.before.developmentEnvironment || '開発環境：未設定';
  const tags=document.createElement('p');tags.textContent=entry.before.tags.length?entry.before.tags.join('、'):'タグ：未設定';
  if(entry.before.thumbnail){const img=document.createElement('img');img.src=entry.before.thumbnail;img.alt='復元する画像';box.append(img);}
  else {const note=document.createElement('p');note.className='hint';note.textContent='画像：未設定';box.append(note);}
  box.append(title,env,tags);$('#restoreHistory').disabled=!editingEnabled;
  for(const [label,value] of [['概要',entry.before.description],['操作方法',entry.before.instructions]]){const heading=document.createElement('h4');heading.textContent=label;const text=document.createElement('p');text.className='game-text';text.textContent=value||'未設定';box.append(heading,text);}
  document.querySelectorAll('[data-history-name]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyName===entry.name)));
}
$('#historyButton').onclick=()=>action(async()=>{
  if(!editing)return;selectedHistory=null;$('#historyEntries').replaceChildren();$('#historyPreview').replaceChildren();$('#history').showModal();
  const result=await maintenance.loadSettingsHistory(root,editing,library);
  $('#historySummary').textContent=result.entries.length?`${result.entries.length}件の履歴。復元する設定を選んでください。`:'この作品の設定履歴はまだありません。';
  if(!result.complete)$('#historySummary').textContent+=' 上限に達したため一部の履歴のみ表示しています。';
  for(const entry of result.entries){
    const item=document.createElement('div');item.className='maintenance-item';
    if(entry.before){const button=document.createElement('button');button.className='secondary history-item';button.dataset.historyName=entry.name;button.textContent=new Date(entry.savedAt).toLocaleString('ja-JP')+' 保存前：'+entry.before.title;button.setAttribute('aria-pressed','false');button.onclick=()=>previewHistory(entry);item.append(button);}
    else{const text=document.createElement('p');text.className='hint';text.textContent=entry.error || '初回保存：以前の設定はありません。';item.append(text);}
    $('#historyEntries').append(item);
  }
});
$('#restoreHistory').onclick=()=>action(async()=>{
  await requireLibraryConnection(true);
  if(!editingEnabled || !selectedHistory || !editing)throw new Error('編集を有効にし、復元する設定を選択してください。');
  if(!confirm('現在の設定と入力中の変更を、この履歴の名前・タグ・画像・開発環境・概要・操作方法に置き換えますか？'))return;
  await maintenance.restoreSettingsHistory(root,editing,selectedHistory.name,library);
  $('#history').close();$('#edit').close();selectedHistory=null;return savedResult('設定履歴から復元しました。');
});
$('#captureButton').onclick=()=>action(async()=>{
  const session=activePlay;if(!editingEnabled || !session || !stopGame)throw new Error('追加・編集を有効にしてからゲームを起動してください。');
  let data;try { data=await stopGame.capture(); } catch(error) { $('#playerStatus').textContent=error.message;throw error; }
  if(activePlay!==session)throw new Error('ゲームが切り替わったため撮影を中止しました。');
  capturedImage={session,data};$('#capturePreview').src=data;$('#capture').showModal();
});
$('#saveCapture').onclick=()=>action(async()=>{
  await requireLibraryConnection(true);
  const captured=capturedImage;
  if(!editingEnabled || !captured || activePlay!==captured.session)throw new Error('もう一度ゲーム画面を撮影してください。');
  const game=captured.session.game;
  await library.saveGameSettings(root,game,{title:game.title,tags:game.tags,developmentEnvironment:game.developmentEnvironment,thumbnail:captured.data},{kind:'capture'});
  $('#capture').close();capturedImage=null;const result=await savedResult('サムネイルを保存しました。');captured.session.game=games.find(g=>g.id===game.id&&g.path===game.path)||game;return result;
});
$('#capture').addEventListener('close',()=>{capturedImage=null;$('#capturePreview').removeAttribute('src');});

$('#editPlaying').onclick=()=>{if(editingEnabled&&openedGame&&!openedGame.settingsError)editGame(openedGame);};

let saveBackupTarget=null;
const saveBackupReasons={'before-update':'本体更新の前','before-content-restore':'前の本体に戻す前','before-save-restore':'セーブ復元の前',manual:'手動退避'};
function downloadSaveBackup(gameId,backup){
  const blob=new Blob([JSON.stringify({schema:1,gameId,data:backup.data},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='game-save-'+gameId+'-backup-'+backup.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function renderSaveBackups(){
  const target=saveBackupTarget;if(!target)return;
  const records=await localState.loadSaveBackups(target.libraryId,target.id);
  if(saveBackupTarget!==target||!$('#saveBackups').open)return;
  $('#saveBackupSummary').textContent=records.length?records.length+'件の退避があります（直近10件まで）。本体の版に合うセーブを選んでください。':'このPCには、この作品の退避履歴がまだありません。本体の更新・旧版復元前に作成します。';
  $('#saveBackupRows').replaceChildren(...records.map(backup=>{
    const row=document.createElement('article');row.className='maintenance-item';row.dataset.saveBackup=backup.id;
    const heading=document.createElement('strong');heading.textContent=new Date(backup.createdAt).toLocaleString('ja-JP')+' ／ '+saveBackupReasons[backup.reason];
    const detail=document.createElement('p');detail.textContent='本体：'+(backup.contentRevision==='original'?'初期版':backup.contentRevision)+' ／ '+Object.keys(backup.data).length+'項目 ／ '+new TextEncoder().encode(JSON.stringify(backup.data)).length+'バイト';
    const buttons=document.createElement('div');buttons.className='buttons';
    const download=document.createElement('button');download.className='secondary';download.textContent='JSONに書き出す';download.dataset.exportBackup=backup.id;download.onclick=()=>downloadSaveBackup(target.id,backup);
    const restore=document.createElement('button');restore.textContent='このセーブに戻す';restore.dataset.restoreBackup=backup.id;restore.onclick=()=>action(async()=>{
      await requireLibraryConnection();
      if(saveBackupTarget!==target||localLibrary!==target.libraryId||openedGame?.id!==target.id)throw new Error('作品・保存先が変わりました。履歴を開き直してください。');
      const game=openedGame;
      try{await withStoppedSave(game,()=>localState.restoreLocalSaveBackup(target.libraryId,target.id,backup.id,game.contentRevision||'original'));}
      catch(error){const recovery=stopGame?'ゲーム画面を閉じずに保存を再試行してください。':'「起動を再試行」で再開できます。';throw new Error('セーブの復元を完了できませんでした。変更前のセーブは保持しています。'+recovery+error.message,{cause:error});}
      $('#saveBackups').close();$('#playerStatus').textContent='セーブを復元しました。復元前のセーブも退避しました。「起動を再試行」で再開できます。';
      return 'セーブを復元しました。本体の版は変更していません。「起動を再試行」で再開できます。';
    });
    buttons.append(download,restore);row.append(heading,detail,buttons);return row;
  }));
}
$('#saveBackupsButton').onclick=()=>action(async()=>{
  if(!openedGame||!localLibrary)return;
  saveBackupTarget={libraryId:localLibrary,id:openedGame.id,title:openedGame.title};$('#saveBackupTarget').textContent=saveBackupTarget.title;
  $('#saveBackupRows').replaceChildren();$('#saveBackupSummary').textContent='履歴を読み込んでいます…';$('#saveBackups').showModal();await renderSaveBackups();
});
$('#saveBackups').addEventListener('close',()=>{saveBackupTarget=null;$('#saveBackupRows').replaceChildren();});

const usageLabels={active:'選択中の更新版',previous:'前の更新版',other:'それ以外の保存版（準備途中を含む）',unknown:'未分類の保存版'};
function usageSize(value){if(value<1024)return value.toLocaleString('ja-JP')+' B';const units=['KiB','MiB','GiB','TiB','PiB'];let size=value/1024,unit=0;while(size>=1024&&unit<units.length-1){size/=1024;unit++;}return size.toFixed(2)+' '+units[unit];}
function renderUsage(){
  const report=usageReport;if(!report)return;
  const complete=report.complete?'確認完了':'一部確認';
  $('#usagePanel').hidden=false;$('#usageSummary').textContent=report.folder+'：'+usageSize(report.bytes)+' ／ '+report.files.toLocaleString('ja-JP')+'ファイル（'+complete+'）／ '+new Date(report.checkedAt).toLocaleString('ja-JP');
  let rows=report.rows.filter(row=>$('#usageFilter').value==='versions'?row.releases.length:$('#usageFilter').value==='attention'?!row.complete||row.pending||row.uploading:true);
  rows=rows.toSorted($('#usageSort').value==='name'?(a,b)=>a.title.localeCompare(b.title,'ja'):(a,b)=>b.bytes-a.bytes||a.title.localeCompare(b.title,'ja'));
  const shown=rows.slice(0,usageLimit);$('#usageResultsCount').textContent=rows.length+'件中 '+shown.length+'件を表示';$('#usageMore').hidden=shown.length>=rows.length;
  $('#usageWarnings').hidden=!report.warnings.length;$('#usageWarnings').replaceChildren(...report.warnings.map(warning=>{const line=document.createElement('p');line.textContent=warning.path+'：'+warning.message;return line;}));
  $('#usageRows').replaceChildren(...shown.map(row=>{
    const box=document.createElement('article');box.className='maintenance-item';box.dataset.usagePath=row.path;
    const title=document.createElement('strong');title.textContent=row.title+' ／ '+usageSize(row.bytes)+' ／ '+row.files+'ファイル';
    const path=document.createElement('p');path.className='issue-path';path.textContent='保存場所：'+row.path;
    const breakdown=document.createElement('p');breakdown.textContent='初期本体・通常ファイル '+usageSize(row.originalBytes)+' ／ 設定・管理 '+usageSize(row.metadataBytes)+' ／ 選択中の更新版 '+usageSize(row.activeBytes)+' ／ 前の更新版 '+usageSize(row.previousBytes)+' ／ その他の保存版 '+usageSize(row.otherBytes)+' ／ 未分類 '+usageSize(row.unknownBytes);
    box.append(title,path,breakdown);
    if(!row.complete||row.uploading||row.pending){const note=document.createElement('p');note.className='notice';note.textContent=row.pending?'更新結果未確認です。「本体を更新」から更新状態を確認してください。':row.uploading?'投稿途中のフォルダーです。':'このフォルダーは一部を確認できませんでした。';box.append(note);}
    if(row.releases.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='保存版 '+row.releases.length+'件の内訳';details.append(summary);
      for(const release of row.releases.slice(0,100)){const item=document.createElement('p');item.className='issue-path';item.textContent=usageLabels[release.status]+' ／ '+usageSize(release.bytes)+' ／ '+release.files+'ファイル ／ '+release.path;details.append(item);}
      if(row.releases.length>100){const more=document.createElement('p');more.textContent='先頭100件を表示しています。全件は結果のJSONに含みます。';details.append(more);}box.append(details);
    }
    return box;
  }));
}
$('#measureUsage').onclick=()=>action(async()=>{
  if(!inspectionRoot)return;
  const handle=inspectionRoot,controller=new AbortController();usageController=controller;
  $('#cancelUsage').hidden=false;$('#cancelUsage').disabled=false;$('#usagePanel').hidden=false;$('#usagePanel').open=true;
  $('#usageFilter').disabled=true;$('#usageSort').disabled=true;$('#usageSummary').textContent='容量を確認しています…';
  try{
    const result=await usageTools.measureLibraryUsage(handle,library,updateTools,{signal:controller.signal,onProgress:progress=>{if(usageController===controller)$('#usageSummary').textContent='容量を確認しています：'+progress.files+'ファイル ／ '+usageSize(progress.bytes);}});
    if(inspectionRoot!==handle||!$('#inspection').open)return;
    usageReport=result;usageLimit=60;renderUsage();return result.complete?'使用容量を確認しました。':'容量は確認できた範囲だけです。未確認の理由を確認してください。';
  }catch(error){if(error.name==='AbortError'){if(usageReport)renderUsage();else $('#usageSummary').textContent='容量確認を中止しました。';return '容量確認を中止しました。';}throw error;}
  finally{if(usageController===controller)usageController=null;$('#cancelUsage').hidden=true;$('#usageFilter').disabled=false;$('#usageSort').disabled=false;}
});
$('#cancelUsage').onclick=()=>{if(usageController){usageController.abort();$('#usageSummary').textContent='中止しています（現在の読み取り応答を待っています）';}};
$('#inspection').addEventListener('close',()=>usageController?.abort());
for(const id of ['usageFilter','usageSort'])$('#'+id).onchange=()=>{usageLimit=60;renderUsage();};
$('#usageMore').onclick=()=>{usageLimit+=60;renderUsage();};
$('#exportUsage').onclick=()=>{if(!usageReport)return;const blob=new Blob([JSON.stringify({...usageReport,launcherVersion:compatibilityTools.LAUNCHER_VERSION},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='game-portal-usage-'+usageReport.checkedAt.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

$('#exportSharedLauncher').onclick=()=>action(async()=>{
  await requireLibraryConnection();if(!root||!localLibrary)throw new Error('共有する保存先を選んでください。');
  const path=$('#sharedFolderPath').value.trim(),info=folderSharing.connectionInfo({schema:1,libraryId:localLibrary,name:root.name,path});
  const html=folderSharing.portableLauncher(launcherSource(),info);
  try{localStorage.setItem('game-portal.folder-path.'+localLibrary,path);}catch{}
  const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='GAME-PORTAL-SHARED.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return '共有用HTMLを保存しました。別PCでは初回だけ案内されたフォルダーを選んでください。';
});
