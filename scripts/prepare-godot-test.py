# Build-time regression data only. The product never downloads an engine.
from pathlib import Path
import urllib.request, struct, zlib, zipfile, io, hashlib, json

BASE = 'https://github.com/godotengine/godot-builds/releases/download/4.3-stable/Godot_v4.3-stable_export_templates.tpz'
SIZE = 1073228327
EXPECTED = '5c54b5db14199571790576408940843b76e3e46884bf6c79d06b369334f512c1'
cache = Path('.tools/godot')
cache.mkdir(parents=True, exist_ok=True)
archive = cache / 'web_nothreads_release.zip'
data = archive.read_bytes() if archive.exists() else b''
if hashlib.sha256(data).hexdigest() != EXPECTED:
    # Fetch only the selected 8 MB entry from the official 1 GB template ZIP.
    # Require bounded range responses, validate ZIP CRC, then the pinned hash.
    with urllib.request.urlopen(urllib.request.Request(BASE, method='HEAD'), timeout=60) as response:
        url = response.url

    def read(start, end):
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'}), timeout=90) as response:
            if response.status != 206:
                raise RuntimeError('Official template endpoint must support bounded range download')
            value = response.read(end - start + 2)
            assert len(value) == end - start + 1
            return value

    tail = read(SIZE - 65557, SIZE - 1)
    end = tail.rfind(b'PK\x05\x06')
    assert end >= 0
    count, length, offset = struct.unpack_from('<HII', tail, end + 10)
    assert count < 500 and length < 1024 * 1024
    directory, at = read(offset, offset + length - 1), 0
    for _ in range(count):
        assert directory[at:at+4] == b'PK\x01\x02'
        method = struct.unpack_from('<H', directory, at + 10)[0]
        crc, packed, plain = struct.unpack_from('<III', directory, at + 16)
        n, e, c = struct.unpack_from('<HHH', directory, at + 28)
        offset = struct.unpack_from('<I', directory, at + 42)[0]
        name = directory[at+46:at+46+n].decode()
        at += 46 + n + e + c
        if name != 'templates/web_nothreads_release.zip':
            continue
        assert method in (0, 8) and packed < 12 * 1024 * 1024 and plain < 12 * 1024 * 1024
        header = read(offset, offset + 29)
        n, e = struct.unpack_from('<HH', header, 26)
        raw = read(offset + 30 + n + e, offset + 30 + n + e + packed - 1)
        data = raw if method == 0 else zlib.decompress(raw, -15)
        assert len(data) == plain and zlib.crc32(data) & 0xffffffff == crc
        assert hashlib.sha256(data).hexdigest() == EXPECTED
        part = cache / 'template.part'
        part.write_bytes(data)
        part.replace(archive)
        break
    else:
        raise RuntimeError('Official Godot Web template missing')

with zipfile.ZipFile(io.BytesIO(data)) as template, zipfile.ZipFile(cache / 'Godot.zip', 'w', zipfile.ZIP_DEFLATED) as game:
    for source, target in [('godot.js', 'index.js'), ('godot.wasm', 'index.wasm'), ('godot.audio.worklet.js', 'index.audio.worklet.js')]:
        game.writestr(target, template.read(source))
    pack = Path('tests/fixtures/godot43/index.pck').read_bytes()
    game.writestr('index.pck', pack)
    config = {'canvasResizePolicy': 2, 'executable': 'index', 'fileSizes': {'index.pck': len(pack), 'index.wasm': 35376909}}
    game.writestr('index.html', '<!doctype html><canvas id="canvas"></canvas><script src="index.js"></script><script>new Engine(' + json.dumps(config) + ').startGame().catch(error=>console.error("GODOT INIT ERROR",error));</script>')
print('Pinned Godot 4.3 single-thread Web ZIP prepared; only locally authored test scene included.')
