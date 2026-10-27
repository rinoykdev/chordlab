/** Stage 3: HMM/Viterbi smoothing, segmentation and confidence scoring. */
import type { DecodeOptions, Features, Segment } from './types';
import { UNCERTAIN_THRESHOLD } from './types';
import type { VocabEntry } from './vocabulary';

let idCounter = 0;
export function segmentId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `s${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Map the 0..1 smoothing control to a chord-change penalty in logit units. */
export function switchPenalty(smoothing: number): number {
  return 2 + Math.max(0, Math.min(1, smoothing)) * 22;
}

export function viterbi(scores: Float32Array, nFrames: number, K: number, penalty: number): Int32Array {
  const back = new Int32Array(nFrames * K);
  let prev = new Float64Array(K);
  let cur = new Float64Array(K);
  for (let k = 0; k < K; k++) prev[k] = scores[k];
  for (let t = 1; t < nFrames; t++) {
    let best = -Infinity;
    let bestK = 0;
    for (let k = 0; k < K; k++) if (prev[k] > best) { best = prev[k]; bestK = k; }
    const jump = best - penalty;
    for (let k = 0; k < K; k++) {
      const stay = prev[k];
      if (stay >= jump) { cur[k] = stay; back[t * K + k] = k; }
      else { cur[k] = jump; back[t * K + k] = bestK; }
      cur[k] += scores[t * K + k];
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  const path = new Int32Array(nFrames);
  let best = -Infinity;
  for (let k = 0; k < K; k++) if (prev[k] > best) { best = prev[k]; path[nFrames - 1] = k; }
  for (let t = nFrames - 1; t > 0; t--) path[t - 1] = back[t * K + path[t]];
  return path;
}

/** Per-frame softmax of the scores. */
export function posteriors(scores: Float32Array, nFrames: number, K: number): Float32Array {
  const post = new Float32Array(scores.length);
  for (let t = 0; t < nFrames; t++) {
    let m = -Infinity;
    for (let k = 0; k < K; k++) m = Math.max(m, scores[t * K + k]);
    let s = 0;
    for (let k = 0; k < K; k++) { const e = Math.exp(scores[t * K + k] - m); post[t * K + k] = e; s += e; }
    for (let k = 0; k < K; k++) post[t * K + k] /= s;
  }
  return post;
}

interface Run { label: number; t0: number; t1: number } // t1 exclusive

function runsOf(path: Int32Array): Run[] {
  const runs: Run[] = [];
  for (let t = 0; t < path.length; t++) {
    const last = runs[runs.length - 1];
    if (last && last.label === path[t]) last.t1 = t + 1;
    else runs.push({ label: path[t], t0: t, t1: t + 1 });
  }
  return runs;
}

function mergeEqual(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.label === r.label) last.t1 = r.t1;
    else out.push({ ...r });
  }
  return out;
}

/** Absorb runs shorter than minFrames into whichever neighbour explains their frames better. */
function absorbShort(runs: Run[], scores: Float32Array, K: number, minFrames: number): Run[] {
  let rs = mergeEqual(runs);
  for (;;) {
    let idx = -1;
    let shortest = Infinity;
    rs.forEach((r, i) => {
      const len = r.t1 - r.t0;
      if (len < minFrames && len < shortest && rs.length > 1) { shortest = len; idx = i; }
    });
    if (idx < 0) break;
    const r = rs[idx];
    const cands = [rs[idx - 1]?.label, rs[idx + 1]?.label].filter((x): x is number => x !== undefined);
    let bestLabel = cands[0];
    let bestScore = -Infinity;
    for (const c of cands) {
      let s = 0;
      for (let t = r.t0; t < r.t1; t++) s += scores[t * K + c];
      if (s > bestScore) { bestScore = s; bestLabel = c; }
    }
    r.label = bestLabel;
    rs = mergeEqual(rs);
  }
  return rs;
}

export function segmentPath(
  path: Int32Array,
  scores: Float32Array,
  features: Features,
  vocab: VocabEntry[],
  options: DecodeOptions,
): { segments: Segment[]; uncertainShare: number } {
  const K = vocab.length;
  const { nFrames, hopSeconds, duration } = features;
  const minFrames = Math.max(1, Math.round(options.minDuration / hopSeconds));
  const runs = absorbShort(runsOf(path), scores, K, minFrames);
  const post = posteriors(scores, nFrames, K);
  let voiced = 0;
  let uncertain = 0;
  const segments: Segment[] = runs.map((r, i) => {
    const acc = new Float64Array(K);
    for (let t = r.t0; t < r.t1; t++) for (let k = 0; k < K; k++) acc[k] += post[t * K + k];
    const n = r.t1 - r.t0;
    const confidence = acc[r.label] / n;
    if (r.label !== 0) {
      for (let t = r.t0; t < r.t1; t++) { voiced++; if (post[t * K + r.label] < UNCERTAIN_THRESHOLD) uncertain++; }
    }
    const alternatives = Array.from(acc, (v, k) => ({ chord: vocab[k].label, p: v / n }))
      .filter((a, k) => k !== r.label && a.p > 0.03)
      .sort((a, b) => b.p - a.p)
      .slice(0, 3)
      .map((a) => ({ chord: a.chord, p: Math.round(a.p * 1000) / 1000 }));
    return {
      id: segmentId(),
      start: i === 0 ? 0 : r.t0 * hopSeconds,
      end: i === runs.length - 1 ? duration : r.t1 * hopSeconds,
      chord: vocab[r.label].label,
      confidence: Math.round(confidence * 1000) / 1000,
      alternatives,
    };
  });
  return { segments, uncertainShare: voiced ? uncertain / voiced : 0 };
}
