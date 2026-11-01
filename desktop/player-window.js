// The native host moves the existing browser view; no second renderer, origin,
// iframe or save session is created. Standalone HTML never installs this hook.
export function installDesktopPlayerWindow(host){
  const dialog=document.getElementById('player'),title=document.getElementById('playerTitle');
  if(!dialog||!title)return;
  let last='',revision=0,returning=null;
  const sync=()=>{
    const open=dialog.open&&(typeof openedGame==='undefined'||openedGame?.kind!=='exe');
    const name=title.textContent.trim().slice(0,160)||'ゲーム',key=JSON.stringify([open,name]);
    if(last===key)return;last=key;const attempt=++revision;
    Promise.resolve().then(async()=>{
      if(!open&&document.fullscreenElement)await document.exitFullscreen();
      if(attempt!==revision)return;
      return host.playerWindow(open,name);
    }).catch(error=>{
      if(attempt!==revision)return;last='';
      const message='プレイ用ウィンドウを変更できませんでした：'+error.message;
      const output=document.getElementById('playerStatus');if(output)output.textContent=message;
    });
  };
  window.gamePortalReturnToLibrary=()=>{
    if(returning)return returning;
    returning=(async()=>{
    if(!dialog.open)return true;
    const game=typeof openedGame==='undefined'?null:openedGame;
    const session=typeof activePlay==='undefined'?null:activePlay;
    const request=typeof playerRequest==='undefined'?null:playerRequest;
    const blocked=()=>{
      if(!document.querySelector('dialog[open]:not(#player)')&&!(typeof hasEditChanges==='function'&&hasEditChanges()))return false;
      const output=document.getElementById('playerStatus');if(output)output.textContent='開いている操作と未保存の編集を確認してから、ゲーム一覧へ戻ってください。';
      return true;
    };
    if(blocked())return false;
    if(document.fullscreenElement)await document.exitFullscreen();
    // Leaving native fullscreen is asynchronous. A newer reload, game or edit
    // must not be replaced by this older close request when the animation ends.
    if(!dialog.open)return true;
    if(game!==(typeof openedGame==='undefined'?null:openedGame)||session!==(typeof activePlay==='undefined'?null:activePlay)||request!==(typeof playerRequest==='undefined'?null:playerRequest))return false;
    if(blocked())return false;
    await document.getElementById('closePlayer').onclick();
    return !dialog.open;
    })().catch(error=>{const output=document.getElementById('playerStatus');if(output)output.textContent='一覧へ戻れませんでした：'+error.message;return false;}).finally(()=>{returning=null;});
    return returning;
  };
  const observer=new MutationObserver(sync);
  observer.observe(dialog,{attributes:true,attributeFilter:['open','hidden'],childList:true,characterData:true,subtree:true});
  sync();
}
