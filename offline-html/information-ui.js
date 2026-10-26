// Transfer tools stay idle until explicitly opened. Selection uses the loaded
// catalogue; game bytes are never included, and images are read only on demand.
function informationControls(){
 const creator=launcherEdition==='creator';$('#informationTools').hidden=!creator;
 const unavailable=busy||starting||!root||syncPaused;
 $('#openInformationExport').disabled=unavailable||!games.length;
 $('#openInformationImport').disabled=unavailable||!editingEnabled||!!root?.nativeReadOnly;
 $('#informationReason').textContent=!root?'保存先フォルダーを選んでください。':!editingEnabled?'読み込むときは編集モードをオンにします。':'';
 $('#exportGameInformation').disabled=unavailable||!editing||pendingSettings(editing?.path);
 $('#importGameInformation').disabled=unavailable||!editingEnabled||!editing||pendingSettings(editing?.path);
 const state=informationState,working=!!informationController;
 for(const id of ['informationSelectAll','informationSelectNone','informationMore'])$('#'+id).disabled=working||!state;
 for(const input of document.querySelectorAll('#informationRows input'))input.disabled=working||state?.rows[Number(input.dataset.informationIndex)]?.blocked||state?.rows[Number(input.dataset.informationIndex)]?.unchanged;
 $('#cancelGameInformation').hidden=!working||!$('#edit').open||$('#information').open;$('#cancelGameInformation').disabled=!working;
 $('#cancelInformation').hidden=!working;$('#cancelInformation').disabled=!working;
 $('#confirmInformationExport').hidden=state?.mode!=='export';$('#confirmInformationImport').hidden=state?.mode!=='import';
 $('#confirmInformationExport').disabled=unavailable||!state?.selected.size;
 $('#confirmInformationImport').disabled=unavailable||!editingEnabled||!state?.plan||!state?.selected.size;
}
function downloadInformation(text,title){
 const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=informationTools.informationFilename(title);link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderInformationRows(){
 const state=informationState,box=$('#informationRows');box.replaceChildren();if(!state)return;
 for(const row of state.rows.slice(0,state.limit)){
  const label=document.createElement('label');label.className='information-row';const check=document.createElement('input');check.type='checkbox';check.dataset.informationIndex=row.index;check.checked=state.selected.has(row.index);check.disabled=row.blocked||row.unchanged||!!informationController;
  const text=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
  title.textContent=state.mode==='import'?(row.target?.title||'対象なし')+' ← '+row.source.title:row.source.title;
  detail.textContent=state.results?.get(row.index)||row.reason||(row.unchanged?'変更なし':state.mode==='import'?(row.exact?(row.sameLibrary?'作品IDで一致':'作品IDで一致（別の保存先の情報です。確認して選んでください）'):'保存場所で一致（作品IDが異なります。確認して選んでください）'):row.source.path);
  check.onchange=()=>{if(check.checked)state.selected.add(row.index);else state.selected.delete(row.index);updateInformationSelection();};
  text.append(title,detail);
  if(state.mode==='import'&&!row.blocked){const preview=document.createElement('details'),summary=document.createElement('summary');summary.textContent='読み込む内容';const content=document.createElement('p');content.className='hint';content.textContent='作成ツール：'+(row.source.developmentEnvironment||'未設定')+'\nタグ：'+row.source.tags.join('、')+'\n概要：'+row.source.description+'\n操作方法：'+row.source.instructions;content.style.whiteSpace='pre-wrap';preview.append(summary,content);if(row.source.thumbnail)preview.addEventListener('toggle',()=>{if(preview.open&&!preview.querySelector('img')){const image=document.createElement('img');image.src=row.source.thumbnail;image.alt='読み込むサムネイル';image.decoding='async';preview.append(image);}});text.append(preview);}
  label.append(check,text);box.append(label);
 }
 $('#informationMore').hidden=state.limit>=state.rows.length;updateInformationSelection();
}
function updateInformationSelection(){
 if(!informationState)return;const state=informationState;
 if(!informationController&&!state.finished)$('#informationSummary').textContent=state.selected.size+'件を選択 / '+state.rows.length+'件';
 $('#confirmInformationExport').textContent='選んだ'+state.selected.size+'件をファイルに保存';$('#confirmInformationImport').textContent='選んだ'+state.selected.size+'件を読み込む';informationControls();
}
$('#informationSelectAll').onclick=()=>{if(!informationState||busy)return;informationState.selected=new Set(informationState.rows.filter(row=>!row.blocked&&!row.unchanged).map(row=>row.index));renderInformationRows();};
$('#informationSelectNone').onclick=()=>{if(!informationState||busy)return;informationState.selected.clear();renderInformationRows();};
$('#informationMore').onclick=()=>{if(!informationState||busy)return;informationState.limit+=60;renderInformationRows();};
$('#cancelInformation').onclick=()=>{informationController?.abort();$('#informationSummary').textContent='中止しています。保存中の1件がある場合は、完了を待ちます。';};
$('#cancelGameInformation').onclick=()=>{informationController?.abort();};
$('#information').addEventListener('cancel',event=>{if(busy){event.preventDefault();informationController?.abort();}});
$('#information').addEventListener('close',()=>{if(informationController)informationController.abort();informationState=null;$('#informationRows').replaceChildren();$('#informationFile').value='';});
function openInformationDialog(mode,rows,plan=null){
 informationState={mode,rows,plan,selected:new Set(rows.filter(row=>!row.blocked&&!row.unchanged&&(mode==='export'||row.exact&&row.sameLibrary)).map(row=>row.index)),limit:60,results:new Map()};
 $('#settings').close();$('#informationTitle').textContent=mode==='export'?'ゲーム情報をファイルに保存':'ゲーム情報を読み込む';
 $('#informationHelp').textContent=mode==='export'?'ゲームを選んで保存します。1件でも複数件でも、JSONファイル1つにまとまります。ゲーム本体・セーブは含みません。':'選んだゲームの名前・タグ・サムネイル・概要・操作方法を置き換えます。作品ID・本体・セーブは変更しません。変更前の情報は設定履歴に残します。';
 $('#information').showModal();renderInformationRows();
}
$('#openInformationExport').onclick=()=>{if(busy||launcherEdition!=='creator'||!root)return;openInformationDialog('export',games.map((game,index)=>({index,source:game,blocked:!!game.settingsError||!!game.contentPending||pendingSettings(game.path),unchanged:false,reason:game.settingsError||game.contentPending||pendingSettings(game.path)?'設定・更新・保存結果の確認が必要です。':''})));};
async function readInformationFile(file,signal){
 if(!file||file.size>informationTools.INFORMATION_LIMIT)throw Error('ゲーム情報ファイルは64MB以内にしてください。');
 return informationTools.parseInformationArchive(await readTasks.readWithSignal(()=>file.text(),signal),library);
}
$('#openInformationImport').onclick=()=>{if(busy||!editingEnabled||launcherEdition!=='creator')return;$('#informationFile').value='';$('#informationFile').click();};
$('#informationFile').onchange=()=>{const file=$('#informationFile').files[0];if(!file)return;return action(async()=>{
 if(!editingEnabled||launcherEdition!=='creator')throw Error('読み込むには編集モードをオンにしてください。');
 const controller=new AbortController();informationController=controller;
 try{openInformationDialog('import',[],null);informationControls();const archive=await readInformationFile(file,controller.signal);await requireLibraryConnection(false,controller.signal);
  $('#informationSummary').textContent='読み込む先を確認しています…';informationControls();
  const plan=await informationTools.planInformationImport(root,archive,games,library,{signal:controller.signal,blockedPaths:settingsReceipts.filter(receipt=>receipt.libraryId===localLibrary).map(receipt=>receipt.gamePath),onProgress:(done,total)=>{$('#informationSummary').textContent='確認中 '+done+' / '+total+'件';}});
  informationState.rows=plan.rows;informationState.plan=plan;informationState.selected=new Set(plan.rows.filter(row=>!row.blocked&&!row.unchanged&&row.exact&&row.sameLibrary).map(row=>row.index));
 }finally{informationController=null;renderInformationRows();}
 });};
$('#confirmInformationExport').onclick=()=>action(async()=>{
 const state=informationState;if(!state||state.mode!=='export'||launcherEdition!=='creator')return;
 const chosen=[...state.selected].map(index=>state.rows[index].source),controller=new AbortController();informationController=controller;informationControls();
 try{const text=await informationTools.createInformationArchive(root,chosen,library,{signal:controller.signal,metadataRevision:metadata?.revision,onProgress:(done,total)=>{$('#informationSummary').textContent='保存用ファイルを準備 '+done+' / '+total+'件';}});controller.signal.throwIfAborted();downloadInformation(text,chosen.length===1?chosen[0].title:null);state.finished=true;$('#informationSummary').textContent=chosen.length+'件のゲーム情報をファイルに書き出しました。';return 'ゲーム情報ファイルを書き出しました。';}
 finally{informationController=null;informationControls();}
});
$('#confirmInformationImport').onclick=()=>{
 if(busy||!editingEnabled||launcherEdition!=='creator'||!root)return;
 const folder=root;let permission;try{permission=Promise.resolve(requestFolderPermission(folder,'readwrite'));}catch(error){editingAccessError(error);return;}
 return permission.then(result=>{if(result!=='granted')throw Error('ゲーム情報を読み込むには保存の許可が必要です。');if(root!==folder||busy||!editingEnabled)return;
  return action(async()=>{const state=informationState;if(!state?.plan)return;const controller=new AbortController();informationController=controller;informationControls();
   try{const result=await informationTools.applyInformationImport(root,state.plan,[...state.selected],library,{signal:controller.signal,beforeWrite:()=>requireLibraryConnection(true),onProgress:(done,total,index)=>{state.results.set(index,'読み込み済み');$('#informationSummary').textContent=done+' / '+total+'件を保存しました。';}});
    state.plan=null;state.finished=true;state.selected.clear();for(const index of result.completed)state.results.set(index,'読み込み済み');
    $('#informationSummary').textContent=result.completed.length+'件を保存しました。'+(result.cancelled?'中止しました。残りは変更していません。':result.error?'途中で停止しました。保存できた件数を確認してください。':'読み込みが完了しました。');
    renderInformationRows();if(result.error)throw result.error;
    try{await refresh();}catch(error){return '情報は'+result.completed.length+'件保存しました。一覧の更新だけ失敗しました。再保存せず、接続を確認してください：'+error.message;}
    return result.cancelled?'情報の読み込みを中止しました。':'ゲーム情報を'+result.completed.length+'件読み込みました。';
   }finally{informationController=null;informationControls();}
  });
 }).catch(editingAccessError);
};
$('#exportGameInformation').onclick=()=>action(async()=>{
 if(!editing||launcherEdition!=='creator')return;
 const controller=new AbortController();informationController=controller;informationControls();try{const text=await informationTools.createInformationArchive(root,[editing],library,{signal:controller.signal,metadataRevision:metadata?.revision});controller.signal.throwIfAborted();downloadInformation(text,editing.title);$('#gameInformationNotice').textContent='保存済みの情報を書き出しました。';return 'ゲーム情報ファイルを書き出しました。';}finally{informationController=null;informationControls();}
});
$('#importGameInformation').onclick=()=>{if(busy||!editingEnabled||!editing||launcherEdition!=='creator')return;$('#gameInformationFile').value='';$('#gameInformationFile').click();};
$('#gameInformationFile').onchange=()=>{const file=$('#gameInformationFile').files[0];if(!file)return;return action(async()=>{
 if(!editing||!editingEnabled||launcherEdition!=='creator')throw Error('編集モードでゲームを開いてください。');
 const controller=new AbortController();informationController=controller;informationControls();try{const archive=await readInformationFile(file,controller.signal);if(archive.games.length!==1)throw Error('複数のゲーム情報は、設定の「ゲーム情報の保存・読み込み」から読み込んでください。');
 const info=archive.games[0];$('#editTitle').value=info.title;$('#editEnvironment').value=info.developmentEnvironment;$('#editTags').value=info.tags.join(', ');$('#editDescription').value=info.description;$('#editInstructions').value=info.instructions;
 importedInformationThumbnail=info.thumbnail;informationImageRevision++;editImageRevision++;$('#editImage').value='';$('#clearImage').checked=false;imageProcessing=false;imageError='';$('#editImage').setCustomValidity('');$('#imageStatus').textContent='';resetCropState();
 $('#editImagePreview').hidden=!info.thumbnail;if(info.thumbnail)$('#editImagePreview').src=info.thumbnail;else $('#editImagePreview').removeAttribute('src');
 autoEnvironmentTag=info.tags.includes(info.developmentEnvironment)?info.developmentEnvironment:'';$('#newTag').value='';renderTagChoices();updateFormCounters();updateEditDirty();selectEditTab('Basic');
 $('#gameInformationNotice').textContent='「'+info.title+'」の情報を読み込みました。内容を確認し、「保存」でこのゲームに反映します。';return '情報を編集画面に読み込みました。「保存」するまでゲームは変更されません。';}finally{informationController=null;informationControls();}
 });};
