// Classification uses explicit codes/names, never guesses an offline NAS from
// free-form text. Diagnostics remain in this window and are never uploaded.
const definitions={
 NotAllowedError:['ACCESS_DENIED','アクセスが許可されていません。','保存先のアクセス許可を確認し、再接続してください。'],
 SecurityError:['ACCESS_RESTRICTED','この画面ではアクセスが制限されています。','HTML版はPC版Chromeで直接開き、アクセス許可を確認してください。'],
 NotFoundError:['FILE_NOT_FOUND','必要なファイルまたはフォルダーが見つかりません。','保存先が移動・削除されていないか確認し、再接続してください。'],
 NotReadableError:['READ_FAILED','ファイルを読み取れません。','保存先への接続やアクセス権、他のアプリで使用中でないか確認してください。'],
 NoModificationAllowedError:['WRITE_DENIED','保存先へ書き込めません。','読み取り専用の設定や他のアプリでの使用状況を確認してください。'],
 QuotaExceededError:['STORAGE_FULL','保存に使える領域が不足しています。','このPCと保存先の空き容量・保存上限を確認し、画面を閉じずに再試行してください。'],
 NetworkError:['CONNECTION_FAILED','保存先との通信に失敗しました。','NASや起動補助への接続を確認し、再接続してください。'],
 TimeoutError:['RESPONSE_TIMEOUT','処理が時間内に完了しませんでした。','接続を確認してください。保存中だった場合は、再保存の前に保存結果を確認してください。'],
 InvalidStateError:['STORAGE_UNAVAILABLE','保存領域を現在利用できません。','未保存のデータがある場合は画面を閉じず、接続と保存結果を確認してください。'],
 AbortError:['OPERATION_ABORTED','処理が中断されました。','保存中だった場合は、再保存の前に保存結果を確認してください。']
};
const domainCodes=new Set(['SETTINGS_SAVE_UNCONFIRMED','CONTENT_UPDATE_UNCONFIRMED','LIBRARY_ID_CHANGED','LIBRARY_INCOMPATIBLE','FOLDER_PERMISSION_CONTEXT']);
export function describeError(error){
 const chain=[],seen=new Set();let current=error;
 while(current&&chain.length<8&&!seen.has(current)){
  seen.add(current);chain.push(current);current=current.cause;
 }
 // Uncertain writes must retain their verification instructions, even when
 // their underlying cause is an abort, quota error or disconnected device.
 const domain=chain.find(e=>domainCodes.has(e.code));
 const named=chain.find(e=>Object.hasOwn(definitions,e.name));
 const selected=domain||named||error;
 const known=!domain&&Object.hasOwn(definitions,selected?.name)&&definitions[selected.name];
 const code=domain?.code||known?.[0]||'OPERATION_FAILED';
 const original=typeof error?.message==='string'?error.message:typeof error==='string'?error:'';
 const message=known?known[1]+' '+known[2]:(domain?.message||original)||'操作を完了できませんでした。もう一度確認してください。';
 const details=chain.map(e=>(typeof e.name==='string'?e.name:'Error')+(typeof e.code==='string'?' / '+e.code:'')+'\n'+(typeof e.message==='string'?e.message:'')).join('\n原因：\n');
 return {code,message,details};
}
