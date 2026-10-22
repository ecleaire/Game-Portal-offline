// Bounded hosted-build diagnostics. Imported only by native CI build steps;
// installed launchers and normal local builds never load this module.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {basename} from 'node:path';
import './ci-failure-diagnostics.mjs';
if(process.env.GITHUB_ACTIONS==='true'){
 const note=message=>console.log('::notice title=Native build::'+message);
 const original=childProcess.execFileSync;
 childProcess.execFileSync=function(command,args=[],options={}){
  // Log only the executable and subcommand, never environments or full arguments.
  const label=basename(command)+' '+String(args[0]||'').replace(/[^a-zA-Z0-9_.-]/g,'');
  note('Starting '+label);const started=Date.now();
  try{const value=original.call(this,command,args,{...options,stdio:options.stdio==='inherit'?'pipe':options.stdio,maxBuffer:16*1024*1024,timeout:options.timeout||10*60*1000});if(options.stdio==='inherit'&&value)process.stdout.write(value);return value;}
  catch(error){const tail=String(error.stderr||'').slice(-3000);if(tail)error.message+='\n'+tail;throw error;}
  finally{note('Finished '+label+' after '+Math.round((Date.now()-started)/1000)+'s');}
 };
 syncBuiltinESMExports();
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async function(input,options){const host=new URL(typeof input==='string'?input:input.url).hostname;note('Fetching from '+host);return originalFetch(input,options);};
}
