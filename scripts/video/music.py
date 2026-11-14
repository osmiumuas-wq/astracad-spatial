"""Original score for the demo video, synthesised from scratch (no samples, nothing licensed):
pads, a sub bass, a soft plucked pulse, noise risers and low impact hits, timed to scripts/video/edl.json.
Usage: python scripts/video/music.py  -> artifacts/video/audio/music.wav (48 kHz stereo)
"""
import json
import os

import numpy as np
import soundfile as sf

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EDL = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'edl.json'), encoding='utf-8'))
TOTAL = EDL['total']
N = int(TOTAL * SR)
rng = np.random.default_rng(7)

BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# D minor world: Dm9, Bbmaj7, Fmaj7(add9), C6/9; the finale resolves to Dmaj9 (a lift).
CHORDS = [
    [38, 50, 57, 60, 64, 65],   # Dm9  (D2 D3 A3 C4 E4 F4)
    [34, 46, 53, 57, 62, 65],   # Bbmaj7
    [41, 53, 57, 60, 64, 67],   # Fmaj9
    [36, 48, 55, 57, 62, 64],   # C6/9
]
FINAL = [38, 50, 57, 61, 64, 66]  # Dmaj9


def env_adsr(n, a, r):
    e = np.ones(n)
    na = min(n, int(a * SR))
    nr = min(n - na, int(r * SR))
    # Equal-power curves, so overlapping chords crossfade without a dip.
    if na:
        e[:na] = np.sin(np.linspace(0, np.pi / 2, na))
    if nr:
        e[n - nr:] *= np.cos(np.linspace(0, np.pi / 2, nr))
    return e


def soft_saw(f, t, harmonics=10, detune=0.0):
    out = np.zeros_like(t)
    for k in range(1, harmonics + 1):
        if f * k > 9000:
            break
        out += np.sin(2 * np.pi * f * k * (1 + detune) * t + k * 0.7) / k ** 1.25
    return out


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):  # small arrays only (per chord), fine in numpy-less loop? use lfilter-like vectorised below
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lowpass_fast(x, cutoff):
    # One-pole low-pass via FFT-domain response (fast, zero-phase-ish for pads).
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    H = 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X * H, len(x))


def pad_layer(start, end, chord, gain, cutoff=1400, attack=1.6, release=2.2):
    n = int((end - start + release) * SR)
    t = np.arange(n) / SR
    left = np.zeros(n)
    right = np.zeros(n)
    for i, m in enumerate(chord):
        f = hz(m)
        amp = 0.55 if m < 45 else 0.32
        left += amp * soft_saw(f, t, detune=-0.0025 + 0.0004 * i)
        right += amp * soft_saw(f, t, detune=0.0025 - 0.0004 * i)
    e = env_adsr(n, attack, release + 0.4)
    left = lowpass_fast(left, cutoff) * e * gain
    right = lowpass_fast(right, cutoff) * e * gain
    return int(start * SR), left, right


def sub(start, end, midi, gain):
    n = int((end - start + 1.0) * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * hz(midi - 12) * t) * env_adsr(n, 0.8, 1.2) * gain
    return int(start * SR), s, s


def pluck(start, midi, gain, decay=0.35):
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t))
    s *= np.exp(-t / decay) * np.minimum(1, t / 0.004) * gain
    pan = 0.5 + 0.35 * np.sin(start * 1.7)
    return int(start * SR), s * (1 - pan) * 1.4, s * pan * 1.4


def riser(end, length, gain):
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # Sweep a band-pass upwards by filtering in chunks.
    out = np.zeros(n)
    chunk = 2048
    for i in range(0, n, chunk):
        frac = i / n
        seg = noise[i:i + chunk]
        cut = 300 + 7000 * frac ** 2
        out[i:i + chunk] = lowpass_fast(np.concatenate([seg, np.zeros(chunk)]), cut)[:len(seg)]
    out *= (t / length) ** 2.2 * gain
    return int((end - length) * SR), out, out[::-1] * 0 + out


def hit(at, gain):
    n = int(4.0 * SR)
    t = np.arange(n) / SR
    f = 75 * np.exp(-t * 1.8) + 38
    phase = 2 * np.pi * np.cumsum(f) / SR
    boom = np.sin(phase) * np.exp(-t / 1.1)
    click = rng.standard_normal(n) * np.exp(-t / 0.012) * 0.25
    s = (boom + lowpass_fast(click, 2500)) * gain
    return int(at * SR), s, s


def reverb(x, seconds=3.2, mix=0.32):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t / (seconds / 6.9))
    ir = lowpass_fast(ir, 6000)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    return x * (1 - mix) + wet * mix * 1.6


def main():
    L = np.zeros(N + SR * 6)
    R = np.zeros(N + SR * 6)

    def add(item):
        i, l, r = item
        j = min(len(L), i + len(l))
        L[i:j] += l[: j - i]
        R[i:j] += r[: j - i]

    marks = {c['src'] + ('_end' if i == 13 else ''): c['at'] for i, c in enumerate(EDL['clips'])}
    at = lambda src, nth=0: [c['at'] for c in EDL['clips'] if c['src'] == src][nth]
    title = at('finale', 0)
    act1 = at('arrive')
    lift = at('hero_handle')
    test = at('test')
    lineup = at('lineup')
    finale = at('finale', 1)
    credits = at('credits')

    # Cold open: a dark drone on D, opening slowly.
    add(pad_layer(0.0, title, [38, 50, 57, 62], 0.10, cutoff=650, attack=4.0, release=1.5))
    add(sub(0.0, title, 38, 0.10))
    add(riser(title, 4.5, 0.05))
    add(hit(title, 0.55))

    # Chord cycle from the title to the finale, one chord per two bars.
    t = title
    i = 0
    while t < finale:
        end = min(finale, t + 2 * BAR)
        chord = CHORDS[i % 4]
        bright = 1600 if t < lift else 2600
        g = 0.085 if t < test else 0.10
        add(pad_layer(t - 0.6 if t > title else t, end, chord, g, cutoff=bright, attack=1.4, release=1.4))
        add(sub(t, end, chord[0], 0.11))
        t = end
        i += 1

    # Plucked pulse from the first app scene: eighth notes on chord tones, quieter under narration.
    t = act1
    k = 0
    while t < finale - 0.2:
        bar_index = int((t - title) // (2 * BAR))
        chord = CHORDS[bar_index % 4]
        pattern = [chord[2] + 12, chord[3] + 12, chord[4] + 12, chord[3] + 12]
        gain = 0.045 if (lift <= t < test) or t >= lineup else 0.03
        add(pluck(t, pattern[k % 4], gain))
        t += BEAT / 2
        k += 1

    # The hero shots (no narration): a lift with a riser into the test.
    add(riser(test, 3.0, 0.03))
    add(hit(lift, 0.25))
    add(riser(finale, 5.0, 0.055))
    add(hit(finale, 0.6))

    # Finale: resolve to D major and let it ring through the credits.
    add(pad_layer(finale, credits + 7.0, FINAL, 0.12, cutoff=3200, attack=0.8, release=4.0))
    add(sub(finale, credits + 6.0, 38, 0.12))
    for j, m in enumerate([69, 74, 76, 78, 81]):
        add(pluck(finale + 0.4 + j * 0.42, m + 12, 0.05, decay=0.9))

    L = reverb(L)
    R = reverb(R[::-1])[::-1] * 0 + reverb(R)
    out = np.stack([L, R], axis=1)[:N]
    # Fade out over the credits' last 3 s; normalise to -1 dBFS peak.
    fade = int(3.0 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    out /= np.max(np.abs(out)) / 0.89
    os.makedirs(os.path.join(ROOT, 'artifacts', 'video', 'audio'), exist_ok=True)
    sf.write(os.path.join(ROOT, 'artifacts', 'video', 'audio', 'music.wav'), out.astype(np.float32), SR)
    print('music', round(len(out) / SR, 2), 's')


if __name__ == '__main__':
    main()
