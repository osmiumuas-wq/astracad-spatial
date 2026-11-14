"""Final cut of the competition video, from scripts/video/edl.json:
Blender renders (artifacts/video/blender/<shot>/f####.png), real app footage (artifacts/video/scenes/<scene>/),
narration (artifacts/video/voice/*.wav), score (artifacts/video/audio/music.wav).
Every frame is composed here (crossfades, framing, labels, subtitles, titles) and piped to ffmpeg.
Usage: python scripts/video/final.py   -> artifacts/video/astracad-spatial-film.mp4
"""
import bisect
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VID = os.path.join(ROOT, 'artifacts', 'video')
FFMPEG = os.environ.get('FFMPEG', r'C:/Users/solid/.local/bin/ffmpeg.exe')
FONTS = r'C:/Windows/Fonts'
W, H, FPS = 1920, 1080, 30
XF = 0.5  # crossfade seconds
EDL = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'edl.json'), encoding='utf-8'))
LINES = dict(json.load(open(os.path.join(ROOT, 'scripts', 'video', 'narration.json'), encoding='utf-8')))
DUR = json.load(open(os.path.join(VID, 'voice', 'durations.json')))


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


F_SUB = font('seguisb.ttf', 40)
F_CHIP = font('consolab.ttf', 19)
F_TITLE = font('seguisb.ttf', 118)
F_TSUB = font('segoeuisl.ttf', 40)


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

class Blender:
    def __init__(self, shot):
        d = os.path.join(VID, 'blender', shot)
        self.files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.png'))
        self.cache = {}

    def frame(self, t):
        i = min(len(self.files) - 1, max(0, int(round(t * FPS))))
        if i not in self.cache:
            self.cache = {i: np.asarray(Image.open(self.files[i]).convert('RGB'), dtype=np.float32)}
        return self.cache[i]


class AppScene:
    """Square 1080 footage on a blurred, darkened copy of itself, in a rounded frame with a soft shadow."""

    def __init__(self, scene):
        d = os.path.join(VID, 'scenes', scene)
        times = json.load(open(os.path.join(d, 'times.json')))['times']
        self.files = [os.path.join(d, f) for f, _ in times]
        self.t = [t for _, t in times]
        self.cache = {}
        mask = Image.new('L', (1080, 1080), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1079, 1079), 34, fill=255)
        self.mask = mask
        shadow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(shadow).rounded_rectangle((420 + 8, 18, 420 + 1080 + 8, 1080 + 30), 40, fill=170)
        self.shadow = np.asarray(shadow.filter(ImageFilter.GaussianBlur(28)), dtype=np.float32)[..., None] / 255

    def frame(self, t):
        i = max(0, bisect.bisect_right(self.t, t) - 1)
        if i in self.cache:
            return self.cache[i]
        src = Image.open(self.files[i]).convert('RGB').resize((1080, 1080))
        bg = src.resize((192, 108), Image.BILINEAR).filter(ImageFilter.GaussianBlur(6)).resize((W, H), Image.BILINEAR)
        bg = np.asarray(bg, dtype=np.float32) * 0.32
        bg = bg * (1 - self.shadow * 0.85)
        canvas = Image.fromarray(bg.astype(np.uint8))
        # Hide the emulator's own toolbar (not part of the app) in the footage's top-right corner.
        fg = src.copy()
        patch = src.crop((800, 0, 1080, 90)).filter(ImageFilter.GaussianBlur(18)).crop((40, 0, 280, 52))
        fg.paste(patch, (840, 0))
        canvas.paste(fg, (420, 0), self.mask)
        arr = np.asarray(canvas, dtype=np.float32)
        self.cache = {i: arr}
        return arr


def card_credits():
    img = Image.new('RGB', (W, H), (8, 9, 18))
    d = ImageDraw.Draw(img)
    lines = [
        ('ASTRACAD / SPATIAL', font('consolab.ttf', 28), (110, 220, 255), 250),
        ('Made for the Meta VR Start Developer Competition 2026', font('seguisb.ttf', 40), (255, 255, 255), 320),
        ('App footage: the real app, recorded in Meta\'s XR emulator (IWER) on a PC with scripted hand and head input.', font('segoeuisl.ttf', 28), (200, 208, 235), 430),
        ('Not yet filmed on a headset. The voice scene feeds a synthesised recording to the on-device recogniser.', font('segoeuisl.ttf', 28), (200, 208, 235), 475),
        ('Product shots: rendered in Blender from the parts the app exported, each verified by its truth gate.', font('segoeuisl.ttf', 28), (200, 208, 235), 520),
        ('Narration: synthetic voice (Kokoro TTS). Music: original, synthesised for this film.', font('segoeuisl.ttf', 28), (200, 208, 235), 565),
        ('Honest limits: hand measurements are good to millimetres; stress and flow are design previews.', font('segoeuisl.ttf', 28), (200, 208, 235), 610),
        ('osmiumuas-wq.github.io/astracad-spatial', font('seguisb.ttf', 44), (255, 255, 255), 720),
        ('Open source  ·  github.com/osmiumuas-wq/astracad-spatial', font('segoeuisl.ttf', 28), (160, 172, 210), 785),
    ]
    for text, f, color, y in lines:
        tw = d.textlength(text, font=f)
        d.text(((W - tw) / 2, y), text, font=f, fill=color)
    return np.asarray(img, dtype=np.float32)


class Card:
    def __init__(self, arr):
        self.arr = arr

    def frame(self, t):
        return self.arr


# ---------------------------------------------------------------------------
# Overlays
# ---------------------------------------------------------------------------

def chip_image(text):
    pad = 14
    tmp = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    tw = int(tmp.textlength(text, font=F_CHIP))
    img = Image.new('RGBA', (tw + pad * 2 + 18, 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, img.width - 1, 39), 20, fill=(10, 12, 28, 190), outline=(255, 255, 255, 60))
    d.ellipse((pad, 15, pad + 10, 25), fill=(110, 220, 255, 255) if 'APP' in text else (170, 140, 255, 255))
    d.text((pad + 18, 9), text, font=F_CHIP, fill=(230, 236, 255, 255))
    return img


CHIP_APP = chip_image('REAL APP  ·  META XR EMULATOR')
CHIP_RENDER = chip_image('RENDER  ·  BLENDER  ·  FROM THE APP\'S EXPORTED PART')


def subtitle_chunks():
    """Split each narration line into short caption chunks, timed by their share of the words."""
    out = []
    for name, at in EDL['voice']:
        words = LINES[name].replace(' S T L', ' STL').replace('three M F', '3MF').replace('three-D', '3D').split()
        chunks, cur = [], []
        for w_ in words:
            cur.append(w_)
            n = len(' '.join(cur))
            if (w_.endswith(('.', ',', '?')) and n > 14) or n > 44:
                chunks.append(' '.join(cur))
                cur = []
        if cur:
            chunks.append(' '.join(cur))
        total = sum(len(c) for c in chunks)
        t = at
        for c in chunks:
            d = DUR[name] * len(c) / total
            out.append((t, t + d, c))
            t += d
    return out


SUBS = subtitle_chunks()
SUB_CACHE = {}


def subtitle_image(text):
    if text in SUB_CACHE:
        return SUB_CACHE[text]
    tmp = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
    tw = int(tmp.textlength(text, font=F_SUB))
    img = Image.new('RGBA', (tw + 60, 80), (0, 0, 0, 0))
    pill = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle((6, 8, img.width - 7, 72), 30, fill=(6, 8, 20, 150))
    img = Image.alpha_composite(img, pill.filter(ImageFilter.GaussianBlur(2)))
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((30, 18), text, font=F_SUB, fill=(0, 0, 0, 200))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(5)))
    ImageDraw.Draw(img).text((30, 16), text, font=F_SUB, fill=(255, 255, 255, 255))
    SUB_CACHE[text] = img
    return img


def title_image(title, sub):
    img = Image.new('RGBA', (W, 400), (0, 0, 0, 0))
    # A soft dark backdrop so the title reads over the parts.
    back = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(back).ellipse((W / 2 - 620, 40, W / 2 + 620, 330), fill=(2, 3, 10, 170))
    img = Image.alpha_composite(img, back.filter(ImageFilter.GaussianBlur(60)))
    d = ImageDraw.Draw(img)
    tw = d.textlength(title, font=F_TITLE)
    glow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).text(((W - tw) / 2, 70), title, font=F_TITLE, fill=(90, 140, 255, 160))
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(22)))
    d = ImageDraw.Draw(img)
    d.text(((W - tw) / 2, 70), title, font=F_TITLE, fill=(255, 255, 255, 255))
    sw = d.textlength(sub, font=F_TSUB)
    d.text(((W - sw) / 2, 232), sub, font=F_TSUB, fill=(200, 212, 255, 255))
    return img


def overlay(base, img, x, y, alpha):
    if alpha <= 0:
        return base
    a = np.asarray(img, dtype=np.float32)
    h, w = a.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return base
    sub = a[y0 - y:y1 - y, x0 - x:x1 - x]
    m = sub[..., 3:4] / 255 * alpha
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - m) + sub[..., :3] * m
    return base


def ease(x):
    x = min(1, max(0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------------------
# Picture
# ---------------------------------------------------------------------------

def clip_frame(clip, src, local):
    f = src.frame(clip.get('in', 0) + local).copy()
    if clip['kind'] == 'app':
        f = overlay(f, CHIP_APP, 40, 36, 1)
    elif clip['kind'] == 'blender':
        f = overlay(f, CHIP_RENDER, 40, 36, 1)
        # A gentle vignette for the renders.
        f *= VIGNETTE
    if clip.get('title'):
        t0 = clip.get('title_at', 0.5)
        a = ease((local - t0) / 1.0) * (1 - ease((local - (clip['dur'] - 0.7)) / 0.7)) if clip is not EDL['clips'][-2] else ease((local - t0) / 1.2)
        f = overlay(f, TITLES[id(clip)], 0, 340, a)
    return f


yy, xx = np.mgrid[0:H, 0:W]
VIGNETTE = (1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) ** 1.2).clip(0.45, 1)[..., None].astype(np.float32)
TITLES = {}


def picture(pipe):
    clips = EDL['clips']
    sources = []
    for c in clips:
        if c['kind'] == 'blender':
            sources.append(Blender(c['src']))
        elif c['kind'] == 'app':
            sources.append(AppScene(c['src']))
        else:
            sources.append(Card(card_credits()))
        if c.get('title'):
            TITLES[id(c)] = title_image(c['title'], c['subtitle'])
    total = EDL['total']
    n = int(round(total * FPS))
    for k in range(n):
        t = k / FPS
        # Current clip, and the next one during the last XF seconds (crossfade).
        idx = max(i for i, c in enumerate(clips) if c['at'] <= t + 1e-9)
        c = clips[idx]
        local = t - c['at']
        frame = clip_frame(c, sources[idx], local)
        if idx + 1 < len(clips) and local > c['dur'] - XF:
            nxt = clips[idx + 1]
            a = ease((local - (c['dur'] - XF)) / XF)
            frame = frame * (1 - a) + clip_frame(nxt, sources[idx + 1], 0) * a
        # Fade from and to black at the very start and end.
        frame *= min(1, t / 1.2, (total - t) / 1.5)
        for s0, s1, text in SUBS:
            if s0 - 0.12 <= t <= s1 + 0.12:
                img = subtitle_image(text)
                a = min(1, (t - s0 + 0.12) / 0.15, (s1 + 0.12 - t) / 0.15)
                frame = overlay(frame, img, (W - img.width) // 2, 950, a)
                break
        pipe.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
        if k % 150 == 0:
            print(f'frame {k}/{n}', flush=True)


# ---------------------------------------------------------------------------
# Sound
# ---------------------------------------------------------------------------

def load48(path):
    data, sr = sf.read(path, dtype='float32', always_2d=True)
    data = data.mean(axis=1)
    if sr != 48000:
        x = np.arange(len(data)) / sr
        xn = np.arange(int(len(data) * 48000 / sr)) / 48000
        data = np.interp(xn, x, data).astype(np.float32)
    return data


def sound(path):
    sr = 48000
    total = EDL['total']
    n = int(total * sr)
    music, _ = sf.read(os.path.join(VID, 'audio', 'music.wav'), dtype='float32', always_2d=True)
    music = music[:n]
    voice = np.zeros(n, dtype=np.float32)
    active = np.zeros(n, dtype=np.float32)
    for name, at in EDL['voice']:
        v = load48(os.path.join(VID, 'voice', f'{name}.wav'))
        i = int(at * sr)
        j = min(n, i + len(v))
        voice[i:j] += v[:j - i]
        active[i:j] = 1
    # Duck the music under the voice: smooth 0.35 s ramps down to 30 %.
    k = int(0.35 * sr)
    kernel = np.ones(k) / k
    env = np.convolve(active, kernel, mode='same')
    gain = 1 - 0.7 * np.clip(env * 1.4, 0, 1)
    voice /= max(1e-6, np.max(np.abs(voice))) / 0.9
    mix = music * gain[:, None] * 0.55 + voice[:, None] * 0.95
    mix /= max(1e-6, np.max(np.abs(mix))) / 0.95
    sf.write(path, mix, sr)


def main():
    audio = os.path.join(VID, 'audio', 'mix.wav')
    sound(audio)
    out = os.path.join(VID, 'astracad-spatial-film.mp4')
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', audio,
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-tune', 'film',
           '-af', 'loudnorm=I=-14:TP=-1.0:LRA=9', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
           '-movflags', '+faststart', '-shortest', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    picture(p.stdin)
    p.stdin.close()
    p.wait()
    print('wrote', out, p.returncode)


def stills(times):
    """Write single composed frames (for checking) to artifacts/video/work/final_<t>.jpg."""
    clips = EDL['clips']
    os.makedirs(os.path.join(VID, 'work'), exist_ok=True)
    for t in times:
        idx = max(i for i, c in enumerate(clips) if c['at'] <= t + 1e-9)
        c = clips[idx]
        src = Blender(c['src']) if c['kind'] == 'blender' else AppScene(c['src']) if c['kind'] == 'app' else Card(card_credits())
        if c.get('title'):
            TITLES[id(c)] = title_image(c['title'], c['subtitle'])
        frame = clip_frame(c, src, t - c['at'])
        for s0, s1, text in SUBS:
            if s0 <= t <= s1:
                img = subtitle_image(text)
                frame = overlay(frame, img, (W - img.width) // 2, 950, 1)
        Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).save(os.path.join(VID, 'work', f'final_{t}.jpg'), quality=90)


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--still':
        stills([float(x) for x in sys.argv[2:]])
    else:
        main()
