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
    let marker = CommandLine.arguments[2]
    let ready = { try Data("ready".utf8).write(to: directory.appendingPathComponent(marker)) }
    if marker == "edit-held" {
     let lock = try DesktopFiles.WriteLock(directory.appendingPathComponent("edit.lock").path, posixError: files.posixError)
     withExtendedLifetime(lock) {
      do { try ready() } catch { exit(2) }
      while true { sleep(1) }
     }
    } else if marker.hasPrefix("edit-") {
     let fd = Darwin.open(directory.appendingPathComponent("edit.lock").path, O_RDWR)
     guard fd >= 0 else { exit(2) }
     defer { Darwin.close(fd) }
     var range = flock()
     range.l_type = Int16(F_WRLCK); range.l_whence = Int16(SEEK_SET); range.l_start = 0; range.l_len = 1
     if fcntl(fd, F_SETLK, &range) != 0 { exit(errno == EACCES || errno == EAGAIN ? 3 : 2) }
     try ready()
    } else {
     try files.withSharedLock {
      try ready()
      if marker == "held" { while true { sleep(1) } }
     }
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
 for(const [marker,contender,after] of [['held','contender','after-crash'],['edit-held','edit-contender','edit-after-crash']]){
 const holder=spawn(binary,[disk,marker],{stdio:'pipe'});
 try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   ready=await readFile(join(disk,marker),'utf8').then(()=>true,()=>false);
   if(ready||holder.exitCode!==null)break;
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert(ready,'independent lock holder started');
  assert.throws(()=>execFileSync(binary,[disk,contender],{timeout:5000,stdio:'pipe'}),error=>error.status===(marker==='edit-held'?3:1));
  const exited=new Promise(resolve=>holder.once('exit',resolve));holder.kill('SIGKILL');await exited;
  execFileSync(binary,[disk,after],{timeout:5000,stdio:'pipe'});
  assert.equal(await readFile(join(disk,after),'utf8'),'ready');
 }finally{if(holder.exitCode===null&&holder.signalCode===null)holder.kill('SIGKILL');}
 }
 assert.equal(JSON.parse(await readFile(join(disk,'result.json'),'utf8')).ok,true);
 console.log('Mac filesystem checks passed: shared defaults, fresh profiles, personal overrides, stale/concurrent writer rejection, Player denial and existing data protection.');
}finally{await rm(temp,{recursive:true,force:true});}
