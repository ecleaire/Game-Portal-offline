// Validate the bytes users download, including signed bundles, before launching
// the two extracted HTML editions. Never execute native files from an archive.
import {readFile,mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {verifyCodeZip} from '../scripts/verify-code-zip.mjs';

const bytes=await readFile(process.argv[2]),files=verifyCodeZip(bytes);
const tracked=execFileSync('git',['ls-files','-z','README.md','Windows','Mac','HTML','docs','_内部ファイル'],{encoding:'utf8'}).split('\0').filter(name=>name&&name!=='docs/DEVELOPMENT.md');
assert.deepEqual([...files.keys()].sort(),tracked.sort(),'Public ZIP must contain every distribution file');
const temp=await mkdtemp(join(tmpdir(),'portal-public-zip-'));
const hash=data=>createHash('sha256').update(data).digest('hex');
try{
 for(const [name,file]of files){
  assert(file.size<=64*1024*1024,'Unexpected oversized file');
  const start=file.offset+30+bytes.readUInt16LE(file.offset+26)+bytes.readUInt16LE(file.offset+28);
  const packed=bytes.subarray(start,start+file.packed);
  assert([0,8].includes(file.method));
  const data=file.method===0?packed:inflateRawSync(packed,{maxOutputLength:64*1024*1024});
  assert.equal(data.length,file.size);assert.equal(hash(data),hash(await readFile(name)),'Public file differs: '+name);
  if(/^HTML\/(プレイ用|クリエイター用)\/GAME-PORTAL(?:-PLAY)?\.html$/.test(name)){
   const destination=join(temp,...name.split('/'));await mkdir(join(destination,'..'),{recursive:true});await writeFile(destination,data);
  }
 }
 console.log('Actual public Code ZIP: every distribution file matches the verified checkout byte for byte.');
 const version='v'+JSON.parse(await readFile('package.json','utf8')).version;
 const server=createServer(async(req,res)=>{
  try{const player=req.url==='/player';res.setHeader('Content-Type','text/html');res.end(await readFile(join(temp,'HTML',player?'プレイ用':'クリエイター用',player?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html')));}catch{res.writeHead(500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
  for(const role of ['creator','player']){
   const context=await browser.newContext(),page=await context.newPage(),errors=[],external=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:'))external.push(request.url());});
   await page.goto('http://127.0.0.1:'+server.address().port+'/'+role);
   await expect(page.locator('html')).toHaveAttribute('data-ready','true');
   await expect(page.locator('#appVersion')).toHaveText(version);
   await expect(page.locator('#setupFolder')).toBeVisible();
   await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.locator('#settings')).toBeVisible();
   assert.equal(await page.evaluate(()=>launcherEdition),role);
   if(role==='player')await expect(page.locator('#enableEditing')).toBeHidden();
   assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
   console.log('Extracted '+role+' HTML: correct version/edition, folder and settings UI, no script errors or external requests.');
   await context.close();
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}finally{await rm(temp,{recursive:true,force:true});}
