"""Scenes for the chaptered film (recorded at 1440 px: start the dev server with `--shot 1440`).
Each take is longer than its slot, so the edit can hold on what the narration explains.
Usage: python -I scripts/video/scenes2.py hero arrive shape ...   (or: all)
Frames go to artifacts/video/scenes/<name>/ with times.json.
"""
import sys
import time

sys.path.insert(0, 'scripts/video')
from drive import Recording, app, head_set, head_to, hand, pinch, pose, press, rest, targets, xr  # noqa: E402
from scenes import AGENTS, BENCH, NEAR, PROOF, WAV_TO_TEXT, hands_down, later, reset  # noqa: E402


def palm_at(x, y, z, dur=0.6):
    """Right hand flat, palm down, with the palm centre at (x, y, z) (offset measured from the wrist)."""
    xr('animate-to', device='hand-right', position={'x': x + 0.015, 'y': y - 0.024, 'z': z + 0.044}, anchor='wrist',
       orientation={'pitch': 0, 'yaw': 0, 'roll': 0}, duration=dur, easing='minimum-jerk')


def scene_hero():
    """A slow sideways glide past the bench, for the opening and the closing titles."""
    reset('project-box')
    hands_down()
    head_set(BENCH, at=(-0.32, 1.5, -0.02))
    rec = Recording('hero', 22)
    head_to(BENCH, 18, at=(0.32, 1.5, -0.02))
    rec.wait()


def scene_arrive():
    """First run: the bench comes in from the side, the guide lights the first step."""
    reset('cradle', guide=True)
    hands_down()
    head_set((0.5, 1.75, -1.2))
    rec = Recording('arrive', 14)
    time.sleep(0.8)
    head_to(BENCH, 3.4)
    time.sleep(4.0)
    head_to((0.0, 1.3, -0.42), 2.0)
    rec.wait()


def scene_shape():
    """Pinch a handle and pull it slowly; the truth gate's numbers update in view as it rebuilds."""
    reset('cradle', guide=True)
    hands_down()
    eye = (-0.05, 1.56, -0.03)
    look = (-0.07, 1.27, -0.42)
    head_set(look, at=eye)
    tg = targets()
    h = tg['Handle 0']['position']
    rec = Recording('shape', 26)
    time.sleep(0.8)
    pose('hand-right', 'default', 0.2)
    hand('hand-right', (h['x'] + 0.05, h['y'] + 0.03, h['z'] + 0.06), dur=1.0)
    hand('hand-right', (h['x'], h['y'], h['z']), dur=0.7)
    pinch('hand-right', 1, 0.25)
    time.sleep(0.4)
    hand('hand-right', (h['x'] + 0.016, h['y'], h['z']), dur=3.0)
    time.sleep(0.8)
    pinch('hand-right', 0, 0.2)
    rest('hand-right')
    rec.wait()


def scene_voice():
    """A spoken request (a recorded sentence fed to the on-device recogniser: the emulator has no microphone)."""
    reset('cradle')
    app("x.voice.warm(); a.understander.warm(); return 1;")
    app(WAV_TO_TEXT.replace('a.runCommand(text);', ''))
    time.sleep(2)
    hands_down()
    head_set(BENCH, at=NEAR)
    later(4200, WAV_TO_TEXT.replace('return text;', ''))
    rec = Recording('voice', 20)
    time.sleep(5.5)
    head_to((0.0, 1.47, -0.5), 1.2)
    time.sleep(4.0)
    head_to(BENCH, 1.2)
    time.sleep(2.5)
    head_to(PROOF, 1.4)
    rec.wait()
    print('heard:', app("return x.probe.heard"))


def scene_measure():
    """Measure: both hands pinch the two ends of the object and hold still; the reading locks."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('measure', 26)
    press('hand-left', 'Button mode:measure', tg)
    rest('hand-left')
    head_to((0.0, 1.3, -0.4), 0.8)
    for dev, x in (('hand-left', -0.045), ('hand-right', 0.045)):
        pose(dev, 'pinch', 0.2)
        hand(dev, (x, 1.32, -0.36), dur=0.8)
    pinch('hand-left', 1, 0.2)
    pinch('hand-right', 1, 0.2)
    time.sleep(3.0)
    head_to((0.0, 1.47, -0.5), 1.2)
    time.sleep(3.5)
    pinch('hand-left', 0, 0.2)
    pinch('hand-right', 0, 0.2)
    hands_down()
    head_to(BENCH, 1.2)
    rec.wait()


def scene_sketch():
    """Air sketch: draw a closed outline above the bench and let go; it becomes a solid."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('sketch', 36)
    press('hand-right', 'Button mode:sketch', tg)
    head_to(BENCH, 0.6)
    y = 1.29
    pts = [(-0.045, y, -0.37), (0.045, y, -0.37), (0.045, y, -0.47), (-0.045, y, -0.47), (-0.045, y, -0.37)]
    pose('hand-right', 'default', 0.2)
    hand('hand-right', pts[0], dur=0.7)
    pinch('hand-right', 1, 0.15)
    for p in pts[1:]:
        hand('hand-right', p, dur=0.7)
    time.sleep(0.3)
    pinch('hand-right', 0, 0.15)
    rest('hand-right')
    time.sleep(4.0)
    rec.wait()


def scene_test():
    """Test by hand: the standard load, then an open-palm push until it would fail; the structure
    agent's fix is pinched, and the same push holds."""
    reset('wall-bracket')
    hands_down()
    eye = (0.03, 1.5, -0.12)
    look = (0.08, 1.335, -0.42)
    head_set(look, at=eye)
    tg = targets()
    rec = Recording('test', 72)
    press('hand-left', 'Button mode:test', tg)
    rest('hand-left')
    time.sleep(4.0)

    def push(depths):
        pose('hand-right', 'flat', 0.3)
        palm_at(0.024, 1.37, -0.42, 0.8)
        for y in depths:
            palm_at(0.024, y, -0.42, 0.8)
            time.sleep(1.8)
        time.sleep(1.2)
        # Lift away at once, so the last load stays on the part for the agents to judge.
        palm_at(0.024, 1.46, -0.42, 0.02)
        rest('hand-right')

    push((1.334, 1.327, 1.321, 1.316))
    time.sleep(3.5)
    tg = targets()
    if 'Button fix:marcus' in tg:
        press('hand-right', 'Button fix:marcus', tg)
        rest('hand-right')
    time.sleep(4.0)
    push((1.334, 1.322, 1.316))
    rec.wait()
    print(app("return JSON.stringify({load: a.loadN.peek(), factor: a.factor(), params: a.params.peek()})"))


def scene_grow():
    reset('wall-bracket')
    hands_down()
    head_set(BENCH, at=(0.05, 1.42, -0.2))
    tg = targets()
    rec = Recording('grow', 26)
    press('hand-right', 'Button act:grow', tg)
    rest('hand-right')
    head_to((0.0, 1.22, -0.42), 1.5, at=(0.05, 1.4, -0.26))
    rec.wait()


def scene_modes():
    reset('wall-bracket')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('modes', 75)
    press('hand-left', 'Button act:modes', tg)
    rest('hand-left')
    head_to((0.0, 1.22, -0.42), 1.5, at=(0.05, 1.4, -0.26))
    # After the first mode has played for a while, show the second (the same button steps through them).
    time.sleep(56)
    press('hand-left', 'Button act:modes', tg)
    rest('hand-left')
    rec.wait()
    print(app("return JSON.stringify(x.probe.modes)"))


def scene_parts():
    """The kernel's newer features: a filleted, shelled box; a swept handle; a lofted foot."""
    reset('project-box')
    hands_down()
    head_set(BENCH, at=(0.0, 1.45, -0.16))
    later(5200, "a.selectJob('pull-handle');")
    later(10400, "a.selectJob('tapered-foot');")
    rec = Recording('parts', 16)
    rec.wait()


def scene_hinge():
    reset('hinge')
    hands_down()
    head_set(BENCH, at=NEAR)
    later(1500, "a.runCommand('swing the hinge');")
    later(8000, "a.runCommand('explode it');")
    rec = Recording('hinge', 15)
    head_to((0.0, 1.22, -0.42), 1.6, at=(0.05, 1.4, -0.26))
    rec.wait()


def scene_share():
    """Take it with you: the dimensioned drawing, the share code, and a co-design room."""
    reset('wall-bracket')
    hands_down()
    head_set(BENCH)
    tg = targets()
    rec = Recording('share', 34)
    press('hand-right', 'Button act:drawing', tg)
    head_to((0.0, 1.62, -0.62), 1.8)
    rest('hand-right')
    time.sleep(5.0)
    head_to(BENCH, 1.4)
    tg = targets()
    press('hand-right', 'Button act:share', tg)
    rest('hand-right')
    time.sleep(0.8)
    head_to((0.27, 1.45, -0.45), 1.3)
    time.sleep(4.0)
    head_to(BENCH, 1.2)
    tg = targets()
    press('hand-right', 'Button act:co', tg)
    rest('hand-right')
    time.sleep(1.0)
    tg = targets()
    host = next((k for k in tg if k.startswith('Button co:host')), None)
    if host:
        press('hand-right', host, tg)
        rest('hand-right')
    head_to((0.27, 1.45, -0.45), 1.3)
    rec.wait()


def scene_access():
    """The Access settings: the list opens beside the tool strip; the head turns to read it."""
    reset('cradle')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('access', 16)
    press('hand-right', 'Button act:settings', tg)
    rest('hand-right')
    head_to((0.2, 1.27, -0.36), 1.6, at=(0.04, 1.5, -0.06))
    rec.wait()


def scene_codesign():
    """Co-design: start a room; the bench shows its six-digit code for a partner's headset or phone."""
    reset('knob')
    hands_down()
    head_set(BENCH, at=NEAR)
    tg = targets()
    rec = Recording('codesign', 28)
    press('hand-right', 'Button act:co', tg)
    rest('hand-right')
    time.sleep(1.0)
    tg = targets()
    print('co targets', [k for k in tg if 'co:' in k])
    host = next((k for k in tg if k.startswith('Button co:host')), None)
    if host:
        press('hand-right', host, tg)
        rest('hand-right')
    head_to((0.27, 1.42, -0.45), 1.3)
    rec.wait()
    print('code', app("return x.codesign && x.codesign.code && x.codesign.code.peek()"))


def scene_glasses():
    """Needs iwsdk.config.json device metaVRGlasses while it records (set it back afterwards)."""
    reset('cradle', guide=True)
    hands_down()
    head_set(BENCH)
    rec = Recording('glasses', 13)
    time.sleep(0.8)
    head_to((0.15, 1.25, -0.42), 1.8)
    time.sleep(1.2)
    head_to((-0.12, 1.3, -0.45), 2.0)
    time.sleep(1.2)
    head_to(BENCH, 1.6)
    rec.wait()


SCENES = {
    'hero': scene_hero,
    'arrive': scene_arrive,
    'shape': scene_shape,
    'voice': scene_voice,
    'measure': scene_measure,
    'sketch': scene_sketch,
    'test': scene_test,
    'grow': scene_grow,
    'modes': scene_modes,
    'parts': scene_parts,
    'hinge': scene_hinge,
    'share': scene_share,
    'access': scene_access,
    'codesign': scene_codesign,
    'glasses': scene_glasses,
}

if __name__ == '__main__':
    names = sys.argv[1:] or ['all']
    if names == ['all']:
        names = [n for n in SCENES if n != 'glasses']
    xr('set-input-mode', mode='hand')
    for n in names:
        print('scene', n, flush=True)
        SCENES[n]()
