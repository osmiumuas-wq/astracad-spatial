"""Timeline for the chaptered film, from scripts/video/film.json and the narration's measured lengths
(artifacts/video/voice2/durations.json). Shared by final2.py (picture and mix) and music2.py (score).
Each chapter lasts lead + speech + tail; its clips fill it in order (the last clip takes what is left).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VID = os.path.join(ROOT, 'artifacts', 'video')
FILM = json.load(open(os.path.join(ROOT, 'scripts', 'video', 'film.json'), encoding='utf-8'))
VOICE = os.path.join(VID, 'voice2')

LEAD = 0.9
TAIL = 1.5
FIRST_LEAD = 1.4
LAST_TAIL = 5.0


def durations():
    return json.load(open(os.path.join(VOICE, 'durations.json'), encoding='utf-8'))


def timeline():
    dur = durations()
    chapters = FILM['chapters']
    t = 0.0
    out = []
    for i, ch in enumerate(chapters):
        lead = ch.get('lead', FIRST_LEAD if i == 0 else LEAD)
        tail = ch.get('tail', LAST_TAIL if i == len(chapters) - 1 else TAIL)
        speech = dur[ch['id']]
        length = round(lead + speech + tail, 2)
        c = dict(ch)
        c.update(at=round(t, 2), dur=length, voice_at=round(t + lead, 2), speech=speech, index=i)
        # Clips, in chapter-local time.
        clips = []
        local = 0.0
        for j, clip in enumerate(ch['clips']):
            k = dict(clip)
            k['at'] = local
            k['dur'] = clip.get('dur', length - local) if j < len(ch['clips']) - 1 else length - local
            local += k['dur']
            clips.append(k)
        c['clips'] = clips
        out.append(c)
        t += length
    return out, round(t, 2)


if __name__ == '__main__':
    chs, total = timeline()
    for c in chs:
        print(f"{c['at']:7.2f}  {c['dur']:6.2f}  speech {c['speech']:5.2f}  {c['id']}")
    print('total', total)
