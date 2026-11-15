"""Scenes for the showcase film: everything added since the first film, recorded in the emulator at 1440 px
(the dev server started with `--shot 1440`). Each take is the real app driven through its own commands.

Browser calls wait while a take records, so each scene is a timeline: its app steps are scheduled inside the
page before recording starts (at their times in the take), and the camera glides and hand presses (XR
emulator calls, which run alongside) are made from here on the same clock.

Usage: python -I scripts/video/scenes3.py ribbon sketchbench ...   (or: all)
Frames go to artifacts/video/scenes/<name>/ with times.json.
"""
import json
import sys
import time

sys.path.insert(0, 'scripts/video')
from drive import Recording, app, head_set, head_to, press, rest, targets  # noqa: E402
from scenes import hands_down, reset  # noqa: E402

LOOK = (0.0, 1.25, -0.42)
CLOSE = (0.0, 1.43, -0.17)
# The take's clock starts this long after the steps are scheduled (the recorder takes a moment to start).
OFFSET = 1.3


def cmd(text):
    return f"a.runCommand({json.dumps(text)});"


def bench(code):
    return f"{{ const b = a.sketchBench; if (b) {{ {code}; }} }}"


def point(x, y, z, n=(0, 1, 0)):
    return f"a.pointed = {{ param: '', at: performance.now(), mm: [{x}, {y}, {z}], normal: [{n[0]}, {n[1]}, {n[2]}] }};"


def part(feats):
    p = {'nf': len(feats), 'sel': -1}
    for i, (op, v) in enumerate(feats):
        p[f'o{i}'] = op
        for s in 'abcdefgh':
            p[f'{s}{i}'] = v.get(s, 0)
    return f"a.replaceParams({json.dumps(p)}); a.notice.value = null;"


BLANK = "a.params.value = { nf: 0 }; a.notice.value = null;"


def take(name, seconds, setup, steps, cams=(), presses=(), look=LOOK, at=CLOSE, job='design', near=0.6, zoom=1.7):
    """Set up, schedule `steps` [(t, js)], then record while running `cams` [(t, look, at, dur)] and
    `presses` [(t, button)] on the take's clock. Every eye is pulled `near` of the way to what it looks at
    (1 = as given), so the part fills the frame."""
    pull = lambda lk, eye: tuple(lk[k] + (eye[k] - lk[k]) * near for k in range(3))  # noqa: E731
    at = pull(look, at)
    cams = [(t, lk, pull(lk, eye), dur) for t, lk, eye, dur in cams]
    reset(job)
    hands_down()
    head_set(look, at=at)
    # The part shown larger on the bench (the view's zoom; sizes are unchanged).
    app(f"x.bench.part.setZoom({zoom}); return 1;")
    if setup:
        app(setup + ' return 1;')
        time.sleep(2.0)
    tg = targets() if presses else None
    sched = ' '.join(f"setTimeout(async () => {{ try {{ {code} }} catch (e) {{ console.error(e); }} }}, {int((OFFSET + t) * 1000)});" for t, code in steps)
    app(sched + ' return 1;')
    t0 = time.time()
    rec = Recording(name, seconds)
    events = sorted([(t, 'cam', c) for t, *c in cams] + [(t, 'press', p) for t, p in presses], key=lambda e: e[0])
    for t, kind, what in events:
        wait = t0 + OFFSET + t - time.time()
        if wait > 0:
            time.sleep(wait)
        if kind == 'cam':
            lk, eye, dur = what
            head_to(lk, dur, at=eye)
        else:
            press('hand-right', f'Button {what}', tg)
            rest('hand-right')
    rec.wait()


def scene_ribbon():
    take('ribbon', 32,
         part([(1, {'a': 70, 'b': 50, 'c': 10})]),
         [(10.5, cmd('add a cylinder 24 by 16')), (13.5, point(0, 26, 0) + cmd('drill a 10 mm hole here')),
          (16.5, point(25, 10, 0) + cmd('drill a 6 mm hole here')), (19, cmd('circular pattern 6')), (23, cmd('fillet 3'))],
         cams=[(20, LOOK, (0.12, 1.46, -0.2), 7)],
         presses=[(0.5, 'design:tab:Holes'), (2.3, 'design:tab:Modify'), (4.1, 'design:tab:Sheet'), (5.9, 'design:tab:Output'), (7.7, 'design:tab:Create')],
         look=(-0.07, 1.26, -0.4), at=(0.02, 1.45, -0.15), near=1.0, zoom=1.0)


def scene_sketchbench():
    s = [(0.5, point(-30, 10, 20) + cmd('sketch here'))]
    clicks = ['b.click(0, 0)', 'b.click(40.6, 0.3)', 'b.click(40, 20.4)', "b.command('tangent arc')", 'b.click(20, 40)',
              'b.click(0, 40.2)', 'b.click(0.4, -0.2)', "b.setTool('dimension')", 'b.click(20, 0)']
    t = 3.0
    for c in clicks:
        s.append((t, bench(c)))
        t += 1.1
    s += [(t, cmd('45')), (t + 1.5, bench("b.setTool('circle')")), (t + 2.3, bench('b.click(15, 20)')), (t + 3.2, bench('b.click(20, 20)')),
          (t + 4.2, bench("b.setTool('dimension')")), (t + 4.8, bench('b.click(20, 20)')), (t + 5.8, cmd('diameter 8')), (t + 9, cmd('extrude 8'))]
    take('sketchbench', 32, part([(1, {'a': 100, 'b': 70, 'c': 10})]), s,
         cams=[(t + 7.5, LOOK, (0.13, 1.47, -0.19), 3.5)], look=(0.03, 1.26, -0.41), at=(0.05, 1.44, -0.16))


def scene_sketchtools():
    s = [(0.5, point(-35, 8, 25) + cmd('sketch here'))]
    clicks = ["b.setTool('rect')", 'b.click(0, 0)', 'b.click(40, 22)', "b.command('fillet 5')", 'b.click(40, 22)', 'b.click(0, 22)',
              "b.command('offset 3')", 'b.click(20, 0)', 'b.click(20, -6)', "b.setTool('spline')", 'b.click(50, 0)', 'b.click(58, 14)',
              'b.click(66, 4)', 'b.click(72, 18)', 'b.click(72, 18)', "b.setTool('ellipse')", 'b.click(20, 11)', 'b.click(28, 11)', 'b.click(20, 15)']
    t = 3.0
    for c in clicks:
        s.append((t, bench(c)))
        t += 1.0
    take('sketchtools', 28, part([(1, {'a': 100, 'b': 70, 'c': 8})]), s,
         cams=[(t, LOOK, (-0.1, 1.46, -0.2), 4)], look=(0.0, 1.26, -0.41), at=(0.03, 1.44, -0.16))


def scene_production():
    take('production', 30, part([(1, {'a': 120, 'b': 80, 'c': 8})]),
         [(0.8, point(-35, 8, 15) + cmd('gear module 2 with 18 teeth 8 thick bore 6')),
          (4.5, point(10, 8, 20) + cmd('m8 thread 16 long')),
          (9.5, point(30, 8, -20) + cmd('loft a rectangle 24 by 18 to a circle 12 over 20')),
          (13.5, point(-30, 8, -25) + cmd('sweep a circle 6 along 25 up then 25 right bend 8'))],
         cams=[(17, LOOK, (0.18, 1.47, -0.22), 8)], at=(0.0, 1.45, -0.15))


def scene_edges():
    # Round all runs on a plain block: on the block with its boss it takes over a minute (a rolling ball
    # round the boss's junction), too long for a take.
    take('edges', 26, part([(1, {'a': 70, 'b': 45, 'c': 18})]),
         [(0.8, cmd('add a cylinder 24 by 12')), (4, point(12, 30, 0) + cmd('chamfer this edge 3')),
          (8, point(35, 9, 22.5, (0, 0, 1)) + cmd('fillet this edge 8')),
          (14, part([(1, {'a': 70, 'b': 45, 'c': 18})])), (15, cmd('round all edges 5'))],
         cams=[(9, LOOK, (0.16, 1.45, -0.2), 4)], at=(0.05, 1.43, -0.17))


def scene_sheet():
    take('sheet', 30, BLANK,
         [(0.5, cmd('sheet metal 110 by 70 thick 2 bend 2')), (3.5, cmd('flange edge 1 30')), (6.5, cmd('flange edge 3 25 at 60')),
          (9.5, cmd('hem edge 2 10')), (12.5, cmd('flange on flange 12')), (19, cmd('flat pattern'))],
         cams=[(14, LOOK, (0.16, 1.47, -0.22), 7)], at=(0.0, 1.46, -0.15))


def scene_weld():
    s = [(0.5, point(-50, 0, 30) + cmd('sketch here'))]
    t = 2.5
    for c in ["b.setTool('rect')", 'b.click(0, 0)', 'b.click(100, 60)', "b.setTool('line')", 'b.click(0, 0)', 'b.click(100, 60)']:
        s.append((t, bench(c)))
        t += 1.0
    s += [(t + 1, cmd('weldment square tube 12 by 1.5')), (t + 9, cmd('cut list'))]
    take('weld', 24, BLANK, s, cams=[(t + 3, LOOK, (0.15, 1.47, -0.2), 6)], at=(0.0, 1.47, -0.14))


def scene_surfaces():
    s = [(0.5, cmd('freeform surface 90 by 60 thick 2 with 5 by 5 points'))]
    t = 3.0
    for c in ['raise point 3 3 by 18', 'raise point 2 2 by 8', 'lower point 4 4 by 6', 'raise point 1 5 by 10']:
        s.append((t, cmd(c)))
        t += 1.8
    s += [(t + 2.5, BLANK), (t + 3.3, cmd('subd box 60 by 30 by 34 cage 3 by 2 by 2 symmetric'))]
    t += 6.5
    for c in ['push point 2 out 12', 'move point 6 up 8', 'push point 9 out 6']:
        s.append((t, cmd(c)))
        t += 2.2
    take('surfaces', 30, BLANK, s, cams=[(7, LOOK, (0.15, 1.46, -0.2), 5), (t - 3, LOOK, (-0.14, 1.45, -0.2), 5)], at=(0.0, 1.45, -0.16))


def scene_mech():
    take('mech', 30, part([(1, {'a': 80, 'b': 56, 'c': 8})]),
         [(0.8, point(-22, 8, 8) + cmd('spring 16 diameter wire 1.6 pitch 5 6 turns closed ends')),
          (4.5, point(20, 8, 8) + cmd('knurl 14 diameter 18 long pitch 1 diamond')),
          (8.5, point(0, 8, 22) + cmd('engrave ASTRA 1 here 6 high 0.6 deep')),
          (12.5, cmd('appearance anodised blue')), (17.5, cmd('appearance brushed aluminium')), (22, cmd('appearance carbon fibre'))],
         cams=[(13, LOOK, (0.14, 1.45, -0.2), 6)], at=(0.0, 1.45, -0.16))


def scene_prop():
    take('prop', 18, BLANK,
         [(0.5, cmd('propeller 3 blades naca 4412 span 55 chord 24 to 10 twist 38 to 12 hub 9 by 11')), (8, cmd('appearance polished chrome'))],
         cams=[(3, (0.0, 1.27, -0.42), (0.16, 1.4, -0.24), 8)], look=(0.0, 1.27, -0.42), at=(0.02, 1.46, -0.16))


def scene_mould():
    # An organic shape: its parting line runs round the widest point, between the green and blue halves.
    take('mould', 24, BLANK + cmd('subd box 60 by 30 by 34 cage 3 by 2 by 2 symmetric'),
         [(1, cmd('draft analysis 1')), (7.5, cmd('parting line')), (13.5, cmd('make mould margin 12 shrink 0.5'))],
         cams=[(4, LOOK, (0.12, 1.45, -0.21), 5)], at=(0.0, 1.44, -0.17))


def scene_config():
    take('config', 24, BLANK + cmd('sheet metal 100 by 60 thick 2 bend 2') + 'setTimeout(() => ' + cmd('flange edge 1 30').rstrip(';') + ', 1500);',
         [(0.5, cmd('variable len 40')), (3, cmd('feature 2 flange length equals len')), (6, cmd('save configuration tall')),
          (8, cmd('len equals 12')), (11, cmd('save configuration short')), (13, cmd('configuration tall')), (17, cmd('configuration short'))],
         cams=[(18, LOOK, (0.14, 1.46, -0.2), 4)], at=(0.0, 1.46, -0.15))


def scene_assembly2():
    take('assembly2', 32, None,
         [(0.5, cmd('assembly demo')), (8, cmd('turn the hinge to 70')), (12, cmd('linkage demo')), (20, cmd('play'))],
         cams=[(24, (0.0, 1.27, -0.42), (0.15, 1.47, -0.2), 6)], look=(0.0, 1.27, -0.42), at=(0.0, 1.47, -0.14), job='project-box', near=0.85, zoom=1.0)


def scene_drawings():
    take('drawings', 20, part([(1, {'a': 80, 'b': 50, 'c': 14}), (4, {'a': 8, 'd': 20, 'f': 14}), (3, {'a': 24, 'b': 16, 'c': 5, 'd': -15, 'f': 9})]),
         [(0.5, cmd('drawing'))],
         # Up to the sheet (it hangs above the bench at about 0, 1.56, -0.52), then in on its views.
         cams=[(2.5, (0.0, 1.56, -0.52), (0.0, 1.52, -0.06), 2.5), (9, (-0.12, 1.61, -0.52), (-0.1, 1.6, -0.27), 7)],
         look=(0.0, 1.3, -0.45), at=(0.0, 1.45, -0.12), near=1.0)


ALL = {k[6:]: v for k, v in globals().items() if k.startswith('scene_')}

if __name__ == '__main__':
    names = sys.argv[1:] or []
    if names == ['all']:
        names = list(ALL)
    for n in names:
        print('scene', n, flush=True)
        ALL[n]()
