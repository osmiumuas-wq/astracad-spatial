"""The demo video's scenes, each a real session in the emulator recorded while it is driven.
Usage: python -I scripts/video/scenes.py arrive shape voice test parts flow drawing  (or: all)
"""
import json
import sys
import time

sys.path.insert(0, 'scripts/video')
from drive import Recording, app, head_set, head_to, hand, pinch, pose, press, rest, targets, xr  # noqa: E402

BENCH = (0.0, 1.21, -0.42)
PROOF = (-0.3, 1.36, -0.45)
AGENTS = (0.3, 1.4, -0.45)
NEAR = (0.0, 1.52, -0.08)
FAR = (0.0, 1.6, 0.0)


def reset(job='cradle', guide=False):
    """A clean take: reload the app, enter XR, seat the head, then set the part and the guide."""
    from drive import cli, HEAD, EYE
    EYE[:] = list(HEAD)
    cli('browser', 'reload', payload={})
    time.sleep(7)
    xr('enter')
    time.sleep(1.0)
    xr('set-transform', device='headset', position={'x': HEAD[0], 'y': HEAD[1], 'z': HEAD[2]}, orientation={'x': 0, 'y': 0, 'z': 0, 'w': 1})
    xr('set-input-mode', mode='hand')
    time.sleep(2.5)
    skills = '{}' if guide else '{shape:1,dial:1,measure:1,test:1,fix:1,save:1}'
    app(f"""
      a.selectJob('{job}');
      a.progress.value = {{ ...a.progress.value, coachDone: {str(not guide).lower()}, skills: {skills} }};
      a.notice.value = null;
      return a.jobId.value;""")
    time.sleep(1.5)


def hands_down():
    rest('hand-right')
    rest('hand-left')


WAV_TO_TEXT = r"""
const res = await fetch('/artifacts/voice/pi.wav');
const buf = await res.arrayBuffer();
const dv = new DataView(buf);
let off = 12, data = -1, len = 0;
while (off < dv.byteLength) { const id = String.fromCharCode(dv.getUint8(off), dv.getUint8(off+1), dv.getUint8(off+2), dv.getUint8(off+3)); const sz = dv.getUint32(off + 4, true); if (id === 'data') { data = off + 8; len = sz; break; } off += 8 + sz; }
const n = len / 2; const audio = new Float32Array(n);
for (let i = 0; i < n; i++) audio[i] = dv.getInt16(data + i * 2, true) / 32768;
const w = x.voice.ensureWorker();
const text = await new Promise((resolve) => { const prev = w.onmessage; w.onmessage = (ev) => { prev?.(ev); if (ev.data.type === 'heard' && ev.data.id === 778) resolve(ev.data.text); }; w.postMessage({ type: 'hear', id: 778, audio }); });
x.probe.heard = text;
a.runCommand(text);
return text;
"""


def scene_arrive():
    reset('cradle', guide=True)
    hands_down()
    head_set((0.5, 1.75, -1.2))
    rec = Recording('arrive', 9)
    time.sleep(0.6)
    head_to(BENCH, 3.0)
    time.sleep(3.2)
    head_to((0.0, 1.27, -0.42), 1.5)
    rec.wait()


def scene_shape():
    reset('cradle', guide=True)
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    h = tg['Handle 0']['position']
    rec = Recording('shape', 13)
    pose('hand-right', 'default', 0.2)
    hand('hand-right', (h['x'] + 0.05, h['y'] + 0.03, h['z'] + 0.06), dur=0.9)
    hand('hand-right', (h['x'], h['y'], h['z']), dur=0.6)
    pinch('hand-right', 1, 0.25)
    time.sleep(0.3)
    hand('hand-right', (h['x'] + 0.014, h['y'], h['z']), dur=1.6)
    time.sleep(0.7)
    pinch('hand-right', 0, 0.2)
    rest('hand-right')
    head_to(PROOF, 1.4)
    time.sleep(3.2)
    head_to(BENCH, 1.2)
    rec.wait()


def later(ms, code):
    """Schedule app code `ms` after now, inside the page (browser calls wait while recording)."""
    app(f"setTimeout(async () => {{ try {{ {code} }} catch (e) {{ console.error(e); }} }}, {ms}); return 1;")


def scene_voice():
    reset('cradle')
    # Load the speech model and the language model first, as they would be after first use.
    app("x.voice.warm(); a.understander.warm(); return 1;")
    app(WAV_TO_TEXT.replace('a.runCommand(text);', ''))
    time.sleep(2)
    hands_down()
    head_set(BENCH, at=NEAR)
    later(2200, WAV_TO_TEXT.replace('return text;', ''))
    rec = Recording('voice', 15)
    time.sleep(3.5)
    head_to((0.0, 1.47, -0.5), 1.1)
    time.sleep(3.4)
    head_to(BENCH, 1.1)
    time.sleep(2.2)
    head_to(PROOF, 1.3)
    rec.wait()
    print('heard:', app("return x.probe.heard"))


def scene_test():
    reset('wall-bracket')
    app("a.setParams({ t: 2.5, g: 0 }); return a.params.value;")
    time.sleep(1.2)
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('test', 17)
    press('hand-right', 'Button mode:test', tg)
    rest('hand-right')
    # Dolly in over the tool strip for a close look at the stress colours.
    head_to((0.0, 1.22, -0.42), 2.2, at=(0.05, 1.4, -0.26))
    time.sleep(4.5)
    head_to(AGENTS, 1.6, at=(0.02, 1.48, -0.14))
    time.sleep(3.0)
    rec.wait()


def scene_parts():
    reset('project-box')
    hands_down()
    head_set(BENCH, at=NEAR)
    later(4200, "a.selectJob('pull-handle');")
    later(8400, "a.selectJob('tapered-foot');")
    rec = Recording('parts', 14)
    time.sleep(9.5)
    head_to(PROOF, 1.3)
    rec.wait()


def scene_flow():
    reset('phone-stand')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('flow', 12)
    press('hand-left', 'Button act:flow', tg)
    rest('hand-left')
    head_to(BENCH, 0.8)
    time.sleep(7.5)
    rec.wait()


def scene_drawing():
    reset('wall-bracket')
    hands_down()
    head_set(BENCH)
    tg = targets()
    rec = Recording('drawing', 15)
    press('hand-right', 'Button act:drawing', tg)
    head_to((0.0, 1.62, -0.62), 1.8)
    rest('hand-right')
    time.sleep(6.5)
    rec.wait()


def scene_measure():
    """Measure mode: hold a span between both hands and keep still; the reading locks."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('measure', 22)
    press('hand-left', 'Button mode:measure', tg)
    rest('hand-left')
    head_to((0.0, 1.3, -0.4), 0.8)
    for dev, x in (('hand-left', -0.045), ('hand-right', 0.045)):
        pose(dev, 'pinch', 0.2)
        hand(dev, (x, 1.32, -0.36), dur=0.8)
    pinch('hand-left', 1, 0.2)
    pinch('hand-right', 1, 0.2)
    time.sleep(2.6)
    # The reading locks and the part takes the size: look up at the confirmation.
    head_to((0.0, 1.47, -0.5), 1.1)
    time.sleep(3.0)
    pinch('hand-left', 0, 0.2)
    pinch('hand-right', 0, 0.2)
    hands_down()
    head_to(BENCH, 1.1)
    rec.wait()


def scene_sketch():
    """Air sketch: pinch above the bench, draw a closed outline, let go: it becomes a solid."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('sketch', 24)
    press('hand-right', 'Button mode:sketch', tg)
    head_to(BENCH, 0.6)
    y = 1.29
    pts = [(-0.045, y, -0.37), (0.045, y, -0.37), (0.045, y, -0.47), (-0.045, y, -0.47), (-0.045, y, -0.37)]
    pose('hand-right', 'default', 0.2)
    hand('hand-right', pts[0], dur=0.7)
    pinch('hand-right', 1, 0.15)
    for p in pts[1:]:
        hand('hand-right', p, dur=0.6)
    time.sleep(0.3)
    pinch('hand-right', 0, 0.15)
    rest('hand-right')
    time.sleep(3.0)
    rec.wait()


def scene_grow():
    """Grow bone: topology optimisation removes material the load does not need."""
    reset('wall-bracket')
    hands_down()
    head_set(BENCH, at=(0.05, 1.42, -0.2))
    tg = targets()
    rec = Recording('grow', 24)
    press('hand-right', 'Button act:grow', tg)
    rest('hand-right')
    head_to((0.0, 1.22, -0.42), 1.5, at=(0.05, 1.4, -0.26))
    time.sleep(10)
    rec.wait()


def scene_modes():
    """Vibration: the part's natural frequencies, each mode shape animated."""
    reset('wall-bracket')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('modes', 58)
    press('hand-left', 'Button act:modes', tg)
    rest('hand-left')
    head_to((0.0, 1.22, -0.42), 1.5, at=(0.05, 1.4, -0.26))
    time.sleep(7)
    rec.wait()


def scene_hinge():
    """The print-in-place hinge swings to where its leaves meet, then explodes apart."""
    reset('hinge')
    hands_down()
    head_set(BENCH, at=NEAR)
    later(1500, "a.runCommand('swing the hinge');")
    later(7500, "a.runCommand('explode it');")
    rec = Recording('hinge', 13)
    head_to((0.0, 1.22, -0.42), 1.6, at=(0.05, 1.4, -0.26))
    time.sleep(9)
    rec.wait()


def scene_codesign():
    """Co-design: start a room; a partner joins by code or QR from a headset or a phone."""
    reset('knob')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('codesign', 18)
    press('hand-right', 'Button act:co', tg)
    rest('hand-right')
    time.sleep(1.0)
    tg = targets()
    host = next((k for k in tg if k.startswith('Button co:host')), None)
    if host:
        press('hand-right', host, tg)
        rest('hand-right')
    head_to((0.27, 1.45, -0.45), 1.3)
    time.sleep(4)
    rec.wait()


def scene_access():
    """Access settings: captions, dwell, large text, high contrast, one-handed, colour-safe map."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('access', 14)
    press('hand-right', 'Button act:settings', tg)
    rest('hand-right')
    head_to((0.0, 1.42, -0.45), 1.3)
    time.sleep(4.5)
    rec.wait()


def scene_glasses():
    """Meta VR Glasses (emulator device switched beforehand): the compact layout for a narrow view."""
    reset('cradle', guide=True)
    hands_down()
    head_set(BENCH)
    rec = Recording('glasses', 12)
    time.sleep(0.8)
    head_to((0.15, 1.25, -0.42), 1.8)
    time.sleep(1.2)
    head_to((-0.12, 1.3, -0.45), 2.0)
    time.sleep(1.2)
    head_to(BENCH, 1.6)
    rec.wait()


SCENES = {
    'arrive': scene_arrive,
    'shape': scene_shape,
    'voice': scene_voice,
    'test': scene_test,
    'parts': scene_parts,
    'flow': scene_flow,
    'drawing': scene_drawing,
    'measure': scene_measure,
    'sketch': scene_sketch,
    'grow': scene_grow,
    'modes': scene_modes,
    'hinge': scene_hinge,
    'codesign': scene_codesign,
    'access': scene_access,
    'glasses': scene_glasses,
}

if __name__ == '__main__':
    names = sys.argv[1:] or ['all']
    if names == ['all']:
        names = list(SCENES)
    xr('set-input-mode', mode='hand')
    for n in names:
        SCENES[n]()
