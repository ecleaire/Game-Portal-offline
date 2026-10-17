// Build a separate desktop document. The distributed standalone HTML stays unchanged.
export function desktopPage(html,bootstrap,licenses=''){
  const replace=(from,to)=>{if(!html.includes(from))throw Error('Desktop integration marker changed: '+from.slice(0,70));html=html.replace(from,to);};
  replace('const $ = selector => document.querySelector(selector);',bootstrap+'\nconst $ = selector => document.querySelector(selector);');
  replace('let nativeBridge=null,nativeRetry=false,nativeReadAbort=null;','let nativeBridge={desktop:true},nativeRetry=false,nativeReadAbort=null;');
  const begin=html.indexOf('try{\n  nativeBridge=nativeTools.nativePageConnection('),end=html.indexOf('function rememberNativePageConnection',begin);
  if(begin<0||end<0)throw Error('Desktop connection marker changed');html=html.slice(0,begin)+html.slice(end);
  html=html.replace(/function rememberNativePageConnection\([^\n]+\n/,'function rememberNativePageConnection(){}\n');
  replace('if(root?.nativeReadOnly||nativeReadAbort)','if(root?.nativeReadOnly||root?.nativeDesktop||nativeReadAbort)');
  html=html.replaceAll('gameLoading.folder?.nativeReadOnly','(gameLoading.folder?.nativeReadOnly||gameLoading.folder?.nativeDesktop)');
  replace("if(handle){editingEnabled=false;$('#enableEditing').checked=false;await connect(handle,false,true,false,startupAbort.signal);return;}","if(handle){await connect(handle,false,true,false,startupAbort.signal);return;}");
  replace('<title>GAME PORTAL</title>','<title>GAME PORTAL デスクトップ試作版</title>');
  replace('connect-src blob: data: http://127.0.0.1:*',"connect-src 'self' blob: data:");
  // WebView2 exposes this property in opaque frames, but reading it throws.
  // Keep the sandbox and let exports detect that service workers are unavailable.
  replace('function webBootstrap(nonce) {',"function webBootstrap(nonce) {\n  try { void navigator.serviceWorker; } catch { delete Object.getPrototypeOf(navigator).serviceWorker; }");
  replace('</style>','#folderDrop,#exportSharedLauncher,#downloadFolderConfig,#downloadFolderConfig+p{display:none!important}</style>');
  html=html.replaceAll('このPCのChrome','このアプリ').replaceAll('このブラウザー内','このアプリ内');
  const escaped=licenses.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  replace('<div class="buttons help-footer">','<section class="help-section"><h3>デスクトップ試作版</h3><p>保存先の選択と読み書きはWindowsアプリが行います。初回に保存先を選び、次回はEXEを開くと前回の保存先へ接続します。セーブはこのアプリ内に保存します。Chrome内のセーブは必要に応じて書き出し・読み込みで移してください。</p><details><summary>ライセンス</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">'+escaped+'</pre></details></section><div class="buttons help-footer">');
  return html;
}
