/** Chord vocabulary shared by every recognizer. Index 0 is always "N" (no chord). */
import { PITCH_CLASSES, type Vocabulary } from './types';

export interface VocabEntry {
  label: string;
  root: number; // -1 for N
  suffix: string;
  intervals: number[];
}

const QUALITIES: Record<Vocabulary, { suffix: string; intervals: number[] }[]> = {
  majmin: [
    { suffix: '', intervals: [0, 4, 7] },
    { suffix: 'm', intervals: [0, 3, 7] },
  ],
  extended: [
    { suffix: '', intervals: [0, 4, 7] },
    { suffix: 'm', intervals: [0, 3, 7] },
    { suffix: '7', intervals: [0, 4, 7, 10] },
    { suffix: 'maj7', intervals: [0, 4, 7, 11] },
    { suffix: 'm7', intervals: [0, 3, 7, 10] },
  ],
};

export function buildVocabulary(v: Vocabulary): VocabEntry[] {
  const out: VocabEntry[] = [{ label: 'N', root: -1, suffix: '', intervals: [] }];
  for (const q of QUALITIES[v]) {
    for (let r = 0; r < 12; r++) out.push({ label: PITCH_CLASSES[r] + q.suffix, root: r, suffix: q.suffix, intervals: q.intervals });
  }
  return out;
}
