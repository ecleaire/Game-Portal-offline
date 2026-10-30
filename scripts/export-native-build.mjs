import {publishWithConfirmation} from './confirm-native-publish.mjs';
// Publish only verified build outputs to an isolated branch. The source checkout
// and its index stay unchanged; the cloud installer can fetch this Git tree.
import {readFile,readdir,lstat,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const kind=process.argv[2];
if(!((process.platform==='darwin'&&['modern','legacy'].includes(kind))||(process.platform==='win32'&&kind==='windows'))||!/^\d+$/.test(process.env.GITHUB_RUN_ID||'')||!/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT||''))throw Error('Run from the verified native CI job.');
const root=resolve(import.meta.dirname,'..'),version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const git=(args,options={})=>execFileSync('git',args,{cwd:root,encoding:'utf8',...options}).trim();
const source=git(['rev-parse','HEAD']);if(source!==process.env.GITHUB_SHA)throw Error('Build source differs from the workflow revision.');
const roles=['プレイ用','クリエイター用'],paths=kind==='windows'?['Windows',...roles.flatMap(role=>['GAME-PORTAL-WINDOWS.exe','README-WINDOWS.txt'].map(name=>'HTML/'+role+'/起動補助/_runtime/'+name))]:kind==='modern'?['Mac',...roles.flatMap(role=>['GAME-PORTAL-MAC','Swift-MAC'].map(name=>'HTML/'+role+'/起動補助/_runtime/'+name))]:roles.flatMap(role=>['GAME-PORTAL-MOJAVE','Swift-MOJAVE'].map(name=>'HTML/'+role+'/起動補助/_runtime/'+name));
if(kind==='modern')for(const role of roles)for(const family of ['MAC','MOJAVE']){
 const name=(role==='プレイ用'?'GAME-PORTAL-PLAY-':'GAME-PORTAL-')+family+'.app';
 const manifest=JSON.parse(await readFile(join(root,'Mac',role,name,'Contents/Resources/build.json'),'utf8'));
 if(manifest.version!==version||manifest.kind!=='mac-cef-standalone-v1')throw Error('Mac output is stale.');
}
const entries=[];
async function collect(path){const info=await lstat(join(root,path));if(info.isSymbolicLink())throw Error('Unexpected output symlink: '+path);if(info.isDirectory()){for(const name of (await readdir(join(root,path))).sort())await collect(path+'/'+name);return;}if(!info.isFile()||/(?:^|\/)(?:origin\.json|\.private|AGENTS\.md)(?:\/|$)/.test(path))throw Error('Unexpected private build output: '+path);entries.push({path,mode:info.mode&0o111?'100755':'100644',blob:git(['hash-object','-w','--no-filters',join(root,path)])});}
for(const path of paths)await collect(path);
const temporary=await mkdtemp(join(tmpdir(),'portal-build-index-'));
try{
 const env={...process.env,GIT_INDEX_FILE:join(temporary,'index')};git(['read-tree','--empty'],{env});
 for(const entry of entries)git(['update-index','--add','--cacheinfo',entry.mode+','+entry.blob+','+entry.path],{env});
 const provenance={schema:1,source_commit:source,version,kind,files:entries};
 const blob=git(['hash-object','-w','--stdin'],{input:JSON.stringify(provenance,null,2)+'\n'});git(['update-index','--add','--cacheinfo','100644,'+blob+',build-output.json'],{env});
 const tree=git(['write-tree'],{env}),commit=git(['-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit-tree',tree],{input:'Verified Mac '+kind+' build for '+source+'\n'});
 const branch='codex/native-output-'+kind+'-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
 const recovered=publishWithConfirmation(()=>git(['push','origin',commit+':refs/heads/'+branch],{stdio:['ignore','pipe','inherit']}),()=>git(['ls-remote','--heads','origin','refs/heads/'+branch]).split(/\s+/)[0],commit);if(recovered)console.log('Remote native output commit verified after transport error.');console.log('Verified native output branch: '+branch);
}finally{await rm(temporary,{recursive:true,force:true});}
