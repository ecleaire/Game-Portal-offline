export function nativeLayout(paths) {
  const exes=paths.filter(path=>/\.exe$/i.test(path)&&!path.split('/').some(p=>p.startsWith('.')||p==='__MACOSX')&&!/(?:^|\/)GAME-PORTAL-WINDOWS\.exe$/i.test(path));
  const main=exes.filter(path=>!(/\.console\.exe$/i.test(path)&&exes.some(other=>other.toLowerCase()===path.replace(/\.console\.exe$/i,'.exe').toLowerCase()))&&!(exes.length>1&&/(?:^|\/)UnityCrashHandler(?:32|64)?\.exe$/i.test(path)));
  if(!main.length)return null;
  if(main.length!==1)throw new Error('起動するEXEが複数あります。1つのゲームのEXEと素材をまとめたフォルダーを選んでください。');
  if(main[0].includes('/'))throw new Error('EXEが直接入っているフォルダーを選んでください。');
  return {kind:'exe',root:'',entry:main[0]};
}
export async function validateExe(file) {
  if(!file||file.size<88||file.size>200*1024*1024)throw new Error('EXEは200MB以内のWindowsゲームを選んでください。');
  const header=new DataView(await file.slice(0,64).arrayBuffer());
  if(header.byteLength!==64||header.getUint16(0,true)!==0x5a4d)throw new Error('WindowsのEXEファイルを確認してください。');
  const offset=header.getUint32(60,true);
  if(offset<64||offset>file.size-24)throw new Error('EXEの起動情報が壊れています。');
  const pe=new DataView(await file.slice(offset,offset+24).arrayBuffer());
  if(pe.byteLength!==24||pe.getUint32(0,true)!==0x4550||!(pe.getUint16(22,true)&2)||pe.getUint16(22,true)&0x2000)throw new Error('Windowsで実行できるEXEを選んでください。');
}
export function nativeConnection(url) {
  const parsed=new URL(url),match=/^#native=(\d{1,5})\.([a-f0-9]{64})$/.exec(parsed.hash);
  if(parsed.protocol!=='file:'||!match||Number(match[1])<1024||Number(match[1])>65535)return null;
  return {origin:'http://127.0.0.1:'+Number(match[1]),token:match[2]};
}
export async function launchNative(connection,libraryId,game,version) {
  if(!connection)throw new Error('同じフォルダーのGAME-PORTAL-WINDOWS.exeを開いてから、このHTMLでEXEを起動してください。');
  const response=await fetch(connection.origin+'/native/launch',{method:'POST',headers:{'Content-Type':'application/json','X-Game-Portal-Token':connection.token},body:JSON.stringify({libraryId,gameId:game.id,gamePath:game.path,version})});
  const result=await response.json();
  if(!response.ok||result.launched!==true)throw new Error(result.error||'EXEを起動できませんでした。');
  return result;
}

// Read-only native directory adapter. Capabilities stay in this page, never IDB or exports.
export async function nativeFolder(connection,version,signal) {
  async function request(action,path='',binary=false) {
    const response=await fetch(connection.origin+'/native/folder',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Game-Portal-Token':connection.token},body:JSON.stringify({version,action,path})});
    if(!response.ok){const error=await response.json();throw new DOMException(error.error||'保存先に接続できません。',error.name||'NotReadableError');}
    return binary?response.arrayBuffer():response.json();
  }
  const info=await request('info');
  if(!info.configured)return null;
  const child=(path,name)=>{if(!name||name==='.'||name==='..'||/[\\/]/.test(name))throw new TypeError('ファイル名を確認してください。');return path?path+'/'+name:name;};
  const deny=()=>{throw new DOMException('自動接続の試用版は読み取り専用です。追加・編集・セーブ共有には「保存先を選ぶ」を使ってください。','NotAllowedError');};
  function handle(path,name,kind) {
    const result={name,kind,nativeReadOnly:true,queryPermission:async({mode='read'}={})=>mode==='read'?'granted':'denied',requestPermission:async({mode='read'}={})=>{if(mode!=='read')deny();return 'granted';},isSameEntry:async other=>other===result,removeEntry:async()=>deny()};
    if(kind==='file')Object.assign(result,{getFile:async()=>new File([await request('read',path,true)],name),createWritable:async()=>deny()});
    else Object.assign(result,{
      getDirectoryHandle:async(name,options={})=>lookup(name,'directory',options),
      getFileHandle:async(name,options={})=>lookup(name,'file',options),
      async *values(){for(const entry of (await request('list',path)).entries)yield handle(child(path,entry.name),entry.name,entry.kind);},
      async *entries(){for await(const entry of result.values())yield [entry.name,entry];}
    });
    async function lookup(name,kind,options){if(options.create)deny();const next=child(path,name),entry=await request('stat',next);if(entry.kind!==kind)throw new DOMException('種類が違います。','TypeMismatchError');return handle(next,name,kind);}
    return result;
  }
  return handle('',info.name,'directory');
}
