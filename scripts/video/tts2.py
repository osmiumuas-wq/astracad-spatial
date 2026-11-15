"""Narration for the chaptered film: one take per chapter from scripts/video/film.json, with Kokoro
(kokoro-onnx, voice af_heart), into artifacts/video/voice2/<id>.wav plus durations.json.
Model files: artifacts/video/tts/kokoro-v1.0.onnx and voices-v1.0.bin.
Usage: python scripts/video/tts2.py [ids...]
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from film import FILM, VID, VOICE  # noqa: E402

SPEED = 0.89
# How some words are said (the captions keep the written form).
SAY = [('AstraCAD', 'Astra CAD'), ('3MF', 'three M F'), ('STL', 'S T L'), ('CalculiX', 'Calculix'),
       ('re-tested', 'retested'), ("agent's", "agent's"), ('NACA', 'Nacka'), ('DXF', 'D X F'), ('GD&T', 'G D and T'),
       ('SOLIDWORKS', 'Solid Works'), ('CATIA', 'Catia'), ('G-code', 'G code'), ('ISO', 'I S O'), ('STEP', 'step')]


def spoken(text):
    for a, b in SAY:
        text = text.replace(a, b)
    return text


def main(ids):
    k = Kokoro(os.path.join(VID, 'tts', 'kokoro-v1.0.onnx'), os.path.join(VID, 'tts', 'voices-v1.0.bin'))
    os.makedirs(VOICE, exist_ok=True)
    path = os.path.join(VOICE, 'durations.json')
    out = json.load(open(path)) if os.path.exists(path) else {}
    for ch in FILM['chapters']:
        if ids and ch['id'] not in ids:
            continue
        samples, rate = k.create(spoken(ch['narration']), voice='af_heart', speed=SPEED, lang='en-us')
        # Trim leading and trailing silence, keep 60 ms.
        loud = np.where(np.abs(samples) > 0.01)[0]
        pad = int(0.06 * rate)
        samples = samples[max(0, loud[0] - pad):loud[-1] + pad]
        sf.write(os.path.join(VOICE, f"{ch['id']}.wav"), samples, rate)
        out[ch['id']] = round(len(samples) / rate, 2)
        print(ch['id'], out[ch['id']], flush=True)
    json.dump(out, open(path, 'w'), indent=1)
    print('speech total', round(sum(out.values()), 1))


if __name__ == '__main__':
    main(sys.argv[1:])
