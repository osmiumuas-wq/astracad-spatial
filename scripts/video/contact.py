"""A contact sheet of a recorded scene: 12 frames evenly through it, with their times.
Usage: python scripts/video/contact.py <scene> [<scene> ...]  -> artifacts/video/sheet-<scene>.jpg
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCENES = os.path.join(ROOT, 'artifacts', 'video', 'scenes')

for name in sys.argv[1:]:
    d = os.path.join(SCENES, name)
    times = json.load(open(os.path.join(d, 'times.json')))['times']
    n = 12
    picks = [times[int(i * (len(times) - 1) / (n - 1))] for i in range(n)]
    tw = 360
    sheet = Image.new('RGB', (tw * 4, tw * 3), 'black')
    for k, (f, t) in enumerate(picks):
        im = Image.open(os.path.join(d, f)).convert('RGB').resize((tw, tw))
        ImageDraw.Draw(im).text((8, 8), f'{t:.1f}s', fill=(255, 255, 0))
        sheet.paste(im, ((k % 4) * tw, (k // 4) * tw))
    out = os.path.join(ROOT, 'artifacts', 'video', f'sheet-{name}.jpg')
    sheet.save(out, quality=85)
    print(out)
