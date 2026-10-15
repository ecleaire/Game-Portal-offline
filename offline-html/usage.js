// File lengths, not disk allocation or free space. No game bytes are executed.
const LIMIT = 10000, DEPTH = 20;
export async function measureLibraryUsage(root, tools, contentTools, options = {}) {
  const rows = new Map(), warnings = [];
  let visited = 0, files = 0, bytes = 0, complete = true;
  const startedAt = new Date().toISOString();
  const cancelled = () => { if (options.signal?.aborted) throw new DOMException('容量確認を中止しました。', 'AbortError'); };
  function warn(path, message, row) {
    complete = false; if (row) row.complete = false;
    if (warnings.length < 100 && !warnings.some(w => w.path === path && w.message === message)) warnings.push({ path, message });
  }
  function rowFor(name) {
    const key = name || '';
    if (!rows.has(key)) {
      const posted = name && contentTools.canUpdateGame({ path: name + '/entry.html' });
      rows.set(key, { path: name || '.', title: name || 'ルート直下のファイル', kind: posted ? 'posted' : name === '.gameportal' ? 'management' : name ? 'folder' : 'root',
        bytes: 0, files: 0, originalBytes: 0, metadataBytes: 0, activeBytes: 0, previousBytes: 0, otherBytes: 0, unknownBytes: 0,
        pending: false, uploading: false, complete: true, releases: [], versions: new Map(), before: null });
    }
    return rows.get(key);
  }
  async function describe(name, row) {
    try { return await contentTools.describeContentStorage(root, name, tools); }
    catch (error) { cancelled(); warn(name, '本体設定を確認できず、保存版を未分類にします：' + error.message, row); return null; }
  }
  async function walk(directory, prefix = '', depth = 0, row = null) {
    cancelled();
    if (depth > DEPTH) { warn(prefix, '20階層を超えたため、一部の容量を確認できません。', row); return; }
    try {
      for await (const entry of directory.values()) {
        cancelled();
        if (++visited > LIMIT) { warn(prefix || '.', '10,000項目の上限に達しました。合計は確認できた範囲だけです。', row); return; }
        const path = prefix + entry.name;
        let owner = row;
        if (!owner) owner = rowFor(entry.kind === 'directory' ? entry.name : '');
        try {
          tools.safePath(path);
          if (entry.kind === 'directory') {
            const relative = owner.path === '.' ? path : path.slice(owner.path.length + 1), parts = relative.split('/');
            if (owner.kind === 'posted' && parts[0] === '.gameportal-versions' && parts.length === 2 && !owner.versions.has(parts[1])) owner.versions.set(parts[1], {id:parts[1],path,bytes:0,files:0,status:'unknown'});
            if (!prefix && owner.kind === 'posted') owner.before = await describe(entry.name, owner);
            await walk(entry, path + '/', depth + 1, owner);
          } else {
            const file = await entry.getFile(); cancelled();
            if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error('ファイルサイズを確認できません。');
            if(!Number.isSafeInteger(owner.bytes+file.size)||!Number.isSafeInteger(bytes+file.size))throw new Error('合計サイズが安全な集計範囲を超えています。');
            owner.files++; owner.bytes += file.size; files++; bytes += file.size;
            const relative = owner.path === '.' ? path : path.slice(owner.path.length + 1);
            const parts = relative.split('/');
            if (relative === '.gameportal-uploading') owner.uploading = true;
            if (owner.kind === 'posted' && parts[0] === '.gameportal-versions' && parts.length > 2) {
              const id = parts[1];
              if (!owner.versions.has(id)) owner.versions.set(id, { id, path: owner.path + '/.gameportal-versions/' + id, bytes: 0, files: 0, status: 'unknown' });
              const release = owner.versions.get(id); release.bytes += file.size; release.files++;
            } else if (owner.kind === 'management' || parts.some(part => part.startsWith('.gameportal')) || /\.gameportal\.json$/i.test(relative)) owner.metadataBytes += file.size;
            else owner.originalBytes += file.size;
            // A single directly-owned settings file gives a useful display name.
            if (owner.kind === 'posted' && parts[0] !== '.gameportal-versions' && /\.gameportal\.json$/i.test(relative) && file.size <= 2 * 1024 * 1024) {
              try { const settings = tools.parseGameSettings(await file.text(), path.slice(0, -'.gameportal.json'.length)); owner.title = settings.title; }
              catch { /* Capacity remains measurable even when settings are broken. */ }
            }
          }
        } catch (error) { cancelled(); warn(path, '読み取れません：' + error.message, owner); }
        if (visited % 50 === 0) options.onProgress?.({ visited, files, bytes });
        if (visited > LIMIT) return;
      }
    } catch (error) { cancelled(); warn(prefix || '.', 'フォルダーを読み取れません：' + error.message, row); }
  }
  async function identity(){
    try{const file=await tools.getFile(root,'.gameportal/library-id.json');if(file.size>1024)throw new Error('ID設定が大きすぎます。');return await file.text();}
    catch(error){cancelled();if(error.name==='NotFoundError')return null;warn('.gameportal/library-id.json','IDの照合ができません：'+error.message);return undefined;}
  }
  const beforeIdentity=await identity();
  await walk(root); cancelled();
  for (const row of rows.values()) {
    if (row.kind === 'posted') {
      const after = await describe(row.path, row); cancelled();
      let references = after;
      if (row.before?.fingerprint !== after?.fingerprint) { references = null; warn(row.path, '確認中に本体設定が変わりました。保存版を未分類にし、もう一度確認してください。', row); }
      row.pending = !!after?.pending;
      for (const release of row.versions.values()) {
        const validName = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(release.id);
        if(!validName)warn(release.path,'保存版のフォルダー名を確認できないため未分類にします。',row);
        release.status = !references || !validName || references.pending || row.uploading ? 'unknown' : references.active === release.id ? 'active' : references.previous === release.id ? 'previous' : 'other';
        row[release.status === 'active' ? 'activeBytes' : release.status === 'previous' ? 'previousBytes' : release.status === 'other' ? 'otherBytes' : 'unknownBytes'] += release.bytes;
      }
      if (row.pending) warn(row.path, '更新結果未確認です。保存版には切り替え途中の本体が含まれる可能性があります。', row);
    }
    if (row.uploading) warn(row.path, '投稿途中です。ファイル数・容量は確認時点の値です。', row);
    row.releases = [...row.versions.values()].sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
    delete row.versions; delete row.before;
  }
  if(beforeIdentity!==await identity())warn('.gameportal/library-id.json','確認中にライブラリIDが変わりました。結果は一部確認として扱い、再接続して確認してください。');
  options.onProgress?.({ visited: Math.min(visited, LIMIT), files, bytes }); cancelled();
  return { schema: 1, folder: root.name, startedAt, checkedAt: new Date().toISOString(), complete, files, bytes, visited: Math.min(visited, LIMIT), warnings,
    rows: [...rows.values()].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path, 'ja')) };
}
