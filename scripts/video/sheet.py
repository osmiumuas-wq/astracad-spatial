"""Contact sheet of a recorded scene: python scripts/video/sheet.py <scene> <out.png> t1 t2 ...  (seconds)."""
import bisect
import json
import os
import sys

from PIL import Image, ImageDraw

scene, out = sys.argv[1], sys.argv[2]
ts = [float(t) for t in sys.argv[3:]]
root = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'artifacts', 'video', 'scenes', scene)
tm = json.load(open(os.path.join(root, 'times.json')))['times']
T = [t for _, t in tm]
cols = 4
size = 400
sh = Image.new('RGB', (cols * size, ((len(ts) + cols - 1) // cols) * size))
for k, t in enumerate(ts):
    i = max(0, bisect.bisect_right(T, t) - 1)
    im = Image.open(os.path.join(root, tm[i][0])).convert('RGB').resize((size, size))
    ImageDraw.Draw(im).rectangle((0, 0, 80, 18), fill=(0, 0, 0))
    ImageDraw.Draw(im).text((4, 3), f'{scene} {t:.1f}', fill='yellow')
    sh.paste(im, ((k % cols) * size, (k // cols) * size))
sh.save(out)
print('last', round(T[-1], 1), 'frames', len(T))
