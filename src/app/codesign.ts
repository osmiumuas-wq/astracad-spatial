/**
 * Co-design: two people on one part, each at their own bench.
 *
 * One person starts a room and gets a six-digit code; the other types it in
 * (or opens the join link on a phone or PC). The free public PeerJS broker
 * only introduces the two browsers; after that the part and the hands travel
 * directly between them over a WebRTC data channel. If the broker or the
 * network is down, the room fails with a plain message and the rest of the app
 * carries on unchanged.
 *
 * What is shared: the job, its dimensions and the material (one shared part),
 * the turntable angle, and each person's head and hands in the part's own
 * frame, so a finger pointing at a hole on one bench points at the same hole
 * on the other. The second person's turntable is turned half a revolution, so
 * the two sit facing each other across the part.
 *
 * Analysis (load tests, bone growth) is not shared: each side runs its own
 * solver on the shared part, so both see the same numbers.
 *
 * Simultaneous edits are settled by a Lamport clock with the host winning a
 * tie, so both benches always end on the same part.
 */

import { effect, Signal, signal } from '@iwsdk/core';
import type { DataConnection, Peer } from 'peerjs';
import { JOBS, paramDef, Params } from '../engine/jobs.js';
import type { App } from './app.js';

/** Peer ids on the public broker are global; the prefix keeps ours apart. */
const ID_PREFIX = 'astracad-spatial-v1-';
const JOIN_TIMEOUT_MS = 15000;
/** Most part updates per second while a dimension is being dragged. */
const PART_HZ = 15;

export type CoStatus = 'off' | 'starting' | 'waiting' | 'joining' | 'connected' | 'failed';
export type Role = 'host' | 'guest';

export interface SharedPart {
  job: string;
  params: Params;
  material: string;
}

/** A tracked hand: wrist, thumb tip, index tip, middle tip, palm (x, y, z each, metres). */
export type HandPose = number[];

export interface Pose {
  /** Head position (3) and orientation quaternion (4), in the part frame. */
  head: number[];
  left: HandPose | null;
  right: HandPose | null;
  pinchL: boolean;
  pinchR: boolean;
  /** Shared turntable angle, rad. */
  spin: number;
  immersive: boolean;
}

type Message =
  | { t: 'hello'; v: 1; immersive: boolean }
  | { t: 'part'; clock: number; rank: number; part: SharedPart }
  | { t: 'pose'; pose: Pose }
  | { t: 'bye' };

/** Parameters as a canonical string (sorted keys, rounded), for change detection. */
export function partKey(p: SharedPart): string {
  const keys = Object.keys(p.params).sort();
  return `${p.job}|${p.material}|${keys.map((k) => `${k}=${Math.round(p.params[k] * 1e6) / 1e6}`).join(',')}`;
}

/** Decide whether an incoming part replaces ours (Lamport clock, host wins a tie). */
export function incomingWins(localClock: number, localRank: number, remoteClock: number, remoteRank: number): boolean {
  return remoteClock > localClock || (remoteClock === localClock && remoteRank < localRank);
}

export function randomCode(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

/** The code from a join link (`?room=123456`), if any. */
export function codeFromUrl(search: string): string | null {
  const m = /[?&]room=(\d{6})\b/u.exec(search);
  return m ? m[1] : null;
}

export class CoDesign {
  readonly status: Signal<CoStatus> = signal('off');
  readonly role: Signal<Role | null> = signal(null);
  readonly code: Signal<string | null> = signal(null);
  /** Why the last attempt failed, in plain words. */
  readonly error: Signal<string | null> = signal(null);
  /** The digits typed so far on the bench keypad. */
  readonly typed = signal('');
  /** Latest pose from the partner, and when it arrived (performance.now ms). */
  partner: Pose | null = null;
  partnerAt = 0;
  partnerImmersive = false;
  /** Set by the co-design system when the partner turned the turntable. */
  remoteSpin: number | null = null;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private clock = 0;
  private lastKey = '';
  private lastSent = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSay = 0;
  private stopEffect: (() => void) | null = null;

  constructor(private readonly app: App) {}

  get rank(): number {
    return this.role.peek() === 'host' ? 0 : 1;
  }

  get connected(): boolean {
    return this.status.peek() === 'connected';
  }

  joinUrl(code: string): string {
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  private async makePeer(id?: string): Promise<Peer> {
    // Loaded on demand: the app never touches the network unless a room is used.
    const { Peer: PeerCtor } = await import('peerjs');
    return id ? new PeerCtor(id, { debug: 0 }) : new PeerCtor({ debug: 0 });
  }

  /** Start a room and wait for a partner. */
  async host(attempt = 0): Promise<void> {
    this.leave(false);
    const code = randomCode();
    this.role.value = 'host';
    this.code.value = code;
    this.error.value = null;
    this.status.value = 'starting';
    let peer: Peer;
    try {
      peer = await this.makePeer(ID_PREFIX + code);
    } catch {
      this.fail('Co-design could not load. Check the network.');
      return;
    }
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer === peer) this.status.value = 'waiting';
    });
    peer.on('connection', (conn) => {
      if (this.conn) {
        // Two people per room.
        conn.on('open', () => conn.close());
        return;
      }
      this.attach(conn);
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id' && attempt < 3) {
        void this.host(attempt + 1);
        return;
      }
      this.fail(this.explain(err.type));
    });
    peer.on('disconnected', () => {
      // Lost the broker. An open data channel keeps working without it.
      if (this.peer === peer && !this.conn) this.fail('Lost the connection to the co-design service.');
    });
  }

  /** Join a room by its six-digit code. */
  async join(code: string): Promise<void> {
    const clean = code.replace(/\D/gu, '');
    if (clean.length !== 6) {
      this.error.value = 'The code has six digits.';
      return;
    }
    this.leave(false);
    this.role.value = 'guest';
    this.code.value = clean;
    this.error.value = null;
    this.status.value = 'joining';
    let peer: Peer;
    try {
      peer = await this.makePeer();
    } catch {
      this.fail('Co-design could not load. Check the network.');
      return;
    }
    this.peer = peer;
    this.joinTimer = setTimeout(() => {
      if (this.peer === peer && this.status.peek() === 'joining') {
        this.fail('No answer from that room. Check the code, or start your own room.');
      }
    }, JOIN_TIMEOUT_MS);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.attach(peer.connect(ID_PREFIX + clean, { reliable: true, serialization: 'json' }));
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (this.peer === peer) this.fail(this.explain(err.type));
    });
  }

  private explain(type: string | undefined): string {
    switch (type) {
      case 'peer-unavailable':
        return 'No room with that code. Check the code.';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        return 'The co-design service cannot be reached right now. Everything else still works.';
      case 'browser-incompatible':
        return 'This browser cannot do peer-to-peer connections.';
      case 'webrtc':
        return 'The two devices could not connect directly. Some networks block this.';
      default:
        return 'Co-design could not connect.';
    }
  }

  private attach(conn: DataConnection): void {
    this.conn = conn;
    conn.on('open', () => {
      if (this.conn !== conn) return;
      if (this.joinTimer) clearTimeout(this.joinTimer);
      this.status.value = 'connected';
      this.partner = null;
      this.send({ t: 'hello', v: 1, immersive: false });
      // The host's part is the starting point for both.
      this.lastKey = partKey(this.current());
      if (this.role.peek() === 'host') {
        this.clock++;
        this.send({ t: 'part', clock: this.clock, rank: this.rank, part: this.current() });
      }
      this.watch();
      this.app.say(this.role.peek() === 'host' ? 'Your partner joined. You share this part.' : 'Joined. You share your partner\'s part.', 'good');
    });
    conn.on('data', (data) => this.receive(data as Message));
    conn.on('close', () => {
      if (this.conn !== conn) return;
      const was = this.status.peek() === 'connected';
      this.conn = null;
      this.partner = null;
      this.stopWatch();
      if (this.role.peek() === 'host' && this.peer && !this.peer.destroyed) {
        // Keep the room open for the partner to come back.
        this.status.value = 'waiting';
      } else {
        this.status.value = 'off';
        this.role.value = null;
        this.peer?.destroy();
        this.peer = null;
      }
      if (was) this.app.say('Your partner left the room.', 'info');
    });
    conn.on('error', () => {
      if (this.conn === conn && this.status.peek() !== 'connected') this.fail(this.explain('webrtc'));
    });
  }

  private current(): SharedPart {
    return { job: this.app.jobId.peek(), params: { ...this.app.params.peek() }, material: this.app.material.peek() };
  }

  /** Send our part whenever it changes, at most PART_HZ times a second, with a trailing send. */
  private watch(): void {
    this.stopWatch();
    this.stopEffect = effect(() => {
      void this.app.jobId.value;
      void this.app.params.value;
      void this.app.material.value;
      this.schedulePart();
    });
  }

  private stopWatch(): void {
    this.stopEffect?.();
    this.stopEffect = null;
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
  }

  private schedulePart(): void {
    if (!this.connected || this.trailing) return;
    const wait = Math.max(0, this.lastSent + 1000 / PART_HZ - performance.now());
    if (wait === 0) {
      this.flushPart();
    } else {
      this.trailing = setTimeout(() => {
        this.trailing = null;
        this.flushPart();
      }, wait);
    }
  }

  private flushPart(): void {
    const part = this.current();
    const key = partKey(part);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.clock++;
    this.lastSent = performance.now();
    this.send({ t: 'part', clock: this.clock, rank: this.rank, part });
  }

  private receive(msg: Message): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        this.partnerImmersive = Boolean(msg.immersive);
        break;
      case 'part': {
        if (!incomingWins(this.clock, this.rank, msg.clock, msg.rank)) return;
        const part = sanitise(msg.part);
        if (!part) return;
        this.clock = msg.clock;
        const before = this.current();
        this.lastKey = partKey(part);
        this.app.adoptShared(part);
        this.narrate(before, part);
        // If our clamp changed it, our copy goes back out (and wins on the next clock).
        this.schedulePart();
        break;
      }
      case 'pose':
        this.partner = msg.pose;
        this.partnerAt = performance.now();
        this.partnerImmersive = msg.pose.immersive;
        break;
      case 'bye':
        this.conn?.close();
        break;
    }
  }

  /** A short caption for what the partner changed, at most once a second. */
  private narrate(before: SharedPart, after: SharedPart): void {
    const now = performance.now();
    if (now - this.lastSay < 1000) return;
    let text = '';
    if (before.job !== after.job) {
      text = `Partner switched to ${JOBS.find((j) => j.id === after.job)?.title ?? after.job}.`;
    } else if (before.material !== after.material) {
      text = 'Partner changed the material.';
    } else {
      const job = JOBS.find((j) => j.id === after.job);
      const id = Object.keys(after.params).find((k) => Math.abs((after.params[k] ?? 0) - (before.params[k] ?? 0)) > 1e-9);
      const def = job && id ? paramDef(job, id) : undefined;
      if (def && id) text = `Partner: ${def.label} ${after.params[id].toFixed(2)} ${def.unit}`.trim();
    }
    if (text) {
      this.lastSay = now;
      this.app.say(text, 'info');
    }
  }

  sendPose(pose: Pose): void {
    if (this.connected) this.send({ t: 'pose', pose });
  }

  private send(msg: Message): void {
    try {
      if (this.conn?.open) void this.conn.send(msg);
    } catch {
      // A closing channel throws; the close handler tidies up.
    }
  }

  private fail(message: string): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.stopWatch();
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    this.partner = null;
    this.status.value = 'failed';
    this.error.value = message;
  }

  /** Leave the room (or stop waiting). */
  leave(announce = true): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.stopWatch();
    if (this.conn) {
      this.send({ t: 'bye' });
      const c = this.conn;
      this.conn = null;
      setTimeout(() => c.close(), 50);
    }
    this.peer?.destroy();
    this.peer = null;
    this.partner = null;
    this.clock = 0;
    this.lastKey = '';
    if (announce && this.status.peek() !== 'off') this.app.say('Left the room.', 'info');
    this.status.value = 'off';
    this.role.value = null;
    this.code.value = null;
  }

  /** Bench keypad: a digit, 'del', or 'join'. */
  key(k: string): void {
    const t = this.typed.peek();
    if (k === 'del') {
      this.typed.value = t.slice(0, -1);
    } else if (k === 'join') {
      void this.join(t);
    } else if (/^\d$/u.test(k) && t.length < 6) {
      this.typed.value = t + k;
    }
  }
}

/** Accept only a part this build knows how to make. */
function sanitise(p: unknown): SharedPart | null {
  if (!p || typeof p !== 'object') return null;
  const q = p as Partial<SharedPart>;
  if (typeof q.job !== 'string' || typeof q.material !== 'string' || !q.params || typeof q.params !== 'object') return null;
  if (!JOBS.some((j) => j.id === q.job)) return null;
  const params: Params = {};
  for (const [k, v] of Object.entries(q.params)) {
    if (typeof v === 'number' && Number.isFinite(v) && /^[a-zA-Z]\w{0,15}$/u.test(k)) params[k] = v;
  }
  return { job: q.job, params, material: q.material };
}
