import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
execFileSync(process.platform==='win32'?'python':'python3',['scripts/prepare-godot-test.py'],{cwd:resolve(import.meta.dirname,'..'),stdio:'inherit'});
