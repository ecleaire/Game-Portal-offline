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
import Network
import Darwin
@main struct ListenerTest {
 static func main() throws {
  let parameters = desktopLoopbackParameters(port: UInt16(CommandLine.arguments[1]))
  guard parameters.requiredInterfaceType == .loopback else { exit(3) }
  let listener = try NWListener(using: parameters)
  let queue = DispatchQueue(label: "loopback-test")
  listener.stateUpdateHandler = { state in
   switch state {
   case .ready: fputs("READY \\(listener.port!.rawValue)\\n", stdout); fflush(stdout)
   case .waiting(let error), .failed(let error): fputs(desktopListenerMessage(error) + "\\n", stderr); exit(2)
   default: break
   }
  }
  listener.newConnectionHandler = { connection in
   connection.start(queue: queue)
   connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { bytes, _, _, _ in
    guard bytes == Data("ping".utf8) else { connection.cancel(); return }
    connection.send(content: Data("pong".utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in })
   }
  }
  listener.start(queue: queue)
  dispatchMain()
 }
}
`);
 execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O',resolve('scripts/macos/desktop-network.swift'),entry,'-o',binary],{timeout:120000,stdio:'pipe'});
 function launch(port){
  const child=spawn(binary,[String(port)],{stdio:['ignore','pipe','pipe']});children.add(child);
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
 async function exchange(port){
  await new Promise((resolve,reject)=>{
   const client=createConnection({host:'127.0.0.1',port});let response='';
   client.setTimeout(3000,()=>client.destroy(Error('Loopback response timed out')));
   client.on('connect',()=>client.write('ping'));client.on('data',bytes=>response+=bytes);client.on('error',reject);
   client.on('end',()=>{try{assert.equal(response,'pong');resolve();}catch(error){reject(error);}finally{client.destroy();}});
  });
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
 console.log('Mac loopback: 4 fixed-origin starts and real TCP exchanges; occupied-port protection PASS.');
}finally{
 for(const child of children)child.kill('SIGKILL');
 await rm(temp,{recursive:true,force:true});
}
