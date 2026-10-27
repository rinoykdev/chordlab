/**
 * Learning from labelled recordings ("Teach Chordlab"). Pure functions, so they run in tests,
 * the worker and the main thread alike.
 *
 * Each take is reduced to one chroma vector. Vectors are rotated so the root sits at index 0,
 * which lets a G and an A teach the same thing about major chords; averaging them gives a
 * template per chord type that is valid in all 12 keys. Learned templates are blended with the
 * theoretical ones (shrinkage), so two or three takes nudge the engine rather than override it.
 */
import { createTemplateRecognizer, harmonicTemplate, qualityPenalty, rotateTemplate } from './recognizers/template';
import type { ChordRecognizer } from './recognizers/types';
import type { Features } from './types';
import { PITCH_CLASSES } from './types';
import { QUALITY_INTERVALS } from './vocabulary';

/** Chord types the teaching mode offers. */
export const TEACHABLE: { suffix: string; name: string }[] = [
  { suffix: '', name: 'Major' },
  { suffix: 'm', name: 'Minor' },
  { suffix: '7', name: 'Dominant 7th' },
  { suffix: 'maj7', name: 'Major 7th' },
  { suffix: 'm7', name: 'Minor 7th' },
  { suffix: 'sus2', name: 'Sus2' },
  { suffix: 'sus4', name: 'Sus4' },
  { suffix: 'dim', name: 'Diminished' },
  { suffix: 'add9', name: 'Add9' },
  { suffix: '5', name: 'Power chord' },
];

/** Takes needed before a chord type is learned. */
export const MIN_TAKES = 2;
/** Prior strength: a learned template gets weight n / (n + PRIOR). */
const PRIOR = 2;
/** How far (cosine) the requested chord may trail the best match before a take is flagged. */
const TAKE_MARGIN = 0.03;

export interface TeachExample { root: number; suffix: string; chroma: number[] }
export interface LearnedTemplate { suffix: string; mean: number[]; count: number; roots: number }
export interface LearnedProfile { version: 1; createdAt: number; templates: LearnedTemplate[] }

const normalise = (v: ArrayLike<number>): number[] => {
  let n = 0;
  for (let i = 0; i < 12; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Array.from({ length: 12 }, (_, i) => v[i] / n);
};
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; };
const relative = (abs: ArrayLike<number>, root: number) => Array.from({ length: 12 }, (_, i) => abs[(i + root) % 12]);

export const chordLabel = (root: number, suffix: string) => PITCH_CLASSES[root] + suffix;

/** Mean chroma of a short clip, ignoring the first strum transient and silent frames. Null if too little signal. */
export function clipChroma(f: Features, skipSeconds = 0.25): number[] | null {
  const acc = new Float64Array(12);
  let frames = 0;
  for (let t = 0; t < f.nFrames; t++) {
    if (t * f.hopSeconds < skipSeconds) continue;
    let e = 0;
    for (let p = 0; p < 12; p++) e += f.chroma[t * 12 + p];
    if (e === 0) continue;
    for (let p = 0; p < 12; p++) acc[p] += f.chroma[t * 12 + p];
    frames++;
  }
  return frames >= 4 ? normalise(acc) : null;
}

/** Root-relative template for a chord type: learned (blended with theory) when available. */
export function relativeTemplate(suffix: string, learned?: LearnedTemplate): Float64Array {
  const theory = harmonicTemplate(QUALITY_INTERVALS[suffix]);
  if (!learned) return theory;
  const w = learned.count / (learned.count + PRIOR);
  return Float64Array.from(normalise(Array.from({ length: 12 }, (_, i) => w * learned.mean[i] + (1 - w) * theory[i])));
}

/** Rank every root × chord type for one chroma vector (cosine, same penalties as the recognizer). */
export function rankChroma(chroma: ArrayLike<number>, suffixes: string[], profile?: LearnedProfile) {
  const out: { root: number; suffix: string; label: string; score: number }[] = [];
  for (const suffix of suffixes) {
    const rel = relativeTemplate(suffix, profile?.templates.find((t) => t.suffix === suffix));
    for (let root = 0; root < 12; root++) {
      out.push({ root, suffix, label: chordLabel(root, suffix), score: dot(chroma, rotateTemplate(rel, root)) - qualityPenalty(QUALITY_INTERVALS[suffix]) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface TakeCheck { ok: boolean; heardAs: string; margin: number }

/**
 * Guard against mislabelled takes: does the recording sound like the chord that was requested?
 * Uses the theoretical templates only, so a bad profile can't approve its own mistakes.
 */
export function checkTake(chroma: ArrayLike<number>, root: number, suffix: string): TakeCheck {
  const ranked = rankChroma(chroma, TEACHABLE.map((t) => t.suffix));
  const expected = ranked.find((r) => r.root === root && r.suffix === suffix)!;
  const margin = ranked[0].score - expected.score;
  return { ok: margin <= TAKE_MARGIN, heardAs: ranked[0].label, margin };
}

export function buildProfile(examples: TeachExample[], minTakes = MIN_TAKES): LearnedProfile {
  const groups = new Map<string, TeachExample[]>();
  for (const e of examples) groups.set(e.suffix, [...(groups.get(e.suffix) ?? []), e]);
  const templates: LearnedTemplate[] = [];
  for (const [suffix, list] of groups) {
    if (list.length < minTakes || !(suffix in QUALITY_INTERVALS)) continue;
    const acc = new Array<number>(12).fill(0);
    for (const e of list) relative(e.chroma, e.root).forEach((v, i) => (acc[i] += v));
    templates.push({ suffix, mean: normalise(acc), count: list.length, roots: new Set(list.map((e) => e.root)).size });
  }
  return { version: 1, createdAt: Date.now(), templates };
}

export function createProfileRecognizer(profile: LearnedProfile): ChordRecognizer {
  const learned = new Map<string, Float64Array>();
  for (const t of profile.templates) learned.set(t.suffix, relativeTemplate(t.suffix, t));
  return createTemplateRecognizer(learned);
}

export interface Evaluation {
  total: number;
  defaultCorrect: number;
  learnedCorrect: number;
  perType: { suffix: string; takes: number; roots: number; defaultCorrect: number; learnedCorrect: number; tested: number }[];
  mistakes: { expected: string; byDefault: string; byProfile: string }[];
}

/**
 * Leave-one-out: each take is classified by a profile built from all the *other* takes, so the
 * score reflects chords the profile has not memorised. The default engine is scored on the same
 * takes and the same chord types for a fair comparison.
 */
export function evaluate(examples: TeachExample[]): Evaluation {
  const suffixes = [...new Set(['', 'm', ...examples.map((e) => e.suffix)])];
  const perType = new Map<string, Evaluation['perType'][number]>();
  const mistakes: Evaluation['mistakes'] = [];
  let defaultCorrect = 0; let learnedCorrect = 0; let total = 0;
  for (const s of new Set(examples.map((e) => e.suffix))) {
    const list = examples.filter((e) => e.suffix === s);
    perType.set(s, { suffix: s, takes: list.length, roots: new Set(list.map((e) => e.root)).size, defaultCorrect: 0, learnedCorrect: 0, tested: 0 });
  }
  examples.forEach((e, i) => {
    const others = examples.filter((_, j) => j !== i);
    const profile = buildProfile(others);
    const want = chordLabel(e.root, e.suffix);
    const d = rankChroma(e.chroma, suffixes)[0].label;
    const l = rankChroma(e.chroma, suffixes, profile)[0].label;
    const row = perType.get(e.suffix)!;
    row.tested++; total++;
    if (d === want) { row.defaultCorrect++; defaultCorrect++; }
    if (l === want) { row.learnedCorrect++; learnedCorrect++; }
    if (d !== want || l !== want) mistakes.push({ expected: want, byDefault: d, byProfile: l });
  });
  return { total, defaultCorrect, learnedCorrect, perType: [...perType.values()], mistakes };
}
