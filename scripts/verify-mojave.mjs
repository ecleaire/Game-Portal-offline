import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bytes=await readFile('GAME-PORTAL-MOJAVE'),{version}=JSON.parse(await readFile('package.json','utf8'));
if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==0x01000007||!bytes.includes(Buffer.from(version)))throw Error('Mojave helper must be a matching Intel x86_64 Mach-O binary.');
let at=32,minimum=null;
for(let n=0;n<bytes.readUInt32LE(16);n++){const command=bytes.readUInt32LE(at),size=bytes.readUInt32LE(at+4);if(size<8||at+size>bytes.length)throw Error('Invalid Mojave load command');if(command===0x32)minimum=bytes.readUInt32LE(at+12);if(command===0x24)minimum=bytes.readUInt32LE(at+8);at+=size;}
if(minimum===null||minimum>0x000a0e00)throw Error('Mojave helper requires an OS newer than macOS 10.14.');
const command=await readFile('GAME-PORTAL-MOJAVE.command','utf8');if(!command.startsWith('#!/bin/bash\n')||command.includes('\r'))throw Error('Mojave entry point must use bash and Unix newlines.');
console.log('Mojave distribution verified: Intel x86_64, macOS 10.14 minimum, helper '+version+'. Actual Mojave hardware remains unverified.');
const base='GAME-PORTAL-MOJAVE.app/Contents/',info=await readFile(base+'Info.plist','utf8');if(!info.includes('<string>10.14</string>')||!info.includes('<string>APPL</string>')||!info.includes('<key>LSUIElement</key>'))throw Error('Mojave app metadata is invalid');
const appExecutable=await readFile(base+'MacOS/GAME-PORTAL-MOJAVE');if(appExecutable.readUInt32LE(0)!==0xfeedfacf||appExecutable.readUInt32LE(4)!==0x01000007)throw Error('App executable is not an Intel Mach-O');
for(const name of ['GAME-PORTAL.html','THIRD-PARTY-LICENSES.txt'])if(!(await readFile(base+'Resources/'+name)).equals(await readFile(name)))throw Error('Mojave app resource differs: '+name);
const manifest=JSON.parse(await readFile(base+'Resources/build.json','utf8'));if(manifest.version!==version)throw Error('App version differs');for(const [file,expected] of Object.entries(manifest.files))if(createHash('sha256').update((await readFile(file,'utf8')).replaceAll('\r\n','\n')).digest('hex')!==expected)throw Error('Mojave app source changed; rebuild: '+file);
console.log('Mojave .app verified: embedded HTML/licenses, native menu helper and matching build sources.');
