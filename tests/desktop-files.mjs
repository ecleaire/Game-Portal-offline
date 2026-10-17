import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
if(process.platform!=='win32'){console.log('Desktop file test requires Windows.');process.exit(0);}
const temp=await mkdtemp(join(tmpdir(),'portal-desktop-files-'));
try{
 const child=spawn(resolve(process.env.PORTAL_DESKTOP_EXE||'GAME-PORTAL.exe'),['--self-test',temp],{windowsHide:true,stdio:'pipe'});
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Desktop backend test timeout'));},30000);child.once('error',reject);child.once('exit',value=>{clearTimeout(timer);resolve(value);});});
 if(code!==0)throw Error(await readFile(join(temp,'failure.txt'),'utf8').catch(()=> 'Desktop backend failed: '+code));
 const result=JSON.parse(await readFile(join(temp,'result.json'),'utf8'));assert.equal(result.passed,true);assert(result.checks.length>=38);console.log('Desktop filesystem passed: '+result.checks.length+' checks, including UNC/quoted paths, restart identity, atomic writes, independent writer exclusion, failed-write preservation and root containment.');
}finally{await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
