import sys, re, os
ps1, d = sys.argv[1], sys.argv[2]
t = open(ps1, 'rb').read().decode('utf-8').replace('\r\n', '\n')
# Chỉ các file mã của extension ở thư mục gốc: bỏ thư mục (tools/, .git/), file ẩn và README.
names = sorted(n for n in os.listdir(d) if os.path.isfile(os.path.join(d, n)) and not n.startswith('.') and n != 'README.md')
for n in names:
    js = open(os.path.join(d, n), 'rb').read().decode('utf-8').replace('\r\n', '\n').rstrip('\n')
    assert not re.search(r"^'@", js, re.M), n
    tag = "W '%s' @'\n" % n
    if tag not in t:
        # file mới: chèn block trước dòng thông báo cuối script
        anchor = '\nWrite-Host ""\nWrite-Host "Xong.'
        assert t.count(anchor) == 1, 'anchor'
        t = t.replace(anchor, '\n' + tag + js + "\n'@\n" + anchor)
        print('added block', n)
        continue
    s = t.index(tag) + len(tag); e = t.index("\n'@", s)
    t = t[:s] + js + t[e:]
assert len(re.findall(r"^W '", t, re.M)) == len(names), 'extra blocks in script'
open(ps1, 'wb').write(t.encode('utf-8'))
print('updated', len(names), 'blocks')
