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
