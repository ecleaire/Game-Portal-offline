import {transform} from 'esbuild-wasm';
import {desktopPage} from '../../desktop/page.mjs';
import {readFile} from 'node:fs/promises';

export async function macDesktopPage(html,bootstrap,licenses){
  const replace=(from,to)=>{if(!bootstrap.includes(from))throw Error('Mac bridge marker changed: '+from.slice(0,60));bootstrap=bootstrap.replace(from,to);};
  replace("location.origin!=='https://gameportal.desktop.invalid'||!window.chrome?.webview","!window.webkit?.messageHandlers?.gamePortal");
  replace("chrome.webview.addEventListener('message',event=>{const message=event.data,", "window.gamePortalReply=message=>{");
  replace("job.reject(error(message.error||{}));});", "job.reject(error(message.error||{}));};");
  replace("if(objects)chrome.webview.postMessageWithAdditionalObjects({id,op,...args},objects);else chrome.webview.postMessage({id,op,...args});", "if(objects)throw Error('Finderから設定画面へフォルダーをドラッグしてください。');window.webkit.messageHandlers.gamePortal.postMessage({id,op,...args});");
  const start=bootstrap.indexOf('      getFile:async()=>'),end=bootstrap.indexOf('\n    });',start);
  if(start<0||end<0)throw Error('Mac file adapter marker changed');
  bootstrap=bootstrap.slice(0,start)+`      getFile:async()=>{
        const parts=[];let offset=0,size=null;const job={id:0,reject:()=>{},cancelled:false};reads.add(job);notify();
        try{do{if(job.cancelled)throw new DOMException('読み込みを中止しました。','NativeReadCancelled');const part=await rpc('readChunk',{root:root.token,path,offset});if(size!==null&&size!==part.size)throw Error('読み込み中にファイルが変わりました。');size=part.size;if(!Number.isSafeInteger(size)||size<0||size>200*1024*1024)throw Error('ファイルは200MB以内にしてください。');const text=atob(part.data),bytes=Uint8Array.from(text,c=>c.charCodeAt(0));if(!bytes.length&&offset<size)throw Error('読み込みが途中で止まりました。');parts.push(bytes);offset+=bytes.length;}while(offset<size);return new File(parts,name);}finally{reads.delete(job);notify();}
      },
      createWritable:async()=>{
        const lease=await rpc('beginWrite',{root:root.token,path});let finished=false;
        return {write:async value=>{if(finished)throw Error('保存処理は終了しています。');if(!(value instanceof Blob)&&typeof value!=='string'&&!(value instanceof ArrayBuffer)&&!ArrayBuffer.isView(value))throw new TypeError('保存する内容を確認してください。');const blob=value instanceof Blob?value:new Blob([value]);try{for(let offset=0;offset<blob.size;offset+=262144){const bytes=new Uint8Array(await blob.slice(offset,offset+262144).arrayBuffer());let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));await rpc('writeChunk',{root:root.token,path,writer:lease.token,data:btoa(text)});}}catch(e){finished=true;await rpc('abortWrite',{root:root.token,writer:lease.token});throw e;}},
          close:async()=>{if(finished)throw Error('保存処理は終了しています。');finished=true;await rpc('commitWrite',{root:root.token,path,writer:lease.token});},
          abort:async()=>{finished=true;await rpc('abortWrite',{root:root.token,writer:lease.token});}};
      }`+bootstrap.slice(end);
  replace("['restore','stat','list','selectPath','dropFolder']", "['restore','stat','list','selectPath','dropFolder','readChunk']");
  replace("if(job.controller)job.controller.abort(reason);else{", "job.cancelled=true;if(job.controller)job.controller.abort(reason);else{");
  const dropStart=bootstrap.indexOf("document.addEventListener('drop'"),dropEnd=bootstrap.indexOf("document.getElementById('desktopConnectPath')",dropStart);
  if(dropStart<0||dropEnd<0)throw Error('Mac drop marker changed');
  bootstrap=bootstrap.slice(0,dropStart)+`window.gamePortalFolderDrop=path=>{if(!prepareFolderSelection())return;return openFolderSelection(desktopHost.fromPath(path).then(handle=>({handle}),error=>({error})));};\n`+bootstrap.slice(dropEnd);
  let page=desktopPage(html,bootstrap,licenses);
  page=page.replace('例：&#92;&#92;NAS&#92;共有&#92;ゲーム','例：/Volumes/共有/ゲーム').replaceAll('エクスプローラーのアドレス欄からコピーして貼り付けられます。','Finderでコピーした保存先のパスを貼り付けられます。')
    .replace('Windowsアプリ（ベータ版）','Macアプリ（ベータ版）').replace('保存先の選択と読み書きはWindowsアプリが行います。','保存先の選択と読み書きはMacアプリが行います。').replace('次回はEXEを開くと','次回はアプリを開くと');
  const polyfills=await readFile(new URL('./desktop-polyfills.js',import.meta.url),'utf8');
  // Transform only the trusted launcher script; JSON/runtime base64 are data.
  const marker='<script>',startScript=page.indexOf(marker+'const tagPresets='),endScript=page.lastIndexOf('</script>');
  if(startScript<0||endScript<0)throw Error('Mac launcher script marker changed');
  const result=await transform(polyfills+'\n'+page.slice(startScript+marker.length,endScript),{target:'safari12',charset:'utf8',legalComments:'none'});
  page=page.slice(0,startScript+marker.length)+result.code.replaceAll('</script','<\\/script')+page.slice(endScript);
  // Older WebKit has no native dialog; retain the same modal interaction.
  page=page.replace('</style>','html.mac-dialog-polyfill dialog{display:none;position:fixed;z-index:1000;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;max-height:90vh;overflow:auto}html.mac-dialog-polyfill dialog[open]{display:block;box-shadow:0 0 0 100vmax rgba(0,0,0,.55)}html.mac-dialog-polyfill dialog[hidden]{display:none}</style>');
  return page;
}
