import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyMojaveRuntime } from '../scripts/verify-mojave-runtime.mjs';

const core = 'libswiftCore.dylib', dependency = 'libswiftFoundation.dylib';
const runtimePath = '@executable_path/../Frameworks';
function image({ cpu = 0x01000007, min = 0x000a0e00, rpath, links = [] } = {}) {
  const minimum = Buffer.alloc(24);
  minimum.writeUInt32LE(0x32); minimum.writeUInt32LE(24, 4);
  minimum.writeUInt32LE(1, 8); minimum.writeUInt32LE(min, 12);
  const commands = [minimum];
  for (const [type, header, value] of [
    ...(rpath ? [[0x8000001c, 12, rpath]] : []),
    ...links.map(name => [0xc, 24, '@rpath/' + name]),
  ]) {
    const command = Buffer.alloc(Math.ceil((header + Buffer.byteLength(value) + 1) / 8) * 8);
    command.writeUInt32LE(type); command.writeUInt32LE(command.length, 4);
    command.writeUInt32LE(header, 8); command.write(value, header);
    commands.push(command);
  }
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf); header.writeUInt32LE(cpu, 4);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(commands.reduce((sum, command) => sum + command.length, 0), 20);
  return Buffer.concat([header, ...commands]);
}

function check({ library = image(), path = runtimePath, omit = false } = {}) {
  const libs = new Map([
    [core, image({ links: [dependency] })],
    [dependency, library],
    ['SWIFT-RUNTIME-LICENSE.txt', Buffer.from('test license')],
  ]);
  if (omit) libs.delete(dependency);
  const files = [...libs].map(([name, bytes]) => ({
    name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }));
  const entries = new Map([
    ['launcher', image({ rpath: path, links: [core] })],
    ['meta/runtime.json', Buffer.from(JSON.stringify({ schema: 1, kind: 'swift-mojave-v1', files }))],
    ...[...libs].map(([name, bytes]) => [(name.endsWith('.dylib') ? 'lib/' : 'meta/') + name, bytes]),
  ]);
  return verifyMojaveRuntime(async name => {
    assert(entries.has(name), name);
    return entries.get(name);
  }, { executable: 'launcher', libraries: 'lib', metadata: 'meta', runtimePath });
}

test('Mojave checks follow required Swift dependencies beyond the launcher', async () => {
  await check();
  await assert.rejects(check({ omit: true }), /Missing Mojave Swift dependency: libswiftFoundation/);
});

test('Mojave distribution rejects an unreachable, ARM-only, or newer Swift runtime', async () => {
  await assert.rejects(check({ path: '/usr/lib/swift' }), /cannot find its bundled Swift runtime/);
  await assert.rejects(check({ library: image({ cpu: 0x0100000c, min: 0x000b0000 }) }), /Incorrect Mojave architecture/);
  await assert.rejects(check({ library: image({ min: 0x000a0e04 }) }), /10.14/);
});
