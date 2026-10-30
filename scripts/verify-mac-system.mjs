import{readFile}from'node:fs/promises';
import{MAC_MINIMUM,verifyMacMinimum}from'./mac-system.mjs';
verifyMacMinimum(await readFile('GAME-PORTAL-MAC'));
for(const name of ['GAME-PORTAL-MAC','GAME-PORTAL-PLAY-MAC']){
 const base=name+'.app/Contents/',info=await readFile(base+'Info.plist','utf8');
 if(!info.includes('<key>LSMinimumSystemVersion</key><string>'+MAC_MINIMUM+'</string>'))throw Error('Mac app must allow macOS '+MAC_MINIMUM+': '+name);
 verifyMacMinimum(await readFile(base+'MacOS/GAME-PORTAL-MAC'));
}
console.log('Mac minimum OS verified: both apps Intel 10.14 / Apple silicon 11; actual Mach-O and Finder metadata.');
