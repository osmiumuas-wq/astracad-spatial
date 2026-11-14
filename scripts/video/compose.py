"""Builds the demo video from the recorded scenes (artifacts/video/scenes/<name>/ frames + times.json):
1920 x 1080, footage on the left, a caption card on the right, title and closing cards.
Usage: python -I scripts/video/compose.py   -> artifacts/video/astracad-spatial-demo.mp4
"""
import json
import os
import subprocess
import textwrap

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VID = os.path.join(ROOT, 'artifacts', 'video')
SCN = os.path.join(VID, 'scenes')
WORK = os.path.join(VID, 'work')
FFMPEG = os.environ.get('FFMPEG', r'C:/Users/solid/.local/bin/ffmpeg.exe')
FONTS = r'C:/Windows/Fonts'
W, H, FPS = 1920, 1080, 30

FOOTER = 'Real app footage · Meta XR emulator (IWER) on a PC · not yet filmed on a headset'

SCENES = [
    ('arrive', 0.4, 8.4, '1 · ARRIVE', 'A CAD bench at your fingertips',
     'It appears at seated height in front of you and anchors itself to the room. With no table in view it says so '
     'and floats within reach. A six-step guide lights up the button it wants next.'),
    ('shape', 0.4, 12.4, '2 · SHAPE WITH YOUR HANDS', 'Pinch a handle. Pull.',
     'Every change is rebuilt by the kernel and checked against an exact closed-form volume. The truth gate on the '
     'left reads Verified; kernel and formula differ by about 1e-11.'),
    ('voice', 0.3, 14.3, '3 · SAY WHAT YOU NEED', '"A box for my Raspberry Pi, 90 by 65 by 30."',
     'Whisper turns speech into text on the device, and a 23 MB on-device language model works out which part is '
     'meant. Sizes come only from your words. (The emulator has no microphone: a synthesised recording of the '
     'sentence is fed to the same recogniser.)'),
    ('test', 0.4, 16.4, '4 · TEST IT', 'Point, pinch, load-test.',
     'A voxel stress solver, checked against CalculiX to 1.3 %, colours the part by stress. Three engineering agents '
     'read the result and offer fixes you can take with a pinch.'),
    ('parts', 0.4, 10.6, '5 · REAL CAD FEATURES', 'Fillets, shells, sweeps, lofts.',
     'A project box with rounded corners and shelled walls, a pull handle swept round two bends, a lofted foot. Each '
     'is verified exactly (Pappus, the prismatoid formula), not just drawn.'),
    ('flow', 0.4, 11.4, '6 · SEE THE AIR', 'Air-flow preview.',
     'Ideal flow solved around the part shows where air goes and where it speeds up. It has no viscosity, so no wake '
     'and no forces, and the app says so.'),
    ('drawing', 0.4, 13.8, '7 · TAKE IT WITH YOU', 'The drawing springs out.',
     'Three views, dimensions and a title block from the same verified model. The STL, 3MF and the drawing download '
     'from the flat page; a share link opens it on a phone.'),
]


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def gradient(w, h):
    """The app's liquid-glass backdrop: deep navy with blue and violet glows."""
    img = Image.new('RGB', (w, h), (20, 24, 54))
    glow = Image.new('RGB', (w, h), (0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((-w * 0.2, -h * 0.4, w * 0.6, h * 0.5), fill=(44, 82, 190))
    d.ellipse((w * 0.5, h * 0.55, w * 1.3, h * 1.4), fill=(96, 60, 200))
    d.ellipse((w * 0.05, h * 0.75, w * 0.55, h * 1.3), fill=(30, 90, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(180))
    return Image.blend(img, glow, 0.55)


def wrap(draw, text, fnt, width):
    lines = []
    for para in text.split('\n'):
        words = para.split()
        line = ''
        for w_ in words:
            trial = (line + ' ' + w_).strip()
            if draw.textlength(trial, font=fnt) <= width:
                line = trial
            else:
                lines.append(line)
                line = w_
        lines.append(line)
    return lines


def card(eyebrow, title, body, path):
    """Right-hand caption panel over the backdrop, with a frosted glass card."""
    bg = gradient(W, H)
    panel = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(panel)
    x0, y0, x1, y1 = 1120, 150, 1880, 930
    d.rounded_rectangle((x0, y0, x1, y1), 36, fill=(255, 255, 255, 26), outline=(255, 255, 255, 70), width=2)
    bg = Image.alpha_composite(bg.convert('RGBA'), panel)
    d = ImageDraw.Draw(bg)
    pad = 56
    tx = x0 + pad
    width = x1 - x0 - 2 * pad
    d.text((tx, y0 + 60), eyebrow, font=font('consolab.ttf', 26), fill=(110, 220, 255))
    y = y0 + 120
    for line in wrap(d, title, font('seguisb.ttf', 52), width):
        d.text((tx, y), line, font=font('seguisb.ttf', 52), fill=(255, 255, 255))
        y += 66
    y += 26
    for line in wrap(d, body, font('segoeuisl.ttf', 31), width):
        d.text((tx, y), line, font=font('segoeuisl.ttf', 31), fill=(220, 228, 255))
        y += 46
    fw = d.textlength(FOOTER, font=font('segoeuisl.ttf', 21))
    d.text((x1 - fw, 975), FOOTER, font=font('segoeuisl.ttf', 21), fill=(170, 180, 220))
    # Brand mark.
    d.text((x0, 70), 'ASTRACAD / SPATIAL', font=font('consolab.ttf', 24), fill=(200, 210, 255))
    bg.convert('RGB').save(path)


def chip(path):
    """Covers the emulator's own toolbar (not part of the app) in the footage's top-right corner."""
    img = Image.new('RGBA', (232, 46), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, 231, 45), 12, fill=(16, 20, 44, 235), outline=(255, 255, 255, 60), width=1)
    d.text((14, 11), 'Meta XR emulator', font=font('seguisb.ttf', 20), fill=(220, 228, 255))
    img.save(path)


def still(path, lines):
    bg = gradient(W, H).convert('RGBA')
    d = ImageDraw.Draw(bg)
    y = lines[0][0]
    for _, text, fnt, size, color in lines:
        f = font(fnt, size)
        if text:
            tw = d.textlength(text, font=f)
            d.text(((W - tw) / 2, y), text, font=f, fill=color)
        y += size + 22
    bg.convert('RGB').save(path)


def run(args):
    r = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y'] + args)
    if r.returncode:
        raise SystemExit(f'ffmpeg failed: {args}')


def scene_clip(name, t0, t1, bg, chip_png, out):
    d = os.path.join(SCN, name)
    times = json.load(open(os.path.join(d, 'times.json')))['times']
    # Variable-rate frames to a concat list with real durations, then to a constant rate.
    lst = os.path.join(WORK, f'{name}.txt')
    with open(lst, 'w', encoding='utf-8', newline='\n') as f:
        for i, (fn, t) in enumerate(times):
            nxt = times[i + 1][1] if i + 1 < len(times) else t + 1 / 30
            f.write(f"file '{os.path.join(d, fn).replace(os.sep, '/')}'\nduration {max(0.001, nxt - t):.4f}\n")
        f.write(f"file '{os.path.join(d, times[-1][0]).replace(os.sep, '/')}'\n")
    dur = t1 - t0
    flt = (f'[0:v]fps={FPS},trim={t0}:{t1},setpts=PTS-STARTPTS,scale=1080:1080[v];'
           f'[1:v][v]overlay=20:0[b];[b][2:v]overlay={20 + 1080 - 232 - 6}:6,'
           f'fade=t=in:st=0:d=0.35,fade=t=out:st={dur - 0.35}:d=0.35,format=yuv420p[o]')
    run(['-f', 'concat', '-safe', '0', '-i', lst, '-loop', '1', '-t', str(dur), '-i', bg, '-i', chip_png,
         '-filter_complex', flt, '-map', '[o]', '-r', str(FPS), '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
         '-t', str(dur), out])


def still_clip(png, dur, out):
    run(['-loop', '1', '-t', str(dur), '-i', png, '-vf',
         f'fps={FPS},fade=t=in:st=0:d=0.5,fade=t=out:st={dur - 0.5}:d=0.5,format=yuv420p',
         '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-t', str(dur), out])


def main():
    os.makedirs(WORK, exist_ok=True)
    chip_png = os.path.join(WORK, 'chip.png')
    chip(chip_png)
    clips = []
    intro = os.path.join(WORK, 'intro.png')
    still(intro, [
        (330, 'ASTRACAD / SPATIAL', 'consolab.ttf', 30, (110, 220, 255)),
        (0, 'Measure the real thing.', 'seguisb.ttf', 84, (255, 255, 255)),
        (0, 'Get the part that fits.', 'seguisb.ttf', 84, (255, 255, 255)),
        (0, '', 'segoeuisl.ttf', 20, (0, 0, 0)),
        (0, 'Hands-first mixed-reality CAD for Meta Quest 3, built with the Immersive Web SDK.', 'segoeuisl.ttf', 34, (220, 228, 255)),
        (0, 'Every shot below is the real app, recorded in Meta\'s XR emulator (IWER) on a PC.', 'segoeuisl.ttf', 28, (170, 180, 220)),
    ])
    clips.append(os.path.join(WORK, 'c00_intro.mp4'))
    still_clip(intro, 5.5, clips[-1])
    for i, (name, t0, t1, eyebrow, title, body) in enumerate(SCENES, 1):
        bg = os.path.join(WORK, f'{name}.png')
        card(eyebrow, title, body, bg)
        out = os.path.join(WORK, f'c{i:02d}_{name}.mp4')
        scene_clip(name, t0, t1, bg, chip_png, out)
        clips.append(out)
        print('scene', name, 'ok')
    outro = os.path.join(WORK, 'outro.png')
    still(outro, [
        (215, 'ASTRACAD / SPATIAL', 'consolab.ttf', 30, (110, 220, 255)),
        (0, 'Verified, not just drawn.', 'seguisb.ttf', 72, (255, 255, 255)),
        (0, '', 'segoeuisl.ttf', 10, (0, 0, 0)),
        (0, 'Runs in Quest Browser. No account, no server; works offline once loaded.', 'segoeuisl.ttf', 32, (220, 228, 255)),
        (0, 'Holds its frame rate: foveation, 90 / 72 Hz, effects thinned under load. Fits Meta VR Glasses\' narrow view.', 'segoeuisl.ttf', 30, (220, 228, 255)),
        (0, 'Honest limits: hand measurements are good to millimetres; stress and flow are design previews.', 'segoeuisl.ttf', 30, (220, 228, 255)),
        (0, '', 'segoeuisl.ttf', 10, (0, 0, 0)),
        (0, 'osmiumuas-wq.github.io/astracad-spatial', 'seguisb.ttf', 40, (255, 255, 255)),
        (0, 'Open source: github.com/osmiumuas-wq/astracad-spatial', 'segoeuisl.ttf', 28, (170, 180, 220)),
    ])
    clips.append(os.path.join(WORK, 'c99_outro.mp4'))
    still_clip(outro, 8.0, clips[-1])
    lst = os.path.join(WORK, 'all.txt')
    with open(lst, 'w', encoding='utf-8', newline='\n') as f:
        for c in clips:
            f.write(f"file '{c.replace(os.sep, '/')}'\n")
    final = os.path.join(VID, 'astracad-spatial-demo.mp4')
    # A silent stereo track keeps every player and upload form happy.
    run(['-f', 'concat', '-safe', '0', '-i', lst, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
         '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', final])
    print('wrote', final)


if __name__ == '__main__':
    main()
