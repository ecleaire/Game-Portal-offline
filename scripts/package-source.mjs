import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { packageWebFiles } from '../assets/zip-upload.js';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'source-release');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Only project-owned source directories and explicit root files. Never traverse
// caches, credentials, git history, local validation data or uploaded games.
const paths = ['README.md', 'CHANGELOG.md', '.gitignore', '.gitattributes', 'package.json', 'package-lock.json', 'GAME-PORTAL-MAC.command', 'GAME-PORTAL-MOJAVE.command', 'GAME-PORTAL-FOLDER.example.txt'];
async function collect(path) {
  for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a,b)=>a.name.localeCompare(b.name, 'en'))) {
    const next = path + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error('Source package cannot contain symlinks: ' + next);
    if (entry.isDirectory()) await collect(next);
    else if (entry.isFile()) {
      if (/^\.env(?:\.|$)/i.test(entry.name) || /\.(zip|pyxapp|exe)$/i.test(entry.name)) throw new Error('Unexpected source package file: ' + next);
      paths.push(next);
    }
  }
}
for (const path of ['offline-html', 'assets', 'scripts', 'tests', '.github', 'desktop']) await collect(path);
for(const name of ['README.md','DEVELOPMENT.md','OFFLINE_HTML.md','TRANSFER_GUIDE.md','NAS_VALIDATION.md','WINDOWS_EXE.md','AUTO_CONNECT.md','DESKTOP.md','MOJAVE.md'])paths.push('docs/'+name);
const files = [], entries = [];
for (const path of paths.sort()) {
  const bytes = await readFile(join(root, path));
  files.push(new File([bytes], path));
  entries.push({ path, bytes: bytes.length, sha256: hash(bytes) });
}
const manifest = JSON.stringify({ schema: 1, project: pkg.name, version: pkg.version, sourceHash: hash(JSON.stringify(entries)), files: entries }, null, 2) + '\n';
files.push(new File([manifest], 'source-manifest.json'));
const zip = Buffer.from(await (await packageWebFiles(files)).arrayBuffer());
await mkdir(output, { recursive: true });
await writeFile(join(output, 'GAME-PORTAL-SOURCE.zip'), zip);
await writeFile(join(output, 'source-manifest.json'), manifest);
await writeFile(join(output, 'SHA256SUMS.txt'), hash(zip) + '  GAME-PORTAL-SOURCE.zip\n');
console.log(`Source package v${pkg.version}: ${entries.length} source files, ${zip.length} bytes. No games, caches or credentials included.`);
