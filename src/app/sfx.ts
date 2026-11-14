/**
 * Sound for every action, synthesised with WebAudio: no audio files to load
 * and nothing to license. Sounds are placed in space with a panner so a tick
 * comes from the handle that made it. Events that carry meaning also emit a
 * caption, for users who play without sound.
 */

export type Sound =
  | 'hover'
  | 'grab'
  | 'release'
  | 'step'
  | 'tick'
  | 'limit'
  | 'lock'
  | 'bind'
  | 'verified'
  | 'refused'
  | 'solve'
  | 'solved'
  | 'yield'
  | 'fix'
  | 'grow'
  | 'save'
  | 'select'
  | 'slice';

const CAPTIONS: Partial<Record<Sound, string>> = {
  limit: 'Soft thud: limit reached',
  lock: 'Two-tone chime: measurement locked',
  bind: 'Rising notes: measurement bound',
  verified: 'Bright chord: part verified',
  refused: 'Low buzz: part refused',
  solve: 'Rising hum: solving',
  solved: 'Bell: solve finished',
  yield: 'Crack: the part would yield',
  fix: 'Pop: fix applied',
  save: 'Four rising notes: saved',
};

interface Listener {
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<Sound, number>();
  enabled = true;
  /** Receives a caption for meaningful sounds. */
  onCaption: (text: string) => void = () => {};

  /** Create or resume the audio context. Must be called from a user gesture. */
  resume(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          globalThis.AudioContext ??
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          return;
        }
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const length = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) {
          data[i] = Math.random() * 2 - 1;
        }
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    } catch {
      this.ctx = null;
    }
  }

  setListener(l: Listener): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    const a = ctx.listener;
    if (a.positionX) {
      const t = ctx.currentTime;
      a.positionX.setValueAtTime(l.x, t);
      a.positionY.setValueAtTime(l.y, t);
      a.positionZ.setValueAtTime(l.z, t);
      a.forwardX.setValueAtTime(l.fx, t);
      a.forwardY.setValueAtTime(l.fy, t);
      a.forwardZ.setValueAtTime(l.fz, t);
      a.upX.setValueAtTime(0, t);
      a.upY.setValueAtTime(1, t);
      a.upZ.setValueAtTime(0, t);
    }
  }

  private out(at?: { x: number; y: number; z: number }): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) {
      return null;
    }
    if (!at) {
      return this.master;
    }
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 0.5;
    p.rolloffFactor = 0.6;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(this.master);
    return p;
  }

  private tone(
    dest: AudioNode,
    freq: number,
    start: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    glideTo?: number,
  ): void {
    const ctx = this.ctx as AudioContext;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.008, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private burst(dest: AudioNode, start: number, dur: number, gain: number, freq: number, q = 1): void {
    const ctx = this.ctx as AudioContext;
    if (!this.noise) {
      return;
    }
    const t0 = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ----- the stress voice: a held tone while a part is pushed ------------------
  private strainOsc: OscillatorNode | null = null;
  private strainGain: GainNode | null = null;
  private strainPan: PannerNode | null = null;
  private crackleAt = 0;

  /**
   * Hear the stress: while a palm pushes a part, a soft tone climbs from about
   * 160 Hz (lightly loaded) to 960 Hz (at yield) with the utilisation (load
   * over what it can take, 1 / safety factor), and crackles as it nears and
   * passes yield. `utilisation` null stops it.
   */
  strain(utilisation: number | null, at?: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) {
      utilisation = null;
    }
    if (utilisation === null || !ctx || !this.master) {
      if (this.strainGain && ctx) {
        const t = ctx.currentTime;
        this.strainGain.gain.cancelScheduledValues(t);
        this.strainGain.gain.setTargetAtTime(0, t, 0.05);
        const osc = this.strainOsc;
        setTimeout(() => osc?.stop(), 400);
      }
      this.strainOsc = null;
      this.strainGain = null;
      this.strainPan = null;
      return;
    }
    const u = Math.max(0, Math.min(1.5, utilisation));
    const t = ctx.currentTime;
    if (!this.strainOsc) {
      this.strainOsc = ctx.createOscillator();
      this.strainOsc.type = 'triangle';
      this.strainGain = ctx.createGain();
      this.strainGain.gain.value = 0;
      this.strainPan = ctx.createPanner();
      this.strainPan.panningModel = 'equalpower';
      this.strainOsc.connect(this.strainGain).connect(this.strainPan).connect(this.master);
      this.strainOsc.start();
    }
    const freq = 160 * Math.pow(6, Math.min(1, u)) * (u > 1 ? 1 + (u - 1) * 0.6 : 1);
    this.strainOsc.frequency.setTargetAtTime(freq, t, 0.04);
    this.strainGain!.gain.setTargetAtTime(0.05 + 0.1 * Math.min(1, u), t, 0.05);
    if (at && this.strainPan) {
      this.strainPan.positionX.setValueAtTime(at.x, t);
      this.strainPan.positionY.setValueAtTime(at.y, t);
      this.strainPan.positionZ.setValueAtTime(at.z, t);
    }
    // Crackle: short noise ticks, more often the closer it is to yield.
    if (u > 0.7 && performance.now() > this.crackleAt) {
      const rate = u >= 1 ? 22 : 4 + (u - 0.7) * 40;
      this.crackleAt = performance.now() + 1000 / rate * (0.5 + Math.random());
      this.burst(this.strainPan ?? this.master, 0, 0.018, u >= 1 ? 0.35 : 0.12, 2400 + Math.random() * 2400, 3);
    }
  }

  /**
   * Play a sound, optionally at a world position. `pitch` shifts it (a dial
   * rises slightly with the value, so direction is audible).
   */
  play(sound: Sound, at?: { x: number; y: number; z: number }, pitch = 1): void {
    const caption = CAPTIONS[sound];
    if (caption) {
      this.onCaption(caption);
    }
    if (!this.enabled || !this.ctx) {
      return;
    }
    // Rate-limit the chatty ones so a fast drag does not smear into noise.
    const now = this.ctx.currentTime;
    const gap = sound === 'tick' ? 0.012 : sound === 'step' ? 0.02 : sound === 'hover' ? 0.05 : 0;
    if (gap && now - (this.lastPlayed.get(sound) ?? -1) < gap) {
      return;
    }
    this.lastPlayed.set(sound, now);
    const d = this.out(at);
    if (!d) {
      return;
    }
    switch (sound) {
      case 'hover':
        this.tone(d, 1500, 0, 0.02, 0.05);
        break;
      case 'grab':
        this.tone(d, 320, 0, 0.07, 0.22, 'triangle', 520);
        break;
      case 'release':
        this.tone(d, 520, 0, 0.08, 0.18, 'triangle', 300);
        break;
      case 'step':
        this.tone(d, 880 * pitch, 0, 0.03, 0.2, 'square');
        this.burst(d, 0, 0.015, 0.12, 3200, 2);
        break;
      case 'tick':
        this.tone(d, 2300 * pitch, 0, 0.014, 0.16);
        break;
      case 'limit':
        this.tone(d, 150, 0, 0.12, 0.35, 'sine', 90);
        break;
      case 'lock':
        this.tone(d, 880, 0, 0.14, 0.25);
        this.tone(d, 1320, 0.09, 0.2, 0.25);
        break;
      case 'bind':
        [660, 880, 1175].forEach((f, i) => this.tone(d, f, i * 0.07, 0.14, 0.22));
        break;
      case 'verified':
        [1047, 1319, 1568].forEach((f, i) => this.tone(d, f, i * 0.05, 0.45, 0.16));
        break;
      case 'refused':
        this.tone(d, 140, 0, 0.22, 0.3, 'sawtooth', 110);
        break;
      case 'solve':
        this.tone(d, 180, 0, 0.5, 0.12, 'sine', 420);
        this.burst(d, 0, 0.5, 0.05, 900, 0.7);
        break;
      case 'solved':
        this.tone(d, 1046, 0, 0.5, 0.2);
        this.tone(d, 2093, 0, 0.3, 0.06);
        break;
      case 'yield':
        this.burst(d, 0, 0.09, 0.5, 2400, 0.8);
        this.tone(d, 95, 0, 0.25, 0.4, 'sine', 55);
        break;
      case 'fix':
        this.tone(d, 600, 0, 0.09, 0.24, 'triangle', 950);
        break;
      case 'grow':
        this.tone(d, 300 * pitch, 0, 0.12, 0.1, 'sine', 450 * pitch);
        break;
      case 'save':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(d, f, i * 0.08, 0.22, 0.2));
        break;
      case 'select':
        this.tone(d, 740, 0, 0.05, 0.18, 'triangle');
        break;
      case 'slice':
        this.burst(d, 0, 0.18, 0.12, 5200, 1.4);
        break;
    }
  }
}
