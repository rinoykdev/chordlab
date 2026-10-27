/** Stage 1: audio → frame features (chroma, bass chroma, loudness, onset envelope, tuning). */
import { FFT, hann, resample } from './dsp';
import type { Features, ProgressFn } from './types';

export const ANALYSIS_RATE = 11025;
const N = 4096; // ≈ 372 ms window, 2.7 Hz bins — resolves semitones down to ≈ E2
const HOP = 512; // ≈ 46 ms between chroma frames
const ONSET_N = 1024;
const ONSET_HOP = 128; // ≈ 86 onset frames per second

const TREBLE = [48, 95] as const; // C3 .. B6
const BASS = [31, 54] as const; // G1 .. F#3
const SILENCE_DB = -60;
const RELATIVE_SILENCE_DB = -45;

function midiOf(f: number, tuningCents: number): number {
  return 69 + 12 * Math.log2(f / 440) - tuningCents / 100;
}

/** Read one centred, windowed frame into re/im. */
function loadFrame(x: Float32Array, center: number, win: Float64Array, re: Float64Array, im: Float64Array): number {
  const n = win.length;
  const start = center - n / 2;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const j = start + i;
    const v = j >= 0 && j < x.length ? x[j] : 0;
    energy += v * v;
    re[i] = v * win[i];
    im[i] = 0;
  }
  return Math.sqrt(energy / n);
}

/** Circular mean of spectral-peak deviations from the A440 semitone grid. */
export function estimateTuning(x: Float32Array, sr: number, onProgress?: ProgressFn): number {
  const fft = new FFT(N);
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(N / 2);
  const nFrames = Math.ceil(x.length / HOP);
  const stride = Math.max(1, Math.floor(nFrames / 400)); // ≤ 400 frames is plenty
  let sx = 0;
  let sy = 0;
  const kLo = Math.ceil((100 * N) / sr);
  const kHi = Math.floor((2000 * N) / sr);
  for (let t = 0; t < nFrames; t += stride) {
    const rms = loadFrame(x, t * HOP, win, re, im);
    if (rms < 1e-4) continue;
    fft.transform(re, im);
    let peak = 0;
    for (let k = 0; k < N / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      if (mag[k] > peak) peak = mag[k];
    }
    for (let k = kLo; k < kHi; k++) {
      const m = mag[k];
      if (m < peak * 0.05 || m <= mag[k - 1] || m < mag[k + 1]) continue;
      // Parabolic interpolation on log magnitude for sub-bin accuracy.
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(mag[k + 1] + 1e-12);
      const off = (0.5 * (a - c)) / (a - 2 * b + c);
      const f = ((k + off) * sr) / N;
      const cents = 1200 * Math.log2(f / 440);
      const ang = (2 * Math.PI * cents) / 100;
      const w = Math.sqrt(m);
      sx += w * Math.cos(ang);
      sy += w * Math.sin(ang);
    }
    if (onProgress && t % (stride * 50) === 0) onProgress('Estimating tuning', t / nFrames);
  }
  if (sx === 0 && sy === 0) return 0;
  return (Math.atan2(sy, sx) / (2 * Math.PI)) * 100;
}

function medianFilterChroma(c: Float32Array, nFrames: number, width: number): Float32Array {
  const out = new Float32Array(c.length);
  const half = width >> 1;
  const buf: number[] = [];
  for (let p = 0; p < 12; p++) {
    for (let t = 0; t < nFrames; t++) {
      buf.length = 0;
      for (let u = Math.max(0, t - half); u <= Math.min(nFrames - 1, t + half); u++) buf.push(c[u * 12 + p]);
      buf.sort((a, b) => a - b);
      out[t * 12 + p] = buf[buf.length >> 1];
    }
  }
  return out;
}

function normaliseRows(c: Float32Array, nFrames: number, silent: Uint8Array): void {
  for (let t = 0; t < nFrames; t++) {
    let s = 0;
    for (let p = 0; p < 12; p++) s += c[t * 12 + p] ** 2;
    const n = Math.sqrt(s);
    for (let p = 0; p < 12; p++) c[t * 12 + p] = silent[t] || n < 1e-9 ? 0 : c[t * 12 + p] / n;
  }
}

function onsetEnvelope(x: Float32Array, sr: number): Float32Array {
  const fft = new FFT(ONSET_N);
  const win = hann(ONSET_N);
  const re = new Float64Array(ONSET_N);
  const im = new Float64Array(ONSET_N);
  const half = ONSET_N / 2;
  let prev = new Float64Array(half);
  let cur = new Float64Array(half);
  const nFrames = Math.ceil(x.length / ONSET_HOP);
  const env = new Float32Array(nFrames);
  const kMax = Math.min(half, Math.floor((5000 * ONSET_N) / sr));
  for (let t = 0; t < nFrames; t++) {
    loadFrame(x, t * ONSET_HOP, win, re, im);
    fft.transform(re, im);
    let flux = 0;
    for (let k = 1; k < kMax; k++) {
      cur[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]) / (ONSET_N / 4));
      const d = cur[k] - prev[k];
      if (d > 0 && t > 0) flux += d;
    }
    env[t] = flux;
    const tmp = prev; prev = cur; cur = tmp;
  }
  // Remove slow trend (≈ 0.5 s moving average) and half-wave rectify.
  const w = Math.round((0.5 * sr) / ONSET_HOP);
  const pref = new Float64Array(nFrames + 1);
  for (let t = 0; t < nFrames; t++) pref[t + 1] = pref[t] + env[t];
  const out = new Float32Array(nFrames);
  for (let t = 0; t < nFrames; t++) {
    const a = Math.max(0, t - w); const b = Math.min(nFrames, t + w + 1);
    out[t] = Math.max(0, env[t] - (pref[b] - pref[a]) / (b - a));
  }
  return out;
}

/**
 * Extract frame features from mono PCM. Audio at any rate is accepted; it is resampled to
 * 11 025 Hz, which keeps the spectrum we care about (< 2 kHz) and quarters the work.
 */
export function extractFeatures(input: Float32Array, inputRate: number, onProgress?: ProgressFn): Features {
  onProgress?.('Preparing audio', 0);
  const x = inputRate === ANALYSIS_RATE ? input : resample(input, inputRate, ANALYSIS_RATE);
  const sr = ANALYSIS_RATE;
  const duration = x.length / sr;
  const tuningCents = estimateTuning(x, sr, (s, f) => onProgress?.(s, 0.05 + f * 0.1));

  // Pre-compute bin → pitch mapping with a raised-cosine weight around each semitone centre.
  const half = N / 2;
  const binPitch = new Int16Array(half).fill(-1);
  const binW = new Float32Array(half);
  for (let k = 1; k < half; k++) {
    const f = (k * sr) / N;
    if (f < 45 || f > 2100) continue;
    const m = midiOf(f, tuningCents);
    const q = Math.round(m);
    if (q < BASS[0] || q > TREBLE[1]) continue;
    binPitch[k] = q;
    binW[k] = Math.cos(Math.PI * (m - q)) ** 2;
  }

  const fft = new FFT(N);
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const Y = new Float64Array(half);
  const pref = new Float64Array(half + 1);
  const sal = new Float64Array(128);
  const nFrames = Math.max(1, Math.ceil(x.length / HOP));
  const treble = new Float32Array(nFrames * 12);
  const bass = new Float32Array(nFrames * 12);
  const loudness = new Float32Array(nFrames);
  const norm = N / 4; // full-scale sine magnitude with a Hann window

  for (let t = 0; t < nFrames; t++) {
    const rms = loadFrame(x, t * HOP, win, re, im);
    loudness[t] = 20 * Math.log10(rms + 1e-9);
    fft.transform(re, im);
    for (let k = 0; k < half; k++) {
      Y[k] = Math.log1p((100 * Math.hypot(re[k], im[k])) / norm);
      pref[k + 1] = pref[k] + Y[k];
    }
    sal.fill(0);
    for (let k = 1; k < half; k++) {
      const q = binPitch[k];
      if (q < 0) continue;
      // Spectral whitening: remove the local mean (≈ ±2 semitones) so broadband
      // noise and drums contribute little while tonal peaks survive.
      const w = Math.max(3, Math.round(k * 0.12));
      const a = Math.max(0, k - w); const b = Math.min(half, k + w + 1);
      const v = Y[k] - (pref[b] - pref[a]) / (b - a);
      if (v > 0) sal[q] += v * binW[k];
    }
    for (let q = TREBLE[0]; q <= TREBLE[1]; q++) treble[t * 12 + (q % 12)] += sal[q];
    for (let q = BASS[0]; q <= BASS[1]; q++) bass[t * 12 + (q % 12)] += sal[q];
    if (onProgress && t % 200 === 0) onProgress('Extracting chroma', 0.15 + 0.6 * (t / nFrames));
  }

  let peakDb = -Infinity;
  for (let t = 0; t < nFrames; t++) peakDb = Math.max(peakDb, loudness[t]);
  const silent = new Uint8Array(nFrames);
  for (let t = 0; t < nFrames; t++) {
    silent[t] = loudness[t] < SILENCE_DB || loudness[t] < peakDb + RELATIVE_SILENCE_DB ? 1 : 0;
  }
  normaliseRows(treble, nFrames, silent);
  normaliseRows(bass, nFrames, silent);
  const chroma = medianFilterChroma(treble, nFrames, 7);
  const bassF = medianFilterChroma(bass, nFrames, 7);
  normaliseRows(chroma, nFrames, silent);
  normaliseRows(bassF, nFrames, silent);

  onProgress?.('Detecting onsets', 0.8);
  const onset = onsetEnvelope(x, sr);
  onProgress?.('Features ready', 0.9);

  return {
    sampleRate: sr,
    hopSeconds: HOP / sr,
    windowSeconds: N / sr,
    duration,
    nFrames,
    chroma,
    bass: bassF,
    loudness,
    tuningCents,
    onset,
    onsetRate: sr / ONSET_HOP,
  };
}
