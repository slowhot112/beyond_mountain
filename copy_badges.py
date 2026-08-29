import shutil, os

desktop = os.path.join(os.path.expanduser('~'), 'Desktop')
src = None
for name in os.listdir(desktop):
    if '知乎' in name and '黑客' in name:
        src = os.path.join(desktop, name)
        break
print('SRC:', src)

if src is None:
    raise SystemExit('未找到知乎_黑客松 文件夹')

project = os.path.dirname(os.path.abspath(__file__))
dst = os.path.join(project, 'lanyard', 'public')
os.makedirs(dst, exist_ok=True)
for key, out in [('正面工牌.png', 'front-badge.png'), ('反面工牌.png', 'back-badge.png')]:
    s = os.path.join(src, key)
    if os.path.exists(s):
        shutil.copy(s, os.path.join(dst, out))
        print('copied', key, '->', out)
    else:
        print('MISSING', key)
print('DST files:', os.listdir(dst))
