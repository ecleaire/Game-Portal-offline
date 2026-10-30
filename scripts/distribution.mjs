import {access,cp,mkdir,readFile,writeFile,readdir,lstat,chmod} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const roles=['プレイ用','クリエイター用'];
export const markerPath='_内部ファイル/GAME-PORTAL-DISTRIBUTION.json';
export const distributionFiles=[
 ...roles.map((role,index)=>({group:'html',source:index?'GAME-PORTAL.html':'GAME-PORTAL-PLAY.html',targets:['HTML/'+role+'/'+(index?'GAME-PORTAL.html':'GAME-PORTAL-PLAY.html')]})),
 ...roles.map((role,index)=>({group:'windows',source:index?'GAME-PORTAL.exe':'GAME-PORTAL-PLAY.exe',targets:['Windows/'+role+'/'+(index?'GAME-PORTAL.exe':'GAME-PORTAL-PLAY.exe')]})),
 {group:'windows',source:'DESKTOP-LICENSES.txt',targets:roles.map(role=>'Windows/'+role+'/_内部ファイル/DESKTOP-LICENSES.txt')},
 ...['GAME-PORTAL-WINDOWS.exe','README-WINDOWS.txt'].map(source=>({group:'helper',source,targets:roles.map(role=>'HTML/'+role+'/起動補助/_runtime/'+source)})),
 ...['MAC','MOJAVE'].flatMap(suffix=>[
  ...roles.map((role,index)=>({group:suffix.toLowerCase(),source:(index?'GAME-PORTAL-':'GAME-PORTAL-PLAY-')+suffix+'.app',targets:['Mac/'+role+'/'+(index?'GAME-PORTAL-':'GAME-PORTAL-PLAY-')+suffix+'.app']})),
  {group:suffix.toLowerCase(),source:'GAME-PORTAL-'+suffix,targets:roles.map(role=>'HTML/'+role+'/起動補助/_runtime/GAME-PORTAL-'+suffix)},
  {group:suffix.toLowerCase(),source:'offline-release/Swift-'+suffix,targets:roles.map(role=>'HTML/'+role+'/起動補助/_runtime/Swift-'+suffix)}
 ]),
 {group:'html',source:'THIRD-PARTY-LICENSES.txt',targets:['Windows','Mac','HTML'].flatMap(platform=>roles.map(role=>platform+'/'+role+'/_内部ファイル/THIRD-PARTY-LICENSES.txt'))}
];
export function helperEntrypoints(role){
 const html=role==='プレイ用'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html';
 return [
  ['Windowsで起動.cmd','@echo off\r\nsetlocal EnableExtensions DisableDelayedExpansion\r\nstart "" "%~dp0_runtime\\GAME-PORTAL-WINDOWS.exe" --html "%~dp0..\\'+html+'"\r\n'],
  ...['MAC','MOJAVE'].map(suffix=>[suffix==='MAC'?'Macで起動.command':'古いMacで起動.command','#!/bin/'+(suffix==='MAC'?'zsh':'bash')+'\ncd -- "$(dirname -- "$0")" || exit 1\n./_runtime/GAME-PORTAL-'+suffix+' --html "../'+html+'"\nresult=$?\nif [ "$result" -ne 0 ]; then\n  printf "\\n起動できませんでした。上の案内を確認してください。Enterで閉じます。\\n"\n  read -r\nfi\nexit "$result"\n'])
 ];
}
const defaultRoot=resolve(import.meta.dirname,'..');
// Existing build/test entry points keep private root staging files. Only grouped
// outputs are tracked and distributed; no user connection files are copied.
export async function materializeDistribution(root=defaultRoot){
 for(const file of distributionFiles){try{await access(join(root,file.source));}catch{try{await cp(join(root,file.targets[0]),join(root,file.source),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}}}
 for(const suffix of ['MAC','MOJAVE']){const path=join(root,'GAME-PORTAL-'+suffix+'.command');try{await access(path);}catch{await writeFile(path,'#!/bin/'+(suffix==='MAC'?'zsh':'bash')+'\ncd -- "$(dirname -- "$0")" || exit 1\n./GAME-PORTAL-'+suffix+'\n');}}
}
export async function publishDistribution(group,root=defaultRoot){
 for(const file of distributionFiles.filter(file=>file.group===group))for(const target of file.targets){await mkdir(dirname(join(root,target)),{recursive:true});await cp(join(root,file.source),join(root,target),{recursive:true});}
 for(const role of roles)for(const [name,text]of helperEntrypoints(role)){const path=join(root,'HTML',role,'起動補助',name);await mkdir(dirname(path),{recursive:true});await writeFile(path,text);if(name.endsWith('.command'))await chmod(path,0o755);}
 await mkdir(join(root,'_内部ファイル'),{recursive:true});await writeFile(join(root,markerPath),JSON.stringify({schema:1,project:'GAME-PORTAL',layout:'platform-role'},null,2)+'\n');
}
async function content(path){
 const info=await lstat(path);if(info.isSymbolicLink())throw Error('Distribution must not contain symbolic links');
 if(info.isFile())return createHash('sha256').update(await readFile(path)).digest('hex');
 const entries=await readdir(path,{withFileTypes:true});
 const result=[];for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw Error('Distribution must not contain symbolic links');result.push([entry.name,await content(join(path,entry.name))]);}return JSON.stringify(result);
}
export async function verifyPublishedDistribution(root=defaultRoot){
 for(const file of distributionFiles)for(const target of file.targets)if(await content(join(root,file.source))!==await content(join(root,target)))throw Error('Distribution output differs: '+target);
 for(const role of roles)for(const [name,text]of helperEntrypoints(role))if(await readFile(join(root,'HTML',role,'起動補助',name),'utf8')!==text)throw Error('Helper entrypoint differs: '+name);
 const marker=JSON.parse(await readFile(join(root,markerPath),'utf8'));if(marker.schema!==1||marker.project!=='GAME-PORTAL'||marker.layout!=='platform-role')throw Error('Invalid distribution layout');
 console.log('Platform/role distribution verified: Windows, Mac and HTML; matching play and creator files.');
}
