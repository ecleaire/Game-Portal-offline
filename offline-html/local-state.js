// Folder handles, saves and bounded verification receipts stay in this profile.
// Browser permissions and handles are never transferred to another PC.
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('game-portal-offline-folder-v1', 3);
    let expired=false;const timeout=setTimeout(()=>{expired=true;reject(new Error('このPCの保存領域から応答がありません。Chromeを開き直して再試行してください。'));},8000);
    request.onupgradeneeded = () => {
      if(expired){request.transaction.abort();return;}
      if (request.result.objectStoreNames.contains('libraries')) request.result.deleteObjectStore('libraries');
      for (const name of ['settings', 'saves']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      request.transaction.objectStore('settings').delete('folder');
    };
    request.onerror = () => {clearTimeout(timeout);reject(request.error);};
    request.onblocked = () => {expired=true;clearTimeout(timeout);reject(new Error('以前のランチャーを閉じてから再読み込みしてください。'));};
    request.onsuccess = () => { clearTimeout(timeout);const db = request.result;if(expired){db.close();return;} db.onversionchange = () => { db.close(); database = null; }; resolve(db); };
  }).catch(error => { database = null; throw error; });
  return database;
}
async function access(name, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode); let result;
    const request = operation(tx.objectStore(name)); request.onsuccess = () => { result = request.result; };
    const timeout=mode==='readonly'?setTimeout(()=>{reject(new Error('このPCの保存情報を読み込めませんでした。もう一度操作してください。'));try{tx.abort();}catch{}},8000):null;
    tx.oncomplete = () => {clearTimeout(timeout);resolve(result);}; tx.onabort = () => {clearTimeout(timeout);reject(tx.error || new Error('このPCへ保存できませんでした。'));}; tx.onerror = () => {};
  });
}
export async function cacheHandle(value, remember = true, scope = null) {
  if(!value)return access('settings','readonly',store=>store.get('folder'));
  const record={name:value.name,revision:crypto.randomUUID(),scope,...(remember?{handle:value}:{})};
  await access('settings','readwrite',store=>store.put(record,'folder'));return record;
}
export async function forgetHandle() { return access('settings','readwrite',store=>store.delete('folder')); }
function validReceipt(v){return v&&v.schema===1&&/^[0-9a-f]{32}$/.test(v.libraryId)&&/^[0-9a-f]{32}$/.test(v.id)&&typeof v.gamePath==='string'&&v.gamePath.length>0&&v.gamePath.length<=1000&&/^[0-9a-f-]+\.json$/.test(v.historyName)&&/^[0-9a-f]{64}$/.test(v.expectedHash)&&(v.beforeHash===null||/^[0-9a-f]{64}$/.test(v.beforeHash))&&['edit','capture','restore','post'].includes(v.kind)&&(v.uploadFolder===null||/^game-[0-9a-f-]+$/.test(v.uploadFolder));}
export async function loadSettingsReceipts(){const value=await access('settings','readonly',s=>s.get('save-receipts'));if(value===undefined)return [];if(!Array.isArray(value)||value.length>1000||!value.every(validReceipt))throw new Error('このPCの保存確認記録を確認してください。');return value;}
export async function trackSettingsReceipt(attempt,remove=false,replaces=null){
  if(!validReceipt(attempt))throw new Error('保存確認記録の形式を確認してください。');
  if(replaces&&(remove||!validReceipt(replaces)||['libraryId','gamePath','id'].some(key=>attempt[key]!==replaces[key])))throw new Error('置き換える保存確認記録が一致しません。');
  const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),request=store.get('save-receipts');
    request.onsuccess=()=>{const existing=request.result||[];if(!Array.isArray(existing)||existing.length>1000||!existing.every(validReceipt)){tx.abort();return;}
      const sameReplacement=a=>replaces&&['schema','libraryId','gamePath','id','historyName','expectedHash','beforeHash','kind','uploadFolder'].every(key=>a[key]===replaces[key]);
      if(replaces&&!existing.some(sameReplacement)){tx.abort();return;}
      const next=existing.filter(a=>!sameReplacement(a)&&!(a.libraryId===attempt.libraryId&&a.historyName===attempt.historyName));if(!remove){if(next.length>=1000||next.some(a=>a.libraryId===attempt.libraryId&&a.gamePath===attempt.gamePath)){tx.abort();return;}next.push(attempt);}store.put(next,'save-receipts');};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('保存確認記録を作成できません。保存結果未確認の操作や、このPCの保存領域を確認してください。'));tx.onerror=()=>{};
  });
}
export function validSave(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length <= 1000 &&
    Object.values(data).every(v => typeof v === 'string') && new TextEncoder().encode(JSON.stringify(data)).length <= 500000;
}
export async function loadLocalSave(libraryId, gameId) {
  const value = await access('saves', 'readonly', store => store.get([libraryId, gameId]));
  if (value === undefined) return {};
  if (!validSave(value)) throw new Error('このPCのセーブ形式を確認してください。');
  return value;
}
export async function writeLocalSave(libraryId, gameId, data) {
  if (!validSave(data)) throw new Error('セーブのサイズ・形式を確認してください。');
  await access('saves', 'readwrite', store => store.put(data, [libraryId, gameId]));
}
const BACKUP_LIMIT = 10;
const backupReasons = ['before-update', 'before-content-restore', 'before-save-restore', 'manual'];
function backupKey(libraryId, gameId) {
  if (![libraryId, gameId].every(id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id))) throw new Error('セーブ退避先の作品IDを確認してください。');
  return ['save-backups', libraryId, gameId];
}
export function validSaveBackups(value) {
  return Array.isArray(value) && value.length <= BACKUP_LIMIT && new Set(value.map(v => v?.id)).size === value.length && value.every(v =>
    v && v.schema === 1 && typeof v.id === 'string' && /^[a-f0-9-]{36}$/.test(v.id) &&
    typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)) && backupReasons.includes(v.reason) &&
    typeof v.contentRevision === 'string' && v.contentRevision.length <= 100 && validSave(v.data));
}
export async function loadSaveBackups(libraryId, gameId) {
  const value = await access('settings', 'readonly', store => store.get(backupKey(libraryId, gameId)));
  if (value === undefined) return [];
  if (!validSaveBackups(value)) throw new Error('このPCのセーブ退避履歴が壊れています。自動で上書きせず、ブラウザーの保存データを確認してください。');
  return value;
}
// Read the current save and history, then commit both together when restoring.
// No schema upgrade: older compatible HTML keeps these independent settings keys.
async function changeSaveBackups(libraryId, gameId, reason, contentRevision, restoreId = null) {
  const key = backupKey(libraryId, gameId);
  if (!backupReasons.includes(reason) || typeof contentRevision !== 'string' || contentRevision.length > 100) throw new Error('セーブ退避の種類・本体情報を確認してください。');
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['settings', 'saves'], 'readwrite'), settings = tx.objectStore('settings'), saves = tx.objectStore('saves');
    const historyRequest = settings.get(key), saveRequest = saves.get([libraryId, gameId]);
    let completed = 0, result, failure;
    const ready = () => {
      if (++completed !== 2) return;
      try {
        const history = historyRequest.result === undefined ? [] : historyRequest.result;
        const current = saveRequest.result === undefined ? {} : saveRequest.result;
        if (!validSaveBackups(history) || !validSave(current)) throw new Error('セーブまたは退避履歴の形式を確認してください。既存データは変更しません。');
        const selected = restoreId === null ? null : history.find(item => item.id === restoreId);
        if (restoreId !== null && !selected) throw new Error('選択した退避データが見つかりません。履歴を開き直してください。');
        const backup = { schema: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason, contentRevision, data: current };
        settings.put([backup, ...history].slice(0, BACKUP_LIMIT), key);
        if (selected) saves.put(selected.data, [libraryId, gameId]);
        result = selected ? selected.data : backup;
      } catch (error) { failure = error; tx.abort(); }
    };
    historyRequest.onsuccess = ready; saveRequest.onsuccess = ready;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('このPCにセーブを退避・復元できません。空き容量を確認してください。'));
    tx.onerror = () => {};
  });
}
export async function backupLocalSave(libraryId, gameId, reason, contentRevision = 'original') {
  return changeSaveBackups(libraryId, gameId, reason, contentRevision);
}
export async function restoreLocalSaveBackup(libraryId, gameId, backupId, contentRevision = 'original') {
  if (typeof backupId !== 'string' || !backupId) throw new Error('復元する退避データを選んでください。');
  return changeSaveBackups(libraryId, gameId, 'before-save-restore', contentRevision, backupId);
}
export async function acquirePlaySession(libraryId, gameId) {
  if(!navigator.locks?.request)throw new Error('このブラウザーではゲームの起動に必要な機能が使えません。PC版ChromeでHTMLを開いてください。');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  return new Promise((resolve, reject) => {
    navigator.locks.request(`game-portal-play-${libraryId}-${gameId}`, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('このゲームは別のタブで起動中です。終了してから開いてください。')); return; }
      resolve(release); await held;
    }).catch(reject);
  });
}
export async function saveDeviceId(){
  const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite'),store=tx.objectStore('settings'),request=store.get('save-sync-device');let value;
    request.onsuccess=()=>{value=request.result;if(value===undefined){value=crypto.randomUUID().replaceAll('-','');store.put(value,'save-sync-device');}else if(!/^[a-f0-9]{32}$/.test(value))tx.abort();};
    tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||new Error('このPCの同期IDを確認してください。'));tx.onerror=()=>{};
  });
}
const canonicalSave=data=>JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(key=>[key,data[key]])));
const emptySync=()=>({schema:1,base:null,clock:{},pending:null});
function validSync(value,libraryId,gameId){
  const clock=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length<=128&&Object.entries(v).every(([k,n])=>/^[a-f0-9]{32}$/.test(k)&&Number.isSafeInteger(n)&&n>0);
  if(!value||value.schema!==1||!clock(value.clock)||value.base!==null&&(typeof value.base!=='string'||value.base.length>500000))return false;
  if(value.base!==null)try{if(!validSave(JSON.parse(value.base)))return false;}catch{return false;}
  const p=value.pending;return p===null||p&&p.schema===1&&p.libraryId===libraryId&&p.gameId===gameId&&/^[a-f0-9]{32}$/.test(p.revision)&&/^[a-f0-9]{32}$/.test(p.deviceId)&&clock(p.clock)&&p.clock[p.deviceId]>0&&typeof p.createdAt==='string'&&Number.isFinite(Date.parse(p.createdAt))&&validSave(p.data);
}
export async function loadSaveSync(libraryId,gameId){
  backupKey(libraryId,gameId);const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(['settings','saves'],'readonly'),a=tx.objectStore('saves').get([libraryId,gameId]),b=tx.objectStore('settings').get(['save-sync',libraryId,gameId]);
    tx.oncomplete=()=>{const data=a.result===undefined?{}:a.result,state=b.result===undefined?emptySync():b.result;if(!validSave(data)||!validSync(state,libraryId,gameId)){reject(new Error('このPCのセーブ同期記録を確認してください。'));return;}resolve({data,state});};tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
  });
}
export async function commitSaveSync(libraryId,gameId,expected,state,data=expected.data){
  const historyKey=backupKey(libraryId,gameId);if(!validSync(state,libraryId,gameId)||!validSave(data))throw new Error('セーブ同期の形式を確認してください。');
  const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(['settings','saves'],'readwrite'),settings=tx.objectStore('settings'),saves=tx.objectStore('saves'),a=saves.get([libraryId,gameId]),b=settings.get(['save-sync',libraryId,gameId]),c=settings.get(historyKey);let ready=0,failure;
    const apply=()=>{if(++ready!==3)return;try{
      const current=a.result===undefined?{}:a.result,previous=b.result===undefined?emptySync():b.result,history=c.result===undefined?[]:c.result;
      if(!validSave(current)||!validSync(previous,libraryId,gameId)||!validSaveBackups(history))throw new Error('セーブまたは退避履歴を確認してください。');
      if(canonicalSave(current)!==canonicalSave(expected.data)||JSON.stringify(previous)!==JSON.stringify(expected.state))throw new Error('このPCのセーブが変わりました。同期を再試行してください。');
      if(canonicalSave(current)!==canonicalSave(data)){
        settings.put([{schema:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason:'before-save-restore',contentRevision:'shared-save',data:current},...history].slice(0,BACKUP_LIMIT),historyKey);
        saves.put(data,[libraryId,gameId]);
      }
      settings.put(state,['save-sync',libraryId,gameId]);
    }catch(error){failure=error;tx.abort();}};
    a.onsuccess=apply;b.onsuccess=apply;c.onsuccess=apply;tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure||tx.error||new Error('セーブ同期をこのPCへ記録できません。'));tx.onerror=()=>{};
  });
}
