// Run the real native filesystem checks before the expensive CEF app build.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
if(process.platform!=='darwin')throw Error('Mac native filesystem checks require macOS.');
const temp=await mkdtemp(join(tmpdir(),'portal-mac-files-'));
try{
 const entry=join(temp,'Entry.swift'),binary=join(temp,'files-test'),disk=join(temp,'fixture');
 await writeFile(entry,'import Foundation\nimport Darwin\n@main struct FilesTest { static func main() { do { try desktopSelfTest(URL(fileURLWithPath: CommandLine.arguments[1])) } catch { fputs(((error as? DesktopError)?.message ?? error.localizedDescription) + "\\n", stderr); exit(1) } } }\n');
 execFileSync('xcrun',['swiftc','-parse-as-library','-swift-version','5','-O',resolve('scripts/macos/desktop-files.swift'),resolve('scripts/macos/desktop-self-test.swift'),entry,'-framework','Security','-o',binary],{timeout:120000,stdio:'pipe'});
 execFileSync(binary,[disk],{timeout:30000,stdio:'pipe'});
 assert.equal(JSON.parse(await readFile(join(disk,'result.json'),'utf8')).ok,true);
 console.log('Mac filesystem checks passed: shared defaults, fresh profiles, personal overrides, stale/concurrent writer rejection, Player denial and existing data protection.');
}finally{await rm(temp,{recursive:true,force:true});}
