"""Đồng bộ script tạo extension (.ps1) với mã hiện tại.

    python -I tools/sync_ps1.py "<đường dẫn>/tao-transvid.ps1.txt" .

Viết lại toàn bộ phần thân script: mỗi file mã một khối  W '<đường dẫn>' @' ... '@,
mỗi ảnh (icons/*.png) một dòng  B '<đường dẫn>' '<base64>'. Giữ nguyên dòng $root và phần cuối.
"""
import sys, re, os, base64

ps1, d = sys.argv[1], sys.argv[2]
t = open(ps1, 'rb').read().decode('utf-8').replace('\r\n', '\n')

ANCHOR = '\nWrite-Host ""\nWrite-Host "Xong.'
assert t.count(ANCHOR) == 1, 'không thấy phần cuối script'
footer = t[t.index(ANCHOR) + 1:]
root_line = re.search(r"^\$root = .*$", t, re.M).group(0)

SKIP_DIRS = {'.git', 'tools', 'tests', 'icons', 'node_modules'}
SKIP_FILES = {'README.md'}
# Bản cũ để mọi file ở thư mục gốc: xoá đi khi tạo lại theo cấu trúc mới.
LEGACY = ['shared.js', 'voices.js', 'hook.js', 'content.js', 'content.css', 'popup.html', 'popup.js',
          'options.html', 'options.js', 'ui.css', 'pico.min.css']

files = []
for base, dirs, names in os.walk(d):
    dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not x.startswith('.'))
    for n in sorted(names):
        rel = os.path.relpath(os.path.join(base, n), d).replace('\\', '/')
        if n.startswith('.') or rel in SKIP_FILES:
            continue
        files.append(rel)
# manifest trước, rồi theo thư mục
files.sort(key=lambda r: (r != 'manifest.json', r.count('/'), r))

header = '\n'.join([
    '# Tao extension "TransVid" (long tieng Viet cho YouTube / Udemy / Coursera / DeepLearning.AI) - Chrome/Edge Manifest V3',
    '# Chay:  powershell -ExecutionPolicy Bypass -Command "Get-Content -Raw -Encoding UTF8 \'D:\\AI repo\\craf\\tao-transvid.ps1.txt\' | iex"',
    root_line,
    'New-Item -ItemType Directory -Force -Path $root | Out-Null',
    '$utf8 = New-Object System.Text.UTF8Encoding $false',
    'function W($name, $text) { $p = Join-Path $root $name; New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; '
    '[IO.File]::WriteAllText($p, $text.TrimStart("`r", "`n"), $utf8); Write-Host "  + $name" }',
    'function B($name, $b64) { $p = Join-Path $root $name; New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null; '
    '[IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($b64)); Write-Host "  + $name" }',
    "foreach ($f in @(%s)) { $p = Join-Path $root $f; if (Test-Path $p) { Remove-Item $p } }" % ', '.join("'%s'" % f for f in LEGACY),
    'Write-Host "Ghi extension vao $root"',
    '',
])

body = []
for rel in files:
    text = open(os.path.join(d, rel), 'rb').read().decode('utf-8').replace('\r\n', '\n').rstrip('\n')
    assert not re.search(r"^'@", text, re.M), rel
    body.append("W '%s' @'\n%s\n'@\n" % (rel, text))

idir = os.path.join(d, 'icons')
imgs = sorted(n for n in os.listdir(idir) if n.endswith('.png')) if os.path.isdir(idir) else []
for n in imgs:
    body.append("B 'icons/%s' '%s'\n" % (n, base64.b64encode(open(os.path.join(idir, n), 'rb').read()).decode()))

out = header + '\n' + ''.join(body) + footer
open(ps1, 'wb').write(out.encode('utf-8'))
print('updated', len(files), 'files,', len(imgs), 'images')
