import {readFile,writeFile,mkdir,cp,access,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('macOS test preparation only');
const cache=resolve('.tools/mojave-test');await mkdir(cache,{recursive:true});
async function download(name,url,algorithm,expected){const file=join(cache,name);let bytes;try{bytes=await readFile(file);}catch{const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Download failed: '+response.status);bytes=Buffer.from(await response.arrayBuffer());await writeFile(file,bytes);}if(createHash(algorithm).update(bytes).digest('hex')!==expected)throw Error('Test dependency digest mismatch: '+name);return file;}
const dmg=await download('Firefox-115.43.0esr.dmg','https://archive.mozilla.org/pub/firefox/releases/115.43.0esr/mac/en-US/Firefox%20115.43.0esr.dmg','sha512','5060f3496fc1081ae5a3a10d8daef7db39192d2b985372de993598bfe5a08b73c976f28fa3dfa7fd5a9473f9ebccbc274f8a48d48b05d18dcd551c8be781a751');
const driver=await download('geckodriver-v0.36.0-macos.tar.gz','https://github.com/mozilla/geckodriver/releases/download/v0.36.0/geckodriver-v0.36.0-macos.tar.gz','sha256','b5627bfc29801b8752c9f1e7699018963c39c076aab6576dc14fcb1ce7a256f6');
const app=join(cache,'Firefox.app');try{await access(join(app,'Contents/MacOS/firefox'));}catch{const mount=join(cache,'mounted');await mkdir(mount,{recursive:true});execFileSync('hdiutil',['attach',dmg,'-readonly','-nobrowse','-mountpoint',mount],{stdio:'pipe'});try{await cp(join(mount,'Firefox.app'),app,{recursive:true,verbatimSymlinks:true});}finally{execFileSync('hdiutil',['detach',mount],{stdio:'pipe'});}}
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const entries=execFileSync('tar',['-tzf',driver],{encoding:'utf8'}).trim();if(entries!=='geckodriver')throw Error('Unexpected driver archive entries');execFileSync('tar',['-xzf',driver,'-C',cache],{stdio:'pipe'});
console.log('Official Firefox ESR 115.43.0 and geckodriver verified for isolated browser testing.');
// Official Chrome for Testing entry and Google Cloud Storage object digest.
const chromeZip=await download('chrome-116-mac-x64.zip','https://storage.googleapis.com/chrome-for-testing-public/116.0.5845.96/mac-x64/chrome-mac-x64.zip','md5',Buffer.from('pSu7psLw4QiqJqeXaJ24pw==','base64').toString('hex'));
const chrome=join(cache,'chrome-mac-x64','Google Chrome for Testing.app');
try{await access(join(chrome,'Contents/MacOS/Google Chrome for Testing'));}catch{execFileSync('ditto',['-x','-k',chromeZip,cache],{stdio:'pipe'});}
execFileSync('codesign',['--verify','--deep','--strict',chrome],{stdio:'pipe'});
console.log('Official Chrome for Testing 116.0.5845.96 verified for Mojave-era engine testing.');
