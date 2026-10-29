// Portable hints contain no browser handle, permission or personal save.
export function connectionInfo(value) {
  if(value===null||value===undefined)return null;
  if(!value||value.schema!==1||typeof value.libraryId!=='string'||! /^[0-9a-f]{32}$/.test(value.libraryId)||typeof value.name!=='string'||typeof value.path!=='string')throw new Error('共有用HTMLの保存先設定を確認してください。');
  // Names and paths are display-only hints, never filesystem paths or identity
  // checks. Preserve OS-provided spelling; bound the entire public record only.
  const info={schema:1,libraryId:value.libraryId,name:value.name,path:value.path};
  if(new TextEncoder().encode(JSON.stringify(info)).length>128*1024)throw new Error('共有用HTMLの案内情報が大きすぎます。');
  return info;
}
export function portableLauncher(source,info) {
  const config=connectionInfo(info);if(!config)throw new Error('共有する保存先を選んでください。');
  const open='<scr'+'ipt id="folderConnection" type="application/json">',close='</scr'+'ipt>';
  const start=source.indexOf(open),end=source.indexOf(close,start+open.length);
  if(start<0||end<0||source.indexOf(open,start+open.length)>=0)throw new Error('共有用HTMLを作れません。最新版HTMLを開き直してください。');
  const json=JSON.stringify(config).replaceAll('<','\\u003c');
  return source.slice(0,start+open.length)+json+source.slice(end);
}

// One bounded, known relocation; never borrow another launcher's folder scope.
export function legacyScope(path){
 const parts=path.split('/');let role;try{role=decodeURIComponent(parts.at(-2)).normalize('NFC');}catch{return null;}
 if(parts.at(-3)!=='HTML'||!['プレイ用','クリエイター用'].includes(role)||!['GAME-PORTAL.html','GAME-PORTAL-PLAY.html'].includes(parts.at(-1)))return null;
 return [...parts.slice(0,-3),parts.at(-1)].join('/');
}

// Only the known distribution pair shares a selection. Other HTML copies keep
// their own scope, and another distribution directory cannot borrow a handle.
export function creatorScope(path){
 const parts=path.split('/'),name=parts.at(-1);
 if(parts.at(-3)==='HTML'){
  let role;try{role=decodeURIComponent(parts.at(-2)).normalize('NFC');}catch{return null;}
  if(!((role==='プレイ用'&&name==='GAME-PORTAL-PLAY.html')||(role==='クリエイター用'&&name==='GAME-PORTAL.html')))return null;
  return [...parts.slice(0,-2),parts.at(-2).includes('%')?encodeURIComponent('クリエイター用'):'クリエイター用','GAME-PORTAL.html'].join('/');
 }
 if(['GAME-PORTAL.html','GAME-PORTAL-PLAY.html'].includes(name))return [...parts.slice(0,-1),'GAME-PORTAL.html'].join('/');
 return null;
}
