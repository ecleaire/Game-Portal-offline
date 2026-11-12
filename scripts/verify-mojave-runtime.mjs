import assert from 'node:assert/strict';
import { verifyMacImageMinimum } from './mac-system.mjs';
import { verifySwiftRuntimeFiles } from './macos/swift-runtime.mjs';

const intel = 0x01000007;
const requiredLoad = new Set([0xc, 0x8000001f, 0x80000023]); // Load, re-export, upward.
const swiftName = /^libswift[A-Za-z0-9_]+\.dylib$/;

function inspectIntelLinks(bytes, name, intelOnly = false) {
  const images = verifyMacImageMinimum(bytes);
  assert(images.has(intel) && (!intelOnly || images.size === 1), 'Incorrect Mojave architecture: ' + name);
  let offset = 0;
  if (bytes.readUInt32BE(0) === 0xcafebabe) {
    for (let i = 0; i < bytes.readUInt32BE(4); i++) {
      const record = 8 + i * 20;
      if (bytes.readUInt32BE(record) === intel) offset = bytes.readUInt32BE(record + 8);
    }
  }
  const required = new Set(), paths = new Set();
  const end = offset + 32 + bytes.readUInt32LE(offset + 20);
  for (let at = offset + 32; at < end;) {
    const type = bytes.readUInt32LE(at), size = bytes.readUInt32LE(at + 4);
    if (requiredLoad.has(type) || type === 0x8000001c) {
      const headerSize = type === 0x8000001c ? 12 : 24;
      assert(size > headerSize, 'Truncated Mojave link command: ' + name);
      const start = bytes.readUInt32LE(at + 8);
      assert(start >= headerSize && start < size, 'Invalid Mojave link path: ' + name);
      const nul = bytes.indexOf(0, at + start);
      assert(nul > at + start && nul < at + size, 'Invalid Mojave link path: ' + name);
      const link = bytes.toString('utf8', at + start, nul);
      if (type === 0x8000001c) paths.add(link);
      else if (swiftName.test(link.split('/').at(-1))) {
        assert(link.startsWith('@rpath/') && swiftName.test(link.slice(7)), 'Swift dependency cannot use the bundled runtime: ' + link);
        required.add(link.slice(7));
      }
    }
    at += size;
  }
  return { required, paths };
}

export async function verifyMojaveRuntime(read, { executable, libraries, metadata = libraries, runtimePath }) {
  const launcher = inspectIntelLinks(await read(executable, 32 * 1024 * 1024), executable, true);
  assert(launcher.required.has('libswiftCore.dylib'), 'Mojave executable is missing its Swift link: ' + executable);
  assert(launcher.paths.has(runtimePath), 'Mojave executable cannot find its bundled Swift runtime: ' + executable);
  const links = new Map();
  await verifySwiftRuntimeFiles(async (name, max) => {
    const bytes = await read(name, max);
    if (name.endsWith('.dylib')) links.set(name.split('/').at(-1), inspectIntelLinks(bytes, name));
    return bytes;
  }, libraries, metadata);
  for (const [name, image] of [[executable, launcher], ...links]) {
    for (const dependency of image.required) assert(links.has(dependency), 'Missing Mojave Swift dependency: ' + dependency + ' (needed by ' + name + ')');
  }
}

export async function verifyMojaveDistributions(read) {
  for (const [role, name] of [['プレイ用', 'GAME-PORTAL-PLAY'], ['クリエイター用', 'GAME-PORTAL']]) {
    const app = 'Mac/' + role + '/' + name + '-MOJAVE.app/Contents';
    const runtime = 'HTML/' + role + '/起動補助/_runtime';
    const plist = (await read(app + '/Info.plist', 16384)).toString('utf8');
    assert(/<key>LSMinimumSystemVersion<\/key>\s*<string>10\.14<\/string>/.test(plist), 'Mojave app metadata must allow macOS 10.14: ' + app);
    await verifyMojaveRuntime(read, {
      executable: app + '/MacOS/GAME-PORTAL-MOJAVE', libraries: app + '/Frameworks',
      metadata: app + '/Resources/SwiftRuntime', runtimePath: '@executable_path/../Frameworks',
    });
    await verifyMojaveRuntime(read, {
      executable: runtime + '/GAME-PORTAL-MOJAVE', libraries: runtime + '/Swift-MOJAVE',
      runtimePath: '@executable_path/Swift-MOJAVE',
    });
  }
  console.log('Mojave Swift startup checked: Intel 10.14, runtime lookup and required libraries in both apps and HTML helpers.');
}
