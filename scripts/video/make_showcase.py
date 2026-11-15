"""Writes scripts/video/showcase.json, the showcase film: chapters, narration, bullets (cued by a word of the
narration, in its order) and clips (take, in-point, speed, zoom keyframes). Run from the repository root."""
import json

PUSH = lambda t1=12, cy=640, side0=1180, side1=960: [[0, 720, cy + 20, side0], [t1, 720, cy, side1]]  # noqa: E731


def ch(id, title, narration, bullets, clips, **kw):
    at = [narration.find(cue) for _, cue in bullets]
    assert all(a >= 0 for a in at), (id, bullets)
    assert at == sorted(at), (id, 'bullet cues out of narration order')
    d = {'id': id, 'title': title, 'narration': narration, 'bullets': [list(b) for b in bullets], 'clips': clips}
    d.update(kw)
    return d


chapters = [
    ch('intro', 'AstraCAD Spatial',
       'AstraCAD Spatial is a complete CAD workstation inside Meta Quest. Sketch, model, assemble, test and make real parts, with your hands and your voice, and every part is checked before it leaves the bench.',
       [('Sketch, model, assemble, test and manufacture', 'Sketch'), ('Hands and voice, in your own room', 'hands'), ('Every part checked by exact maths', 'checked')],
       [{'src': 'hero', 'in': 1.0, 'zoom': [[0, 720, 720, 1440], [14, 720, 760, 1280]]}], kind='title', kicker='CAD for Meta Quest'),
    ch('bench', 'The bench, in your room',
       'It runs in the Quest browser, with nothing to install. The bench lands on your desk, anchors to the room, and a guide lights up each next step.',
       [('WebXR in the Quest Browser: no install', 'browser'), ('Anchored to your room', 'anchors'), ('A guide for each next step', 'guide')],
       [{'src': 'arrive', 'in': 0.3}]),
    ch('shape', 'Shape it with your hands',
       'Pinch a handle and pull. The kernel rebuilds the solid as you move, and the truth gate checks it against an exact formula, to better than one part in a billion.',
       [('Pinch and pull: the solid rebuilds live', 'rebuilds'), ('Truth gate: closed-form volume, size and holes', 'truth gate'), ('A part that fails is never shown as verified', 'billion')],
       [{'src': 'shape', 'in': 4.0, 'zoom': [[0, 720, 720, 1440], [4.5, 720, 720, 1440], [6.5, 560, 560, 880]]}]),
    ch('voice', 'Or just say it',
       'Or just say it. Speech is recognised on the headset, and every size comes from your words. Type it if you prefer: the same commands work either way.',
       [('Speech recognised on the headset', 'recognised'), ('Sizes come only from your words', 'words'), ('Voice and typing share one command set', 'Type')],
       [{'src': 'voice', 'in': 0.5}]),
    ch('sketchbench', 'A real sketcher',
       'Point at any face and open a sketch. Lines chain and snap to points, centres and midpoints. A tangent arc, a circle, then Smart Dimension: say forty five, and the solver makes it so. Extrude, and the profile becomes a verified solid.',
       [('Line, rectangle, circle, arc, slot, polygon', 'Lines'), ('Snaps and relations, solved by FreeCAD\'s planeGCS', 'snap'), ('Smart Dimension by voice; degrees of freedom shown', 'Smart Dimension'), ('Extrude, cut or revolve every closed region', 'Extrude')],
       [{'src': 'sketchbench', 'in': 1.5, 'zoom': [[0, 720, 640, 1200], [10, 720, 600, 900], [20, 720, 640, 1100]]}]),
    ch('sketchtools', 'Every sketch tool',
       'The sketch tools you expect: fillet a corner, offset an outline, mirror, trim and extend, draw splines and ellipses, and sketch on planes at any angle.',
       [('Fillet, offset, mirror, trim, extend', 'fillet'), ('Splines, ellipses and sketch patterns', 'splines'), ('Offset and angled sketch planes', 'angle')],
       [{'src': 'sketchtools', 'in': 2.0, 'speed': 1.5, 'zoom': PUSH(14, 620, 1150, 880)}]),
    ch('ribbon', 'Every feature, one ribbon',
       'Every feature lives in a ribbon of tabs: create, holes, modify, sheet metal and output. Add a boss, drill a hole where you point, pattern it round, and fillet the result.',
       [('A ribbon of tabs, pressed by hand', 'ribbon'), ('Create, holes, modify, sheet metal, output', 'create'), ('Holes where you point, patterns, fillets', 'pattern')],
       [{'src': 'ribbon', 'in': 0.3, 'speed': 1.7, 'zoom': [[0, 600, 660, 1300], [5, 600, 660, 1300], [8, 760, 620, 1000]]}]),
    ch('production', 'Production features',
       'Production features come from a sentence: an involute spur gear, a metric thread, a loft from a rectangle to a circle, and a pipe swept along a bent path.',
       [('ISO involute gears and metric threads', 'involute'), ('Lofts between any two profiles', 'loft'), ('Sweeps along paths with round bends', 'swept')],
       [{'src': 'production', 'in': 1.0, 'speed': 1.45, 'zoom': PUSH(16, 640, 1200, 950)}]),
    ch('edges', 'Fillet and chamfer any edge',
       'Point at any edge, straight or curved. A rolling ball follows tangent edges, chamfers follow any curve, and round all edges does the whole part at once.',
       [('Rolling-ball fillets that follow tangent edges', 'rolling ball'), ('Chamfers on curved edges', 'chamfers'), ('Round every edge in one step', 'round all')],
       [{'src': 'edges', 'in': 1.0, 'speed': 1.5, 'zoom': PUSH(14, 640, 1150, 900)}]),
    ch('surfaces', 'Freeform and organic',
       'For shapes that are not boxes, pull the control points of a B-spline surface by hand. Or push and pull a subdivision cage, mirrored left to right, into a smooth organic solid.',
       [('B-spline surfaces shaped by their control points', 'B-spline'), ('Subdivision modelling with symmetry', 'subdivision'), ('Smooth, closed and measured', 'smooth')],
       [{'src': 'surfaces', 'in': 1.5, 'speed': 1.3, 'dur': 6.5, 'zoom': PUSH(7, 640, 1200, 980)}, {'src': 'surfaces', 'in': 14.8, 'zoom': PUSH(8, 640, 1100, 900)}]),
    ch('mech', 'Springs, knurls and finish',
       'Mechanical details are real geometry: a closed-end compression spring, a diamond knurl with real teeth, and lettering engraved into the face. Then choose how it looks: anodised, brushed aluminium, or carbon fibre.',
       [('Springs and coils on a helix', 'spring'), ('Real knurling and engraved lettering', 'knurl'), ('Appearances: metals, colours, carbon, wood', 'anodised')],
       [{'src': 'mech', 'in': 0.5, 'speed': 1.35, 'zoom': PUSH(14, 640, 1150, 900)}]),
    ch('prop', 'Blades and propellers',
       'Fans and propellers are built from NACA airfoil sections, tapered and twisted along the span, and joined to their hub.',
       [('NACA four-digit airfoils', 'NACA'), ('Taper and twist from root to tip', 'twisted'), ('Any number of blades round a hub', 'hub')],
       [{'src': 'prop', 'in': 0.5, 'zoom': PUSH(10, 640, 1100, 880)}]),
    ch('sheet', 'Sheet metal',
       'Sheet metal works like it does at the bench: a base flange, edge flanges at any angle, a hem, a flange on a flange. Then save the flat pattern as DXF, with every bend allowance worked out.',
       [('Flanges, hems, jogs and mitre flanges', 'edge flanges'), ('Exact bends, verified in closed form', 'hem'), ('Flat pattern DXF with bend allowance', 'flat pattern')],
       [{'src': 'sheet', 'in': 0.5, 'speed': 1.3, 'zoom': [[0, 720, 720, 1440], [16, 720, 690, 1320]]}]),
    ch('weld', 'Weldments',
       'Sketch a frame as lines, and turn it into structural members: square tube here. The cut list gives every length and its mass.',
       [('From any frame sketch', 'frame'), ('Tube, angle and flat-bar members', 'structural members'), ('A cut list with lengths and mass', 'cut list')],
       [{'src': 'weld', 'in': 1.0, 'speed': 1.6, 'zoom': [[0, 740, 680, 1360], [10, 740, 660, 1180]]}]),
    ch('mould', 'Moulds and castings',
       'Ready to mould it? Draft analysis colours every face: green and blue release, amber needs draft. Then find the parting line, and split a mould block into core and cavity.',
       [('Draft analysis on every face', 'Draft analysis'), ('The parting line, found and drawn', 'parting line'), ('Core and cavity, with shrinkage', 'core and cavity')],
       [{'src': 'mould', 'in': 0.5, 'speed': 1.25, 'zoom': PUSH(12, 640, 1100, 860)}]),
    ch('config', 'Equations and configurations',
       'Design intent stays editable. A variable drives the flange through an equation. Save configurations, and switch the whole part between them.',
       [('Global variables and equations', 'variable'), ('Configurations of the whole part', 'configurations'), ('A design table for every size', 'switch')],
       [{'src': 'config', 'in': 0.5, 'speed': 1.6, 'zoom': [[0, 770, 680, 1320], [12, 770, 660, 1160]]}]),
    ch('test', 'Test it with your hand',
       'Now test it. Push with your open palm, and the stress solver runs live, cross-checked against CalculiX. Three engineering agents read every result and suggest the fix.',
       [('A live load from your open palm', 'palm'), ('Stress solver, checked against CalculiX', 'CalculiX'), ('Agents for strength, printing and cost', 'agents')],
       [{'src': 'test', 'in': 19.0, 'zoom': [[0, 720, 720, 1440], [2.0, 640, 700, 960]]}]),
    ch('lighter', 'Lighter, and steady',
       'Grow bone strips away the material the load does not need, and vibration finds each natural frequency and its mode shape.',
       [('Topology optimisation on the headset', 'Grow bone'), ('Natural frequencies and mode shapes', 'vibration')],
       [{'src': 'grow', 'in': 1.0, 'dur': 8.0}, {'src': 'modes', 'in': 1.0}]),
    ch('assembly', 'Assemblies in motion',
       'Assemble parts with mates: coincident, concentric, hinges, sliders, gears, screws and rack and pinion. Turn the hinge, and a four-bar linkage runs through its full revolution.',
       [('Mates, including gears, screws, racks and limits', 'mates'), ('Hinges you turn by hand, with limits', 'hinge'), ('Closed loops solved, like a four-bar linkage', 'linkage')],
       [{'src': 'assembly2', 'in': 2.0, 'speed': 1.3, 'dur': 6.5, 'zoom': [[0, 720, 700, 1440], [6.5, 720, 680, 1250]]}, {'src': 'assembly2', 'in': 19.5, 'zoom': [[0, 720, 680, 1250], [8, 720, 660, 1100]]}]),
    ch('drawings', 'Drawings and STEP',
       'Every part has its drawing: three views, hidden edges dashed, and geometric tolerances to ISO. And it exports as STEP, with true cylinders, straight into SOLIDWORKS, CATIA or Creo.',
       [('Hidden-line views and assembly drawings', 'hidden edges'), ('GD&T: datums and feature control frames', 'tolerances'), ('STEP export with true cylinders', 'STEP')],
       [{'src': 'drawings', 'in': 1.0, 'zoom': [[0, 720, 720, 1440], [4.5, 720, 720, 1440], [7.5, 790, 760, 1000], [11, 780, 700, 1050], [15.7, 760, 620, 950]]}]),
    ch('share', 'Take it with you',
       'When it is right, take it with you: STL or 3MF for your slicer, G-code sliced on the headset, a share code for your phone, or a co-design room another headset can join.',
       [('STL, 3MF and G-code', 'G-code'), ('A share code: no server', 'share code'), ('Co-design with another headset', 'co-design')],
       [{'src': 'share', 'in': 0.5, 'dur': 9.0}, {'src': 'codesign', 'in': 1.0}]),
    ch('access', 'Made for everyone',
       'Captions, dwell to select, large text and one-handed use are built in, and on Meta\'s glasses the layout fits the narrower view.',
       [('Captions, dwell and large text', 'Captions'), ('One-handed use', 'one-handed'), ('Fits Meta\'s glasses', 'glasses')],
       [{'src': 'access', 'in': 0.5, 'dur': 8.0}, {'src': 'glasses', 'in': 0.5}]),
    ch('outro', 'AstraCAD Spatial',
       'Two hundred and forty engine tests. No install, no account, no server. AstraCAD Spatial: design anything, right where you are.',
       [('240 engine tests, all passing', 'tests'), ('Works offline: no account, no server', 'server'), ('osmiumuas-wq.github.io/astracad-spatial', 'AstraCAD Spatial')],
       [{'src': 'hero', 'in': 6.0, 'zoom': [[0, 720, 760, 1300], [14, 720, 720, 1440]]}], kind='title', kicker='Design anything, right where you are.', tail=4.0),
]

film = {'comment': 'The showcase film: every shot is the real app recorded in the XR emulator (artifacts/video/scenes/<src>, 1440 px). Fields as in film.json.', 'chapters': chapters}
open('scripts/video/showcase.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(film, indent=1, ensure_ascii=False) + '\n')
print(len(chapters), 'chapters')
