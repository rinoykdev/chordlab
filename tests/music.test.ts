/** Chord mapping: parsing, transposition and instrument voicings. */
import { describe, expect, it } from 'vitest';
import {
  canonicalChord, chordPitchClasses, diatonicChords, displayChord, keyName, keyPrefersFlats, parseChord, transposeChord, QUALITIES, SHARPS,
} from '../src/music/theory';
import { assignFingers, curatedShapes, suggestCapo, TUNINGS, voicingsFor, type FrettedInstrument } from '../src/music/fretted';
import { pianoVoicing, PIANO_VOICINGS } from '../src/music/piano';

describe('chord symbols', () => {
  it('parses roots, accidentals, qualities and slash basses', () => {
    expect(parseChord('C')!.quality.suffix).toBe('');
    expect(parseChord('Bbm')!.root).toBe(10);
    expect(parseChord('F#maj7')!.quality.suffix).toBe('maj7');
    expect(parseChord('Gsus')!.quality.suffix).toBe('sus4');
    expect(parseChord('Am7b5')!.quality.suffix).toBe('m7b5');
    expect(parseChord('C/G')!.bass).toBe(7);
    expect(parseChord('Cmin')!.quality.suffix).toBe('m');
    expect(parseChord('H')).toBeNull();
    expect(parseChord('Cxyz')).toBeNull();
    expect(parseChord('N')).toBeNull();
  });

  it('canonicalises to sharp spelling for storage', () => {
    expect(canonicalChord('Bbm')).toBe('A#m');
    expect(canonicalChord('Db7')).toBe('C#7');
    expect(canonicalChord('N')).toBe('N');
  });

  it('transposes up and down, wrapping the octave', () => {
    expect(transposeChord('C', 2)).toBe('D');
    expect(transposeChord('Am', -2)).toBe('Gm');
    expect(transposeChord('B7', 1)).toBe('C7');
    expect(transposeChord('C', -1, true)).toBe('B');
    expect(transposeChord('F#m', 12)).toBe('F#m');
    expect(transposeChord('C/E', 5, true)).toBe('F/A');
    expect(transposeChord('N', 3)).toBe('N');
  });

  it('round-trips every chord through every transposition', () => {
    for (const q of QUALITIES) for (const r of SHARPS) for (let s = -11; s <= 11; s++) {
      const name = r + q.suffix;
      expect(canonicalChord(transposeChord(transposeChord(name, s), -s))).toBe(canonicalChord(name));
    }
  });

  it('spells with flats in flat keys', () => {
    expect(keyPrefersFlats(5, 'major')).toBe(true); // F
    expect(keyPrefersFlats(2, 'minor')).toBe(true); // D minor → F major
    expect(keyPrefersFlats(7, 'major')).toBe(false); // G
    expect(displayChord('A#', 0, true)).toBe('Bb');
    expect(displayChord('N', 0, false)).toBe('N.C.');
    expect(keyName(0, 'major', 3)).toBe('Eb major');
    expect(diatonicChords(7, 'major')).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#dim']);
  });
});

function soundingPcs(frets: number[], tuning: number[]) {
  return frets.map((f, i) => (f < 0 ? -1 : (tuning[i] + f) % 12)).filter((x) => x >= 0);
}

describe('fretted voicings', () => {
  it.each(['guitar', 'ukulele'] as FrettedInstrument[])('every curated %s shape plays exactly its chord', (inst) => {
    const tuning = TUNINGS[inst][0].notes;
    for (const [name, shapes] of Object.entries(curatedShapes(inst))) {
      const pcs = chordPitchClasses(parseChord(name)!);
      for (const [frets, fingers] of shapes) {
        expect(frets).toHaveLength(tuning.length);
        expect(fingers).toHaveLength(tuning.length);
        const s = soundingPcs(frets, tuning);
        for (const pc of s) expect(pcs, `${inst} ${name} ${frets}`).toContain(pc);
        expect(s, `${inst} ${name} root`).toContain(pcs[0]);
        expect(s, `${inst} ${name} third`).toContain(pcs[1]);
        frets.forEach((f, i) => expect(f > 0 ? fingers[i] > 0 : fingers[i] === 0, `${inst} ${name} finger ${i}`).toBe(true));
      }
    }
  });

  it('puts the root in the bass on guitar', () => {
    const tuning = TUNINGS.guitar[0].notes;
    for (const r of SHARPS) for (const q of ['', 'm', '7', 'maj7', 'm7']) {
      const v = voicingsFor(r + q, 'guitar')[0];
      const lowest = v.frets.findIndex((f) => f >= 0);
      expect((tuning[lowest] + v.frets[lowest]) % 12, `${r}${q} ${v.frets}`).toBe(SHARPS.indexOf(r));
    }
  });

  it.each([...TUNINGS.guitar.map((t) => ['guitar', t.id] as [FrettedInstrument, string]), ...TUNINGS.ukulele.map((t) => ['ukulele', t.id] as [FrettedInstrument, string])])(
    'finds a playable shape for every chord on %s (%s)', (inst, tuningId) => {
      const tuning = TUNINGS[inst].find((t) => t.id === tuningId)!.notes;
      for (const r of SHARPS) for (const q of QUALITIES) {
        if (q.suffix === '5' && inst === 'ukulele') continue;
        const name = r + q.suffix;
        const vs = voicingsFor(name, inst, tuningId);
        expect(vs.length, `${inst}/${tuningId} ${name}`).toBeGreaterThan(0);
        const pcs = chordPitchClasses(parseChord(name)!);
        for (const v of vs) {
          for (const pc of soundingPcs(v.frets, tuning)) expect(pcs).toContain(pc);
          const fretted = v.frets.filter((f) => f > 0);
          if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(3);
          expect(new Set(v.fingers.filter((f) => f > 0)).size).toBeLessThanOrEqual(4);
        }
      }
    });

  it('prefers beginner open shapes in standard tuning', () => {
    for (const name of ['C', 'G', 'D', 'Am', 'Em', 'E', 'A', 'Dm']) {
      expect(voicingsFor(name, 'guitar')[0].difficulty).toBe('easy');
      expect(voicingsFor(name, 'guitar')[0].source).toBe('curated');
    }
    expect(voicingsFor('Am', 'ukulele')[0].frets).toEqual([2, 0, 0, 0]);
  });

  it('assigns a barre when five strings are fretted', () => {
    const a = assignFingers([1, 3, 3, 2, 1, 1])!;
    expect(a.barre).toEqual({ fret: 1, from: 0, to: 5 });
    expect(assignFingers([1, 2, 3, 4, 5, 6])).toBeNull();
  });

  it('suggests a capo that turns a flat-key progression into open shapes', () => {
    const t = (n: string, s: number) => transposeChord(n, s);
    const best = suggestCapo(['A#', 'D#', 'F', 'Gm'].map((name) => ({ name, seconds: 4 })), 'guitar', t)[0];
    // Capo 3 → G C D Em, capo 1 → A D E F#m; both are all-open.
    expect([1, 3]).toContain(best.capo);
    expect(suggestCapo(['G', 'C', 'D', 'Em'].map((name) => ({ name, seconds: 4 })), 'guitar', t)[0].capo).toBe(0);
  });
});

describe('piano voicings', () => {
  it('contains exactly the chord tones for every voicing', () => {
    for (const r of SHARPS) for (const q of QUALITIES) for (const v of PIANO_VOICINGS) {
      const name = r + q.suffix;
      const pv = pianoVoicing(name, v.id)!;
      const pcs = chordPitchClasses(parseChord(name)!);
      const notes = [...pv.left, ...pv.right];
      expect(new Set(pv.right.map((m) => m % 12))).toEqual(new Set(pcs));
      for (const m of notes) expect(pcs).toContain(m % 12);
      expect(Math.min(...notes)).toBeGreaterThanOrEqual(40);
      expect(Math.max(...notes)).toBeLessThanOrEqual(84);
    }
  });
  it('voices inversions with the right bass note', () => {
    expect(pianoVoicing('C', 'root')!.right).toEqual([60, 64, 67]);
    expect(pianoVoicing('C', 'first')!.right[0] % 12).toBe(4);
    expect(pianoVoicing('C', 'second')!.right[0] % 12).toBe(7);
    expect(pianoVoicing('C/E', 'root')!.left[0] % 12).toBe(4);
  });
});
