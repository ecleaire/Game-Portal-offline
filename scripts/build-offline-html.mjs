import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { packageWebFiles } from '../assets/zip-upload.js';

const root = resolve(import.meta.dirname, '..');
const cache = process.env.OFFLINE_RUNTIME_CACHE || join(root, '.tools/offline-runtime');
const output = join(root, 'offline-release');
const lock = JSON.parse(await readFile(join(root, 'offline-html/runtime-lock.json'), 'utf8'));
const prepare = process.argv.includes('--prepare');
const runtime = {};
for (const file of lock.files) {
  const target = join(cache, file.path); let bytes;
  try { bytes = await readFile(target); }
  catch (e) {
    if (!prepare) throw new Error('Runtime missing. Run npm run offline:prepare with network access first: ' + file.path);
    // Native fetch respects the session proxy with Node >=24 NODE_USE_ENV_PROXY=1.
    const response = await fetch(file.url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('Runtime download failed: ' + file.path + ' ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Runtime checksum mismatch: ' + file.path);
    await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, bytes);
  }
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Runtime checksum mismatch: ' + file.path);
  runtime[file.path] = bytes.toString('base64');
}
const source = async path => (await readFile(join(root, path), 'utf8')).replaceAll('\r\n','\n');
const { version } = JSON.parse(await source('package.json'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid application version in package.json');
const wrap = (name, code, exports) => `const ${name}=(()=>{${code.replace(/^export /gm, '')}\nreturn {${exports}};})();`;
// TurboWarp's compiler needs dynamic JS inside the opaque game sandbox. This
// changes only the standalone bundle, never the public portal's preview policy.
const offlinePreview = (await source('assets/private-preview.js')).replaceAll("script-src 'unsafe-inline' data: blob: 'wasm-unsafe-eval'", "script-src 'unsafe-inline' 'unsafe-eval' data: blob: 'wasm-unsafe-eval'");
const script = [
  'const tagPresets=' + JSON.stringify(JSON.parse(await source('offline-html/tag-presets.json')).tags) + ';',
  "const launcherEdition=document.documentElement.dataset.edition==='player'?'player':'creator';",
  wrap('preview', offlinePreview, 'unpackPrivateZip,webArchiveLayout,privatePreviewDocument'),
  wrap('readTasks', await source('offline-html/read-task.js'), 'readWithSignal'),
  wrap('folderSharing', await source('offline-html/folder-sharing.js'), 'connectionInfo,portableLauncher'),
  wrap('compatibilityTools', await source('offline-html/compatibility.js'), 'LAUNCHER_VERSION,checkCompatibility,ensureCompatibility'),
  wrap('updateTools', await source('offline-html/updates.js'), 'canUpdateGame,resolveGameContent,replaceGameContent,restoreGameContent,verifyContentUpdate,inspectGameContent,describeContentStorage'),
  wrap('nativeTools', await source('offline-html/native-tools.js'), 'nativeLayout,validateExe,nativeConnection,nativePageConnection,launchNative,nativeFolder'),
  wrap('library', (await source('offline-html/library.js')).replace("import {readWithSignal} from './read-task.js';",'const {readWithSignal}=readTasks;').replace("import { checkCompatibility, ensureCompatibility } from './compatibility.js';",'const {checkCompatibility,ensureCompatibility}=compatibilityTools;').replace("import { resolveGameContent } from './updates.js';",'const {resolveGameContent}=updateTools;').replace("import {nativeLayout,validateExe} from './native-tools.js';",'const {nativeLayout,validateExe}=nativeTools;').replace('export {validateExe};',''), 'safePath,uploadPaths,getFile,writeFile,loadLibraryId,ensureLibraryId,loadMetadata,saveMetadata,parseGameSettings,loadGameSettings,saveGameSettings,setSettingsSaveObserver,verifySettingsSave,retrySettingsSave,tagsFrom,gameId,scan,readTree,postGame,validatePyxapp,embeddedPyxel,validateExe'),
  wrap('maintenance', (await source('offline-html/maintenance.js')).replace("import { canUpdateGame,inspectGameContent } from './updates.js';",'const {canUpdateGame,inspectGameContent}=updateTools;'), 'localResources,inspectLibrary,loadSettingsHistory,restoreSettingsHistory'),
  wrap('dependencyTools', await source('offline-html/dependencies.js'), 'analyzeDependencies,inspectUploadDependencies'),
  wrap('improvements', (await source('offline-html/improvements.js')).replace("import { inspectUploadDependencies } from './dependencies.js';",'const {inspectUploadDependencies}=dependencyTools;').replace("import {nativeLayout,validateExe} from './native-tools.js';",'const {nativeLayout,validateExe}=nativeTools;'), 'checkUpload,cropRect'),
  wrap('searchTools', await source('offline-html/search.js'), 'searchGames'),
  wrap('localState', await source('offline-html/local-state.js'), 'cacheHandle,forgetHandle,loadSettingsReceipts,trackSettingsReceipt,loadLocalSave,writeLocalSave,acquirePlaySession,validSave,validSaveBackups,loadSaveBackups,backupLocalSave,restoreLocalSaveBackup,saveDeviceId,loadSaveSync,commitSaveSync'),
  wrap('sharedSaves', (await source('offline-html/shared-saves.js')).replace("import {readWithSignal} from './read-task.js';",'const {readWithSignal}=readTasks;'), 'syncSave,saveText,saveHeads,validSnapshot,validClock'),
  wrap('usageTools', await source('offline-html/usage.js'), 'measureLibraryUsage'),
  wrap('syncTools', await source('offline-html/sync.js'), 'libraryViewKey'),
  wrap('player', await source('offline-html/player.js'), 'startPlayer,decodeBase64,encodeBase64'),
  await source('offline-html/app.js'),
].join('\n').replaceAll('</script', '<\\/script');
const html = (await source('offline-html/index.html')).replace('/*__HELP__*/',await source('offline-html/help.html')).replace('__VERSION__', version).replace('/*__STYLE__*/', await source('offline-html/style.css')).replace('__RUNTIME__', JSON.stringify(runtime)).replace('/*__SCRIPT__*/', script);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'GAME-PORTAL.html'), html);
// Code > Download ZIP must work without a build or an Actions artifact.
await writeFile(join(root, 'GAME-PORTAL.html'), html);
const playerHTML=html.replace('<html lang="ja">','<html lang="ja" data-edition="player">').replace('<title>GAME PORTAL</title>','<title>GAME PORTAL プレイ専用</title>').replace(await source('offline-html/help.html'),await source('offline-html/help-player.html'));
await writeFile(join(root,'GAME-PORTAL-PLAY.html'),playerHTML);
await writeFile(join(output,'GAME-PORTAL-PLAY.html'),playerHTML);
const readme = await source('docs/OFFLINE_HTML.md');
const nasGuide = await source('docs/NAS_VALIDATION.md');
const transferGuide = await source('docs/TRANSFER_GUIDE.md');
const licenses = lock.files.filter(f => f.path.endsWith('/LICENSE')).map(f => f.path + '\n' + Buffer.from(runtime[f.path], 'base64').toString('utf8')).join('\n\n');
await writeFile(join(output, 'THIRD-PARTY-LICENSES.txt'), licenses);
await writeFile(join(root, 'THIRD-PARTY-LICENSES.txt'), licenses);
await writeFile(join(output, 'README.txt'), readme);
await writeFile(join(output, 'NAS-VALIDATION.txt'), nasGuide);
await writeFile(join(output, 'START-HERE.txt'), transferGuide);
const zip = await packageWebFiles([new File([html], 'GAME-PORTAL.html'), new File([playerHTML], 'GAME-PORTAL-PLAY.html'), new File([readme], 'README.txt'), new File([nasGuide], 'NAS-VALIDATION.txt'), new File([licenses], 'THIRD-PARTY-LICENSES.txt'), new File([transferGuide], 'START-HERE.txt')]);
await writeFile(join(output, 'GAME-PORTAL-HTML.zip'), Buffer.from(await zip.arrayBuffer()));
console.log(`Offline launcher built: ${Buffer.byteLength(html)} bytes, ${lock.files.length} verified runtime files. No runtime network required.`);
