import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {desktopPage} from '../desktop/page.mjs';
test('desktop packaging preserves the standalone HTML and sandbox while binding only the main document to native IO',async()=>{
 const original=(await readFile('GAME-PORTAL.html','utf8')).replaceAll('\r\n','\n'),bootstrap=await readFile('desktop/bootstrap.js','utf8'),page=desktopPage(original,bootstrap,'<license>');
 assert(original.includes('connect-src blob: data: http://127.0.0.1:*'));assert(!original.includes('const desktopHost='));assert(page.includes("connect-src 'self' blob: data:"));assert(page.includes("window!==window.top||location.origin!=="));assert(page.includes('sandbox="allow-scripts allow-pointer-lock"'));assert(page.includes('&lt;license&gt;'));assert(!page.includes('<license>'));
 const start=page.indexOf('<script>const tagPresets=');assert(start>=0,'bundled app script');new Script(page.slice(start+8,page.lastIndexOf('</script>')));
 assert.throws(()=>desktopPage('<html>outdated</html>',bootstrap),/marker changed/);
});
