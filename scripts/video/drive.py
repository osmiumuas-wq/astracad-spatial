"""Drives the IWSDK emulator for the demo video: eased head moves, hand reaches, pinches and
button presses through the IWSDK CLI, and app calls through scripts/video/eval.mjs, while
scripts/video/cast.mjs records. Every interaction is a real input event into the running app.

Usage: python -I scripts/video/drive.py <scene> [<scene> ...]   (or "all"; "probe" for a test)
Frames go to artifacts/video/scenes/<scene>/.
"""
import json
import math
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CLI = [os.environ.get('NODE', 'node'), os.path.join(ROOT, 'node_modules', '@iwsdk', 'cli', 'dist', 'cli.js')]
OUT = os.path.join(ROOT, 'artifacts', 'video', 'scenes')
HEAD = (0.0, 1.6, 0.0)


def cli(*args, payload=None, check=True):
    cmd = CLI + list(args)
    if payload is not None:
        cmd += ['--input-json', json.dumps(payload)]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    out = r.stdout.strip()
    try:
        data = json.loads(out[out.index('{'):]) if '{' in out else {}
    except ValueError:
        data = {}
    if check and data.get('ok') is False:
        print('CLI error', args, data.get('error'), file=sys.stderr)
    return data


def xr(action, **payload):
    return cli('xr', action, payload=payload)


def app(code):
    with open(os.path.join(ROOT, 'scripts', 'video', 'eval.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'code': code}, f)
    d = cli('browser', 'run', 'scripts/video/eval.mjs')
    return (d.get('data') or {}).get('result')


def targets():
    d = cli('xr', 'list-targets')
    t = (d.get('data') or {}).get('result', d.get('data') or {})
    items = t.get('targets', t) if isinstance(t, dict) else t
    return {x['name']: x for x in items}


def look_euler(target, frm=HEAD):
    dx, dy, dz = target[0] - frm[0], target[1] - frm[1], target[2] - frm[2]
    yaw = math.degrees(math.atan2(-dx, -dz))
    pitch = math.degrees(math.atan2(dy, math.hypot(dx, dz)))
    return {'pitch': pitch, 'yaw': yaw, 'roll': 0}


EYE = list(HEAD)


def head_to(target, dur=1.5, at=None):
    """Turn (and, with `at`, move) the head smoothly to look at `target`."""
    if at:
        EYE[:] = at
        xr('animate-to', device='headset', position={'x': at[0], 'y': at[1], 'z': at[2]},
           orientation=look_euler(target, at), duration=dur, easing='minimum-jerk')
    else:
        xr('animate-to', device='headset', orientation=look_euler(target, EYE), duration=dur, easing='minimum-jerk')


def head_set(target, at=None):
    if at:
        EYE[:] = at
    xr('set-transform', device='headset', position={'x': EYE[0], 'y': EYE[1], 'z': EYE[2]}, orientation=look_euler(target, EYE))


def hand(device, pos, anchor='grasp', dur=0.8, orientation='auto'):
    xr('animate-to', device=device, position={'x': pos[0], 'y': pos[1], 'z': pos[2]}, anchor=anchor,
       orientation=orientation, duration=dur, easing='minimum-jerk')


def pose(device, pose_id, dur=0.25):
    xr('set-hand-pose', device=device, poseId=pose_id, duration=dur)


def pinch(device, value, dur=0.25):
    xr('set-select-value', device=device, value=value, duration=dur, easing='minimum-jerk')


def rest(device):
    side = 0.22 if device == 'hand-right' else -0.22
    hand(device, (side, 0.95, -0.15), anchor='wrist', dur=0.7)


def press(device, name, tg=None, hold=0.15):
    """Point the hand's ray at a button and pinch: how a hand presses a button out of reach on Quest."""
    tg = tg or targets()
    p = tg[name]['position']
    c = (p['x'], p['y'], p['z'])
    side = 1 if device == 'hand-right' else -1
    origin = (c[0] * 0.5 + side * 0.16, c[1] - 0.12, c[2] + 0.26)
    pose(device, 'default', 0.2)
    xr('animate-to', device=device, position={'x': origin[0], 'y': origin[1], 'z': origin[2]},
       orientation=look_euler(c, origin), duration=0.7, easing='minimum-jerk')
    time.sleep(0.25)
    pinch(device, 1, 0.12)
    time.sleep(hold)
    pinch(device, 0, 0.12)
    time.sleep(0.2)


class Recording:
    def __init__(self, name, seconds):
        self.dir = os.path.join(OUT, name)
        os.makedirs(self.dir, exist_ok=True)
        for f in os.listdir(self.dir):
            os.remove(os.path.join(self.dir, f))
        with open(os.path.join(ROOT, 'scripts', 'video', 'record.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'out': self.dir.replace('\\', '/'), 'seconds': seconds}, f)
        self.proc = subprocess.Popen(CLI + ['browser', 'run', 'scripts/video/cast.mjs', '--timeout', str(int(seconds * 1000 + 30000))], cwd=ROOT,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
        time.sleep(1.2)

    def wait(self):
        out, _ = self.proc.communicate()
        frames = len([f for f in os.listdir(self.dir) if f.endswith('.jpg')])
        print(os.path.basename(self.dir), 'frames', frames)
        return frames
