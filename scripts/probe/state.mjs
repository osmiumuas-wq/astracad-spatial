// Prints a JSON snapshot of the app state from the managed browser (debug aid).
export default async function run({ page, frame }) {
  const out = await (frame ?? page).evaluate(() => {
    const a = globalThis.astra;
    const v = (x) => x.toArray().map((n) => +n.toFixed(4));
    const hand = (h) => ({ pinchPoint: v(h.pinchPoint), thumb: v(h.thumbTip), tracked: h.tracked, open: h.open, openTime: +h.openTime.toFixed(2), pinching: h.pinching, gap: +(h.gap * 1000).toFixed(1), palm: v(h.palm), normal: v(h.palmNormal) });
    const s = a.app.stress.value;
    return {
      mode: a.app.mode.value,
      params: a.app.params.value,
      loadN: a.app.loadN.value,
      busy: a.app.busy.value,
      stress: s ? { custom: s.custom, newtons: s.newtons, p99: s.stressP99, label: s.loadLabel } : null,
      factor: a.app.factor(),
      right: hand(a.hands.right),
      left: hand(a.hands.left),
      bench: v(a.bench.root.position),
      notice: a.app.notice.value?.text,
      probe: a.probe,
    };
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
