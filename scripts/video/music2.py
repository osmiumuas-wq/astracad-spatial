"""Original score for the chaptered film (synthesised, nothing sampled or licensed), timed to film.py:
warm pads in D, a sub, a soft plucked pulse, a light chime at each chapter, and a lift into the closing title.
Usage: python scripts/video/music2.py  -> artifacts/video/audio/music2.wav (48 kHz stereo)
"""
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from film import SUFFIX, VID, timeline  # noqa: E402
from music import BAR, BEAT, CHORDS, FINAL, SR, pad_layer, pluck, reverb, riser, sub  # noqa: E402


def chime(at, midi, gain):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    f = 440.0 * 2 ** ((midi - 69) / 12)
    s = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t / 0.25))
    s *= np.exp(-t / 0.9) * np.minimum(1, t / 0.006) * gain
    return int(at * SR), s * 0.8, s * 1.0


def main():
    chapters, total = timeline()
    n = int(total * SR)
    L = np.zeros(n + SR * 8)
    R = np.zeros(n + SR * 8)

    def add(item):
        i, left, right = item
        j = min(len(L), i + len(left))
        L[i:j] += left[:j - i]
        R[i:j] += right[:j - i]

    outro = chapters[-1]['at']
    first = chapters[1]['at']

    # Opening: a slow swell on D under the title.
    add(pad_layer(0.0, first, [38, 50, 57, 62, 64], 0.09, cutoff=900, attack=3.0, release=1.6))
    add(sub(0.0, first, 38, 0.08))

    # The chord cycle through the chapters, two bars a chord.
    t, i = first - 0.4, 0
    while t < outro:
        end = min(outro, t + 2 * BAR)
        chord = CHORDS[i % 4]
        add(pad_layer(t, end, chord, 0.075, cutoff=1900, attack=1.4, release=1.4))
        add(sub(t, end, chord[0], 0.09))
        t, i = end, i + 1

    # A soft eighth-note pulse on chord tones.
    t, k = first, 0
    while t < outro - 0.3:
        idx = int((t - first + 0.4) // (2 * BAR))
        chord = CHORDS[idx % 4]
        pattern = [chord[2] + 12, chord[3] + 12, chord[4] + 12, chord[3] + 12]
        add(pluck(t, pattern[k % 4], 0.022))
        t += BEAT / 2
        k += 1

    # A light chime as each chapter's title comes in.
    for ch in chapters[1:-1]:
        add(chime(ch['at'] + 0.1, 86 if ch['index'] % 2 else 81, 0.03))

    # The close: a riser, then D major, ringing out.
    add(riser(outro, 3.0, 0.03))
    add(pad_layer(outro, total + 4, FINAL, 0.1, cutoff=3000, attack=1.0, release=4.0))
    add(sub(outro, total + 3, 38, 0.1))
    for j, m in enumerate([69, 74, 76, 78, 81]):
        add(pluck(outro + 0.5 + j * 0.45, m + 12, 0.04, decay=0.9))

    L, R = reverb(L), reverb(R)
    out = np.stack([L, R], axis=1)[:n]
    fade = int(3.5 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5
    out[:int(0.8 * SR)] *= np.linspace(0, 1, int(0.8 * SR))[:, None]
    out /= np.max(np.abs(out)) / 0.89
    os.makedirs(os.path.join(VID, 'audio'), exist_ok=True)
    sf.write(os.path.join(VID, 'audio', f'music{SUFFIX}.wav'), out.astype(np.float32), SR)
    print('music2', round(len(out) / SR, 2), 's')


if __name__ == '__main__':
    main()
