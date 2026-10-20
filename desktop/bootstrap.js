// Runs only in the trusted launcher document, never inside a game frame.
const desktopHost=(()=>{
  if(window!==window.top||location.origin!=='https://gameportal.desktop.invalid'||!window.chrome?.webview)throw Error('デスクトップ版の起動元を確認してください。');
  let serial=0;const requests=new Map(),handles=new Map(),reads=new Set();
  const notify=()=>{if(typeof nativeReadControls==='function')nativeReadControls(reads.size);};
  function error(info){const result=new Error(info.message||'保存先を確認してください。');result.name=info.name||'NotReadableError';return result;}
  chrome.webview.addEventListener('message',event=>{const message=event.data,job=requests.get(message.id);if(!job)return;requests.delete(message.id);clearTimeout(job.timer);reads.delete(job);notify();message.ok?job.resolve(message.value):job.reject(error(message.error||{}));});
  function rpc(op,args={},objects=null){
    return new Promise((resolve,reject)=>{
      const id=++serial,readonly=['restore','stat','list','selectPath','dropFolder','sharedConnection'].includes(op)||(['file','directory'].includes(op)&&!args.create),job={resolve,reject,id};
      if(readonly){reads.add(job);job.timer=setTimeout(()=>{requests.delete(id);reads.delete(job);notify();reject(error({name:'TimeoutError',message:'保存先から応答がありません。再接続するか、保存先を選び直してください。'}));},12000);}
      requests.set(id,job);notify();try{if(objects)chrome.webview.postMessageWithAdditionalObjects({id,op,...args},objects);else chrome.webview.postMessage({id,op,...args});}catch(e){requests.delete(id);clearTimeout(job.timer);reads.delete(job);notify();reject(e);}
    });
  }
  const child=(path,name)=>{if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\\/]/.test(name))throw new TypeError('ファイル名を確認してください。');return path?path+'/'+name:name;};
  function handle(root,path,name,kind){
    const key=root.token+'/'+path;if(handles.has(key)&&handles.get(key).kind===kind)return handles.get(key);
    const h={name,kind,nativeDesktop:true,desktopToken:root.token,queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',isSameEntry:async other=>other?.desktopToken===root.token&&other?.desktopPath===path};
    Object.defineProperty(h,'desktopPath',{value:path});handles.set(key,h);
    if(kind==='directory')Object.assign(h,{
      getDirectoryHandle:async(name,options={})=>{const next=child(path,name);await rpc('directory',{root:root.token,path:next,create:!!options.create});return handle(root,next,name,'directory');},
      getFileHandle:async(name,options={})=>{const next=child(path,name);await rpc('file',{root:root.token,path:next,create:!!options.create});return handle(root,next,name,'file');},
      removeEntry:async(name,options={})=>rpc('remove',{root:root.token,path:child(path,name),recursive:!!options.recursive}),
      async *values(){for(const entry of (await rpc('list',{root:root.token,path})).entries)yield handle(root,child(path,entry.name),entry.name,entry.kind);},
      async *entries(){for await(const entry of h.values())yield [entry.name,entry];}
    });else Object.assign(h,{
      getFileInfo:async()=>{const info=await rpc('stat',{root:root.token,path});if(info.kind!=='file')throw error({name:'TypeMismatchError',message:'ファイルではありません。'});return {size:info.size};},
      getFile:async()=>{const controller=new AbortController(),job={controller};reads.add(job);notify();const timer=setTimeout(()=>controller.abort(),120000);try{const response=await fetch('/io/read?root='+root.token+'&path='+encodeURIComponent(path),{headers:{'X-Game-Portal-Desktop':root.secret},signal:controller.signal});if(!response.ok)throw error(await response.json());return new File([await response.blob()],name);}finally{clearTimeout(timer);reads.delete(job);notify();}},
      createWritable:async()=>{
        const lease=await rpc('beginWrite',{root:root.token,path});
        let blob=null,finished=false;
        return {write:async value=>{if(finished)throw Error('保存処理は終了しています。');if(!(value instanceof Blob)&&typeof value!=='string'&&!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value))throw new TypeError('保存する内容を確認してください。');const part=value instanceof Blob?value:new Blob([value]),next=blob?new Blob([blob,part]):part;if(next.size>200*1024*1024)throw Error('ファイルは200MB以内にしてください。');blob=next;},
          close:async()=>{if(finished)throw Error('保存処理は終了しています。');finished=true;if(!blob)blob=new Blob([]);const response=await fetch('/io/write?root='+root.token+'&writer='+lease.token+'&path='+encodeURIComponent(path),{method:'POST',headers:{'X-Game-Portal-Desktop':root.secret},body:blob});if(!response.ok)throw error(await response.json());await response.json();},
          abort:async()=>{finished=true;blob=null;await rpc('abortWrite',{root:root.token,writer:lease.token});}};
      }
    });
    return h;
  }
  function record(value){if(!value)return null;const notice=document.getElementById('desktopSharedConnection');if(notice){notice.textContent=value.connectionHint||'';notice.hidden=!notice.textContent;}return {...value,scope:location.pathname,handle:handle(value,'',value.name,'directory')};}
  async function current(){return record(await rpc('restore'));}
  window.showDirectoryPicker=async()=>{const selected=record(await rpc('select'));if(!selected)throw new DOMException('フォルダーを選びませんでした。','AbortError');return selected.handle;};
  localState.cacheHandle=async value=>{if(value)await rpc('remember',{root:value.desktopToken});return current();};
  localState.forgetHandle=()=>rpc('forget');
  nativeTools.nativeFolder=async()=> (await current())?.handle||null;
  nativeTools.launchNative=async(connection,libraryId,game)=>rpc('launch',{root:root?.desktopToken,libraryId,gameId:game.id,path:game.path});
  const cancel=()=>{for(const job of [...reads]){const reason=error({name:'NativeReadCancelled',message:'接続待ちを中止しました。もう一度試せます。'});if(job.controller)job.controller.abort(reason);else{clearTimeout(job.timer);requests.delete(job.id);job.reject(reason);}reads.delete(job);}notify();};
  return {current,cancel,sharedInfo:folder=>rpc('sharedConnection',{root:folder.desktopToken}),share:async(folder,revision)=>record(await rpc('shareConnection',{root:folder.desktopToken,revision})),fromPath:async path=>desktopHost.attach(record(await rpc('selectPath',{path})).handle),fromDrop:async files=>desktopHost.attach(record(await rpc('dropFolder',{},files)).handle),get pending(){return reads.size;},attach(h){if(!h)return h;h.cancelReads=cancel;Object.defineProperty(h,'pendingReads',{get:()=>reads.size,configurable:true});return h;}};
})();
const desktopOriginalNativeFolder=nativeTools.nativeFolder;
nativeTools.cancelFolderReads=()=>desktopHost.cancel();
nativeTools.nativeFolder=async()=>desktopHost.attach(await desktopOriginalNativeFolder());
const desktopOriginalPicker=window.showDirectoryPicker;
window.showDirectoryPicker=async()=>desktopHost.attach(await desktopOriginalPicker());
document.addEventListener('drop',event=>{
  const target=event.target.closest('#emptyState,#folderDrop');if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();if((target.id==='emptyState'&&root)||!prepareFolderSelection())return;
  const files=[...(event.dataTransfer?.files||[])];
  const selection=files.length===1?desktopHost.fromDrop(files).then(handle=>({handle}),error=>({error})):Promise.resolve({error:new Error('保存先フォルダーを1つドラッグしてください。')});
  openFolderSelection(selection);
},true);
document.getElementById('desktopConnectPath').onclick=()=>{
  if(!prepareFolderSelection())return;
  return openFolderSelection(desktopHost.fromPath(document.getElementById('desktopFolderPath').value).then(handle=>({handle}),error=>({error})));
};
document.getElementById('desktopFolderPath').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();document.getElementById('desktopConnectPath').click();}});
document.getElementById('desktopShareConnection')?.addEventListener('click',()=>{
  if(busy)return;
  void action(async()=>{
    const folder=root;if(!folder?.nativeDesktop)throw Error('先にゲームの保存先フォルダーを選んでください。');
    const info=await desktopHost.sharedInfo(folder);
    if(!info.canShare)throw Error('ランチャー一式とゲームの保存先を、同じNASの共有フォルダー内に置いてください。');
    if(!confirm('「'+folder.name+'」を、同じNASのランチャーを開く未設定のPCの保存先にします。'+(info.exists?'現在の共有先を更新します。':'')+' 個別に設定済みのPCは変更しません。よろしいですか？'))return '共有先は変更していません。';
    if(root!==folder)throw Error('保存先が変わりました。もう一度確認してください。');
    const result=await desktopHost.share(folder,info.revision);return result.connectionHint;
  });
});
