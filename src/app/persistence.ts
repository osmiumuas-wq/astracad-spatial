/**
 * What survives between sessions, kept in localStorage: the parts shelf, the
 * real objects the user has measured ("my things"), skills and streak, the
 * accessibility settings and whether the first-run coach has been completed.
 */

import { Params } from '../engine/jobs.js';

const PREFIX = 'astracad.spatial.v1.';

export interface SavedPart {
  id: string;
  job: string;
  title: string;
  material: string;
  params: Params;
  created: string;
  verdict: string;
  volume: number;
  grams: number;
  /** Name of the measured object it was fitted to, if any. */
  fits?: string;
}

/** A real object the user measured, remembered so the next part can reuse it. */
export interface Thing {
  id: string;
  name: string;
  value: number;
  spread: number;
  method: 'span' | 'tape';
  created: string;
}

export type Skill = 'measure' | 'shape' | 'dial' | 'test' | 'fix' | 'slice' | 'history' | 'grow' | 'save';

export interface Progress {
  skills: Partial<Record<Skill, number>>;
  partsSaved: number;
  /** ISO date (yyyy-mm-dd) of the last day a part was saved. */
  lastDay: string;
  streak: number;
  coachDone: boolean;
  /** ISO date of the last daily job completed. */
  dailyDone: string;
  dailyCount: number;
}

export interface Settings {
  handed: 'right' | 'left';
  highContrast: boolean;
  largeText: boolean;
  captions: boolean;
  reduceMotion: boolean;
  /** Colour-blind-safe stress map (blue to yellow) instead of blue to red. */
  colorSafe: boolean;
  sound: boolean;
  /** Dwell on a target to select it, for users who cannot pinch. */
  dwell: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  handed: 'right',
  highContrast: false,
  largeText: false,
  captions: true,
  reduceMotion: false,
  colorSafe: false,
  sound: true,
  dwell: false,
};

export const DEFAULT_PROGRESS: Progress = {
  skills: {},
  partsSaved: 0,
  lastDay: '',
  streak: 0,
  coachDone: false,
  dailyDone: '',
  dailyCount: 0,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) {
      return fallback;
    }
    const value = JSON.parse(raw) as T;
    return Array.isArray(fallback) ? (Array.isArray(value) ? value : fallback) : { ...fallback, ...value };
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the session still works, it just forgets.
  }
}

export const loadSettings = (): Settings => read('settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings): void => write('settings', s);
export const loadProgress = (): Progress => read('progress', DEFAULT_PROGRESS);
export const saveProgress = (p: Progress): void => write('progress', p);
export const loadLibrary = (): SavedPart[] => read<SavedPart[]>('library', []);
export const saveLibrary = (l: SavedPart[]): void => write('library', l.slice(0, 24));
export const loadThings = (): Thing[] => read<Thing[]>('things', []);
export const saveThings = (t: Thing[]): void => write('things', t.slice(0, 12));

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Update the streak when a part is saved: consecutive days extend it, a gap restarts it. */
export function bumpStreak(p: Progress, day = today()): Progress {
  if (p.lastDay === day) {
    return { ...p, partsSaved: p.partsSaved + 1 };
  }
  const yesterday = new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  return {
    ...p,
    partsSaved: p.partsSaved + 1,
    lastDay: day,
    streak: p.lastDay === yesterday ? p.streak + 1 : 1,
  };
}

export const uid = (): string =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
