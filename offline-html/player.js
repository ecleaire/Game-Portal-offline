export function decodeBase64(value) {
  if(typeof Uint8Array.fromBase64==='function')return Uint8Array.fromBase64(value);
  const binary=atob(value),bytes=new Uint8Array(binary.length);
  for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return bytes;
}
export function encodeBase64(bytes) {
  if(typeof bytes.toBase64==='function')return bytes.toBase64();
  let binary='';
  for(let index=0;index<bytes.length;index+=0x8000)binary+=String.fromCharCode(...bytes.subarray(index,index+0x8000));
  return btoa(binary);
}
// Executed inside an opaque sandbox. Only game bytes, runtime bytes and its own
// localStorage snapshot cross the message port; directory handles never do.
async function captureGameCanvas() {
  const canvases = [...document.querySelectorAll('canvas')].filter(c => c.width && c.height && c.getBoundingClientRect().width && c.getBoundingClientRect().height);
  const canvas = canvases.sort((a,b)=>b.width*b.height-a.width*a.height)[0];
  if (!canvas) throw new Error('撮影できるゲーム画面がありません。「編集」から画像を選択してください。');
  return new Promise((resolve,reject)=>requestAnimationFrame(()=>{
    try {
      // Scratch/TurboWarp can render on a timer instead of this animation frame.
      // Redraw its own canvas immediately before copying a WebGL framebuffer.
      const renderer=typeof vm!=='undefined'?vm.runtime?.renderer:null;
      if(renderer && (renderer.canvas||renderer._gl?.canvas)===canvas && typeof renderer.draw==='function')renderer.draw();
      const image = document.createElement('canvas'); image.width = 960; image.height = 540;
      const ctx=image.getContext('2d'), scale=Math.max(960/canvas.width,540/canvas.height);
      ctx.drawImage(canvas,(960-canvas.width*scale)/2,(540-canvas.height*scale)/2,canvas.width*scale,canvas.height*scale);
      resolve(image.toDataURL('image/webp',.85));
    } catch(error) { reject(new Error('画面を撮影できません。外部画像を使用する作品は「編集」から画像を選択してください。')); }
  }));
}
function webBootstrap(nonce) {
  // Opaque game frames cannot use service workers. Hide the unsupported
  // capability without invoking its throwing getter (Godot probes it at boot).
  try {
    for(let owner=navigator;owner;owner=Object.getPrototypeOf(owner)){
      if(Object.hasOwn(owner,'serviceWorker')){delete owner.serviceWorker;break;}
    }
  } catch { /* Some engines expose a non-configurable navigator property. */ }
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'offline-game' || !event.ports[0]) return;
    const port = event.ports[0];
    port.onmessage = async event => {
      if (event.data?.type !== 'capture') return;
      try { port.postMessage({type:'thumbnail',requestId:event.data.requestId,data:await window.captureGameCanvas()}); }
      catch(error) { port.postMessage({type:'thumbnail',requestId:event.data.requestId,error:error.message}); }
    };
    const snapshot = event.data.saved;
    window.offlineStorage = () => {
      const data = Object.assign(Object.create(null), snapshot);
      const send = () => port.postMessage({ type: 'save', data });
      const api = { getItem: key => Object.hasOwn(data, key) ? data[key] : null,
        setItem: (key, value) => { const next = { ...data, [key]: String(value) }; if (Object.keys(next).length > 1000 || new TextEncoder().encode(JSON.stringify(next)).length > 500000) throw new DOMException('保存容量を超えました。', 'QuotaExceededError'); data[key] = String(value); send(); },
        removeItem: key => { delete data[key]; send(); }, clear: () => { for (const key of Object.keys(data)) delete data[key]; send(); },
        key: index => Object.keys(data)[index] ?? null, get length() { return Object.keys(data).length; } };
      // Storage also supports storage.score = value and delete storage.score.
      // Keep methods separate from saved keys, including __proto__ and getItem.
      const storage=new Proxy(Object.create(api),{
        get:(target,key,receiver)=>Reflect.has(target,key)?Reflect.get(target,key,receiver):typeof key==='string'?data[key]:undefined,
        set:(target,key,value)=>{if(typeof key!=='string')return Reflect.set(target,key,value);if(key!=='length')api.setItem(key,value);return true;},
        deleteProperty:(target,key)=>{if(typeof key!=='string')return Reflect.deleteProperty(target,key);api.removeItem(key);return true;},
        has:(target,key)=>Reflect.has(target,key)||Object.hasOwn(data,key),
        ownKeys:target=>[...new Set([...Object.keys(data).filter(key=>key!=='length'),...Reflect.ownKeys(target)])],
        getOwnPropertyDescriptor:(target,key)=>Reflect.getOwnPropertyDescriptor(target,key)||(typeof key==='string'&&key!=='length'&&Object.hasOwn(data,key)?{value:data[key],writable:true,enumerable:true,configurable:true}:undefined)
      });
      Object.defineProperty(window, 'localStorage', { value: storage });
      window.offlineReady = () => port.postMessage({ type: 'ready' });
    };
    try {
      const decoder = new TextDecoder();
      const mime = name => ({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',wasm:'application/wasm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2'})[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
      const fn = window.offlinePreview;
      const html = fn(event.data.files, (bytes, type) => URL.createObjectURL(new Blob([bytes], { type })), ';window.offlineStorage();addEventListener("load",()=>window.offlineReady(),{once:true});');
      document.open(); document.write(html); document.close();
    } catch (e) { port.postMessage({ type: 'error', message: e.message }); }
  }, { once: true });
  // Replacing the document before its initial srcdoc navigation finishes can
  // leave Chromium displaying a blank frame with a detached zero-sized layout.
  const announce = () => parent.postMessage({ type: 'offline-bootstrap-ready', nonce }, '*');
  if (document.readyState === 'complete') announce();
  else addEventListener('load', announce, { once: true });
}
function pyxelBootstrap(nonce) {
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.type !== 'offline-game' || !event.ports[0]) return;
    const port = event.ports[0], assets = event.data.runtime, urls = new Map(), bytes = new Map();
    port.onmessage = async event => {
      if (event.data?.type !== 'capture') return;
      try { port.postMessage({type:'thumbnail',requestId:event.data.requestId,data:await window.captureGameCanvas()}); }
      catch(error) { port.postMessage({type:'thumbnail',requestId:event.data.requestId,error:error.message}); }
    };
    const nativeFetch = fetch.bind(window);
    const type = name => name.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    const key = raw => {
      const url = new URL(typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url, 'https://offline.invalid/runtime/pyxel/');
      return url.pathname.includes('/pyodide/v') ? 'pyodide/' + url.pathname.split('/').at(-1) : url.pathname.replace(/^\/runtime\//, '');
    };
    const read = name => {
      if (!Object.hasOwn(assets, name)) throw new Error('同梱ランタイムがありません：' + name);
      if (!bytes.has(name)) bytes.set(name, decodeBase64(assets[name]));
      return bytes.get(name);
    };
    window.offlineURL = raw => {
      const name = key(raw);
      if (!urls.has(name)) urls.set(name, URL.createObjectURL(new Blob([read(name)], { type: type(name) })));
      return urls.get(name);
    };
    window.fetch = async (raw, options) => {
      const url = typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url;
      if (/^(blob:|data:)/.test(url)) return nativeFetch(raw, options);
      try { const name = key(raw); return new Response(read(name), { headers: { 'Content-Type': type(name) } }); }
      catch { console.error('Offline runtime resource unavailable:', url); throw new TypeError('オフラインファイルがありません：' + url); }
    };
    try {
      let source = new TextDecoder().decode(read('pyxel/pyxel.js'));
      source = source.replace('console.log(params);', '');
      source = source.replace(/const _scriptDir = \(\(\) => \{[\s\S]*?\}\)\(\);/, 'const _scriptDir = "https://offline.invalid/runtime/pyxel/";');
      source = source.replace('script.src = scriptSrc;', 'script.src = window.offlineURL(scriptSrc);');
      for (const name of ['logoImage', 'promptImage', 'img']) source = source.replace(new RegExp(name + '\\.src = (`[^;]+`);', 'g'), name + '.src = window.offlineURL($1);');
      for (const name of ['iconLink', 'styleSheetLink']) source = source.replace(new RegExp(name + '\\.href = (`[^;]+`);', 'g'), name + '.href = window.offlineURL($1);');
      source = source.replace('await loadPyodide();', 'await loadPyodide({indexURL:"https://offline.invalid/runtime/pyodide/",createPyodideModule:(await import(window.offlineURL("https://offline.invalid/runtime/pyodide/pyodide.asm.mjs"))).default});');
      const script = document.createElement('script'); script.textContent = source; document.head.append(script);
      const interval = setInterval(() => {
        if (window.pyxelContext?.initialized) { port.postMessage({ type: 'ready' }); clearInterval(interval); }
        else if (document.getElementById('pyxel-prompt')) {
          const prompt=document.getElementById('pyxel-prompt');
          // A frame restored from a hidden update dialog can initially measure 0.
          if(!prompt.getBoundingClientRect().width&&document.documentElement.clientWidth)window.dispatchEvent(new Event('resize'));
          port.postMessage({type:'status',message:'ゲーム画面をクリックして開始してください。'});
        }
      }, 300);
      await window.launchPyxel({ command: 'play', name: 'game.pyxapp', base64: event.data.app, gamepad: 'enabled' });
    } catch (e) { port.postMessage({ type: 'error', message: 'Pyxelを起動できません：' + e.message }); }
  }, { once: true });
  const announce = () => parent.postMessage({ type: 'offline-bootstrap-ready', nonce }, '*');
  if (document.readyState === 'complete') announce();
  else addEventListener('load', announce, { once: true });
}
export function startPlayer(frame, options, preview, onMessage) {
  const channel = new MessageChannel();
  let capture = null;
  channel.port1.onmessage = event => {
    const message=event.data;
    if(message?.type === 'thumbnail') {
      if(!capture || message.requestId !== capture.id)return;
      const pending=capture;capture=null;clearTimeout(pending.timer);
      if(message.error)pending.reject(new Error(String(message.error).slice(0,500)));
      else if(typeof message.data !== 'string' || message.data.length > 2*1024*1024 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(message.data))pending.reject(new Error('撮影した画像を確認できません。'));
      else pending.resolve(message.data);
      return;
    }
    onMessage(message);
  };
  const mimeTypes = { html:'text/html',htm:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',wasm:'application/wasm',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',gif:'image/gif',ogg:'audio/ogg',mp3:'audio/mpeg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2' };
  // privatePreviewDocument is pure apart from these two browser helpers.
  const helpers = `const decoder=new TextDecoder();const decodeBase64=${decodeBase64.toString()};const mimeTypes=${JSON.stringify(mimeTypes)};const mime=n=>mimeTypes[n.split('.').pop().toLowerCase()]||'application/octet-stream';window.captureGameCanvas=${captureGameCanvas.toString()};window.offlinePreview=${preview.privatePreviewDocument.toString()};`;
  const boot = options.kind === 'pyxapp' ? pyxelBootstrap : webBootstrap;
  const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; style-src 'unsafe-inline' blob:; img-src blob: data:; connect-src blob: data:; worker-src blob:; font-src blob: data:; media-src blob: data:; base-uri 'none'";
  const nonce = crypto.randomUUID();
  const ready = event => {
    if (event.source !== frame.contentWindow || event.data?.type !== 'offline-bootstrap-ready' || event.data.nonce !== nonce) return;
    window.removeEventListener('message', ready);
    // Transfer each buffer once, including aliased entry HTML and ZIP views.
    // Large WASM/PCK files must not be cloned into a second parent-side copy.
    const buffers = options.files ? [...new Set([...options.files.values()].map(bytes => bytes.buffer).filter(buffer => buffer instanceof ArrayBuffer))] : [];
    try { frame.contentWindow.postMessage({ type: 'offline-game', ...options }, '*', [channel.port2, ...buffers]); }
    catch(error) { onMessage({type:'error',message:'ゲームのファイルを渡せませんでした。接続を確認して起動を再試行してください：'+error.message}); }
  };
  window.addEventListener('message', ready);
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;background:#080c0e;color:white}canvas{image-rendering:pixelated}</style><script>${(helpers + '(' + boot.toString() + ')(' + JSON.stringify(nonce) + ');').replaceAll('</script', '<\\/script')}<\/script>`;
  const stop = () => {
    if(capture){clearTimeout(capture.timer);capture.reject(new Error('ゲームを終了したため撮影を中止しました。'));capture=null;}
    window.removeEventListener('message', ready); channel.port1.close(); channel.port2.close(); frame.srcdoc = '';
  };
  stop.capture = () => new Promise((resolve,reject)=>{
    if(capture){reject(new Error('撮影中です。'));return;}
    const id=crypto.randomUUID(),timer=setTimeout(()=>{capture=null;reject(new Error('撮影できませんでした。ゲームを開始してから再試行してください。'));},8000);
    capture={id,timer,resolve,reject};channel.port1.postMessage({type:'capture',requestId:id});
  });
  return stop;
}
