import{test}from'node:test';import assert from'node:assert/strict';import{verifyMacMinimum,verifyMacImageMinimum,MAC_MINIMUM,MAC_TARGETS}from'../scripts/mac-system.mjs';
function fixture(intel=0x000a0e00,arm=0x000b0000){const bytes=Buffer.alloc(176);bytes.writeUInt32BE(0xcafebabe,0);bytes.writeUInt32BE(2,4);for(const [i,cpu,minimum,type,length]of[[0,0x01000007,intel,0x24,16],[1,0x0100000c,arm,0x32,24]]){const at=64+i*56,record=8+i*20;bytes.writeUInt32BE(cpu,record);bytes.writeUInt32BE(at,record+8);bytes.writeUInt32BE(56,record+12);bytes.writeUInt32LE(0xfeedfacf,at);bytes.writeUInt32LE(cpu,at+4);bytes.writeUInt32LE(1,at+16);bytes.writeUInt32LE(length,at+20);bytes.writeUInt32LE(type,at+32);bytes.writeUInt32LE(length,at+36);if(type===0x32)bytes.writeUInt32LE(1,at+40);bytes.writeUInt32LE(minimum,at+(type===0x32?44:40));}return bytes;}
test('Mac release targets accept Mojave Intel and Big Sur ARM load commands',()=>{assert.equal(MAC_MINIMUM,'10.14');assert.deepEqual(MAC_TARGETS,{x86_64:'10.14',arm64:'11.0'});assert.equal(verifyMacMinimum(fixture()).get(0x01000007),0x000a0e00);});
test('Mac release rejects the previous macOS 12 requirement per architecture',()=>{assert.throws(()=>verifyMacMinimum(fixture(0x000c0000)),/10.14/);assert.throws(()=>verifyMacMinimum(fixture(0x000a0e00,0x000c0000)),/macOS 11/);});
test('Mac release refuses truncated, missing, duplicate or overlapping architectures',()=>{for(const change of [b=>b.subarray(0,170),b=>{b.writeUInt32BE(1,4);return b;},b=>{b.writeUInt32BE(0x01000007,28);return b;},b=>{b.writeUInt32BE(64,36);return b;},b=>{b.writeUInt32LE(100,64+36);return b;},b=>{b.writeUInt32LE(0,64+32);return b;}])assert.throws(()=>verifyMacMinimum(change(fixture())));});


test('release rejects patch-specific Mojave requirements including 10.14.4 and 10.14.6',()=>{
 for(const minimum of [0x000a0e01,0x000a0e04,0x000a0e06])assert.throws(()=>verifyMacMinimum(fixture(minimum)),/10.14/);
});
test('thin helpers and bundled framework images obey the same OS floor',()=>{
 const bytes=fixture(),intel=bytes.subarray(64,120),arm=bytes.subarray(120,176);
 assert.equal(verifyMacImageMinimum(intel).get(0x01000007),0x000a0e00);assert.equal(verifyMacImageMinimum(arm).get(0x0100000c),0x000b0000);
 const newer=Buffer.from(intel);newer.writeUInt32LE(0x000a0e04,40);assert.throws(()=>verifyMacImageMinimum(newer),/10.14/);assert.throws(()=>verifyMacMinimum(intel),/Intel and Apple/);
});
