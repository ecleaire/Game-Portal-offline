import { canUpdateGame,inspectGameContent } from './updates.js';
import {isLauncherEntry} from './native-tools.js';
// Read-only maintenance. No game code is executed and no external URLs fetched.
export function localResources(html, entry) {
  const refs = new Set();
  const clean = html.replace(/<!--[\s\S]*?-->|(<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/\2\s*>/gi,(_match,opening)=>opening||'');
  for (const tag of clean.matchAll(/<(script|img|link|audio|video|source)\b[^>]*>/gi)) {
    if (tag[1].toLowerCase() === 'link' && !/\brel\s*=\s*["']?(?:stylesheet|icon|apple-touch-icon)\b/i.test(tag[0])) continue;
    for (const attr of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) refs.add(attr[1] ?? attr[2] ?? attr[3]);
  }
  // Godot downloads engine/package files dynamically, outside HTML attributes.
  for (const config of html.matchAll(/\bGODOT_CONFIG\s*=\s*(\{[^\n]+\})\s*;/g)) {
    try { for (const name of Object.keys(JSON.parse(config[1]).fileSizes || {})) refs.add(name); } catch { /* Not a recognized config. */ }
  }
  const paths = new Set();
  for (const ref of refs) {
    if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(ref)) continue;
    try {
      const url = new URL(ref.replaceAll('&amp;', '&'), 'https://library.invalid/' + entry);
      paths.add(decodeURIComponent(url.pathname).replace(/^\//, ''));
    } catch { /* Malformed reference is left to the game runtime. */ }
  }
  return [...paths];
}

export async function inspectLibrary(root, library, preview) {
  const issues = [], files = new Map(), ids = new Map(), settingIds = new Set(); let visited = 0, complete = true;
  const add = (kind, path, message, remedy) => { if(issues.length < 1000) issues.push({ kind, path, message, remedy }); else complete=false; };
  async function walk(dir, prefix = '', depth = 0) {
    if (depth > 20) { complete = false; add('limit', prefix, '階層が深いため点検を省略しました。', 'ゲーム専用の小さなフォルダーで点検してください。'); return; }
    try {
      const entries = [];
      for await (const entry of dir.values()) {
        if (++visited > 10000) { complete = false; add('limit', prefix, '点検上限の10,000項目に達しました。', 'フォルダーを分けて点検してください。'); return; }
        entries.push(entry);
      }
      if (entries.some(e => e.name === '.gameportal-uploading')) {
        add('upload', prefix + '.gameportal-uploading', '投稿途中のマーカーが残っています。この作品は一覧に表示されません。', '投稿中でないことと元のゲームを確認してから再投稿してください。'); return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === '__MACOSX' || isLauncherEntry(entry.name) || isLauncherEntry(entry.name.replace(/\.gameportal\.json$/i,''))) continue;
        const path = prefix + entry.name;
        try { library.safePath(path); } catch(error) { add('unreadable', path, error.message, 'ファイル名を確認してください。'); continue; }
        if (entry.kind === 'directory') { await walk(entry, path + '/', depth + 1); if (visited > 10000) return; }
        else files.set(path, entry);
      }
    } catch(error) { complete = false; add('unreadable', prefix || root.name, '読み取れません：' + error.message, '接続とフォルダーの読み取り権限を確認してください。'); }
  }
  await walk(root);
  try { if (!await library.loadLibraryId(root)) add('config', '.gameportal/library-id.json', 'ライブラリIDが未設定です。', '初回だけ編集する人が「設定」で追加・編集を有効にしてください。'); }
  catch(error) { add('config', '.gameportal/library-id.json', error.message, 'バックアップから元のIDを復旧してください。IDを再生成しないでください。'); }
  let metadata = {games:{}};
  try { metadata = await library.loadMetadata(root); }
  catch(error) { add('config', '.gameportal/library.json', error.message, '旧管理情報のバックアップを確認してください。'); }
  for (const path of Object.keys(metadata.games)) {
    if(isLauncherEntry(path.split('/').at(-1)))continue;
    try { library.safePath(path); if (!files.has(path)) add('missing', path, '旧管理情報にあるゲームファイルが見つかりません。', '移動・改名した作品やバックアップを確認してください。'); }
    catch(error) { add('config', '.gameportal/library.json', error.message, '旧管理情報の作品パスを確認してください。'); }
  }
  for (const path of files.keys()) if (path.endsWith('.gameportal.json')) {
    const gamePath = path.slice(0, -'.gameportal.json'.length);
    if (!files.has(gamePath)) add('missing', gamePath, '設定に対応するゲームファイルが見つかりません。', 'ゲームと設定ファイルの名前・配置をそろえてください。');
    try {
      const {data} = await library.loadGameSettings(root, gamePath);
      if (data) { settingIds.add(gamePath);const group = ids.get(data.id) || []; group.push(path); ids.set(data.id, group); }
    } catch(error) { add('config', path, error.message, '設定JSONとバックアップを確認してください。'); }
  }
  for(const path of files.keys()) if(/\.(html?|zip|pyxapp)$/i.test(path) && !/(?:^|\/)GAME-PORTAL\.html$/i.test(path) && !settingIds.has(path)) {
    const id=await library.gameId(path),group=ids.get(id)||[];group.push(path);ids.set(id,group);
  }
  for (const paths of ids.values()) if (paths.length > 1) for (const path of paths) add('duplicate', path, '同じ作品IDが' + paths.length + '件あります：' + paths.filter(p => p !== path).slice(0,3).join('、'), '別作品として複製する場合は「投稿」を使用してください。IDを手で変更しないでください。');
  let checked = 0;
  let scanned=[];try{scanned=await library.scan(root,metadata);}catch(error){complete=false;add('unreadable',root.name,error.message,'接続を確認し、もう一度点検してください。');}
  const currentContent=new Set(scanned.filter(g=>g.contentRevision||g.contentError).map(g=>g.path));
  for(const game of scanned.filter(canUpdateGame))try{for(const message of await inspectGameContent(root,game,library))add('config',game.path,message,'ゲームを開き、「本体を更新」から結果を確認してください。');}catch(error){add('config',game.path,'更新版のファイル・設定を確認できません：'+error.message,'本体更新のバックアップと接続を確認してください。');}
  for (const [path, handle] of files) {
    if (!/\.(html?|zip|pyxapp|exe)$/i.test(path) || /(?:^|\/)GAME-PORTAL(?:\.html|-WINDOWS\.exe)$/i.test(path)) continue;
    checked++;
    if(currentContent.has(path))continue;
    try {
      const file = await handle.getFile();
      if (/\.exe$/i.test(path)) { await library.validateExe(file); continue; }
      if (file.size > 50 * 1024 * 1024) { add('limit', path, '50MBを超えているため内容点検を省略しました。', '作品のサイズを確認してください。'); complete = false; continue; }
      if (/\.pyxapp$/i.test(path)) { library.validatePyxapp(await file.arrayBuffer()); continue; }
      let html, entry = path, available = files;
      if (/\.zip$/i.test(path)) {
        const contents = await preview.unpackPrivateZip(await file.arrayBuffer());
        html = new TextDecoder().decode(contents.get('index.html')); available = contents;
        const layout = preview.webArchiveLayout([...contents.keys()].filter(p => p !== 'index.html'));
        entry = layout?.entry || 'index.html';
      } else html = await file.text();
      for (const dependency of localResources(html, entry)) {
        if (!available.has(dependency)) add('missing', path, '参照ファイルが見つかりません：' + dependency, 'Web書き出しの素材・JS・WASM・PCKをすべて含めてください。');
      }
    } catch(error) {
      add(error.message === 'web_export_required' ? 'missing' : 'package', path, error.message === 'web_export_required' ? 'ZIPに起動用HTMLがありません。' : '内容を読み取れません：' + error.message, '対応形式のWeb書き出し一式、または正常なPYXAPPを用意してください。');
    }
  }
  return { folder: root.name, checked, complete, issues, checkedAt: new Date().toISOString() };
}

function historyRecord(text, game, library) {
  let record;try { record = JSON.parse(text); } catch { throw new Error('履歴のJSONが壊れています。'); }
  if (!record || record.schema !== 1 || record.gamePath !== game.path || typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) throw new Error('対象作品の履歴ではありません。');
  if (record.before === null) return {...record, before: null};
  if (typeof record.before !== 'string') throw new Error('履歴の設定が壊れています。');
  const before = library.parseGameSettings(record.before, game.path);
  if (before.id !== game.id) throw new Error('履歴の作品IDが一致しません。');
  return {...record, before};
}
export async function loadSettingsHistory(root, game, library) {
  let dir;
  try { dir = await (await (await root.getDirectoryHandle('.gameportal')).getDirectoryHandle('history')).getDirectoryHandle(game.id); }
  catch(error) { if (error.name === 'NotFoundError') return {entries:[],complete:true}; throw error; }
  const entries = []; let complete = true, bytes = 0;
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !/^[0-9a-f-]+\.json$/i.test(entry.name)) continue;
    if (entries.length >= 200) { complete = false; break; }
    try {
      const file = await entry.getFile(); if (file.size > 12 * 1024 * 1024) throw new Error('履歴ファイルが大きすぎます。');
      bytes += file.size; if (bytes > 32 * 1024 * 1024) { complete=false; break; }
      const record = historyRecord(await file.text(), game, library);
      entries.push({name:entry.name,savedAt:record.savedAt,before:record.before,error:''});
    } catch(error) { entries.push({name:entry.name,before:null,error:error.message,savedAt:''}); }
  }
  entries.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)); return {entries,complete};
}
export async function restoreSettingsHistory(root, game, name, library) {
  if (!/^[0-9a-f-]+\.json$/i.test(name)) throw new Error('履歴ファイル名を確認してください。');
  const file = await library.getFile(root, `.gameportal/history/${game.id}/${name}`);
  if (file.size > 12 * 1024 * 1024) throw new Error('履歴ファイルが大きすぎます。');
  const record = historyRecord(await file.text(), game, library);
  if (!record.before) throw new Error('初回保存には復元できる以前の設定がありません。');
  await library.saveGameSettings(root, game, record.before,{kind:'restore'});
}
