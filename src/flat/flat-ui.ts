/**
 * The flat page: what a visitor sees before entering the headset, and what a
 * phone or PC shows when a QR code from the bench is scanned. It drives the
 * same application state as the immersive bench, so a part can be inspected,
 * re-verified and downloaded here without a headset.
 */

import { effect, VisibilityState, World } from '@iwsdk/core';
import qrcode from 'qrcode-generator';
import { AGENTS, Finding } from '../engine/agents.js';
import { JOBS } from '../engine/jobs.js';
import { MATERIALS } from '../engine/materials.js';
import { toThreeMF } from '../engine/threemf.js';
import { stressColor } from '../app/palette.js';
import { App } from '../app/app.js';
import { Bench } from '../app/bench.js';
import { CoDesign } from '../app/codesign.js';
import { describe } from '../engine/describe.js';
import { parseCommand } from '../engine/commands.js';
import { recognise as recogniseStep } from '../engine/step-import.js';
import { ctx } from '../app/context.js';
import { FlowSystem } from '../systems/flow-system.js';
import { HingeSystem } from '../systems/hinge-system.js';
import { ModeSystem } from '../systems/mode-system.js';
import { Sfx } from '../app/sfx.js';
import { clampZoom } from '../app/view-zoom.js';

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((ev: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') {
      el.addEventListener(k, v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (v !== false) {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c) {
      el.append(c);
    }
  }
  return el;
}

function download(data: Uint8Array | string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A QR code for `text`, at the strongest error correction it fits in; null when it is too long for any. */
function makeQr(text: string): ReturnType<typeof qrcode> | null {
  for (const level of ['M', 'L'] as const) {
    try {
      const qr = qrcode(0, level);
      qr.addData(text);
      qr.make();
      return qr;
    } catch {
      // Too long at this level: try the next one.
    }
  }
  return null;
}

/**
 * Draw a QR code for `text` onto a canvas (dark modules on a light quiet zone). A link too long for any QR
 * code (a large free design) draws a note to use the link instead; it never throws, because it runs inside
 * the parameter effects and a throw there would stop the part rebuilding. Returns whether a code was drawn.
 */
export function drawQr(canvas: HTMLCanvasElement, text: string, size = 220): boolean {
  const qr = makeQr(text);
  if (!qr) {
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, size, size);
    c.fillStyle = '#0b1220';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `600 ${Math.round(size / 12)}px system-ui, sans-serif`;
    c.fillText('Too large for a QR code:', size / 2, size / 2 - size / 14);
    c.fillText('use the link', size / 2, size / 2 + size / 14);
    return false;
  }
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = Math.max(1, Math.floor(size / (n + quiet * 2)));
  const total = cell * (n + quiet * 2);
  canvas.width = total;
  canvas.height = total;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, total, total);
  c.fillStyle = '#0b1220';
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) {
        c.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
      }
    }
  }
  return true;
}

const VERDICT_TEXT: Record<string, string> = {
  verified: 'Verified: closed form and kernel agree',
  'kernel-only': 'Kernel only: no closed form applies',
  refused: 'Refused',
};

export function mountFlatUi(world: World, app: App, bench: Bench, sfx: Sfx, codesign: CoDesign): void {
  const root = h('aside', { id: 'flat', class: 'glass', 'aria-label': 'AstraCAD Spatial' });
  document.body.append(root);
  const toast = h('div', { id: 'toast', class: 'glass', role: 'status', 'aria-live': 'polite' });
  document.body.append(toast);

  // ----- header --------------------------------------------------------------
  const enter = h('button', { class: 'primary', type: 'button', click: () => {
    sfx.resume();
    world.launchXR();
  } }, 'Enter the bench');
  const xrHint = h('p', { class: 'hint' }, 'Checking for a headset...');
  root.append(
    h('header', {},
      h('div', { class: 'brand' },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, 'A'),
        h('b', {}, 'ASTraCAD'),
        h('span', { class: 'crumb' }, '/ SPATIAL'),
        h('span', { class: 'pill live' }, 'Verified'),
      ),
      h('div', { class: 'eyebrow' }, 'Hands-first product studio'),
      h('h1', {}, 'Measure the real thing. Get the part that fits.'),
      h('p', { class: 'lede' }, 'Pinch a real object to size a part, shape it with your fingers, push it to test it, and take the file with you. Hands only.'),
      enter,
      xrHint,
    ),
  );
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!world.xrEnabled || !xr) {
    enter.disabled = true;
    xrHint.textContent = 'This browser has no WebXR. Open this page in the Meta Quest Browser to use your hands. Everything below still works here.';
  } else {
    xr.isSessionSupported('immersive-ar').then(
      (ok) => {
        enter.disabled = !ok;
        xrHint.textContent = ok
          ? 'Seated, hands only. No controllers needed.'
          : 'Mixed reality is not available on this device. Open this page in the Meta Quest Browser. Everything below still works here.';
      },
      () => {
        enter.disabled = true;
        xrHint.textContent = 'WebXR is blocked on this page. Everything below still works here.';
      },
    );
  }

  // ----- describe it ---------------------------------------------------------
  const descText = h('textarea', {
    rows: 2,
    'aria-label': 'Describe a part',
    placeholder: 'e.g. wall bracket, 100 mm arm, 80 high, 30 wide, M5 screws, PETG  -  or  make the arm 20 mm longer',
  });
  const descOut = h('div', { class: 'describe' });
  const descGo = h('button', { type: 'button', class: 'go' }, 'Go');
  const descMic = h('button', { type: 'button', title: 'Say it instead of typing (the microphone stays on this device)' }, 'Talk');
  const runDescribe = (): void => {
    descOut.replaceChildren();
    // Edits and actions ("make the arm 20 mm longer", "test it") run at once; a new part asks for missing sizes.
    const cmd = parseCommand(descText.value, app.job, app.params.peek());
    if (cmd.kind !== 'describe') {
      descOut.append(h('p', { class: 'note' }, app.runCommand(descText.value)));
      return;
    }
    const r = describe(cmd.text);
    if ('error' in r) {
      descOut.append(h('p', { class: 'note' }, r.error));
      return;
    }
    if (r.understood.length) descOut.append(h('p', { class: 'note' }, `Understood: ${r.understood.join(', ')}.`));
    if (!r.ask.length) {
      app.applyDescribed(r, {});
      return;
    }
    // Ask for every key size the text did not give, with a sensible default filled in.
    const inputs = r.ask.map((q) => {
      const input = h('input', { type: 'number', step: 'any', value: String(q.value), 'aria-label': q.label });
      descOut.append(h('label', { class: 'field' }, h('span', {}, `${q.label}${q.unit ? ` (${q.unit})` : ''}`), input));
      return { q, input };
    });
    descOut.append(
      h('button', { type: 'button', class: 'go', click: () => {
        const answers: Record<string, number> = {};
        for (const { q, input } of inputs) {
          const v = Number(input.value);
          if (Number.isFinite(v)) answers[q.id] = v;
        }
        app.applyDescribed(r, answers);
        descOut.replaceChildren(h('p', { class: 'note' }, 'Built. Shape it further on the bench.'));
      } }, 'Build it'),
    );
  };
  descGo.addEventListener('click', runDescribe);
  descText.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      runDescribe();
    }
  });
  descMic.addEventListener('click', async () => {
    const v = ctx.voice;
    try {
      const text = await v.listen();
      if (text) {
        descText.value = text;
        runDescribe();
        v.speak(app.notice.peek()?.text ?? '');
      }
    } catch (e) {
      descOut.replaceChildren(h('p', { class: 'note' }, e instanceof Error ? e.message : String(e)));
    }
  });
  effect(() => {
    const st = ctx.voice.state.value;
    const pct = ctx.voice.loading.value;
    descMic.textContent = st === 'listening' ? 'Listening (tap to stop)' : st === 'thinking' ? 'Thinking...' : st === 'loading' ? `Loading voice ${pct}%` : 'Talk';
    descMic.classList.toggle('go', st === 'listening');
    if (st === 'listening' && ctx.voice.heard.value) descText.value = ctx.voice.heard.value;
  });
  root.append(
    h('section', {},
      h('h2', {}, 'Tell it'),
      descText,
      h('div', { class: 'row' }, descGo, descMic),
      descOut,
      h('p', { class: 'hint' }, 'Describe a new part, or change this one: "make the arm 20 mm longer", "double the thickness", "two more bolts", "in aluminium", "test it", "make it stronger", "show the drawing", "undo". Word rules, no AI service; voice is recognised on this device.'),
    ),
  );

  // ----- jobs and material ---------------------------------------------------
  const jobChips = h('div', { class: 'chips' });
  for (const job of JOBS) {
    jobChips.append(h('button', { type: 'button', 'data-job': job.id, title: job.blurb, click: () => app.selectJob(job.id) }, job.title));
  }
  const materialSelect = h('select', { 'aria-label': 'Material', change: (ev) => app.setMaterial((ev.target as HTMLSelectElement).value) });
  for (const m of MATERIALS) {
    materialSelect.append(h('option', { value: m.id }, m.name));
  }
  root.append(h('section', {}, h('h2', {}, 'Part'), jobChips, h('label', { class: 'field' }, h('span', {}, 'Material'), materialSelect)));

  // ----- parameters ----------------------------------------------------------
  const paramBox = h('div', { class: 'params' });
  const clampNote = h('p', { class: 'note' });
  const btnUndo = h('button', { type: 'button', title: 'Undo (Ctrl+Z)', click: () => app.undo() }, 'Undo');
  const btnRedo = h('button', { type: 'button', title: 'Redo (Ctrl+Y or Ctrl+Shift+Z)', click: () => app.redo() }, 'Redo');
  root.append(h('section', {}, h('h2', {}, 'Dimensions'), h('div', { class: 'row' }, btnUndo, btnRedo), paramBox, clampNote));
  effect(() => {
    btnUndo.disabled = !app.history.canUndo.value;
    btnRedo.disabled = !app.history.canRedo.value;
  });
  window.addEventListener('keydown', (ev) => {
    const typing = ev.target instanceof HTMLInputElement && ev.target.type === 'text';
    if (typing || !(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      app.undo();
    } else if (k === 'y' || (k === 'z' && ev.shiftKey)) {
      ev.preventDefault();
      app.redo();
    }
  });

  // ----- proof ---------------------------------------------------------------
  const verdict = h('div', { class: 'verdict' });
  const checks = h('ul', { class: 'checks' });
  root.append(h('section', {}, h('h2', {}, 'Truth gate'), verdict, checks));

  // ----- test ----------------------------------------------------------------
  const loadLabel = h('span', {}, '');
  const loadRange = h('input', { type: 'range', min: 0, max: 300, step: 1, 'aria-label': 'Load in newtons', input: (ev) => app.setLoad(Number((ev.target as HTMLInputElement).value)) });
  const testStatus = h('p', { class: 'note' });
  const agentLog = h('ol', { class: 'log' });
  const btnTest = h('button', { type: 'button', click: () => void app.runTest() }, 'Run load test');
  const btnFix = h('button', { type: 'button', click: () => void app.autoReinforce() }, 'Let Marcus reinforce');
  const btnGrow = h('button', { type: 'button', click: () => void app.grow(0.55) }, 'Grow bone (keep 55 %)');
  const btnSolid = h('button', { type: 'button', click: () => app.clearGrown() }, 'Back to solid');
  const btnFlow = h('button', { type: 'button', title: 'Ideal flow around the part: where the air goes. No wake, no forces.', click: () => {
    world.getSystem(FlowSystem)?.toggle();
  } }, 'Air flow preview');
  root.append(
    h('section', {},
      h('h2', {}, 'Load test'),
      h('div', { class: 'row' }, btnTest, btnFix),
      h('div', { class: 'row' }, btnGrow, btnSolid, btnFlow,
        h('button', { type: 'button', title: 'Natural frequencies and mode shapes. Press again for the next mode.', click: () => world.getSystem(ModeSystem)?.toggle() }, 'Vibration modes'),
        h('button', { type: 'button', title: 'Hinge only: swing leaf B until the leaves touch.', click: () => world.getSystem(HingeSystem)?.toggle() }, 'Swing hinge')),
      h('label', { class: 'field' }, loadLabel, loadRange),
      testStatus,
      agentLog,
    ),
  );

  // ----- agents --------------------------------------------------------------
  const agentBox = h('div', { class: 'agents' });
  root.append(h('section', {}, h('h2', {}, 'Agents'), agentBox));

  // ----- keep ----------------------------------------------------------------
  const qr = h('canvas', { class: 'qr', 'aria-label': 'QR code linking to this part' });
  const link = h('input', { type: 'text', readonly: true, 'aria-label': 'Link to this part' });
  root.append(
    h('section', {},
      h('h2', {}, 'Take it'),
      h('div', { class: 'row' },
        h('button', { type: 'button', click: () => { sfx.resume(); if (app.save()) { sfx.play('save'); } } }, 'Save to shelf'),
        h('button', { type: 'button', click: async () => {
          const files = await app.exportFiles();
          if (files) {
            download(files.stl, `${files.name}.stl`, 'model/stl');
          }
        } }, 'Download STL'),
        h('button', { type: 'button', click: async () => {
          const files = await app.exportFiles();
          if (files) {
            download(files.json, `${files.name}.astracad.json`, 'application/json');
          }
        } }, 'Download record'),
        h('button', { type: 'button', title: 'With the stress map as vertex colours, when the part has been tested', click: () => {
          const built = app.built.peek();
          const grown = app.grown.peek();
          const mesh = grown?.final ? grown.mesh : built?.mesh;
          if (!mesh) return;
          const s = app.stress.peek();
          let colors: Float32Array | null = null;
          if (s && s.vertexStress.length * 3 === mesh.positions.length) {
            colors = new Float32Array(mesh.positions.length);
            const k = app.loadN.peek() / s.newtons / app.materialData.yield;
            const safe = app.settings.peek().colorSafe;
            for (let v = 0; v < s.vertexStress.length; v++) stressColor(s.vertexStress[v] * k, safe, colors, v * 3);
          }
          const res = toThreeMF(mesh.positions, mesh.indices, colors, app.job.title);
          download(res.bytes, `${app.job.id}${colors ? '_stress' : ''}.3mf`, 'model/3mf');
          app.say(colors ? `3MF saved with ${res.colors} stress colours.` : '3MF saved. Run a load test first to include stress colours.', 'good');
        } }, 'Download 3MF'),
        h('button', { type: 'button', title: 'Front, top and right views with dimensions and a title block (A4, SVG)', click: async () => {
          const d = await app.makeDrawing();
          if (d) {
            download(d.svg, `${d.name}_drawing.svg`, 'image/svg+xml');
            app.say(`Drawing saved${d.holes ? ` with ${d.holes} through-hole callout${d.holes === 1 ? '' : 's'}` : ''}. Open it in a browser to print or save as PDF.`, 'good');
          }
        } }, 'Download drawing'),
        h('button', { type: 'button', title: 'A solid B-rep (AP214) that SOLIDWORKS, CATIA, Creo and Fusion open', click: () => {
          const s = app.exportStep();
          if (s) {
            download(s.step, `${s.name}.step`, 'model/step');
            app.say(`STEP saved: one solid, ${s.faces} faces.`, 'good');
          }
        } }, 'Download STEP'),
      ),
      h('div', { class: 'share' }, qr, h('div', {}, h('p', { class: 'note' }, 'Scan to open this exact part on another device. The link holds the part; no server is involved.'), link)),
    ),
  );

  // ----- STEP import ---------------------------------------------------------
  const stepStatus = h('p', { class: 'note', role: 'status' }, 'Bring a part from SOLIDWORKS, Fusion, Onshape or FreeCAD. A cradle is fitted round it, and it rides into the headset on the bench.');
  const stepInput = h('input', {
    type: 'file', accept: '.step,.stp,.STEP,.STP', 'aria-label': 'STEP file',
    change: async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      stepStatus.textContent = `Reading ${file.name}... (the first file loads the 7.6 MB OpenCascade reader)`;
      try {
        const { importStepFile } = await import('../app/step-loader.js');
        const m = await importStepFile(file);
        app.useReference(m);
        stepEditable.hidden = recogniseStep(m) === null;
        stepStatus.textContent = `${m.name}: ${(m.box.max[0] - m.box.min[0]).toFixed(1)} x ${(m.box.max[2] - m.box.min[2]).toFixed(1)} x ${(m.box.max[1] - m.box.min[1]).toFixed(1)} mm` +
          `${Number.isFinite(m.volume) ? `, ${(m.volume / 1000).toFixed(2)} cm3` : ' (the mesh is not closed, so no volume)'}, ${m.bodies} bod${m.bodies === 1 ? 'y' : 'ies'}.`;
      } catch (e) {
        stepStatus.textContent = e instanceof Error ? e.message : String(e);
      }
    },
  });
  const stepEditable = h('button', { type: 'button', class: 'go', hidden: true, click: () => {
    stepStatus.textContent = app.runCommand('make it editable');
    stepEditable.hidden = true;
  } }, 'Make editable');
  root.append(h('section', {}, h('h2', {}, 'Import STEP'), stepInput, stepStatus, stepEditable));

  // ----- co-design -----------------------------------------------------------
  const coStatus = h('p', { class: 'note', role: 'status' });
  const coCode = h('input', { type: 'text', inputmode: 'numeric', maxlength: 7, placeholder: '123 456', 'aria-label': 'Room code' });
  const coHost = h('button', { type: 'button', click: () => void codesign.host() }, 'Start a room');
  const coJoin = h('button', { type: 'button', click: () => void codesign.join(coCode.value) }, 'Join');
  const coLeave = h('button', { type: 'button', click: () => codesign.leave() }, 'Leave room');
  const coQr = h('canvas', { class: 'qr', 'aria-label': 'QR code to join this room' });
  const coLink = h('input', { type: 'text', readonly: true, 'aria-label': 'Link to join this room' });
  const coShare = h('div', { class: 'share' }, coQr, h('div', {}, h('p', { class: 'note' }, 'Your partner scans this or opens the link, on a headset, phone or PC.'), coLink));
  const coForm = h('div', { class: 'row' }, coHost, coCode, coJoin);
  root.append(
    h('section', {},
      h('h2', {}, 'Co-design'),
      h('p', { class: 'note' }, 'Two people, one part. A free public service (PeerJS) introduces the two browsers; the part and hands then go directly between them.'),
      coForm,
      coLeave,
      coShare,
      coStatus,
    ),
  );
  effect(() => {
    const status = codesign.status.value;
    const code = codesign.code.value;
    const error = codesign.error.value;
    const inRoom = status !== 'off' && status !== 'failed';
    coForm.hidden = inRoom;
    coLeave.hidden = !inRoom;
    coShare.hidden = !(status === 'waiting' && code);
    if (status === 'waiting' && code) {
      const url = codesign.joinUrl(code);
      drawQr(coQr, url, 180);
      coLink.value = url;
    }
    const spaced = code ? `${code.slice(0, 3)} ${code.slice(3)}` : '';
    coStatus.textContent =
      status === 'starting' ? 'Opening a room...'
      : status === 'waiting' ? `Room ${spaced} is open. Waiting for your partner.`
      : status === 'joining' ? `Joining room ${spaced}...`
      : status === 'connected' ? `Connected in room ${spaced}. You share one part.`
      : status === 'failed' ? (error ?? 'Co-design could not connect.')
      : (error ?? '');
  });

  // ----- shelf ---------------------------------------------------------------
  const shelf = h('div', { class: 'shelf' });
  const streak = h('p', { class: 'note' });
  root.append(h('section', {}, h('h2', {}, 'Your shelf'), streak, shelf));

  root.append(
    h('footer', {},
      h('p', { class: 'note' }, 'Stress results are a design preview on a voxel grid. Material values are typical datasheet figures. Verify before you rely on a part.'),
    ),
  );

  // ----- reactions -----------------------------------------------------------
  effect(() => {
    const id = app.jobId.value;
    jobChips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-job') === id));
    materialSelect.value = app.material.value;
  });

  // Rebuild the sliders when the job changes; update values in place otherwise.
  let builtFor = '';
  effect(() => {
    const job = JOBS.find((j) => j.id === app.jobId.value) ?? JOBS[0];
    const params = app.params.value;
    const selected = app.selected.value;
    if (builtFor !== job.id) {
      builtFor = job.id;
      paramBox.replaceChildren();
      for (const d of job.params) {
        const value = h('output', {}, '');
        const range = h('input', {
          type: 'range', min: d.min, max: d.max, step: d.fine, 'data-param': d.id, 'aria-label': d.label,
          input: (ev) => {
            app.dragging.value = true;
            app.selected.value = d.id;
            app.setParam(d.id, Number((ev.target as HTMLInputElement).value));
          },
          change: () => {
            app.dragging.value = false;
          },
        });
        paramBox.append(
          h('label', { class: 'param', 'data-param': d.id },
            h('span', { class: 'name' }, d.label, d.measure ? h('em', { title: d.prompt ?? '' }, d.measure === 'span' ? ' finger span' : ' two-hand tape') : null),
            value,
            range,
          ),
        );
      }
    }
    for (const d of job.params) {
      const row = paramBox.querySelector(`label[data-param="${d.id}"]`) as HTMLElement | null;
      if (!row || params[d.id] === undefined) continue;
      (row.querySelector('output') as HTMLOutputElement).textContent = d.unit === ''
        ? String(Math.round(params[d.id]))
        : `${params[d.id].toFixed(d.unit === 'deg' ? 1 : 2)} ${d.unit}`;
      const range = row.querySelector('input') as HTMLInputElement;
      if (document.activeElement !== range) {
        range.value = String(params[d.id]);
      }
      row.classList.toggle('on', selected === d.id);
    }
  });

  effect(() => {
    clampNote.textContent = app.clampNotes.value.join(' ');
  });

  effect(() => {
    const built = app.built.value;
    const refusal = app.refusal.value;
    const rolled = app.rollback.value;
    checks.replaceChildren();
    if (refusal) {
      verdict.className = 'verdict refused';
      verdict.textContent = `Refused: ${refusal}`;
      return;
    }
    if (!built) {
      verdict.className = 'verdict';
      verdict.textContent = 'Building...';
      return;
    }
    if (rolled !== null) {
      verdict.className = 'verdict rolled';
      verdict.textContent = `History view: ${built.applied} of ${built.features.length} features. Not judged.`;
      return;
    }
    verdict.className = `verdict ${built.gate.verdict}`;
    verdict.textContent = built.gate.verdict === 'refused' ? `Refused: ${built.gate.reason ?? ''}` : VERDICT_TEXT[built.gate.verdict];
    for (const c of built.gate.checks) {
      checks.append(h('li', { class: c.status }, h('b', {}, c.label), h('span', {}, c.detail)));
    }
    const p = built.props;
    checks.append(
      h('li', { class: 'info' }, h('b', {}, 'Kernel'), h('span', {}, `${p.volume.toFixed(2)} mm3, ${p.surfaceArea.toFixed(1)} mm2, ${p.triangles} triangles, built in ${built.ms.toFixed(0)} ms`)),
    );
  });

  effect(() => {
    const stress = app.stress.value;
    const busy = app.busy.value;
    const load = app.loadN.value;
    const grown = app.grown.value;
    void app.params.value;
    void app.material.value;
    loadLabel.textContent = `Load ${load.toFixed(0)} N`;
    if (document.activeElement !== loadRange) {
      loadRange.value = String(load);
    }
    btnSolid.hidden = !grown;
    for (const b of [btnTest, btnFix, btnGrow]) {
      b.disabled = busy !== null;
    }
    if (busy) {
      testStatus.textContent = `${busy.label}${busy.progress >= 0 ? ` ${(busy.progress * 100).toFixed(0)} %` : '...'}`;
    } else if (stress) {
      const sf = app.factor();
      testStatus.textContent =
        `${stress.loadLabel}; ${stress.fixtureLabel.toLowerCase()}. Peak ${(stress.stressP99 * load / stress.newtons).toFixed(1)} MPa, deflection ${(stress.maxDisp * load / stress.newtons).toFixed(2)} mm, ` +
        `safety factor ${sf === null ? '-' : sf.toFixed(2)}. ${stress.elements} cells, ${stress.iterations} iterations, ${stress.ms.toFixed(0)} ms.` +
        (grown?.final ? ` Grown shape: ${(grown.kept * 100).toFixed(0)} % of the material.` : '');
    } else {
      testStatus.textContent = 'Not tested yet.';
    }
  });

  effect(() => {
    agentLog.replaceChildren(...app.agentLog.value.map((line) => h('li', {}, line)));
  });

  effect(() => {
    const findings = app.findings.value;
    agentBox.replaceChildren();
    const card = (f: Finding): HTMLElement =>
      h('article', { class: `agent ${f.severity}` },
        h('div', { class: 'who' }, `${AGENTS[f.agent].name} - ${AGENTS[f.agent].role}`),
        h('h3', {}, f.title),
        h('p', {}, f.detail),
        h('p', { class: 'note' }, f.evidence),
        f.fix ? h('button', { type: 'button', click: () => { sfx.resume(); sfx.play('fix'); app.applyFix(f); } }, `Fix: ${f.fix.label}`) : null,
        f.fix ? h('p', { class: 'note' }, f.fix.expect) : null,
      );
    for (const f of findings) {
      agentBox.append(card(f));
    }
  });

  effect(() => {
    void app.params.value;
    void app.jobId.value;
    void app.material.value;
    const url = app.shareUrl();
    link.value = url;
    drawQr(qr, url, 180);
  });

  effect(() => {
    const parts = app.library.value;
    const p = app.progress.value;
    streak.textContent = parts.length
      ? `${p.partsSaved} part(s) made. Streak: ${p.streak} day(s).`
      : 'Parts you save appear here and on your desk in the headset.';
    shelf.replaceChildren(
      ...parts.map((part) =>
        h('div', { class: 'saved' },
          h('button', { type: 'button', class: 'load', click: () => app.loadSaved(part) },
            h('b', {}, part.title),
            h('span', {}, `${part.grams.toFixed(1)} g ${part.material.toUpperCase()}${part.fits ? `, fits ${part.fits}` : ''}`),
          ),
          h('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${part.title}`, click: () => app.removeSaved(part.id) }, 'x'),
        ),
      ),
    );
  });

  let toastTimer = 0;
  effect(() => {
    const n = app.notice.value;
    if (!n) {
      return;
    }
    toast.textContent = n.text;
    toast.className = `glass show ${n.tone}`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.className = 'glass';
    }, 4200);
  });

  effect(() => {
    const fatal = app.fatal.value;
    if (fatal) {
      verdict.className = 'verdict refused';
      verdict.textContent = fatal;
    }
  });

  // On a narrow screen the sheet covers the lower half: lift the part into the top half.
  const frame = (): void => {
    if (world.visibilityState.peek() !== VisibilityState.NonImmersive) return;
    const narrow = window.innerWidth < 760;
    bench.root.position.set(narrow ? 0.2 : 0.06, narrow ? 1.15 : 1.0, -0.5);
    bench.root.rotation.set(0, 0, 0);
  };
  window.addEventListener('resize', frame);
  frame();

  world.visibilityState.subscribe((state) => {
    const flat = state === VisibilityState.NonImmersive;
    root.hidden = !flat;
    toast.hidden = !flat;
    if (flat) frame();
  });

  // ----- orbit the part with mouse or touch ----------------------------------
  const canvas = world.renderer.domElement;
  let dragX: number | null = null;
  canvas.addEventListener('pointerdown', (ev) => {
    dragX = ev.clientX;
  });
  window.addEventListener('pointerup', () => {
    dragX = null;
  });
  window.addEventListener('pointermove', (ev) => {
    if (dragX !== null && world.visibilityState.peek() === VisibilityState.NonImmersive) {
      bench.turntable.rotation.y += (ev.clientX - dragX) * 0.008;
      dragX = ev.clientX;
    }
  });
  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (world.visibilityState.peek() === VisibilityState.NonImmersive) {
        ev.preventDefault();
        app.viewZoom.value = clampZoom(app.viewZoom.peek() * (ev.deltaY < 0 ? 1.08 : 0.926));
      }
    },
    { passive: false },
  );
}
