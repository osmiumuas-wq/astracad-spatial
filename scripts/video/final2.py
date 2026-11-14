"""The chaptered competition film, composed from scripts/video/film.json (see film.py for timing).
Every shot is the real app (artifacts/video/scenes/<src>, 1440 px square, recorded in Meta's XR emulator).
Layout: an explainer column on the left (chapter, title, timed bullets, captions, progress) and the footage
on the right, with eased zooms and callouts on what the narration is about.

Usage:
  python scripts/video/final2.py               -> artifacts/video/astracad-spatial-film.mp4
  python scripts/video/final2.py --still 12 40  -> artifacts/video/work/f2_<t>.jpg
  python scripts/video/final2.py --plan         -> prints the timeline
"""
import bisect
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from film import VID, VOICE, timeline  # noqa: E402

FFMPEG = os.environ.get('FFMPEG', r'C:/Users/solid/.local/bin/ffmpeg.exe')
FONTS = r'C:/Windows/Fonts'
W, H, FPS = 1920, 1080, 30
XF = 0.6  # crossfade between chapters, s
CXF = 0.45  # crossfade between clips inside a chapter, s

CHAPTERS, TOTAL = timeline()
CONTENT = [c for c in CHAPTERS if c.get('kind') != 'title']

# Layout.
LX, LW = 110, 660
PX, PY, PS = 850, 60, 960
SRC = 1440

CYAN = (110, 214, 255)
INK = (236, 240, 255)
SOFT = (200, 208, 238)
DIM = (128, 138, 176)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


F_KICK = font('CascadiaMono.ttf', 21)
F_NUM = font('segoeuil.ttf', 112)
F_OF = font('CascadiaMono.ttf', 22)
F_TITLE = font('seguisb.ttf', 58)
F_BIG = font('seguisb.ttf', 112)
F_LEDE = font('segoeuisl.ttf', 36)
F_BUL = font('segoeuisl.ttf', 30)
F_CAP = font('seguisb.ttf', 33)
F_CAPQ = font('seguisbi.ttf', 33)
F_CHIP = font('CascadiaMono.ttf', 17)
F_TAG = font('seguisb.ttf', 22)
F_FOOT = font('segoeuisl.ttf', 21)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def wrap(text, f, width):
    d = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    lines, cur = [], ''
    for word in text.split():
        nxt = (cur + ' ' + word).strip()
        if d.textlength(nxt, font=f) <= width or not cur:
            cur = nxt
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------------------
# Background and frame
# ---------------------------------------------------------------------------

def make_background():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    base = np.zeros((H, W, 3), np.float32)
    top, bottom = np.array([10, 13, 30], np.float32), np.array([5, 6, 15], np.float32)
    base += top + (bottom - top) * (yy / H)[..., None]
    # A soft indigo glow behind the footage, and a faint one behind the text.
    cx, cy = PX + PS / 2, PY + PS / 2
    g = np.exp(-(((xx - cx) / 720) ** 2 + ((yy - cy) / 560) ** 2))[..., None]
    base += g * np.array([34, 30, 92], np.float32)
    g2 = np.exp(-(((xx - 300) / 520) ** 2 + ((yy - 380) / 420) ** 2))[..., None]
    base += g2 * np.array([8, 22, 40], np.float32)
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    # Drop shadow for the footage panel.
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((PX + 6, PY + 18, PX + PS + 6, PY + PS + 22), 34, fill=200)
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    arr = np.asarray(img, np.float32) * (1 - np.asarray(sh, np.float32)[..., None] / 255 * 0.75)
    return arr


BG = make_background()
MASK = Image.new('L', (PS, PS), 0)
ImageDraw.Draw(MASK).rounded_rectangle((0, 0, PS - 1, PS - 1), 26, fill=255)
MASK_A = np.asarray(MASK, np.float32)[..., None] / 255
RIM = Image.new('RGBA', (PS + 4, PS + 4), (0, 0, 0, 0))
ImageDraw.Draw(RIM).rounded_rectangle((0, 0, PS + 3, PS + 3), 28, outline=(255, 255, 255, 46), width=2)


def chip(text, dot=CYAN):
    d = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    tw = int(d.textlength(text, font=F_CHIP))
    img = Image.new('RGBA', (tw + 50, 36), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    dd.rounded_rectangle((0, 0, img.width - 1, 35), 18, fill=(8, 10, 24, 200), outline=(255, 255, 255, 50))
    dd.ellipse((14, 13, 24, 23), fill=dot + (255,))
    dd.text((32, 8), text, font=F_CHIP, fill=(232, 238, 255, 255))
    return img


CHIP_APP = chip('REAL APP  ·  RECORDED IN META\'S XR EMULATOR')
NOTE_CACHE = {}


# ---------------------------------------------------------------------------
# Footage
# ---------------------------------------------------------------------------

class Scene:
    """One recorded take: frames with their capture times; the emulator's toolbar is hidden."""

    def __init__(self, name):
        d = os.path.join(VID, 'scenes', name)
        times = json.load(open(os.path.join(d, 'times.json')))['times']
        self.files = [os.path.join(d, f) for f, _ in times]
        self.t = [t for _, t in times]
        self.idx = -1
        self.img = None

    def image(self, t):
        i = min(len(self.t) - 1, max(0, bisect.bisect_right(self.t, t) - 1))
        if i != self.idx:
            im = Image.open(self.files[i]).convert('RGB')
            if im.size != (SRC, SRC):
                im = im.resize((SRC, SRC), Image.BICUBIC)
            # The emulator's own Runtime/Editor toolbar (top right) is not part of the app.
            patch = im.crop((1150, 0, SRC, 70)).filter(ImageFilter.GaussianBlur(22))
            im.paste(patch, (1150, 0))
            self.idx, self.img = i, im
        return self.img


SCENES = {}


def scene(name):
    if name not in SCENES:
        SCENES[name] = Scene(name)
    return SCENES[name]


def zoom_at(clip, local):
    keys = clip.get('zoom') or [[0, SRC / 2, SRC / 2, SRC]]
    if local <= keys[0][0]:
        return keys[0][1:]
    for a, b in zip(keys, keys[1:]):
        if local <= b[0]:
            u = ease((local - a[0]) / max(1e-6, b[0] - a[0]))
            return [a[k] + (b[k] - a[k]) * u for k in (1, 2, 3)]
    return keys[-1][1:]


def callout_layer(clip, local, box_view):
    """Rounded highlight boxes (with a label tag) drawn in panel coordinates."""
    cx, cy, side = box_view
    x0v, y0v = cx - side / 2, cy - side / 2
    s = PS / side
    out = []
    for c in clip.get('callouts', []):
        a = min(ease((local - c['t0']) / 0.35), ease((c['t1'] - local) / 0.35))
        if a <= 0:
            continue
        x0, y0, x1, y1 = c['box']
        r = ((x0 - x0v) * s, (y0 - y0v) * s, (x1 - x0v) * s, (y1 - y0v) * s)
        out.append((r, c.get('label', ''), a))
    return out


def footage(clip, local):
    sc = scene(clip['src'])
    im = sc.image(clip.get('in', 0) + local)
    cx, cy, side = zoom_at(clip, local)
    side = min(SRC, side)
    cx = min(SRC - side / 2, max(side / 2, cx))
    cy = min(SRC - side / 2, max(side / 2, cy))
    view = im.resize((PS, PS), Image.BICUBIC, box=(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2))
    marks = callout_layer(clip, local, (cx, cy, side))
    if marks:
        view = view.convert('RGBA')
        for (x0, y0, x1, y1), label, a in marks:
            glow = Image.new('RGBA', view.size, (0, 0, 0, 0))
            ImageDraw.Draw(glow).rounded_rectangle((x0, y0, x1, y1), 18, outline=CYAN + (int(170 * a),), width=10)
            view = Image.alpha_composite(view, glow.filter(ImageFilter.GaussianBlur(9)))
            lay = Image.new('RGBA', view.size, (0, 0, 0, 0))
            dl = ImageDraw.Draw(lay)
            dl.rounded_rectangle((x0, y0, x1, y1), 18, outline=CYAN + (int(255 * a),), width=3)
            if label:
                tw = dl.textlength(label, font=F_TAG)
                ty = y0 - 46 if y0 > 50 else y1 + 10
                dl.rounded_rectangle((x0, ty, x0 + tw + 28, ty + 38), 19, fill=(8, 12, 30, int(225 * a)), outline=CYAN + (int(255 * a),), width=2)
                dl.text((x0 + 14, ty + 5), label, font=F_TAG, fill=(255, 255, 255, int(255 * a)))
            view = Image.alpha_composite(view, lay)
        view = view.convert('RGB')
    return np.asarray(view, np.float32)


def chapter_footage(ch, local):
    clips = ch['clips']
    j = max(k for k, c in enumerate(clips) if c['at'] <= local + 1e-9)
    c = clips[j]
    f = footage(c, local - c['at'])
    note = c.get('note')
    if j + 1 < len(clips):
        n = clips[j + 1]
        until = n['at'] - local
        if until < CXF:
            a = ease(1 - until / CXF)
            f = f * (1 - a) + footage(n, 0) * a
            if a > 0.5:
                note = n.get('note')
    return f, note


# ---------------------------------------------------------------------------
# The explainer column
# ---------------------------------------------------------------------------

def cue_time(ch, cue):
    text = ch['narration']
    i = text.find(cue)
    frac = 0 if i < 0 else i / max(1, len(text))
    return ch['voice_at'] - ch['at'] + ch['speech'] * frac - 0.15


def column_static(ch):
    """The parts of the column that do not change within a chapter: kicker, number, title."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((LX, 64), 'ASTRACAD  SPATIAL', font=F_KICK, fill=CYAN + (255,))
    d.text((LX + 236, 64), '·  META QUEST', font=F_KICK, fill=DIM + (255,))
    if ch.get('kind') == 'title':
        y = 220
        for line in ('AstraCAD', 'Spatial'):
            d.text((LX - 6, y), line, font=F_BIG, fill=INK + (255,))
            y += 124
        y += 44
        for line in wrap(ch['kicker'], F_LEDE, LW + 60):
            d.text((LX, y), line, font=F_LEDE, fill=SOFT + (255,))
            y += 48
        y += 30
    else:
        n = CONTENT.index(next(c for c in CONTENT if c['id'] == ch['id'])) + 1
        num = f'{n:02d}'
        d.text((LX - 6, 150), num, font=F_NUM, fill=CYAN + (235,))
        nw = d.textlength(num, font=F_NUM)
        d.text((LX + nw + 12, 222), f'/ {len(CONTENT):02d}', font=F_OF, fill=DIM + (255,))
        y = 300
        for line in wrap(ch['title'], F_TITLE, LW + 40):
            d.text((LX, y), line, font=F_TITLE, fill=INK + (255,))
            y += 72
        y += 18
        d.rounded_rectangle((LX, y, LX + 64, y + 5), 3, fill=CYAN + (255,))
        y += 44
    return img, y


def bullet_image(text, url=False):
    lines = wrap(text, F_BUL, LW - 40)
    img = Image.new('RGBA', (LW, 42 * len(lines) + 6), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((2, 15, 14, 27), fill=CYAN + (255,))
    for k, line in enumerate(lines):
        d.text((36, 42 * k), line, font=F_BUL, fill=(INK if url else SOFT) + (255,))
    return img


COLUMN = {}


def column(ch):
    if ch['id'] not in COLUMN:
        static, y = column_static(ch)
        bullets = []
        for text, cue in ch['bullets']:
            b = bullet_image(text, url=text.startswith('osmiumuas'))
            bullets.append((b, y, cue_time(ch, cue)))
            y += b.height + 20
        COLUMN[ch['id']] = (static, bullets)
    return COLUMN[ch['id']]


def progress_layer(ch):
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    n = len(CONTENT)
    gap = 8
    seg = (LW - gap * (n - 1)) / n
    cur = next((k for k, c in enumerate(CONTENT) if c['id'] == ch['id']), -1 if ch['index'] == 0 else n)
    for k in range(n):
        x0 = LX + k * (seg + gap)
        col = CYAN + (255,) if k == cur else (255, 255, 255, 120) if k < cur else (255, 255, 255, 34)
        d.rounded_rectangle((x0, 1012, x0 + seg, 1017), 2, fill=col)
    return img


PROGRESS = {}


# Captions: each narration line split into short chunks timed by their share of the characters.
def caption_chunks(ch):
    words = ch['narration'].split()
    chunks, cur = [], []
    for w_ in words:
        cur.append(w_)
        n = len(' '.join(cur))
        if (w_.endswith(('.', '?', ':')) and n > 18) or (w_.endswith(',') and n > 40) or n > 62:
            chunks.append(' '.join(cur))
            cur = []
    if cur:
        chunks.append(' '.join(cur))
    total = sum(len(c) for c in chunks)
    t = ch['voice_at']
    out = []
    for c in chunks:
        dd = ch['speech'] * len(c) / total
        out.append((t, t + dd, c, False))
        t += dd
    return out


CAPS = []
for _c in CHAPTERS:
    CAPS += caption_chunks(_c)
    for text, at, dur in _c.get('quotes', []):
        CAPS.append((_c['at'] + at, _c['at'] + at + dur, text, True))
CAPS.sort()
CAP_CACHE = {}


def caption_image(text, quote):
    key = (text, quote)
    if key not in CAP_CACHE:
        f = F_CAPQ if quote else F_CAP
        lines = wrap(text, f, LW)
        img = Image.new('RGBA', (LW + 20, 50 * len(lines) + 20), (0, 0, 0, 0))
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
        for k, line in enumerate(lines):
            ImageDraw.Draw(sh).text((0, 4 + 50 * k), line, font=f, fill=(0, 0, 0, 220))
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(4)))
        d = ImageDraw.Draw(img)
        for k, line in enumerate(lines):
            d.text((0, 2 + 50 * k), line, font=f, fill=((255, 226, 160) if quote else (255, 255, 255)) + (255,))
        CAP_CACHE[key] = img
    return CAP_CACHE[key]


FOOT = None


def footer_image():
    global FOOT
    if FOOT is None:
        img = Image.new('RGBA', (LW + 20, 110), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        text = ('Footage: the real app, recorded in Meta\'s XR emulator (IWER) on a PC with scripted hand and head '
                'input. Not yet filmed on a headset. Narration: synthetic voice. Music: original.')
        for k, line in enumerate(wrap(text, F_FOOT, LW)):
            d.text((0, 30 * k), line, font=F_FOOT, fill=DIM + (255,))
        FOOT = img
    return FOOT


def paste(base, img, x, y, alpha=1.0):
    """Alpha-blend an RGBA PIL image into a float32 HxWx3 array."""
    if alpha <= 0:
        return base
    a = np.asarray(img, np.float32)
    h, w = a.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return base
    s = a[y0 - y:y1 - y, x0 - x:x1 - x]
    m = s[..., 3:4] / 255 * alpha
    base[y0:y1, x0:x1] = base[y0:y1, x0:x1] * (1 - m) + s[..., :3] * m
    return base


# ---------------------------------------------------------------------------
# A frame
# ---------------------------------------------------------------------------

def chapter_frame(ch, local, t):
    f = BG.copy()
    shot, note = chapter_footage(ch, local)
    region = f[PY:PY + PS, PX:PX + PS]
    f[PY:PY + PS, PX:PX + PS] = region * (1 - MASK_A) + shot * MASK_A
    f = paste(f, RIM, PX - 2, PY - 2)
    f = paste(f, CHIP_APP, PX, PY - 46)
    if note:
        if note not in NOTE_CACHE:
            NOTE_CACHE[note] = chip(note, dot=(255, 196, 92))
        f = paste(f, NOTE_CACHE[note], PX, PY + PS + 10)
    static, bullets = column(ch)
    # Title and number ease in at the start of the chapter.
    a_in = ease((local - 0.1) / 0.6)
    f = paste(f, static, 0, int(14 * (1 - a_in)), a_in)
    for img, y, at in bullets:
        a = ease((local - at) / 0.45)
        if a > 0:
            f = paste(f, img, LX, y + int(16 * (1 - a)), a)
    if ch['id'] not in PROGRESS:
        PROGRESS[ch['id']] = progress_layer(ch)
    f = paste(f, PROGRESS[ch['id']], 0, 0)
    return f


def captions(f, t, ch):
    if ch['id'] == 'outro' and t > ch['voice_at'] + ch['speech'] + 0.3:
        a = ease((t - (ch['voice_at'] + ch['speech'] + 0.3)) / 0.6)
        return paste(f, footer_image(), LX, 880, a)
    for s0, s1, text, quote in CAPS:
        if s0 - 0.12 <= t <= s1 + 0.12:
            a = min(1, (t - s0 + 0.12) / 0.15, (s1 + 0.12 - t) / 0.15)
            img = caption_image(text, quote)
            return paste(f, img, LX, 990 - img.height, a)
    return f


def frame_at(t):
    i = max(k for k, c in enumerate(CHAPTERS) if c['at'] <= t + 1e-9)
    ch = CHAPTERS[i]
    local = t - ch['at']
    f = chapter_frame(ch, local, t)
    if i + 1 < len(CHAPTERS):
        nxt = CHAPTERS[i + 1]
        until = nxt['at'] - t
        if until < XF:
            a = ease(1 - until / XF)
            f = f * (1 - a) + chapter_frame(nxt, 0.0, t) * a
    f = captions(f, t, ch)
    f *= min(1.0, t / 1.0, (TOTAL - t) / 1.6)
    return f


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
    n = int(TOTAL * sr)
    music, _ = sf.read(os.path.join(VID, 'audio', 'music2.wav'), dtype='float32', always_2d=True)
    music = np.pad(music, ((0, max(0, n - len(music))), (0, 0)))[:n]
    voice = np.zeros(n, np.float32)
    active = np.zeros(n, np.float32)
    for ch in CHAPTERS:
        v = load48(os.path.join(VOICE, f"{ch['id']}.wav"))
        i = int(ch['voice_at'] * sr)
        j = min(n, i + len(v))
        voice[i:j] += v[:j - i]
        active[i:j] = 1
        for name, at, gain in ch.get('audio', []):
            s = load48(os.path.join(VID, name)) * gain
            i = int((ch['at'] + at) * sr)
            j = min(n, i + len(s))
            voice[i:j] += s[:j - i]
            active[i:j] = 1
    k = int(0.4 * sr)
    env = np.convolve(active, np.ones(k) / k, mode='same')
    gain = 1 - 0.72 * np.clip(env * 1.4, 0, 1)
    voice /= max(1e-6, np.max(np.abs(voice))) / 0.9
    mix = music * gain[:, None] * 0.6 + voice[:, None] * 0.95
    mix /= max(1e-6, np.max(np.abs(mix))) / 0.95
    sf.write(path, mix, sr)


def main():
    audio = os.path.join(VID, 'audio', 'mix2.wav')
    sound(audio)
    out = os.path.join(VID, 'astracad-spatial-film.mp4')
    cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-i', audio,
           '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-tune', 'film',
           '-af', 'loudnorm=I=-14:TP=-1.0:LRA=9', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
           '-movflags', '+faststart', '-shortest', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = int(round(TOTAL * FPS))
    for k in range(n):
        f = frame_at(k / FPS)
        p.stdin.write(np.clip(f, 0, 255).astype(np.uint8).tobytes())
        if k % 150 == 0:
            print(f'frame {k}/{n}', flush=True)
    p.stdin.close()
    p.wait()
    print('wrote', out, p.returncode, 'total', TOTAL)


def stills(times):
    os.makedirs(os.path.join(VID, 'work'), exist_ok=True)
    for t in times:
        f = frame_at(t)
        Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).save(os.path.join(VID, 'work', f'f2_{t}.jpg'), quality=92)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--plan':
        for c in CHAPTERS:
            print(f"{c['at']:7.2f} {c['dur']:6.2f} voice {c['voice_at']:7.2f} +{c['speech']:5.2f}  {c['id']}  clips " +
                  ', '.join(f"{k['src']}@{k.get('in', 0)}+{k['dur']:.1f}" for k in c['clips']))
        print('total', TOTAL)
    elif len(sys.argv) > 2 and sys.argv[1] == '--still':
        stills([float(x) for x in sys.argv[2:]])
    else:
        main()
