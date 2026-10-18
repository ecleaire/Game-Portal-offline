import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {verifyEngineTarget} from '../scripts/verify-mac-engines.mjs';
const lock=JSON.parse(await readFile(new URL('../scripts/macos/cef-lock.json',import.meta.url)));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
test('Mac distribution rejects missing, truncated and corrupt engine parts',async()=>{
 const bytes=Buffer.from('offline-engine'),target={sdkSHA256:lock.targets.x86_64.sha256,size:bytes.length,sha256:digest(bytes),parts:[{name:'engine.part00',size:bytes.length,sha256:digest(bytes)}]};
 await verifyEngineTarget(target,'x86_64',async()=>bytes);
 await assert.rejects(verifyEngineTarget(target,'x86_64',async()=>{throw Error('missing');}),/missing/);
 await assert.rejects(verifyEngineTarget(target,'x86_64',async()=>bytes.subarray(1)),/Truncated/);
 await assert.rejects(verifyEngineTarget(target,'x86_64',async()=>Buffer.alloc(bytes.length)),/checksum/);
 await assert.rejects(verifyEngineTarget({...target,sha256:'0'.repeat(64)},'x86_64',async()=>bytes),/checksum/);
});
test('Mac engine distribution rejects unsafe names, unpinned SDKs and oversize parts before reading',async()=>{
 const target={sdkSHA256:lock.targets.arm64.sha256,size:1,sha256:'a'.repeat(64),parts:[{name:'../engine.part00',size:1,sha256:'a'.repeat(64)}]},load=async()=>assert.fail('Unsafe target must not be read');
 await assert.rejects(verifyEngineTarget(target,'arm64',load),/path/);
 await assert.rejects(verifyEngineTarget({...target,sdkSHA256:'0'.repeat(64)},'arm64',load),/Unpinned/);
 await assert.rejects(verifyEngineTarget({...target,parts:[{name:'engine.part00',size:41*1024*1024}]},'arm64',load),/bounds/);
});
