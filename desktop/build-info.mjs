import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const digest=data=>createHash('sha256').update(data).digest('hex');
export async function desktopBuildInfo(root,licenses,edition='creator'){
 const config=JSON.parse(await readFile(join(root,'desktop/desktop.json'),'utf8')),files={};
 for(const path of ['desktop/desktop.json','desktop/bootstrap.js','desktop/page.mjs','desktop/host.cs','desktop/files.cs','desktop/folder-dialog.cs','desktop/shared-connection.cs','desktop/self-test.cs','desktop/build-info.mjs','scripts/build-desktop.mjs','scripts/windows/native-launcher.cs'])files[path]=digest((await readFile(join(root,path),'utf8')).replaceAll('\r\n','\n'));
 return JSON.stringify({schema:1,version:config.version,launcherVersion:config.launcherVersion,edition,htmlSHA256:digest(await readFile(join(root,edition==='player'?'GAME-PORTAL-PLAY.html':'GAME-PORTAL.html'))),licensesSHA256:digest(licenses),files});
}
