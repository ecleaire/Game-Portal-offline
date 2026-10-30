// Keep compiler targets, Finder metadata and every shipped native image aligned.
export const MAC_MINIMUM='10.14';
export const MAC_TARGETS=Object.freeze({x86_64:MAC_MINIMUM,arm64:'11.0'});
const limits=new Map([[0x01000007,0x000a0e00],[0x0100000c,0x000b0000]]);
export function verifyMacImageMinimum(bytes){
 const result=new Map(),ranges=[];
 function image(offset,size,cpu){
  if(offset<0||size<32||offset+size>bytes.length||ranges.some(([start,end])=>offset<end&&offset+size>start)||bytes.readUInt32LE(offset)!==0xfeedfacf)throw Error('Mac architecture is corrupt.');
  cpu??=bytes.readUInt32LE(offset+4);
  if(!limits.has(cpu)||result.has(cpu)||bytes.readUInt32LE(offset+4)!==cpu)throw Error('Mac architecture is corrupt.');
  ranges.push([offset,offset+size]);let command=offset+32,minimum=null;const end=command+bytes.readUInt32LE(offset+20),count=bytes.readUInt32LE(offset+16);
  if(end>offset+size||count>(end-command)/8)throw Error('Mac load commands are corrupt.');
  for(let n=0;n<count;n++){
   if(command+8>end)throw Error('Mac load command is corrupt.');
   const type=bytes.readUInt32LE(command),length=bytes.readUInt32LE(command+4);if(length<8||command+length>end)throw Error('Mac load command is corrupt.');
   if(type===0x32){if(length<24||bytes.readUInt32LE(command+8)!==1||minimum!==null)throw Error('Mac build version is corrupt.');minimum=bytes.readUInt32LE(command+12);}
   if(type===0x24){if(length<16||minimum!==null)throw Error('Mac minimum version is corrupt.');minimum=bytes.readUInt32LE(command+8);}
   command+=length;
  }
  if(command!==end||minimum===null||minimum>limits.get(cpu))throw Error(cpu===0x01000007?'Intel Mac image must support macOS '+MAC_MINIMUM+'.':'Apple silicon image must support macOS 11.');
  result.set(cpu,minimum);
 }
 if(bytes.length<32)throw Error('Mac image is truncated.');
 if(bytes.readUInt32LE(0)===0xfeedfacf)image(0,bytes.length);
 else{
  if(bytes.readUInt32BE(0)!==0xcafebabe||![1,2].includes(bytes.readUInt32BE(4))||bytes.length<8+20*bytes.readUInt32BE(4))throw Error('Mac image must contain valid Intel/Apple silicon architectures.');
  for(let i=0;i<bytes.readUInt32BE(4);i++){const record=8+i*20,offset=bytes.readUInt32BE(record+8);if(offset<8+20*bytes.readUInt32BE(4))throw Error('Mac architecture is corrupt.');image(offset,bytes.readUInt32BE(record+12),bytes.readUInt32BE(record));}
 }
 return result;
}
export function verifyMacMinimum(bytes){
 const result=verifyMacImageMinimum(bytes);
 if(result.size!==2||!result.has(0x01000007)||!result.has(0x0100000c))throw Error('Mac helper must contain Intel and Apple silicon.');
 return result;
}
