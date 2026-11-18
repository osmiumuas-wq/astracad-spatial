// The on-device language model (all-MiniLM-L6-v2, shipped in public/models) on sentences it has
// never seen: none of these is in the intent catalogue. Runs offline from the shipped files.
import { fileURLToPath } from 'node:url';
import { env, pipeline } from '@huggingface/transformers';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogue, decide, INTENTS, MATCH_FLOOR, TIE_MARGIN } from '../src/engine/intents.js';

type Embed = (t: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

const HELD_OUT: [string, string][] = [
  ['I need something to hold up a shelf that sticks out about 90 millimetres', 'wall-bracket'],
  ['support for a floating shelf', 'wall-bracket'],
  ['round plate to bolt onto my 22 mm tube', 'flange-plate'],
  ['a cap for the volume control on my amp', 'knob'],
  ['a spot for my earbuds case to sit', 'cradle'],
  ['clip my cable to the desk edge', 'fit-clip'],
  ['hold my phone up while I watch videos', 'phone-stand'],
  ['a pivot for a small lid', 'hinge'],
  ['I want a box to keep my raspberry pi in', 'project-box'],
  ['housing for an arduino', 'project-box'],
  ['handle for my kitchen drawer', 'pull-handle'],
  ['something to stop my table wobbling', 'tapered-foot'],
  ['the sofa leg needs a new end', 'tapered-foot'],
  ['can you check if this is strong enough', 'act:test'],
  ['load it up and see what happens', 'act:test'],
  ['can I see the plans for it', 'act:drawing'],
  ['print the dimensions on paper', 'act:drawing'],
  ['store this design', 'act:save'],
  ['oops, not that', 'act:undo'],
  ['blow some wind at it', 'act:flow'],
  ['does it wobble at some frequency', 'act:vibration'],
  ['cut the weight down', 'act:grow'],
  ['it feels flimsy, toughen it up', 'act:stronger'],
  ['how many hours on my printer', 'act:print'],
  ['send it to my laptop', 'act:share'],
];

let embed: Embed;
let cat: number[][];
const phrases = catalogue();

beforeAll(async () => {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = fileURLToPath(new URL('../public/models/', import.meta.url));
  embed = (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'q8' })) as unknown as Embed;
  cat = (await embed(phrases.map((p) => p.text), { pooling: 'mean', normalize: true })).tolist();
}, 120000);

async function understand(text: string) {
  const [v] = (await embed([text], { pooling: 'mean', normalize: true })).tolist();
  const best = new Map<string, number>();
  cat.forEach((c, i) => {
    const s = c.reduce((a, x, j) => a + x * v[j], 0);
    const k = phrases[i].key;
    if (!best.has(k) || (best.get(k) as number) < s) best.set(k, s);
  });
  return decide([...best].map(([key, score]) => ({ key, score })));
}

describe('on-device language model', () => {
  it('has no held-out sentence in its catalogue', () => {
    const known = new Set(phrases.map((p) => p.text.toLowerCase()));
    for (const [s] of HELD_OUT) expect(known.has(s.toLowerCase())).toBe(false);
  });

  it('gets unseen paraphrases right, and asks rather than guesses when unsure', async () => {
    let right = 0;
    let asked = 0;
    const wrong: string[] = [];
    for (const [s, want] of HELD_OUT) {
      const u = await understand(s);
      // A question back ("did you mean...?") is asking, not a right answer.
      if (u.kind === 'none' || u.kind === 'tie' || u.kind === 'confirm') asked++;
      else if (u.intent.key === want) right++;
      else wrong.push(`${s} -> ${u.intent.key}`);
    }
    console.log(`right ${right}/${HELD_OUT.length}, asked ${asked}, wrong ${wrong.length}`, wrong);
    expect(right).toBeGreaterThanOrEqual(20);
    expect(wrong.length).toBeLessThanOrEqual(2);
  });

  it('rejects sentences about nothing in the app', async () => {
    for (const s of ['what is the weather tomorrow', 'play some music']) {
      const u = await understand(s);
      expect(u.kind === 'none' || u.kind === 'tie', `${s}: ${JSON.stringify(u)}`).toBe(true);
    }
  });
});

describe('decision rule', () => {
  it('asks on a near tie and refuses a weak match', () => {
    expect(decide([{ key: 'knob', score: MATCH_FLOOR - 0.01 }]).kind).toBe('none');
    expect(decide([{ key: 'knob', score: 0.6 }, { key: 'hinge', score: 0.6 - TIE_MARGIN / 2 }]).kind).toBe('tie');
    expect(decide([{ key: 'act:test', score: 0.6 }, { key: 'hinge', score: 0.3 }])).toMatchObject({ kind: 'action', action: 'test' });
  });
  it('names every part with a noun the word rules know', () => {
    for (const i of INTENTS) if (!i.key.startsWith('act:')) expect(i.noun).toBeTruthy();
  });
});
