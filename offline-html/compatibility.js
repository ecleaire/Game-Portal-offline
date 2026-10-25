// Raise the floor only when a library format requires new reader/writer behavior.
export const LAUNCHER_VERSION = '0.24.11';
const MINIMUM_VERSION = '0.14.0';
const BASE_FEATURES = ['per-game-settings-v1', 'content-selector-v1'];
const FEATURES = [...BASE_FEATURES,'extended-tags-v1'];
const FILE = 'compatibility.json';
function failure(message) {
  const error = new Error(message + ' 全PCのGAME-PORTAL.htmlを対応版へ交換し、再読み込みしてください。互換性情報は削除・書き換えないでください。');
  error.code = 'LIBRARY_INCOMPATIBLE';
  return error;
}
function parts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw failure('互換性情報のバージョン形式を確認できません。');
  const result = version.split('.').map(Number);
  if (!result.every(Number.isSafeInteger)) throw failure('互換性情報のバージョンが大きすぎます。');
  return result;
}
function older(a, b) {
  const left = parts(a), right = parts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i];
  return false;
}
function validate(text, version) {
  let data;
  try { data = JSON.parse(text); } catch { throw failure('共有フォルダーの互換性情報が壊れています。管理者がバックアップと照合してください。'); }
  if (!data || data.schema !== 1 || !Array.isArray(data.requiredFeatures) || data.requiredFeatures.length > 32 || data.requiredFeatures.some(f => typeof f !== 'string' || !FEATURES.includes(f))) throw failure('このHTMLでは共有フォルダーの形式・必須機能に対応できません。');
  if (older(version, data.minLauncherVersion)) throw failure(`この共有フォルダーには v${data.minLauncherVersion} 以上が必要です（このHTML：v${version}）。`);
  return data;
}
async function read(root) {
  try {
    const directory = await root.getDirectoryHandle('.gameportal');
    const file = await (await directory.getFileHandle(FILE)).getFile();
    if (file.size > 8192) throw failure('共有フォルダーの互換性情報が大きすぎます。');
    return await file.text();
  } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}
export async function checkCompatibility(root, version = LAUNCHER_VERSION) {
  const text = await read(root);
  return text === null ? null : validate(text, version);
}
export async function ensureCompatibility(root,{extendedTags=false}={}) {
  const minimum=extendedTags?'0.22.0':MINIMUM_VERSION,required=extendedTags?FEATURES:BASE_FEATURES;
  const current = await checkCompatibility(root);
  // Never lower a shared requirement or discard fields written by another version.
  if (current && !older(current.minLauncherVersion, minimum) && required.every(f => current.requiredFeatures.includes(f))) return current;
  const directory = await root.getDirectoryHandle('.gameportal', { create: true });
  const handle = await directory.getFileHandle(FILE, { create: true });
  const writer = await handle.createWritable({ mode: 'exclusive' });
  try {
    const live = await (await handle.getFile()).text();
    let previous = current;
    if (live) previous = validate(live, LAUNCHER_VERSION);
    else if (current) throw failure('互換性情報が変更されています。');
    const next = { ...previous, schema: 1, minLauncherVersion: previous && !older(previous.minLauncherVersion, minimum) ? previous.minLauncherVersion : minimum,
      requiredFeatures: [...new Set([...(previous?.requiredFeatures || []), ...required])] };
    const text = JSON.stringify(next, null, 2) + '\n';
    await writer.write(text); await writer.close();
    if (await read(root) !== text) throw failure('互換性情報の保存結果を確認できません。再接続して確認してください。');
    return next;
  } catch (error) { await writer.abort().catch(() => {}); throw error; }
}
