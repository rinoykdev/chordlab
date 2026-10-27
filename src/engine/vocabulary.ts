/** Chord vocabulary shared by every recognizer. Index 0 is always "N" (no chord). */
import { PITCH_CLASSES, type Vocabulary } from './types';

export interface VocabEntry {
  label: string;
  root: number; // -1 for N
  suffix: string;
  intervals: number[];
}

/** Every chord type the engine can represent. The first interval is the root. */
export const QUALITY_INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  add9: [0, 4, 7, 2],
  '5': [0, 7],
};

const BASE: Record<Vocabulary, string[]> = {
  majmin: ['', 'm'],
  extended: ['', 'm', '7', 'maj7', 'm7'],
};

/** Build the label set. `extra` adds chord types a learned profile has examples for. */
export function buildVocabulary(v: Vocabulary, extra: string[] = []): VocabEntry[] {
  const suffixes = [...new Set([...BASE[v], ...extra.filter((s) => s in QUALITY_INTERVALS)])];
  const out: VocabEntry[] = [{ label: 'N', root: -1, suffix: '', intervals: [] }];
  for (const suffix of suffixes) {
    for (let r = 0; r < 12; r++) out.push({ label: PITCH_CLASSES[r] + suffix, root: r, suffix, intervals: QUALITY_INTERVALS[suffix] });
  }
  return out;
}
