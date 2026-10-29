// Exercise the actual Mac listener independently of CEF or an Internet service.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')throw Error('Mac loopback checks require macOS.');
const temp=await mkdtemp(join(tmpdir(),'portal-mac-loopback-')),children=new Set();
try{
 const entry=join(temp,'Entry.swift'),binary=join(temp,'listener');
 await writeFile(entry,`import Foundation
import Darwin
@main struct ListenerTest {
 static var lease: DesktopInstanceLease?
 static func main() {
  do {
   if CommandLine.arguments.count > 2 { lease = try DesktopInstanceLease(URL(fileURLWithPath: CommandLine.arguments[2])) }
   let listener = DesktopHTTPServer(page: Data(String(repeating: "local-page-", count: 300000).utf8))
   let port = try listener.start(port: UInt16(CommandLine.arguments[1]))
   fputs("READY \\(port)\\n", stdout); fflush(stdout)
   DispatchQueue.global().async {
    if readLine() == "cancel" { listener.cancel(); fputs("CANCELLED\\n", stdout); fflush(stdout) }
   }
   dispatchMain()
  } catch { fputs(error.localizedDescription + "\\n", stderr); exit(2) }
 }
}
`);
 execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O','-target',process.arch==='arm64'?'arm64-apple-macosx11.0':'x86_64-apple-macosx10.14.6',resolve('scripts/macos/desktop-network.swift'),resolve('scripts/macos/desktop-instance.swift'),entry,'-o',binary],{timeout:120000,stdio:'pipe'});
 function launch(port,lease){
  const child=spawn(binary,[String(port),...(lease?[lease]:[])],{stdio:['pipe','pipe','pipe']});children.add(child);
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  return {child,output:()=>output,errors:()=>errors};
 }
 async function ready(run){
  for(let attempt=0;attempt<100;attempt++){
   const match=/READY (\d+)/.exec(run.output());if(match)return Number(match[1]);
   assert.equal(run.child.exitCode,null,'Listener failed: '+run.errors());await delay(50);
  }
  throw Error('Local listener did not become ready: '+run.errors());
 }
 async function stop(run){
  run.child.kill('SIGKILL');if(run.child.exitCode===null&&run.child.signalCode===null)await new Promise(resolve=>run.child.once('exit',resolve));children.delete(run.child);
 }
 async function request(port,request){
  return new Promise((resolve,reject)=>{
   const client=createConnection({host:'127.0.0.1',port});const chunks=[];
   client.setTimeout(5000,()=>client.destroy(Error('Loopback response timed out')));
   client.on('connect',()=>client.write(request));client.on('data',bytes=>chunks.push(bytes));client.on('error',error=>{if(error.code==='ECONNRESET')return;reject(error);});
   client.on('close',()=>resolve(Buffer.concat(chunks)));
  });
 }
 async function exchange(port){
  const response=await request(port,`GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  const split=response.indexOf('\r\n\r\n');assert(split>0);
  const head=response.subarray(0,split).toString();
  assert.match(head,/^HTTP\/1.1 200 OK/);assert.match(head,/X-Frame-Options: DENY/);assert.match(head,/Content-Length: 3300000/);
  assert.equal(response.subarray(split+4).toString(),'local-page-'.repeat(300000),'Full static page survives partial socket writes');
 }
 let port=0;
 for(let cycle=0;cycle<4;cycle++){
  const run=launch(port),bound=await ready(run);if(port)assert.equal(bound,port,'Saved origin must remain stable');port=bound;
  await exchange(port);
  if(cycle===0){
   const conflict=launch(port);
   for(let attempt=0;attempt<100&&conflict.child.exitCode===null;attempt++)await delay(50);
   assert.equal(conflict.child.exitCode,2,'An occupied origin must fail instead of sharing/changing ports');
   assert.match(conflict.errors(),/POSIX 48/);assert.match(conflict.errors(),/別のGAME PORTAL/);assert.equal(conflict.output(),'');children.delete(conflict.child);
  }
  await stop(run);
 }
 // Only the exact trusted page and local Host may return any bytes.
 const run=launch(port);await ready(run);
 for(const invalid of [
  `GET /secret HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
  `GET /index.html HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`,
  `GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nHost: evil\r\n\r\n`,
  `POST /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
  `GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nTransfer-Encoding: chunked\r\n\r\n`,
  `GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 1\r\n\r\nx`,
  'x'.repeat(17000),
 ])assert.equal((await request(port,invalid)).length,0,'Invalid HTTP must not reveal the launcher');
 // Idle clients expire against a total deadline and cannot consume all slots
 // forever; cancellation also wakes blocked reads instead of leaving workers.
 const idle=()=>new Promise((resolve,reject)=>{const client=createConnection({host:'127.0.0.1',port});client.on('connect',()=>{client.resume();client.write('G');resolve(client);});client.on('error',error=>{if(error.code!=='ECONNRESET')reject(error);});});
 const held=await Promise.all(Array.from({length:8},()=>idle()));
 const trickle=setInterval(()=>{if(!held[0].destroyed)held[0].write('x');},2000);trickle.unref();await delay(150);
 assert.equal((await request(port,`GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`)).length,0,'Connection limit must reject excess clients');
 await delay(16000);clearInterval(trickle);assert(held.every(client=>client.destroyed),'Idle and trickling clients must expire against the total deadline');await exchange(port);
 const pending=await idle();run.child.stdin.write('cancel\n');
 for(let attempt=0;attempt<100&&!pending.destroyed;attempt++)await delay(50);
 assert(pending.destroyed,'Shutdown must release blocked clients');
 await assert.rejects(()=>request(port,`GET /index.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`),/ECONNREFUSED/);
 await stop(run);
 const creatorLock=join(temp,'creator.lock'),playerLock=join(temp,'player.lock');
 const creator=launch(0,creatorLock),player=launch(0,playerLock);await ready(creator);await ready(player);
 const duplicate=launch(0,creatorLock);
 for(let attempt=0;attempt<100&&duplicate.child.exitCode===null;attempt++)await delay(50);
 assert.equal(duplicate.child.exitCode,2);assert.match(duplicate.errors(),/すでに開いています/);assert.equal(duplicate.output(),'');children.delete(duplicate.child);
 await exchange(Number(/READY (\d+)/.exec(creator.output())[1]));await exchange(Number(/READY (\d+)/.exec(player.output())[1]));
 await stop(creator);const recovered=launch(0,creatorLock);await ready(recovered);await stop(recovered);await stop(player);
 console.log('Mac loopback: fixed origin, large HTTP replies, conflict, malformed requests, bounded clients, timeouts and shutdown PASS.');
}finally{
 for(const child of children)child.kill('SIGKILL');
 await rm(temp,{recursive:true,force:true});
}
