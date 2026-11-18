"""Writes scripts/video/cut.json, the competition cut of the showcase: under three minutes (the rules' limit), best
material first, the same recorded takes. Render with FILM=cut (tts2.py, music2.py, then render_parallel.py).
Run from the repository root."""
import json

PUSH = lambda t1=12, cy=640, side0=1180, side1=960: [[0, 720, cy + 20, side0], [t1, 720, cy, side1]]  # noqa: E731
# Tighter than the showcase: a shorter breath before and after each chapter's narration.
GAP = {'lead': 0.7, 'tail': 1.1}


def ch(id, title, narration, bullets, clips, **kw):
    at = [narration.find(cue) for _, cue in bullets]
    assert all(a >= 0 for a in at), (id, bullets)
    assert at == sorted(at), (id, 'bullet cues out of narration order')
    d = {'id': id, 'title': title, 'narration': narration, 'bullets': [list(b) for b in bullets], 'clips': clips}
    d.update(GAP)
    d.update(kw)
    return d


chapters = [
    ch('intro', 'AstraCAD Spatial',
       'AstraCAD Spatial is a complete CAD workstation in Meta Quest. Design, test and make real parts with your hands and voice, seated at your desk, and every part is checked by exact maths.',
       [('Sketch, model, assemble, test and make', 'Design'), ('Hands-first and seated: no controller needed', 'hands'), ('Every part checked by exact maths', 'checked')],
       [{'src': 'hero', 'in': 1.0, 'zoom': [[0, 720, 720, 1440], [12, 720, 760, 1280]]}], kind='title', kicker='CAD for Meta Quest', lead=1.4),
    ch('shape', 'Shape it with your hands',
       'Pinch a handle and pull. The kernel rebuilds the solid as you move, and the truth gate checks it against an exact formula.',
       [('Pinch and pull: the solid rebuilds live', 'Pinch'), ('Truth gate: closed-form volume, size and holes', 'truth gate')],
       [{'src': 'shape', 'in': 4.0, 'zoom': [[0, 720, 720, 1440], [4.5, 720, 720, 1440], [6.5, 560, 560, 880]]}]),
    ch('voice', 'Or just say it',
       'Or just say it. Speech is recognised on the headset, and every size comes from your words.',
       [('Speech recognised on the headset', 'recognised'), ('Sizes come only from your words', 'words')],
       [{'src': 'voice', 'in': 0.5}]),
    ch('sketchbench', 'A real sketcher',
       'Open a sketch on any face. Lines snap and solve, Smart Dimension takes a spoken number, and extrude makes a verified solid.',
       [('Snaps and relations, solved live', 'snap'), ('Smart Dimension by voice', 'Smart Dimension'), ('Extrude to a verified solid', 'extrude')],
       [{'src': 'sketchbench', 'in': 1.5, 'speed': 1.7, 'zoom': [[0, 720, 640, 1200], [6, 720, 600, 900], [12, 720, 640, 1100]]}]),
    ch('production', 'Production features',
       'One sentence adds an involute gear, a metric thread, a loft, or a pipe swept along a bent path.',
       [('ISO gears and metric threads', 'gear'), ('Lofts and sweeps', 'loft')],
       [{'src': 'production', 'in': 1.0, 'speed': 1.8, 'zoom': PUSH(10, 640, 1200, 950)}], tail=2.0),
    ch('edges', 'Fillet and chamfer any edge',
       'Point at any edge to fillet or chamfer it, even a curved one, or round every edge at once.',
       [('Fillet or chamfer the edge you point at', 'fillet'), ('Round every edge in one step', 'round every')],
       [{'src': 'edges', 'in': 3.5, 'speed': 1.7, 'zoom': PUSH(9, 640, 1150, 900)}], tail=2.0),
    ch('organic', 'Organic forms and real detail',
       'Push and pull a subdivision cage into a smooth organic form. Add real springs, knurls and lettering, then choose a finish.',
       [('Subdivision modelling', 'subdivision'), ('Springs, knurls and engraving', 'springs'), ('Metal, colour and carbon finishes', 'finish')],
       [{'src': 'surfaces', 'in': 14.8, 'speed': 1.2, 'dur': 5.0, 'zoom': PUSH(5, 640, 1100, 900)},
        {'src': 'mech', 'in': 3.0, 'speed': 1.8, 'zoom': PUSH(8, 640, 1150, 900)}], tail=2.0),
    ch('prop', 'Blades and propellers',
       'Propellers are built from NACA airfoil sections, tapered and twisted along the span.',
       [('NACA four-digit airfoils', 'NACA'), ('Taper and twist from root to tip', 'twisted')],
       [{'src': 'prop', 'in': 0.5, 'speed': 1.2, 'zoom': PUSH(8, 640, 1100, 880)}]),
    ch('sheetweld', 'Sheet metal and weldments',
       'Sheet metal works like it does at the bench, with flanges and hems. Sketch a frame, and it becomes welded tube with a cut list.',
       [('Flanges, hems and flat patterns', 'flanges'), ('Weldments with a cut list', 'frame')],
       [{'src': 'sheet', 'in': 0.5, 'speed': 1.6, 'dur': 6.0, 'zoom': [[0, 720, 720, 1440], [6, 720, 700, 1360]]},
        {'src': 'weld', 'in': 9.0, 'speed': 1.4, 'zoom': [[0, 740, 680, 1360], [6, 740, 660, 1180]]}], tail=2.0),
    ch('mould', 'Moulds and castings',
       'Ready to mould it? Draft analysis colours every face, the parting line is found, and the core and cavity are made.',
       [('Draft analysis on every face', 'Draft'), ('Parting line, core and cavity', 'parting line')],
       [{'src': 'mould', 'in': 4.0, 'speed': 1.3, 'zoom': PUSH(10, 640, 1100, 860)}], tail=2.0),
    ch('test', 'Test it with your hand',
       'Push with your open palm, and the stress solver runs live. Three rule-based agents read the result and suggest the fix.',
       [('A live load from your open palm', 'palm'), ('A stress preview, solved on the headset', 'stress solver'), ('Rule-based agents suggest the fix', 'agents')],
       [{'src': 'test', 'in': 19.0, 'zoom': [[0, 720, 720, 1440], [2.0, 640, 700, 960]]}]),
    ch('lighter', 'Lighter, and steady',
       'Grow bone strips away the material the load does not need, and vibration finds each natural frequency.',
       [('Topology optimisation on the headset', 'Grow bone'), ('Natural frequencies and mode shapes', 'vibration')],
       [{'src': 'grow', 'in': 1.0, 'dur': 5.0}, {'src': 'modes', 'in': 1.0}]),
    ch('assembly', 'Assemblies in motion',
       'Assemble parts with mates. Turn the hinge, and a four-bar linkage runs through its full revolution.',
       [('Mates: hinges, sliders, gears, screws', 'mates'), ('A four-bar linkage in motion', 'linkage')],
       [{'src': 'assembly2', 'in': 8.5, 'dur': 3.8, 'zoom': [[0, 720, 700, 1400], [3.8, 720, 680, 1250]]}, {'src': 'assembly2', 'in': 20.5, 'zoom': [[0, 720, 680, 1250], [6, 720, 660, 1150]]}], tail=2.0),
    ch('drawings', 'Drawings and STEP',
       'Every part has its drawing, with views and geometric tolerances to ISO, and exports as STEP for SOLIDWORKS, CATIA or Creo.',
       [('Drawings with GD&T to ISO', 'drawing'), ('STEP export with true cylinders', 'STEP')],
       [{'src': 'drawings', 'in': 1.0, 'speed': 1.25, 'zoom': [[0, 720, 720, 1440], [3.6, 720, 720, 1440], [6, 790, 760, 1000], [8.8, 780, 700, 1050], [12.5, 760, 620, 950]]}]),
    ch('share', 'Take it with you',
       'Share it with a code, design together with another headset, and use captions, dwell and one-handed mode.',
       [('Share codes: no server', 'Share'), ('Co-design with another headset', 'together'), ('Captions, dwell and one hand', 'captions')],
       [{'src': 'share', 'in': 0.5, 'dur': 4.0}, {'src': 'codesign', 'in': 1.0, 'dur': 3.5}, {'src': 'access', 'in': 0.5}]),
    ch('outro', 'AstraCAD Spatial',
       'No install, no account, no server. AstraCAD Spatial: design anything, right where you are.',
       [('Open the link in the Quest browser', 'install'), ('osmiumuas-wq.github.io/astracad-spatial', 'AstraCAD Spatial')],
       [{'src': 'hero', 'in': 6.0, 'zoom': [[0, 720, 760, 1300], [12, 720, 720, 1440]]}], kind='title', kicker='Design anything, right where you are.', tail=4.0),
]

film = {'comment': 'The competition cut (under 3 minutes): every shot is the real app recorded in the XR emulator (artifacts/video/scenes/<src>, 1440 px). Fields as in film.json.', 'chapters': chapters}
open('scripts/video/cut.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(film, indent=1, ensure_ascii=False) + '\n')
print(len(chapters), 'chapters')
