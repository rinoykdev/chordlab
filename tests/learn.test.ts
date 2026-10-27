/** Teach Chordlab: learning chord-type profiles from labelled takes. */
import { describe, expect, it } from 'vitest';
import { analyzeAudio, buildProfile, checkTake, clipChroma, createProfileRecognizer, decodeFeatures, evaluate, extractFeatures, MIN_TAKES, type TeachExample } from '../src/engine';
import { bars, NOTE, overlapAccuracy, synthesize } from '../src/engine/testing/synth';

/** One "take": a chord held for 3 s, like a recording from the Teach screen. */
function take(root: string, suffix: string, opts: Parameters<typeof synthesize>[1] = {}): TeachExample {
  const { samples, sampleRate } = synthesize([{ chord: root + suffix, seconds: 3 }], { sampleRate: 22050, ...opts });
  const chroma = clipChroma(extractFeatures(samples, sampleRate));
  if (!chroma) throw new Error('no chroma');
  return { root: NOTE.indexOf(root), suffix, chroma };
}

describe('take checking', () => {
  it('accepts takes that match the requested chord', () => {
    for (const [r, s] of [['G', ''], ['A', 'm'], ['D', 'sus4'], ['E', '7'], ['B', 'dim'], ['C', 'add9']] as const) {
      expect(checkTake(take(r, s).chroma, NOTE.indexOf(r), s).ok, `${r}${s}`).toBe(true);
    }
  });
  it('flags a take where the wrong chord was played', () => {
    const played = take('G', '');
    const c = checkTake(played.chroma, NOTE.indexOf('G'), 'sus4'); // asked for Gsus4, played G
    expect(c.ok).toBe(false);
    expect(c.heardAs).toBe('G');
    expect(checkTake(take('A', 'm').chroma, NOTE.indexOf('C'), '').ok).toBe(false);
  });
  it('returns null chroma for silence', () => {
    expect(clipChroma(extractFeatures(new Float32Array(22050 * 3), 22050))).toBeNull();
  });
});

describe('profiles', () => {
  it(`learns a chord type only after ${MIN_TAKES} takes and counts distinct roots`, () => {
    const p = buildProfile([take('G', 'sus4'), take('A', ''), take('C', '')]);
    expect(p.templates.map((t) => t.suffix)).toEqual(['']);
    expect(p.templates[0]).toMatchObject({ count: 2, roots: 2 });
  });

  it('transfers to roots it never heard: learns sus4 from G and A, detects Dsus4 and Esus4 in a song', async () => {
    const profile = buildProfile([take('G', 'sus4'), take('A', 'sus4'), take('G', 'sus4', { inversion: 1 }), take('C', ''), take('A', 'm')]);
    const { samples, sampleRate, truth } = synthesize(bars('D Dsus4 D Dsus4 E Esus4 E A', 100), { bass: true });
    const { features, result: plain } = await analyzeAudio(samples, sampleRate);
    expect(plain.segments.some((s) => s.chord.includes('sus'))).toBe(false); // default vocabulary can't
    const learned = await decodeFeatures(features, plain.options, createProfileRecognizer(profile));
    expect(learned.engine).toBe('template-hmm+profile');
    expect(learned.segments.filter((s) => s.chord.endsWith('sus4')).map((s) => s.chord)).toEqual(['Dsus4', 'Dsus4', 'Esus4']);
    expect(overlapAccuracy(learned.segments, truth, 0.2)).toBeGreaterThan(0.9);
  });

  it('does not hurt ordinary major/minor detection', async () => {
    const profile = buildProfile([take('G', ''), take('C', ''), take('A', 'm'), take('E', 'm'), take('D', 'sus4'), take('A', 'sus4')]);
    const { samples, sampleRate, truth } = synthesize(bars('C G Am F C G Am F', 100), { bass: true, drumsBpm: 100 });
    const { features, result } = await analyzeAudio(samples, sampleRate);
    const learned = await decodeFeatures(features, result.options, createProfileRecognizer(profile));
    expect(overlapAccuracy(learned.segments, truth, 0.2)).toBeGreaterThan(0.95);
  });
});

describe('evaluation', () => {
  it('reports leave-one-out accuracy for default and profile, per chord type', () => {
    const ex = [take('G', ''), take('A', ''), take('C', ''), take('G', 'sus2'), take('A', 'sus2'), take('D', 'sus2')];
    const ev = evaluate(ex);
    expect(ev.total).toBe(6);
    const sus2 = ev.perType.find((t) => t.suffix === 'sus2')!;
    expect(sus2).toMatchObject({ takes: 3, roots: 3, tested: 3 });
    expect(ev.learnedCorrect).toBeGreaterThanOrEqual(5);
    expect(ev.learnedCorrect).toBeGreaterThanOrEqual(ev.defaultCorrect - 1);
  });
});
