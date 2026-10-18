import {helperEntrypoints} from '../scripts/distribution.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
if(!['win32','darwin'].includes(process.platform))process.exit(0);
const root=await mkdtemp(join(tmpdir(),'portal helper # + & '));
try{
 for(const role of ['プレイ用','クリエイター用']){
  const folder=join(root,'HTML',role,'起動補助'),runtime=join(folder,'_runtime'),html=role==='プレイ用'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html';await mkdir(runtime,{recursive:true});await writeFile(join(folder,'..',html),'fixture');
  for(const [name,text]of helperEntrypoints(role)){
   const launcher=join(folder,name);await writeFile(launcher,text);if(process.platform==='win32'&&!name.endsWith('.cmd')||process.platform==='darwin'&&!name.endsWith('.command'))continue;
   const executable=join(runtime,process.platform==='win32'?'GAME-PORTAL-WINDOWS.exe':name.startsWith('古い')?'GAME-PORTAL-MOJAVE':'GAME-PORTAL-MAC'),result=executable+'.args';
   if(process.platform==='win32'){
    const source=join(root,'capture.cs');await writeFile(source,'using System;using System.IO;using System.Text;class Capture{static void Main(string[] args){File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"GAME-PORTAL-WINDOWS.exe.args"),args,new UTF8Encoding(false));}}');
    execFileSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/out:'+executable,source],{stdio:'pipe',windowsHide:true});
    execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','""'+launcher+'""'],{windowsHide:true,windowsVerbatimArguments:true,stdio:'pipe'});
   }else{
    await writeFile(executable,'#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\n');await chmod(executable,0o755);await chmod(launcher,0o755);execFileSync(name.startsWith('古い')?'/bin/bash':'/bin/zsh',[launcher],{stdio:'pipe'});
   }
   let args;for(let count=0;count<100;count++){try{args=(await readFile(result,'utf8')).trim().split(/\r?\n/);break;}catch{await delay(50);}}assert(args,'Helper was launched');assert.equal(args[0],'--html');assert.equal(resolve(process.platform==='win32'?args[1]:join(dirname(launcher),args[1])),resolve(folder,'..',html));
  }
 }
 console.log('Helper entrypoints passed: actual shell launch, both roles, Unicode/space/#/+/& paths and correct HTML argument.');
}finally{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
