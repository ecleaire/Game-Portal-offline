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
  const playerEdition=html.includes('<html lang="ja" data-edition="player">');
  replace(playerEdition?'<title>GAME PORTAL プレイ専用</title>':'<title>GAME PORTAL</title>',playerEdition?'<title>GAME PORTAL プレイ専用</title>':'<title>GAME PORTAL クリエイター</title>');
  replace('connect-src blob: data: http://127.0.0.1:*',"connect-src 'self' blob: data:");
  // WebView2 exposes this property in opaque frames, but reading it throws.
  // Keep the sandbox and let exports detect that service workers are unavailable.
  replace('function webBootstrap(nonce) {',"function webBootstrap(nonce) {\n  try { void navigator.serviceWorker; } catch { delete Object.getPrototypeOf(navigator).serviceWorker; }");
  replace('<div id="folderDrop" class="notice" role="group" aria-label="保存先フォルダーをドラッグして接続">保存先フォルダーをここへドラッグ</div>','<div id="folderDrop" class="notice" role="group" aria-label="保存先フォルダーをドラッグして接続">保存先フォルダーをここへドラッグ</div><label for="desktopFolderPath">保存先のパス</label><div class="buttons desktop-path"><input id="desktopFolderPath" type="text" autocomplete="off" spellcheck="false" placeholder="例：&#92;&#92;NAS&#92;共有&#92;ゲーム" aria-label="保存先フォルダーのパス"><button id="desktopConnectPath" class="secondary">このパスに接続</button></div><p class="hint">エクスプローラーのアドレス欄からコピーして貼り付けられます。</p>');
  replace('<p class="hint">エクスプローラーのアドレス欄からコピーして貼り付けられます。</p>','<p class="hint">エクスプローラーのアドレス欄からコピーして貼り付けられます。</p><p id="desktopSharedConnection" class="hint" hidden></p>');
  if(!playerEdition)replace('<p id="desktopSharedConnection" class="hint" hidden></p>','<p id="desktopSharedConnection" class="hint" hidden></p><section class="settings-option"><div><strong>ほかのPCの初回接続</strong><p class="hint">ランチャー一式とゲームを同じNASの共有フォルダー内に置きます。この保存先を共有すると、同じランチャーを開く未設定のPCが自動で接続します。個別に設定済みのPCは変更しません。</p><button id="desktopShareConnection" class="secondary">この保存先を共有</button><p class="hint">NASへのログインとOSのアクセス許可は、各PCで必要です。</p></div></section>');
  replace('</style>','#exportSharedLauncher,#downloadFolderConfig,#downloadFolderConfig+p{display:none!important}.desktop-path{margin-top:8px}.desktop-path input{flex:1 1 240px;min-width:0;width:100%}</style>');
  html=html.replaceAll('このPCのChrome','このアプリ').replaceAll('このブラウザー内','このアプリ内');
  const escaped=licenses.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  replace('<div class="buttons help-footer">','<section class="help-section"><h3>Windowsアプリ（ベータ版）</h3><p>保存先の選択と読み書きはWindowsアプリが行います。初回に保存先を選び、次回はEXEを開くと前回の保存先へ接続します。セーブはこのアプリ内に保存します。Chromeとは保存場所が異なります。続きを移すときは、対応セーブを同期するか、書き出し・読み込みを使ってください。</p><details><summary>ライセンス</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px">'+escaped+'</pre></details></section><div class="buttons help-footer">');
  return html;
}
