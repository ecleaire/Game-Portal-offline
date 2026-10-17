import {readFile} from 'node:fs/promises';
const bytes=await readFile('GAME-PORTAL-MOJAVE'),{version}=JSON.parse(await readFile('package.json','utf8'));
if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x01000007||!bytes.includes(Buffer.from(version)))throw Error('Mojave helper must be a matching Intel x86_64 Mach-O binary.');
let at=32,minimum=null;
for(let n=0;n<bytes.readUInt32LE(16);n++){const command=bytes.readUInt32LE(at),size=bytes.readUInt32LE(at+4);if(size<8||at+size>bytes.length)throw Error('Invalid Mojave load command');if(command===0x32)minimum=bytes.readUInt32LE(at+12);if(command===0x24)minimum=bytes.readUInt32LE(at+8);at+=size;}
if(minimum===null||minimum>0x000a0e00)throw Error('Mojave helper requires an OS newer than macOS 10.14.');
const command=await readFile('GAME-PORTAL-MOJAVE.command','utf8');if(!command.startsWith('#!/bin/bash\n')||command.includes('\r'))throw Error('Mojave entry point must use bash and Unix newlines.');
console.log('Mojave distribution verified: Intel x86_64, macOS 10.14 minimum, helper '+version+'. Actual Mojave hardware remains unverified.');
