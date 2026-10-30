import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifySwiftRuntimeFiles} from '../scripts/macos/swift-runtime.mjs';
function fixture(minimum=0x000a0e00){
 const image=Buffer.alloc(48);image.writeUInt32LE(0xfeedfacf);image.writeUInt32LE(0x01000007,4);image.writeUInt32LE(1,16);image.writeUInt32LE(16,20);image.writeUInt32LE(0x24,32);image.writeUInt32LE(16,36);image.writeUInt32LE(minimum,40);
 const files=new Map([['base/libswiftCore.dylib',image],['base/SWIFT-RUNTIME-LICENSE.txt',Buffer.from('runtime license')]]);
 const entries=[...files].map(([path,bytes])=>({name:path.slice(5),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
 const manifest={schema:1,kind:'swift-mojave-v1',files:entries};
 files.set('base/runtime.json',Buffer.from(JSON.stringify(manifest)));
 return {files,manifest,read:async(path,max)=>{const bytes=files.get(path);assert(bytes,'Missing '+path);assert(bytes.length<=max);return bytes;}};
}
test('bundled Swift verification requires complete matching runtime and supports initial Mojave',async()=>{
 const good=fixture();await verifySwiftRuntimeFiles(good.read,'base');
 const corrupt=fixture();corrupt.files.set('base/libswiftCore.dylib',Buffer.from('corrupt'));await assert.rejects(verifySwiftRuntimeFiles(corrupt.read,'base'),/incomplete/);
 const missing=fixture();missing.files.delete('base/libswiftCore.dylib');await assert.rejects(verifySwiftRuntimeFiles(missing.read,'base'),/Missing/);
 const newer=fixture(0x000a0e04);await assert.rejects(verifySwiftRuntimeFiles(newer.read,'base'),/10.14/);
 for(const change of [m=>m.files.splice(0,1),m=>m.files.push(m.files[0]),m=>m.files[0].name='../libswiftCore.dylib']){const f=fixture();change(f.manifest);f.files.set('base/runtime.json',Buffer.from(JSON.stringify(f.manifest)));await assert.rejects(verifySwiftRuntimeFiles(f.read,'base'));}
});
