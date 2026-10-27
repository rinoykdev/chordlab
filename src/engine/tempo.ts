/** Tempo estimation: autocorrelation of the onset envelope with a log-normal prior around 120 BPM. */
import type { Features, TempoEstimate } from './types';

export function estimateTempo(features: Features, minBpm = 50, maxBpm = 220): TempoEstimate {
  const { onset, onsetRate } = features;
  const n = onset.length;
  if (n < onsetRate * 4) return { bpm: 0, confidence: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i];
  mean /= n;
  const x = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) { x[i] = onset[i] - mean; energy += x[i] * x[i]; }
  if (energy < 1e-9) return { bpm: 0, confidence: 0 };

  const lagMin = Math.floor((60 * onsetRate) / maxBpm);
  const lagMax = Math.min(n - 1, Math.ceil((60 * onsetRate) / minBpm) * 4);
  const ac = new Float64Array(lagMax + 2);
  // Limit to the first ~3 minutes; tempo is usually stable and this bounds the cost.
  const span = Math.min(n, Math.round(onsetRate * 180));
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = 0; i + lag < span; i++) s += x[i] * x[i + lag];
    ac[lag] = s / (span - lag);
  }
  const acAt = (l: number) => {
    const i = Math.floor(l); const f = l - i;
    return i + 1 < ac.length ? ac[i] * (1 - f) + ac[i + 1] * f : 0;
  };
  let bestLag = 0;
  let bestScore = -Infinity;
  const lagHi = Math.ceil((60 * onsetRate) / minBpm);
  for (let lag = lagMin; lag <= lagHi; lag++) {
    const bpm = (60 * onsetRate) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    // Comb over the beat, half-bar and bar: the true beat repeats at every metrical level.
    const comb = acAt(lag) + 0.5 * acAt(lag * 2) + 0.5 * acAt(lag * 4);
    const score = comb * prior;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (bestLag === 0 || ac[bestLag] <= 0) return { bpm: 0, confidence: 0 };
  // Parabolic refinement.
  const a = ac[bestLag - 1] ?? ac[bestLag];
  const b = ac[bestLag];
  const c = ac[bestLag + 1] ?? ac[bestLag];
  const denom = a - 2 * b + c;
  const off = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const bpm = (60 * onsetRate) / (bestLag + off);
  const zero = energy / n;
  return { bpm: Math.round(bpm * 10) / 10, confidence: Math.max(0, Math.min(1, b / zero)) };
}
