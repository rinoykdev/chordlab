/** Default recognizer: harmonic chord templates matched against chroma (cosine similarity). */
import type { Features } from '../types';
import type { VocabEntry } from '../vocabulary';
import type { ChordRecognizer } from './types';

const HARMONICS = 6;
const DECAY = 0.6; // relative weight of successive harmonics
const BASS_WEIGHT = 0.2;
const NO_CHORD_BIAS = 0.82; // how flat a chroma must look before "N" wins
const SEVENTH_PENALTY = 0.015; // prefer triads when evidence is equal
const DYAD_PENALTY = 0.03; // a power chord must clearly lack its third to win
export const SCORE_SCALE = 30; // turns similarities into logits

/** Template for a set of pitch classes including the partials each note produces. */
export function harmonicTemplate(pcs: number[], rootWeight = 1): Float64Array {
  const t = new Float64Array(12);
  pcs.forEach((pc, i) => {
    const w = i === 0 ? rootWeight : 1;
    for (let h = 1; h <= HARMONICS; h++) {
      const off = Math.round(12 * Math.log2(h));
      t[(pc + off) % 12] += w * DECAY ** (h - 1);
    }
  });
  let n = 0;
  for (const v of t) n += v * v;
  n = Math.sqrt(n);
  for (let i = 0; i < 12; i++) t[i] /= n;
  return t;
}

/** Score penalty that keeps richer chords from winning on equal evidence. */
export function qualityPenalty(intervals: number[]): number {
  return intervals.length > 3 ? SEVENTH_PENALTY : intervals.length < 3 ? DYAD_PENALTY : 0;
}

/** Rotate a root-relative template (index 0 = root) to an absolute root. */
export function rotateTemplate(rel: ArrayLike<number>, root: number): Float64Array {
  const t = new Float64Array(12);
  for (let i = 0; i < 12; i++) t[(i + root) % 12] = rel[i];
  return t;
}

/**
 * Template recognizer. `learned` maps a chord type (suffix) to a root-relative template learned
 * from the user's own recordings; other chord types use the theoretical harmonic templates.
 */
export function createTemplateRecognizer(learned?: Map<string, Float64Array>): ChordRecognizer {
  return {
    id: learned?.size ? 'template-hmm+profile' : 'template-hmm',
    label: learned?.size ? 'Chroma templates + your guitar profile + HMM' : 'Chroma templates + HMM',
    version: '1.1.0',
    extraSuffixes: learned ? [...learned.keys()] : undefined,
    frameScores: (input) => scoreFrames(input.features, input.vocab, learned),
  };
}

export const templateRecognizer: ChordRecognizer = createTemplateRecognizer();

function scoreFrames(features: Features, vocab: VocabEntry[], learned?: Map<string, Float64Array>): Float32Array {
  {
    const { nFrames, chroma, bass } = features;
    const K = vocab.length;
    const treble = vocab.map((v) => {
      if (v.root < 0) return null;
      const l = learned?.get(v.suffix);
      return l ? rotateTemplate(l, v.root) : harmonicTemplate(v.intervals.map((i) => (v.root + i) % 12));
    });
    const bassT = vocab.map((v) => (v.root < 0 ? null : harmonicTemplate([v.root])));
    const flat = 1 / Math.sqrt(12);
    const out = new Float32Array(nFrames * K);
    for (let t = 0; t < nFrames; t++) {
      const o = t * 12;
      let energy = 0;
      let bassEnergy = 0;
      let flatSim = 0;
      for (let p = 0; p < 12; p++) {
        energy += chroma[o + p];
        bassEnergy += bass[o + p];
        flatSim += chroma[o + p] * flat;
      }
      if (energy === 0) {
        // Silent frame: strongly favour N.
        for (let k = 0; k < K; k++) out[t * K + k] = k === 0 ? 0 : -SCORE_SCALE;
        continue;
      }
      out[t * K] = SCORE_SCALE * NO_CHORD_BIAS * flatSim;
      for (let k = 1; k < K; k++) {
        const T = treble[k]!;
        let s = 0;
        for (let p = 0; p < 12; p++) s += chroma[o + p] * T[p];
        if (bassEnergy > 0) {
          const B = bassT[k]!;
          let b = 0;
          for (let p = 0; p < 12; p++) b += bass[o + p] * B[p];
          s = (1 - BASS_WEIGHT) * s + BASS_WEIGHT * b;
        }
        s -= qualityPenalty(vocab[k].intervals);
        out[t * K + k] = SCORE_SCALE * s;
      }
    }
    return out;
  }
}
