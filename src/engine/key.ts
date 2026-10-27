/** Key estimation: Krumhansl–Kessler profiles on the chroma average, refined by chord durations. */
import { PITCH_CLASSES, type Features, type KeyEstimate, type Segment } from './types';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0; let mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function chordRoot(label: string): { root: number; minor: boolean } | null {
  if (label === 'N') return null;
  const m = /^([A-G]#?)(.*)$/.exec(label);
  if (!m) return null;
  const root = PITCH_CLASSES.indexOf(m[1] as (typeof PITCH_CLASSES)[number]);
  const q = m[2];
  return { root, minor: q.startsWith('m') && !q.startsWith('maj') };
}

export function estimateKey(features: Features, segments: Segment[]): KeyEstimate {
  const profile = new Float64Array(12);
  for (let t = 0; t < features.nFrames; t++) for (let p = 0; p < 12; p++) profile[p] += features.chroma[t * 12 + p];

  // Share of time spent on each tonic triad, plus first/last-chord cadence evidence.
  const total = segments.reduce((s, x) => s + (x.chord === 'N' ? 0 : x.end - x.start), 0) || 1;
  const voiced = segments.filter((s) => s.chord !== 'N');
  const tonicShare = (tonic: number, minor: boolean) =>
    segments.reduce((s, x) => {
      const r = chordRoot(x.chord);
      return r && r.root === tonic && r.minor === minor ? s + (x.end - x.start) : s;
    }, 0) / total;
  const cadence = (tonic: number, minor: boolean) => {
    let s = 0;
    for (const x of [voiced[0], voiced[voiced.length - 1]]) {
      const r = x && chordRoot(x.chord);
      if (r && r.root === tonic && r.minor === minor) s += 0.5;
    }
    return s;
  };

  // Share of chord time that belongs to each key (natural triads, plus the major V in minor keys,
  // which is how most minor-key songs reach their dominant). Raw note counts alone are fooled when
  // the dominant's root is the loudest note, e.g. F# in a B minor song.
  const diatonic = (tonic: number, minor: boolean) => {
    const set = minor
      ? [[0, true], [3, false], [5, true], [7, true], [7, false], [8, false], [10, false]]
      : [[0, false], [2, true], [4, true], [5, false], [7, false], [9, true]];
    return set.map(([i, m]) => `${(tonic + (i as number)) % 12}${m ? 'm' : ''}`);
  };
  const chordFit = (tonic: number, minor: boolean) => {
    const fits = new Set(diatonic(tonic, minor));
    return segments.reduce((s, x) => {
      const r = chordRoot(x.chord);
      return r && fits.has(`${r.root}${r.minor ? 'm' : ''}`) ? s + (x.end - x.start) : s;
    }, 0) / total;
  };

  const scored: { tonic: number; mode: 'major' | 'minor'; score: number }[] = [];
  for (let k = 0; k < 12; k++) {
    for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]] as const) {
      const rot = prof.map((_, i) => prof[(i - k + 12) % 12]);
      const minor = mode === 'minor';
      const score = pearson(profile, rot) + 0.35 * tonicShare(k, minor) + 0.1 * cadence(k, minor) + 0.8 * chordFit(k, minor);
      scored.push({ tonic: k, mode, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const margin = best.score - scored[1].score;
  return {
    tonic: best.tonic,
    mode: best.mode,
    name: `${PITCH_CLASSES[best.tonic]} ${best.mode}`,
    confidence: Math.max(0, Math.min(1, margin * 4 + Math.max(0, best.score) * 0.3)),
  };
}
