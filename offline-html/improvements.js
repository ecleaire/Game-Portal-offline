// Read-only upload checks and image geometry shared by UI and regression tests.
import { inspectUploadDependencies } from './dependencies.js';
import {nativeLayout,validateExe} from './native-tools.js';
export async function checkUpload(input, library, preview, localResources) {
  const files=[...input], bytes=files.reduce((n,f)=>n+f.size,0);
  if(!files.length||files.length>500||bytes>200*1024*1024)throw Error('投稿は500ファイル・200MB以内にしてください。');
  const single=files.length===1&&!files[0].webkitRelativePath;
  const paths=files.map(f=>f.webkitRelativePath?f.webkitRelativePath.split('/').slice(1).join('/'):f.name);
  paths.forEach(library.safePath);
  if(new Set(paths.map(p=>p.toLowerCase())).size!==paths.length)throw Error('同じ名前のファイルがあります。大文字・小文字も確認してください。');
  const native=single?/\.exe$/i.test(files[0].name)?{entry:paths[0]}:null:nativeLayout(paths);
  if(native){await validateExe(files[paths.indexOf(native.entry)]);return {kind:'exe',entry:native.entry,bytes,expandedBytes:bytes,count:files.length,missing:[],external:[],unverified:['Windows版の起動補助で実行します。必要なDLL・素材はフォルダーごと追加してください。EXEのセーブはゲーム自身が管理します。'],checkedFiles:1};}
  let contents,entry,expandedBytes=bytes;
  if(single){
    const file=files[0];if(!/\.(html?|zip|pyxapp)$/i.test(file.name))throw Error('HTML・ZIP・PYXAPPを選択してください。');
    if(file.size>50*1024*1024)throw Error('単体ファイルは50MB以内にしてください。');
    if(/\.pyxapp$/i.test(file.name)){library.validatePyxapp(await file.arrayBuffer());return{entry:file.name,bytes,expandedBytes:null,count:1,missing:[],external:[],unverified:['PYXAPPの起動情報・構造を確認しました。Pythonの依存とゲーム内動作は実行確認が必要です。'],checkedFiles:0};}
    if(/\.zip$/i.test(file.name)){
      try{contents=await preview.unpackPrivateZip(await file.arrayBuffer());}
      catch(e){throw Error(e.message==='web_export_required'?'起動用HTMLがありません。GodotはWeb書き出しのHTML・JS・WASM・PCKをまとめてZIPにしてください。':e.message==='invalid_preview'?'ZIPを読み取れません。破損していないWeb書き出しのZIPを選び直してください。':e.message);}
      const realPaths=[...contents.keys()].filter(p=>p!=='index.html'||![...contents].some(([k,v])=>k!=='index.html'&&v===contents.get('index.html')));
      entry=preview.webArchiveLayout(realPaths)?.entry||'index.html';
      expandedBytes=[...new Set(contents.values())].reduce((n,b)=>n+b.byteLength,0);
    }else{entry=file.name;contents=new Map([[entry,file]]);}
  }else{
    const layout=preview.webArchiveLayout(paths);if(!layout)throw Error('index.html、またはHTMLが1件のWeb書き出しフォルダーを選んでください。');
    entry=layout.root+layout.entry;contents=new Map(paths.map((p,i)=>[p,files[i]]));
  }
  const result=await inspectUploadDependencies(contents,entry,localResources);
  if(result.missing.length)throw Error('参照ファイルが不足しています：'+result.missing.slice(0,8).join('、')+(result.missing.length>8?' ほか'+(result.missing.length-8)+'件':'')+'。素材・JS・WASM・PCKを含めて選び直してください。');
  return{entry,bytes,expandedBytes,count:files.length,...result};
}
export function cropRect(width,height,zoom=1,x=50,y=50){
  const z=Math.max(1,Math.min(3,Number(zoom)||1));
  const scale=Math.max(960/width,540/height)*z;
  const w=960/scale,h=540/scale;
  return{x:(width-w)*Math.max(0,Math.min(100,Number(x)||0))/100,y:(height-h)*Math.max(0,Math.min(100,Number(y)||0))/100,width:w,height:h};
}
