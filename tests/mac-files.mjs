// Run the real native filesystem checks before the expensive CEF app build.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')throw Error('Mac native filesystem checks require macOS.');
const temp=await mkdtemp(join(tmpdir(),'portal-mac-files-'));
try{
 const entry=join(temp,'Entry.swift'),binary=join(temp,'files-test'),disk=join(temp,'fixture');
 await writeFile(entry,`import Foundation
import Darwin
@main struct FilesTest {
 static func main() {
  do {
   let directory = URL(fileURLWithPath: CommandLine.arguments[1])
   if CommandLine.arguments.count > 2 {
    let files = try DesktopFiles(profile: directory.appendingPathComponent("profile"), application: directory, player: false)
    try files.withSharedLock {
     try Data("ready".utf8).write(to: directory.appendingPathComponent(CommandLine.arguments[2]))
     if CommandLine.arguments[2] == "held" { while true { sleep(1) } }
    }
   } else { try desktopSelfTest(directory) }
  } catch { fputs(((error as? DesktopError)?.message ?? error.localizedDescription) + "\\n", stderr); exit(1) }
 }
}
`);
 execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O',resolve('scripts/macos/desktop-files.swift'),resolve('scripts/macos/desktop-self-test.swift'),entry,'-framework','Security','-o',binary],{timeout:120000,stdio:'pipe'});
 execFileSync(binary,[disk],{timeout:30000,stdio:'pipe'});
 // Exercise an actual independent OS process, including SIGKILL. Record
 // locks must reject the live writer and recover without deleting the file.
 const holder=spawn(binary,[disk,'held'],{stdio:'pipe'});
 try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   ready=await readFile(join(disk,'held'),'utf8').then(()=>true,()=>false);
   if(ready||holder.exitCode!==null)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert(ready,'independent lock holder started');
  assert.throws(()=>execFileSync(binary,[disk,'contender'],{timeout:5000,stdio:'pipe'}));
  const exited=new Promise(resolve=>holder.once('exit',resolve));holder.kill('SIGKILL');await exited;
  execFileSync(binary,[disk,'after-crash'],{timeout:5000,stdio:'pipe'});
  assert.equal(await readFile(join(disk,'after-crash'),'utf8'),'ready');
 }finally{if(holder.exitCode===null&&holder.signalCode===null)holder.kill('SIGKILL');}
 assert.equal(JSON.parse(await readFile(join(disk,'result.json'),'utf8')).ok,true);
 console.log('Mac filesystem checks passed: shared defaults, fresh profiles, personal overrides, stale/concurrent writer rejection, Player denial and existing data protection.');
}finally{await rm(temp,{recursive:true,force:true});}
