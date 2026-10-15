import { checkCompatibility, ensureCompatibility } from './compatibility.js';
import { resolveGameContent } from './updates.js';
import {nativeLayout,validateExe} from './native-tools.js';
const MAX_FILES = 500, MAX_BYTES = 200 * 1024 * 1024;
export function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw new Error('安全に扱えないファイル名です。');
  return value.split('/');
}
export async function getFile(root, path) {
  const parts = safePath(path); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
  return (await folder.getFileHandle(parts.at(-1))).getFile();
}
export async function writeFile(root, path, content) {
  const parts = safePath(path); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
  const handle = await folder.getFileHandle(parts.at(-1), { create: true });
  const writer = await handle.createWritable({ mode: 'exclusive' });
  try { await writer.write(content); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
function parseLibraryId(text) {
  let data;try { data=JSON.parse(text); } catch { throw new Error('保管フォルダーのID設定が壊れています。'); }
  if (!data || data.schema !== 1 || typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id)) throw new Error('保管フォルダーのID設定を確認してください。');
  return data.id;
}
export async function loadLibraryId(root) {
  await checkCompatibility(root);
  try { const file = await getFile(root, '.gameportal/library-id.json'); if (file.size > 1024) throw new Error('保管フォルダーのID設定が大きすぎます。'); return parseLibraryId(await file.text()); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
export async function ensureLibraryId(root) {
  const existing = await loadLibraryId(root); await ensureCompatibility(root); if (existing) return existing;
  const folder = await root.getDirectoryHandle('.gameportal', { create: true });
  const handle = await folder.getFileHandle('library-id.json', { create: true });
  const writer = await handle.createWritable({ mode: 'exclusive' });
  try {
    const text = await (await handle.getFile()).text();
    if (text) { const id = parseLibraryId(text); await writer.abort(); return id; }
    const id = crypto.randomUUID().replaceAll('-', '');
    await writer.write(JSON.stringify({ schema: 1, id }, null, 2)); await writer.close();
    if (await loadLibraryId(root) !== id) throw new Error('初期設定中に別の更新がありました。フォルダーを選び直してください。');
    return id;
  } catch (error) { await writer.abort().catch(() => {}); throw error; }
}
export async function loadMetadata(root) {
  try {
    const file = await getFile(root, '.gameportal/library.json');
    if (file.size > 2 * 1024 * 1024) throw new Error('管理情報のサイズが大きすぎます。');
    let data;try { data = JSON.parse(await file.text()); } catch { throw new Error('旧管理情報のJSONが壊れています。'); }
    if (!data || data.schema !== 1 || !data.games || Array.isArray(data.games) || typeof data.games !== 'object') throw new Error('管理情報の形式を確認してください。');
    return data;
  } catch (e) { if (e.name === 'NotFoundError') return { schema: 1, revision: null, games: {} }; throw e; }
}
export async function saveMetadata(root, data) {
  const current = await loadMetadata(root);
  if (current.revision !== data.revision) throw new Error('別の画面で管理情報が更新されています。「再読み込み」してから編集してください。');
  const next = { ...data, revision: crypto.randomUUID() };
  await writeFile(root, '.gameportal/library.json', JSON.stringify(next, null, 2));
  data.revision = next.revision;
}
export function tagsFrom(text) {
  return [...new Set(String(text).split(/[,、\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 12).map(s => s.slice(0, 32));
}
export function parseGameSettings(text, path = '') {
    if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('ゲーム設定のサイズが大きすぎます。');
    let data;try { data = JSON.parse(text); } catch { throw new Error('ゲーム設定のJSONが壊れています。'); }
    if (!data || data.schema !== 1 || typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id) ||
      typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120 ||
      !Array.isArray(data.tags) || data.tags.length > 12 || data.tags.some(t => typeof t !== 'string' || t.length > 32) ||
      typeof data.developmentEnvironment !== 'string' || data.developmentEnvironment.length > 120 ||
      (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 2000)) ||
      (data.instructions !== undefined && (typeof data.instructions !== 'string' || data.instructions.length > 4000)) ||
      (data.thumbnail !== null && (typeof data.thumbnail !== 'string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.thumbnail)))) {
      throw new Error('ゲーム設定の形式を確認してください：' + path + '.gameportal.json');
    }
    return {...data,description:data.description ?? '',instructions:data.instructions ?? ''};
}
export async function loadGameSettings(root, path) {
  safePath(path);
  try {
    const file = await getFile(root, path + '.gameportal.json');
    if (file.size > 2 * 1024 * 1024) throw new Error('ゲーム設定のサイズが大きすぎます。');
    const text = await file.text(), data = parseGameSettings(text, path);
    return { data, text };
  } catch (error) { if (error.name === 'NotFoundError') return { data: null, text: null }; throw error; }
}
let settingsSaveObserver=async()=>{};
export function setSettingsSaveObserver(observer){settingsSaveObserver=observer;}
const settingsDigest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function unconfirmedSettingsSave(attempt,cause){const error=new Error('保存結果未確認です。書き込みが反映されている可能性があります。再保存せず、接続を戻して「保存結果を確認」を押してください。'+(cause?.message?' '+cause.message:''));error.code='SETTINGS_SAVE_UNCONFIRMED';error.attempt=attempt;return error;}
export async function verifySettingsSave(root,attempt){
  if(!attempt||attempt.schema!==1||!/^[0-9a-f]{32}$/.test(attempt.id)||!/^[0-9a-f-]+\.json$/.test(attempt.historyName)||!/^[0-9a-f]{64}$/.test(attempt.expectedHash)||attempt.beforeHash!==null&&!/^[0-9a-f]{64}$/.test(attempt.beforeHash))throw new Error('保存確認の記録が不正です。');
  safePath(attempt.gamePath);
  if(attempt.libraryId&&await loadLibraryId(root)!==attempt.libraryId)throw new Error('保存した保管フォルダーを選んでください。別のライブラリでは確認できません。');
  const historyFile=await getFile(root,`.gameportal/history/${attempt.id}/${attempt.historyName}`);
  if(historyFile.size>12*1024*1024)throw new Error('保存確認の履歴が大きすぎます。');
  const history=JSON.parse(await historyFile.text());
  if(history.schema!==1||history.gamePath!==attempt.gamePath||typeof history.after!=='string'||await settingsDigest(history.after)!==attempt.expectedHash)throw new Error('保存確認の履歴が一致しません。');
  if((history.before===null?null:typeof history.before==='string'?await settingsDigest(history.before):'invalid')!==attempt.beforeHash)throw new Error('保存前の確認記録が一致しません。');
  const desired=parseGameSettings(history.after,attempt.gamePath);if(desired.id!==attempt.id)throw new Error('保存確認の作品IDが一致しません。');
  let actual=null;try{const file=await getFile(root,attempt.gamePath+'.gameportal.json');if(file.size>2*1024*1024)throw new Error('現在の設定が大きすぎます。');actual=await file.text();}catch(error){if(error.name!=='NotFoundError')throw error;}
  const hash=actual===null||actual===''&&attempt.beforeHash===null?null:await settingsDigest(actual);
  if(hash===attempt.expectedHash)return {state:'confirmed',game:desired};
  if(hash===attempt.beforeHash)return {state:'not-saved',game:desired};
  return {state:'changed'};
}
export async function saveGameSettings(root, game, values, options={}) {
  await checkCompatibility(root);
  let current;
  if(options.retryAttempt){
    if(options.retryAttempt.gamePath!==game.path||options.retryAttempt.id!==game.id||(await verifySettingsSave(root,options.retryAttempt)).state!=='not-saved')throw new Error('現在の設定が変わりました。再保存せず、保存結果を確認してください。');
    if(options.retryAttempt.beforeHash===null){let text=null;try{const file=await getFile(root,game.path+'.gameportal.json');if(file.size>2*1024*1024)throw new Error('現在の設定が大きすぎます。');text=await file.text();}catch(error){if(error.name!=='NotFoundError')throw error;}if(text!==null&&text!=='')throw new Error('現在の設定が変わりました。');current={data:null,text:null};}
  }
  current||=await loadGameSettings(root, game.path);
  if (current.text !== game.settingsText) throw new Error('このゲームの設定が更新されています。「再読み込み」してから編集してください。');
  const next = { ...current.data, schema: 1, id: game.id, title: values.title.trim(),
    tags: tagsFrom(values.tags.join(',')), developmentEnvironment: values.developmentEnvironment.trim(),
    description: values.description ?? current.data?.description ?? '', instructions: values.instructions ?? current.data?.instructions ?? '',
    thumbnail: values.thumbnail, updatedAt: new Date().toISOString() };
  if (typeof next.description !== 'string' || next.description.length > 2000 || typeof next.instructions !== 'string' || next.instructions.length > 4000) throw new Error('概要は2000文字、操作方法は4000文字以内で入力してください。');
  next.description=next.description.trim();next.instructions=next.instructions.trim();
  if (!next.title || next.title.length > 120 || next.developmentEnvironment.length > 120 ||
    (next.thumbnail !== null && (typeof next.thumbnail !== 'string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(next.thumbnail)))) throw new Error('ゲーム設定の入力内容を確認してください。');
  const text = JSON.stringify(next, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('ゲーム設定のサイズが大きすぎます。');
  const attempt={schema:1,id:game.id,gamePath:game.path,historyName:crypto.randomUUID()+'.json',expectedHash:await settingsDigest(text),beforeHash:current.text===null?null:await settingsDigest(current.text),kind:options.kind||'edit',uploadFolder:options.uploadFolder||null};
  const parts = safePath(game.path + '.gameportal.json'); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
  const handle = await folder.getFileHandle(parts.at(-1), { create: true });
  let writer;
  try { writer = await handle.createWritable({ mode: 'exclusive' }); }
  catch (error) { if (error.name === 'NoModificationAllowedError') throw new Error('このゲームの設定は別の画面で保存中です。少し待って再読み込みしてください。'); throw error; }
  let closing=false,tracked=false;
  try {
    const live = await handle.getFile(), actual = await live.text();
    if ((current.text === null ? actual !== '' : actual !== current.text)) throw new Error('このゲームの設定が更新されています。「再読み込み」してから編集してください。');
    const history = { schema: 1, gamePath: game.path, before: current.text, after: text, savedAt: new Date().toISOString() };
    await writeFile(root, `.gameportal/history/${game.id}/${attempt.historyName}`, JSON.stringify(history, null, 2));
    await settingsSaveObserver('started',attempt);tracked=true;
    await writer.write(text);closing=true;await writer.close();
  } catch (error) { await writer.abort().catch(() => {});if(closing)throw unconfirmedSettingsSave(attempt,error);if(tracked)await settingsSaveObserver('cancelled',attempt).catch(()=>{});throw error; }
  try{if(await(await handle.getFile()).text()!==text)throw new Error('保存後の設定が一致しません。');}
  catch(error){throw unconfirmedSettingsSave(attempt,error);}
  await settingsSaveObserver('confirmed',attempt).catch(()=>{});
}
export async function retrySettingsSave(root,attempt){
  const result=await verifySettingsSave(root,attempt);if(result.state!=='not-saved')throw new Error('未反映と確認できた保存だけ再試行できます。保存済みや別の変更を上書きしません。');
  const previous=attempt.beforeHash===null?null:(await loadGameSettings(root,attempt.gamePath)).text;
  await saveGameSettings(root,{path:attempt.gamePath,id:attempt.id,settingsText:previous},result.game,{kind:attempt.kind,uploadFolder:attempt.uploadFolder,retryAttempt:attempt});
}
export function validatePyxapp(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || bytes.length > 50 * 1024 * 1024) throw new Error('PYXAPPは50MB以内にしてください。');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (view.getUint32(at,true) === 0x06054b50) { end = at; break; }
  if (end < 0 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw new Error('PyxelでpackageしたPYXAPPを選択してください。');
  const count = view.getUint16(end+10,true), size = view.getUint32(end+12,true), start = view.getUint32(end+16,true);
  if (!count || count > MAX_FILES || start + size > end) throw new Error('PYXAPPの構造・ファイル数を確認してください。');
  let at = start, total = 0, startup = false; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at+46 > end || view.getUint32(at,true)!==0x02014b50) throw new Error('PYXAPPが壊れています。');
    const length=view.getUint16(at+28,true), extra=view.getUint16(at+30,true), comment=view.getUint16(at+32,true);
    const method=view.getUint16(at+10,true), flags=view.getUint16(at+8,true);
    if (at+46+length+extra+comment>end || (flags&1) || ![0,8].includes(method)) throw new Error('対応していないPYXAPPです。');
    const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+length)); safePath(name.replace(/\/$/,''));
    const normalized=name.toLowerCase(); if(names.has(normalized))throw new Error('PYXAPP内のファイル名が重複しています。'); names.add(normalized);
    total+=view.getUint32(at+24,true); if(total>MAX_BYTES)throw new Error('PYXAPPの展開後サイズは200MB以内にしてください。');
    if(name.endsWith('/.pyxapp_startup_script'))startup=true;
    at+=46+length+extra+comment;
  }
  if (!startup || at !== start+size) throw new Error('PYXAPPの起動情報がありません。Pyxelでpackageしてください。');
}
export function embeddedPyxel(html) {
  if (!/pyxel\.js/i.test(html) || !/launchPyxel|pyxel-play/i.test(html)) return null;
  const match = html.match(/base64\s*[:=]\s*(["'])([A-Za-z0-9+/=]+)\1/);
  return match ? match[2] : null;
}
export async function gameId(path) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export async function scan(root, metadata, {signal} = {}) {
  const games = [], candidates = []; let visited = 0;
  async function add(path, title, kind, handle, folder, entry) {
    let settings, settingsError = '';
    try { settings = await loadGameSettings(root, path); }
    catch (error) { settings = { data: null, text: null }; settingsError = error.message; }
    signal?.throwIfAborted();
    const saved = settings.data || (Object.hasOwn(metadata.games, path) ? metadata.games[path] : {});
    const replacement=await resolveGameContent(root,path,{safePath,getFile}),id=settings.data?.id||await gameId(path);
    if(replacement.contentError)settingsError= replacement.contentError;
    if(replacement.contentGameId&&replacement.contentGameId!==id)settingsError='ゲーム本体と作品情報のIDが一致しません。';
    return { id, settingsText: settings.text, settingsError, path, kind, handle, folder, entry, title: typeof saved?.title === 'string' && saved.title.trim() ? saved.title.slice(0, 120) : title,
      tags: Array.isArray(saved?.tags) ? tagsFrom(saved.tags.filter(t => typeof t === 'string').join(',')) : [],
      developmentEnvironment: settings.data?.developmentEnvironment || (kind === 'pyxapp' ? 'Pyxel' : ''),
      description: typeof saved?.description === 'string' ? saved.description.slice(0,2000) : '',
      instructions: typeof saved?.instructions === 'string' ? saved.instructions.slice(0,4000) : '',
      updatedAt: settings.data?.updatedAt || '',
      thumbnail: settings.data ? saved.thumbnail : saved?.thumbnail === true,...replacement,settingsError };
  }
  async function walk(folder, prefix = '', depth = 0) {
    signal?.throwIfAborted();
    try { await folder.getFileHandle('.gameportal-uploading'); return; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    const entries = []; for await (const entry of folder.values()) { signal?.throwIfAborted(); if (entry.name === '.gameportal-uploading') return; if (++visited > 10000) throw new Error('ファイルが多すぎます。ゲーム専用のフォルダーを選択してください。'); if (!entry.name.startsWith('.') && entry.name !== '__MACOSX') entries.push(entry); }
    const html = entries.filter(e => e.kind === 'file' && /\.html?$/i.test(e.name));
    let native=null;try{native=nativeLayout(entries.filter(e=>e.kind==='file').map(e=>e.name));}catch{}
    const entry = native ? entries.find(e=>e.name===native.entry) : html.find(e => /^index\.html?$/i.test(e.name)) || (html.length === 1 ? html[0] : null);
    if (depth > 0 && entry) { candidates.push([prefix + entry.name, folder.name, native?'exe':'html', entry, folder, entry.name]); return; }
    for (const file of entries.filter(e => e.kind === 'file')) {
      const ext = file.name.split('.').at(-1).toLowerCase();
      if (['html', 'htm', 'zip', 'pyxapp','exe'].includes(ext) && !/^GAME-PORTAL(?:-WINDOWS\.exe|\.html)$/i.test(file.name)) candidates.push([prefix + file.name, file.name.replace(/\.[^.]+$/, ''), ext === 'htm' ? 'html' : ext, file, folder, file.name]);
    }
    if (depth < 8) for (const dir of entries.filter(e => e.kind === 'directory')) await walk(dir, prefix + dir.name + '/', depth + 1);
  }
  await walk(root);
  // Overlap metadata I/O on shared folders, with a small fixed concurrency.
  let next = 0, failure;
  await Promise.all(Array.from({length: Math.min(4,candidates.length)},async()=>{
    while(!failure&&next<candidates.length){
      const index=next++;
      try{signal?.throwIfAborted();games[index]=await add(...candidates[index]);signal?.throwIfAborted();}catch(error){failure ||= error;}
    }
  }));
  if(failure)throw failure;
  signal?.throwIfAborted();
  const ids = new Map(); for (const game of games) ids.set(game.id, (ids.get(game.id) || 0) + 1);
  for (const game of games) if (ids.get(game.id) > 1) { game.identityConflict = true; game.settingsError = '同じ作品IDのゲームが複数あります。別作品として追加する場合は「投稿」を使用してください。'; }
  return games.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
export async function readTree(folder, preloaded = new Map(), {fileBacked = false} = {}) {
  const entries = []; let bytes = 0;
  async function walk(dir, prefix = '') {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      const path = prefix + entry.name; safePath(path);
      if (entry.kind === 'directory') await walk(entry, path + '/');
      else {
        if (/\.(zip|pyxapp|exe)$/i.test(path) || /\.gameportal\.json$/i.test(path) || /^GAME-PORTAL\.html$/i.test(entry.name)) continue;
        if (entries.length >= MAX_FILES) throw new Error('ゲームは500ファイル・展開後200MB以内にしてください。');
        entries.push({path, entry});
      }
    }
  }
  await walk(folder);
  // Reserve bytes before allocating buffers; preserve traversal order.
  const contents = new Array(entries.length); let next = 0, failure;
  await Promise.all(Array.from({length: Math.min(4, entries.length)}, async () => {
    while (!failure && next < entries.length) {
      const index = next++, {path, entry} = entries[index];
      try {
        const ready = preloaded.get(path), file = ready ? null : await entry.getFile();
        bytes += ready ? ready.byteLength : file.size;
        if (bytes > MAX_BYTES) throw new Error('ゲームは500ファイル・展開後200MB以内にしてください。');
        // Keep large assets file-backed. Only HTML/CSS need rewriting as text.
        // File snapshots are acquired anew for every launch, never cached.
        contents[index] = ready || (fileBacked && !/\.(?:html?|css)$/i.test(path) ? file : new Uint8Array(await file.arrayBuffer()));
      } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return new Map(entries.map(({path}, index) => [path, contents[index]]));
}
export async function postGame(root, files, packageTools, onProgress = () => {}) {
  await checkCompatibility(root);
  files = [...files];
  onProgress({phase:'validate',current:0,total:files.length});
  if (!files.length || files.length > MAX_FILES || files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error('投稿は500ファイル・200MB以内にしてください。');
  const single = files.length === 1 && !files[0].webkitRelativePath;
  if (single && !/\.(html?|zip|pyxapp|exe)$/i.test(files[0].name)) throw new Error('HTML・ZIP・PYXAPP・EXEを選択してください。');
  const paths = files.map(f => f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name);
  paths.forEach(safePath);
  const native=single?/\.exe$/i.test(files[0].name)?{entry:paths[0],root:''}:null:nativeLayout(paths);
  if(native)await validateExe(files[paths.indexOf(native.entry)]);
  if (!single && !native && !packageTools.webArchiveLayout(paths)) throw new Error('起動用HTML、またはEXEと素材をまとめたフォルダーを選んでください。');
  if (single && /\.zip$/i.test(files[0].name)) {
    try { await packageTools.unpackPrivateZip(await files[0].arrayBuffer()); }
    catch (error) {
      if (error.message === 'web_export_required') throw new Error('起動用HTMLがありません。GodotはWeb書き出しのHTML・JS・WASM・PCKをまとめてZIPにしてください。');
      if (error.message === 'invalid_preview') throw new Error('ZIPを読み取れません。破損していないWeb書き出しのZIPを選び直してください。');
      throw error;
    }
  }
  if (single && /\.pyxapp$/i.test(files[0].name)) validatePyxapp(await files[0].arrayBuffer());
  const title = (single ? files[0].name.replace(/\.[^.]+$/, '') : files[0].webkitRelativePath.split('/')[0]).slice(0, 120);
  const name = 'game-' + crypto.randomUUID();
  const dir = await root.getDirectoryHandle(name, { create: true });
  try {
    await writeFile(dir, '.gameportal-uploading', '投稿準備中');
    onProgress({phase:'copy',current:0,total:files.length});
    for (let i = 0; i < files.length; i++) { await writeFile(dir, paths[i], files[i]);onProgress({phase:'copy',current:i+1,total:files.length}); }
    const layout = single ? null : native || packageTools.webArchiveLayout(paths);
    const entry = single ? paths[0] : layout.root + layout.entry;
    const relative = name + '/' + entry;
    onProgress({phase:'settings',current:files.length,total:files.length});
    await saveGameSettings(root, { path: relative, id: crypto.randomUUID().replaceAll('-', ''), settingsText: null },
      { title, tags: [], thumbnail: null, developmentEnvironment: /\.pyxapp$/i.test(entry) ? 'Pyxel' : '' },{kind:'post',uploadFolder:name});
    await dir.removeEntry('.gameportal-uploading');
    return relative;
  } catch (e) { if(e.code!=='SETTINGS_SAVE_UNCONFIRMED')try{await root.removeEntry(name,{recursive:true});}catch{const failure=new Error(e.message+' 追加途中のフォルダーが残っている可能性があります。接続を戻して「ライブラリ点検」で確認してください。',{cause:e});failure.name=e.name;throw failure;}throw e; }
}

export {validateExe};
