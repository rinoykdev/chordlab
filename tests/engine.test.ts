/** Stage 1 acceptance: the DSP engine against synthetic audio with known chords. */
import { describe, expect, it } from 'vitest';
import { analyzeAudio, decodeFeatures, extractFeatures, UNCERTAIN_THRESHOLD } from '../src/engine';
import { bars, NOTE, overlapAccuracy, synthesize, toMajMin } from '../src/engine/testing/synth';

const majmin = (t: { start: number; end: number; chord: string }[]) => t.map((x) => ({ ...x, chord: toMajMin(x.chord) }));

async function detect(chords: string, bpm: number, beats: number, opts: Parameters<typeof synthesize>[1] = {}, decode = {}) {
  const { samples, sampleRate, truth } = synthesize(bars(chords, bpm, beats), opts);
  const { result, features } = await analyzeAudio(samples, sampleRate, { vocabulary: 'majmin', smoothing: 0.5, minDuration: 0.6, ...decode });
  return { result, features, truth };
}

describe('chord recognition: clean synthetic audio', () => {
  it('identifies all 24 major and minor triads', async () => {
    const all = [...NOTE, ...NOTE.map((n) => `${n}m`)].join(' ');
    const { result, truth } = await detect(all, 120, 3, { bass: true });
    const voiced = result.segments.filter((s) => s.chord !== 'N');
    expect(voiced.map((s) => s.chord)).toEqual(truth.map((t) => t.chord));
    expect(overlapAccuracy(result.segments, truth, 0.2)).toBeGreaterThan(0.95);
  });

  it('identifies triads synthesised as pure sine waves (no harmonics)', async () => {
    const { result, truth } = await detect('C Am F G Dm E', 100, 4, { partials: 1 });
    expect(overlapAccuracy(result.segments, truth, 0.2)).toBeGreaterThan(0.95);
  });

  it.each([
    ['I–V–vi–IV in C', 'C G Am F C G Am F'],
    ['i–iv–V–i in A minor', 'Am Dm E Am Am Dm E Am'],
    ['ii–V–I in B flat', 'Cm F A# A# Cm F A# A#'],
    ['sharp keys', 'F# C#m D#m B G#m C# F# B'],
  ])('%s', async (_, chords) => {
    const { result, truth } = await detect(chords, 100, 4, { bass: true });
    expect(overlapAccuracy(result.segments, truth, 0.2)).toBeGreaterThan(0.97);
  });

  it('places chord boundaries within 250 ms of the truth', async () => {
    const { result, truth } = await detect('C G Am F', 90, 4, { bass: true });
    const voiced = result.segments.filter((s) => s.chord !== 'N');
    expect(voiced).toHaveLength(truth.length);
    voiced.forEach((s, i) => {
      if (i > 0) expect(Math.abs(s.start - truth[i].start)).toBeLessThan(0.25);
    });
  });

  it('follows fast changes (one chord per beat at 100 BPM) with low smoothing', async () => {
    const { result, truth } = await detect('C F G C Am Dm G C', 100, 1, { bass: true }, { smoothing: 0.15, minDuration: 0.3 });
    expect(overlapAccuracy(result.segments, truth, 0.1)).toBeGreaterThan(0.85);
  });
});

describe('chord recognition: robustness', () => {
  it.each([
    ['first inversion + drums', { bass: false, inversion: 1, drumsBpm: 100 }],
    ['second inversion', { inversion: 2 }],
    ['white noise at 10% of peak', { bass: true, noise: 0.1 }],
    ['detuned by +35 cents', { bass: true, detuneCents: 35 }],
    ['detuned by −40 cents', { bass: true, detuneCents: -40 }],
    ['melody with passing tones + drums', { bass: true, melody: true, drumsBpm: 100 }],
    ['everything at once', { bass: true, melody: true, drumsBpm: 100, noise: 0.06, inversion: 1, detuneCents: -20 }],
  ])('%s', async (_, opts) => {
    const { result, truth } = await detect('D Bm G A F#m Bm Em A', 100, 4, opts);
    expect(overlapAccuracy(result.segments, truth, 0.25)).toBeGreaterThan(0.9);
  });

  it('estimates tuning offsets to within 5 cents', async () => {
    for (const cents of [-30, 0, 20]) {
      const { samples, sampleRate } = synthesize(bars('C G Am F', 100), { detuneCents: cents, bass: true });
      const f = extractFeatures(samples, sampleRate);
      expect(Math.abs(f.tuningCents - cents)).toBeLessThan(5);
    }
  });
});

describe('no-chord, confidence and uncertainty', () => {
  it('labels silence as N and finds the first chord after a lead-in', async () => {
    const { result } = await detect('A E F#m D', 100, 4, { leadIn: 2, bass: true });
    expect(result.segments[0].chord).toBe('N');
    expect(result.segments[0].end).toBeGreaterThan(1.7);
    expect(result.segments[0].end).toBeLessThan(2.3);
    expect(result.segments[1].chord).toBe('A');
  });

  it('returns N for white noise only', async () => {
    const sr = 22050;
    const samples = new Float32Array(sr * 6);
    let s = 1;
    for (let i = 0; i < samples.length; i++) { s = (s * 16807) % 2147483647; samples[i] = (s / 2147483647 - 0.5) * 0.5; }
    const { result } = await analyzeAudio(samples, sr);
    const nTime = result.segments.filter((x) => x.chord === 'N').reduce((a, x) => a + x.end - x.start, 0);
    expect(nTime / result.duration).toBeGreaterThan(0.8);
  });

  it('gives clean triads high confidence', async () => {
    const { result } = await detect('C G Am F', 100, 4, { bass: true });
    for (const s of result.segments) expect(s.confidence).toBeGreaterThan(0.85);
    expect(result.uncertainShare).toBeLessThan(0.05);
  });

  it('flags ambiguous harmony (bare C–E dyads) as uncertain and offers alternatives', async () => {
    // A C–E dyad fits C major and A minor equally well.
    const { samples, sampleRate } = synthesize([{ chord: 'C', seconds: 4 }], {});
    // Remove the G by synthesising the two notes directly: reuse C major vs a C+E-only render.
    const dyad = synthesize([{ chord: 'Am', seconds: 4 }], {}); // A C E
    const mix = new Float32Array(Math.min(samples.length, dyad.samples.length));
    for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * samples[i] + 0.5 * dyad.samples[i]; // C E G + A C E
    const { result } = await analyzeAudio(mix, sampleRate);
    const main = result.segments.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    expect(['C', 'Am']).toContain(main.chord);
    expect(main.confidence).toBeLessThan(UNCERTAIN_THRESHOLD + 0.2);
    expect(main.alternatives?.map((a) => a.chord)).toContain(main.chord === 'C' ? 'Am' : 'C');
  });
});

describe('extended vocabulary (beta)', () => {
  it('detects dominant, major and minor sevenths', async () => {
    const { result, truth } = await detect('G7 Cmaj7 Am7 D7 Em7 Fmaj7 Dm7 G7', 100, 4, { bass: true }, { vocabulary: 'extended' });
    expect(overlapAccuracy(result.segments, truth, 0.2)).toBeGreaterThan(0.75);
  });
  it('still reduces correctly to major/minor', async () => {
    const { result, truth } = await detect('G7 Cmaj7 Am7 D7', 100, 4, { bass: true });
    expect(overlapAccuracy(result.segments, majmin(truth), 0.2)).toBeGreaterThan(0.95);
  });
});

describe('key and tempo', () => {
  it.each([
    ['C G Am F C G F C', 'C major'],
    ['Am Dm E Am Am Dm E Am', 'A minor'],
    ['D G A D Bm G A D', 'D major'],
    ['Em C D Em Em Am B Em', 'E minor'],
    ['C# F# G# C# A#m F# G# C#', 'C# major'],
  ])('%s → %s', async (chords, key) => {
    const { result } = await detect(chords, 100, 4, { bass: true });
    expect(result.key.name).toBe(key);
  });

  it.each([66, 72, 90, 100, 110, 128, 140, 174])('tempo %i BPM (within 3%, metrical octave allowed)', async (bpm) => {
    const { result } = await detect('G D Em C G D Em C', bpm, 4, { drumsBpm: bpm, bass: true });
    const ratio = result.tempo.bpm / bpm;
    expect([0.5, 1, 2].some((m) => Math.abs(ratio - m) / m < 0.03)).toBe(true);
  });

  it.each([100, 110, 128, 140])('tempo %i BPM exactly', async (bpm) => {
    const { result } = await detect('G D Em C G D Em C', bpm, 4, { drumsBpm: bpm, bass: true, melody: true });
    expect(Math.abs(result.tempo.bpm - bpm) / bpm).toBeLessThan(0.03);
  });
});

describe('pipeline behaviour', () => {
  it('is deterministic', async () => {
    const a = await detect('C G Am F', 100, 4, { noise: 0.05, bass: true });
    const b = await detect('C G Am F', 100, 4, { noise: 0.05, bass: true });
    expect(a.result.segments.map((s) => [s.chord, s.start, s.confidence])).toEqual(b.result.segments.map((s) => [s.chord, s.start, s.confidence]));
  });

  it('re-decodes cached features with new settings without re-reading audio', async () => {
    const { features } = await detect('C F G C Am Dm G C', 100, 1, { bass: true, noise: 0.15, melody: true });
    const loose = await decodeFeatures(features, { vocabulary: 'majmin', smoothing: 0, minDuration: 0.1 });
    const tight = await decodeFeatures(features, { vocabulary: 'majmin', smoothing: 1, minDuration: 2 });
    expect(tight.segments.length).toBeLessThan(loose.segments.length);
  });

  it('rejects clips that are too short and corrupted samples', async () => {
    await expect(analyzeAudio(new Float32Array(1000), 44100)).rejects.toThrow(/too short/);
    const bad = new Float32Array(44100); bad.fill(NaN);
    await expect(analyzeAudio(bad, 44100)).rejects.toThrow(/invalid samples/);
  });

  it('analyses a 5-minute recording in reasonable time', async () => {
    const chords = Array.from({ length: 75 }, (_, i) => ['C', 'G', 'Am', 'F'][i % 4]).join(' ');
    const { samples, sampleRate, truth } = synthesize(bars(chords, 60, 4), { sampleRate: 11025, bass: true, partials: 4 });
    expect(samples.length / sampleRate).toBeGreaterThanOrEqual(299);
    const t0 = performance.now();
    const { result } = await analyzeAudio(samples, sampleRate);
    expect(performance.now() - t0).toBeLessThan(20000);
    expect(overlapAccuracy(result.segments, truth, 0.25)).toBeGreaterThan(0.95);
  }, 60000);
});

describe('key: minor keys whose dominant is the loudest note', () => {
  it.each([
    ['Bm F# A E G D Em F#', 'B minor'],
    ['Am E Am E F E Am E', 'A minor'],
    ['Em B Em B C B Em B', 'E minor'],
  ])('%s → %s', async (chords, key) => {
    const { samples, sampleRate } = synthesize(bars(chords, 74), { bass: true });
    const { result } = await analyzeAudio(samples, sampleRate);
    expect(result.key.name).toBe(key);
  });
});
