"""The Devpost thumbnail (3:2, 1500 x 1000): the title column beside a real frame of the app recorded in the
XR emulator. Writes artifacts/video/thumbnail.png. Usage: python scripts/video/thumbnail.py [scene] [frame]"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = r'C:/Windows/Fonts'
W, H = 1500, 1000


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def main():
    scene = sys.argv[1] if len(sys.argv) > 1 else 'production'
    frame = sys.argv[2] if len(sys.argv) > 2 else 'f00560.jpg'
    im = Image.new('RGB', (W, H))
    top, bottom = (14, 18, 52), (34, 24, 86)
    px = im.load()
    for y in range(H):
        k = y / (H - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3))
        for x in range(W):
            px[x, y] = c
    # The footage: a square frame of the real app, rounded, on the right.
    shot = Image.open(os.path.join(ROOT, 'artifacts', 'video', 'scenes', scene, frame)).convert('RGB')
    s = min(shot.size)
    shot = shot.crop(((shot.width - s) // 2, (shot.height - s) // 2, (shot.width + s) // 2, (shot.height + s) // 2))
    side = 900
    shot = shot.resize((side, side), Image.LANCZOS)
    mask = Image.new('L', (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), 36, fill=255)
    x0, y0 = W - side - 50, (H - side) // 2
    im.paste(shot, (x0, y0), mask)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0, y0, x0 + side - 1, y0 + side - 1), 36, outline=(120, 170, 255), width=3)
    cyan, white, dim = (110, 200, 255), (245, 247, 255), (176, 186, 220)
    lx = 56
    d.text((lx, 92), 'META QUEST  ·  WEBXR', font=font('CascadiaMono.ttf', 22), fill=cyan)
    d.text((lx, 140), 'AstraCAD', font=font('seguisb.ttf', 88), fill=white)
    d.text((lx, 240), 'Spatial', font=font('seguisb.ttf', 88), fill=white)
    d.rectangle((lx, 362, lx + 80, 367), fill=cyan)
    lede = font('segoeuisl.ttf', 31)
    for i, line in enumerate(['Real CAD with your', 'hands and voice.', 'Every part checked', 'by exact maths.']):
        d.text((lx, 400 + i * 44), line, font=lede, fill=dim)
    small = font('segoeui.ttf', 25)
    for i, line in enumerate(['Sketch, model, assemble', 'Test with your palm', 'Drawings, STEP, G-code']):
        y = 640 + i * 46
        d.ellipse((lx, y + 10, lx + 10, y + 20), fill=cyan)
        d.text((lx + 24, y), line, font=small, fill=white)
    d.text((lx, 900), 'Real app, recorded in Meta’s XR emulator', font=font('CascadiaMono.ttf', 15), fill=dim)
    out = os.path.join(ROOT, 'artifacts', 'video', 'thumbnail.png')
    im.save(out, optimize=True)
    print(out, os.path.getsize(out))


if __name__ == '__main__':
    main()
