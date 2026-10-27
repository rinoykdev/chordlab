/** Deterministic synthetic audio with known chords. Used by the Vitest suite, the in-app
 * self-test and the demo song, so all three exercise exactly the same signals. */

export const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface ChordSpec { chord: string; seconds: number }
export interface SynthOptions {
  sampleRate?: number;
  /** Harmonic partials per note (1 = pure sine). */
  partials?: number;
  /** Detune the whole signal in cents. */
  detuneCents?: number;
  /** Additive white noise level relative to peak (0 = none). */
  noise?: number;
  /** Kick + hi-hat at this BPM (0 = none). */
  drumsBpm?: number;
  /** Which inversion to voice the triad in: 0, 1 or 2. */
  inversion?: number;
  /** Add a bass note an octave or two below the chord root. */
  bass?: boolean;
  /** Add a simple non-chord-tone melody (passing notes). */
  melody?: boolean;
  /** Leading silence in seconds. */
  leadIn?: number;
  seed?: number;
}

export function parseSpec(chord: string): { root: number; intervals: number[] } {
  const m = /^([A-G]#?)(maj7|m7|sus2|sus4|add9|dim|7|m|5)?$/.exec(chord);
  if (!m) throw new Error(`bad chord ${chord}`);
  const root = NOTE.indexOf(m[1]);
  const q = m[2] ?? '';
  const table: Record<string, number[]> = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 2], dim: [0, 3, 6], '5': [0, 7] };
  const intervals = table[q];
  return { root, intervals };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}

function addTone(out: Float32Array, sr: number, start: number, dur: number, midi: number, amp: number, partials: number, detune: number) {
  const f0 = 440 * 2 ** ((midi - 69 + detune / 100) / 12);
  const s0 = Math.floor(start * sr);
  const n = Math.floor(dur * sr);
  const attack = Math.floor(0.01 * sr);
  const release = Math.floor(0.08 * sr);
  for (let h = 1; h <= partials; h++) {
    const f = f0 * h;
    if (f > sr / 2.2) break;
    const a = amp / h;
    const w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      let env = Math.exp(-i / sr / 2.5); // gentle piano-like decay
      if (i < attack) env *= i / attack;
      if (i > n - release) env *= (n - i) / release;
      out[s0 + i] += a * env * Math.sin(w * i);
    }
  }
}

export function synthesize(progression: ChordSpec[], opts: SynthOptions = {}): { samples: Float32Array; sampleRate: number; truth: { start: number; end: number; chord: string }[] } {
  const sr = opts.sampleRate ?? 44100;
  const partials = opts.partials ?? 8;
  const detune = opts.detuneCents ?? 0;
  const leadIn = opts.leadIn ?? 0;
  const total = leadIn + progression.reduce((s, c) => s + c.seconds, 0);
  const out = new Float32Array(Math.ceil(total * sr));
  const rand = rng(opts.seed ?? 7);
  const truth: { start: number; end: number; chord: string }[] = [];
  if (leadIn > 0) truth.push({ start: 0, end: leadIn, chord: 'N' });
  let t = leadIn;
  for (const { chord, seconds } of progression) {
    const { root, intervals } = parseSpec(chord);
    // Voice in G3..F#4, then apply inversion by raising the lowest notes an octave.
    const notes = intervals.map((i) => { let m = 48 + ((root + i) % 12); while (m < 55) m += 12; return m; }).sort((a, b) => a - b);
    const rootMidi = notes.find((m) => m % 12 === root)!;
    const ordered = [rootMidi, ...notes.filter((m) => m !== rootMidi).map((m) => (m < rootMidi ? m + 12 : m))].sort((a, b) => a - b);
    const inv = opts.inversion ?? 0;
    for (let k = 0; k < inv && k < ordered.length; k++) ordered[k] += 12;
    for (const m of ordered) addTone(out, sr, t, seconds, m, 0.18, partials, detune);
    if (opts.bass) addTone(out, sr, t, seconds, 36 + root, 0.22, partials, detune);
    if (opts.melody) {
      // Eighth-note melody mixing chord tones and passing tones (2nds, 6ths).
      const step = opts.drumsBpm ? 30 / opts.drumsBpm : 0.25;
      const pool = [0, 2, ...intervals, 9].map((i) => 72 + ((root + i) % 12));
      for (let u = 0; u + step <= seconds + 1e-6; u += step) addTone(out, sr, t + u, step, pool[Math.floor(rand() * pool.length)], 0.1, partials, detune);
    }
    truth.push({ start: t, end: t + seconds, chord });
    t += seconds;
  }
  if (opts.drumsBpm) {
    const beat = 60 / opts.drumsBpm;
    for (let b = leadIn; b < total; b += beat) {
      const s0 = Math.floor(b * sr);
      for (let i = 0; i < 0.12 * sr && s0 + i < out.length; i++) {
        const env = Math.exp(-i / (0.03 * sr));
        out[s0 + i] += 0.5 * env * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-i / (0.01 * sr))) * (i / sr)); // kick
      }
      const h0 = Math.floor((b + beat / 2) * sr);
      for (let i = 0; i < 0.04 * sr && h0 + i < out.length; i++) out[h0 + i] += 0.15 * Math.exp(-i / (0.008 * sr)) * (rand() * 2 - 1); // hat
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = 0.8 / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= g;
  if (opts.noise) for (let i = 0; i < out.length; i++) out[i] += opts.noise * (rand() * 2 - 1);
  return { samples: out, sampleRate: sr, truth };
}

/** Fraction of time where the predicted label equals the reference label (WCSR-style). */
export function overlapAccuracy(pred: { start: number; end: number; chord: string }[], truth: { start: number; end: number; chord: string }[], tolerance = 0): number {
  let hit = 0; let total = 0;
  for (const r of truth) {
    const a = r.start + tolerance; const b = r.end - tolerance;
    if (b <= a) continue;
    total += b - a;
    for (const p of pred) {
      const lo = Math.max(a, p.start); const hi = Math.min(b, p.end);
      if (hi > lo && p.chord === r.chord) hit += hi - lo;
    }
  }
  return total ? hit / total : 0;
}

/** Progression helper: each chord lasts `beats` beats at `bpm`. */
export function bars(chords: string, bpm = 120, beats = 4): ChordSpec[] {
  return chords.split(/\s+/).filter(Boolean).map((chord) => ({ chord, seconds: (beats * 60) / bpm }));
}

/** Reduce a reference label to the major/minor vocabulary (as in MIREX "majmin" evaluation). */
export function toMajMin(label: string): string {
  if (label === 'N') return 'N';
  const m = /^([A-G]#?)(.*)$/.exec(label)!;
  const q = m[2];
  return m[1] + (q.startsWith('m') && !q.startsWith('maj') ? 'm' : '');
}
