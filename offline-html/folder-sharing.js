// Portable hints contain no browser handle, permission or personal save.
export function connectionInfo(value) {
  if(value===null||value===undefined)return null;
  if(!value||value.schema!==1||typeof value.libraryId!=='string'||! /^[0-9a-f]{32}$/.test(value.libraryId)||typeof value.name!=='string'||!value.name.trim()||value.name.length>255||typeof value.path!=='string'||value.path.length>1000||/[\u0000-\u001f]/.test(value.path))throw new Error('共有用HTMLの保存先設定を確認してください。');
  return {schema:1,libraryId:value.libraryId,name:value.name,path:value.path};
}
export function portableLauncher(source,info) {
  const config=connectionInfo(info);if(!config)throw new Error('共有する保存先を選んでください。');
  const open='<scr'+'ipt id="folderConnection" type="application/json">',close='</scr'+'ipt>';
  const start=source.indexOf(open),end=source.indexOf(close,start+open.length);
  if(start<0||end<0||source.indexOf(open,start+open.length)>=0)throw new Error('共有用HTMLを作れません。最新版HTMLを開き直してください。');
  const json=JSON.stringify(config).replaceAll('<','\\u003c');
  return source.slice(0,start+open.length)+json+source.slice(end);
}
