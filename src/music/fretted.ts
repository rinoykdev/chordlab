/** Fretted-instrument voicings: a curated beginner database plus a deterministic search
 * that finds playable shapes for any chord in any tuning. */
import { chordPitchClasses, parseChord, type Chord } from './theory';

export type FrettedInstrument = 'guitar' | 'ukulele';

export interface Tuning { id: string; name: string; notes: number[] /* MIDI, low/first string first */; labels: string[] }

export const TUNINGS: Record<FrettedInstrument, Tuning[]> = {
  guitar: [
    { id: 'standard', name: 'Standard (E A D G B E)', notes: [40, 45, 50, 55, 59, 64], labels: ['E', 'A', 'D', 'G', 'B', 'E'] },
    { id: 'half-down', name: 'Half step down (Eb)', notes: [39, 44, 49, 54, 58, 63], labels: ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'Eb'] },
    { id: 'drop-d', name: 'Drop D', notes: [38, 45, 50, 55, 59, 64], labels: ['D', 'A', 'D', 'G', 'B', 'E'] },
    { id: 'open-g', name: 'Open G', notes: [38, 43, 50, 55, 59, 62], labels: ['D', 'G', 'D', 'G', 'B', 'D'] },
    { id: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62], labels: ['D', 'A', 'D', 'G', 'A', 'D'] },
  ],
  ukulele: [
    { id: 'standard', name: 'Standard (G C E A)', notes: [67, 60, 64, 69], labels: ['G', 'C', 'E', 'A'] },
    { id: 'low-g', name: 'Low G', notes: [55, 60, 64, 69], labels: ['G', 'C', 'E', 'A'] },
    { id: 'd-tuning', name: 'D tuning (A D F# B)', notes: [69, 62, 66, 71], labels: ['A', 'D', 'F#', 'B'] },
    { id: 'baritone', name: 'Baritone (D G B E)', notes: [50, 55, 59, 64], labels: ['D', 'G', 'B', 'E'] },
  ],
};

export interface Voicing {
  /** Fret per string, −1 = muted, 0 = open. */
  frets: number[];
  /** Finger per string, 0 = none, 1 index … 4 little. */
  fingers: number[];
  barre?: { fret: number; from: number; to: number };
  difficulty: 'easy' | 'medium' | 'hard';
  source: 'curated' | 'generated';
  score: number;
}

const X = -1;
type Shape = [number[], number[]];
/** Hand-checked beginner shapes in standard tuning. Keys are canonical sharp names. */
const CURATED: Record<FrettedInstrument, Record<string, Shape[]>> = {
  guitar: {
    C: [[[X, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]]],
    C7: [[[X, 3, 2, 3, 1, 0], [0, 3, 2, 4, 1, 0]]],
    Cmaj7: [[[X, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]]],
    Cadd9: [[[X, 3, 2, 0, 3, 0], [0, 2, 1, 0, 3, 0]]],
    D: [[[X, X, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]]],
    Dm: [[[X, X, 0, 2, 3, 1], [0, 0, 0, 2, 3, 1]]],
    D7: [[[X, X, 0, 2, 1, 2], [0, 0, 0, 2, 1, 3]]],
    Dmaj7: [[[X, X, 0, 2, 2, 2], [0, 0, 0, 1, 2, 3]]],
    Dm7: [[[X, X, 0, 2, 1, 1], [0, 0, 0, 2, 1, 1]]],
    Dsus2: [[[X, X, 0, 2, 3, 0], [0, 0, 0, 1, 3, 0]]],
    Dsus4: [[[X, X, 0, 2, 3, 3], [0, 0, 0, 1, 3, 4]]],
    E: [[[0, 2, 2, 1, 0, 0], [0, 2, 3, 1, 0, 0]]],
    Em: [[[0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0]]],
    E7: [[[0, 2, 0, 1, 0, 0], [0, 2, 0, 1, 0, 0]]],
    Em7: [[[0, 2, 0, 0, 0, 0], [0, 2, 0, 0, 0, 0]]],
    Emaj7: [[[0, 2, 1, 1, 0, 0], [0, 3, 1, 2, 0, 0]]],
    Esus4: [[[0, 2, 2, 2, 0, 0], [0, 2, 3, 4, 0, 0]]],
    F: [[[1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]], [[X, X, 3, 2, 1, 1], [0, 0, 3, 2, 1, 1]]],
    Fmaj7: [[[X, X, 3, 2, 1, 0], [0, 0, 3, 2, 1, 0]]],
    G: [[[3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3]], [[3, 2, 0, 0, 3, 3], [2, 1, 0, 0, 3, 4]]],
    G7: [[[3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1]]],
    Gmaj7: [[[3, 2, 0, 0, 0, 2], [3, 2, 0, 0, 0, 1]]],
    A: [[[X, 0, 2, 2, 2, 0], [0, 0, 1, 2, 3, 0]]],
    Am: [[[X, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]]],
    A7: [[[X, 0, 2, 0, 2, 0], [0, 0, 2, 0, 3, 0]]],
    Am7: [[[X, 0, 2, 0, 1, 0], [0, 0, 2, 0, 1, 0]]],
    Amaj7: [[[X, 0, 2, 1, 2, 0], [0, 0, 2, 1, 3, 0]]],
    Asus2: [[[X, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0]]],
    Asus4: [[[X, 0, 2, 2, 3, 0], [0, 0, 1, 2, 3, 0]]],
    B7: [[[X, 2, 1, 2, 0, 2], [0, 2, 1, 3, 0, 4]]],
    Bm: [[[X, 2, 4, 4, 3, 2], [0, 1, 3, 4, 2, 1]]],
  },
  ukulele: {
    C: [[[0, 0, 0, 3], [0, 0, 0, 3]]],
    Cm: [[[0, 3, 3, 3], [0, 1, 1, 1]]],
    C7: [[[0, 0, 0, 1], [0, 0, 0, 1]]],
    Cmaj7: [[[0, 0, 0, 2], [0, 0, 0, 2]]],
    D: [[[2, 2, 2, 0], [1, 2, 3, 0]]],
    Dm: [[[2, 2, 1, 0], [2, 3, 1, 0]]],
    D7: [[[2, 2, 2, 3], [1, 1, 1, 2]]],
    Dm7: [[[2, 2, 1, 3], [2, 3, 1, 4]]],
    E: [[[4, 4, 4, 2], [2, 3, 4, 1]]],
    Em: [[[0, 4, 3, 2], [0, 3, 2, 1]]],
    E7: [[[1, 2, 0, 2], [1, 2, 0, 3]]],
    Em7: [[[0, 2, 0, 2], [0, 1, 0, 2]]],
    F: [[[2, 0, 1, 0], [2, 0, 1, 0]]],
    Fm: [[[1, 0, 1, 3], [1, 0, 2, 4]]],
    F7: [[[2, 3, 1, 3], [2, 3, 1, 4]]],
    G: [[[0, 2, 3, 2], [0, 1, 3, 2]]],
    Gm: [[[0, 2, 3, 1], [0, 2, 3, 1]]],
    G7: [[[0, 2, 1, 2], [0, 2, 1, 3]]],
    Gmaj7: [[[0, 2, 2, 2], [0, 1, 2, 3]]],
    A: [[[2, 1, 0, 0], [2, 1, 0, 0]]],
    Am: [[[2, 0, 0, 0], [2, 0, 0, 0]]],
    A7: [[[0, 1, 0, 0], [0, 1, 0, 0]]],
    Am7: [[[0, 0, 0, 0], [0, 0, 0, 0]]],
    Amaj7: [[[1, 1, 0, 0], [1, 2, 0, 0]]],
    'A#': [[[3, 2, 1, 1], [3, 2, 1, 1]]],
    B: [[[4, 3, 2, 2], [3, 2, 1, 1]]],
    Bm: [[[4, 2, 2, 2], [3, 1, 1, 1]]],
    B7: [[[2, 3, 2, 2], [1, 2, 1, 1]]],
  },
};

/** Movable barre shapes (standard guitar tuning). Offsets are relative to the barre fret;
 * the root sits on the low E (E-shape) or A string (A-shape). */
const MOVABLE: { string: 0 | 1; suffix: string; offsets: number[]; fingers: number[] }[] = [
  { string: 0, suffix: '', offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
  { string: 0, suffix: 'm', offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
  { string: 0, suffix: '7', offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
  { string: 0, suffix: 'm7', offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
  { string: 1, suffix: '', offsets: [X, 0, 2, 2, 2, 0], fingers: [0, 1, 3, 3, 3, 1] },
  { string: 1, suffix: 'm', offsets: [X, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
  { string: 1, suffix: '7', offsets: [X, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
  { string: 1, suffix: 'm7', offsets: [X, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
  { string: 1, suffix: 'maj7', offsets: [X, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1] },
  { string: 1, suffix: 'sus4', offsets: [X, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1] },
  { string: 1, suffix: 'sus2', offsets: [X, 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1] },
];

function movableShapes(c: Chord): Voicing[] {
  const out: Voicing[] = [];
  for (const m of MOVABLE) {
    if (m.suffix !== c.quality.suffix) continue;
    const open = m.string === 0 ? 4 : 9; // pitch class of the open root string
    const fret = (c.root - open + 12) % 12 || 12;
    if (fret > 10) continue;
    const frets = m.offsets.map((o) => (o < 0 ? -1 : o + fret));
    const barre = detectBarre(frets, m.fingers);
    out.push({ frets, fingers: m.fingers, barre, difficulty: difficultyOf(frets, barre), source: 'curated', score: fret });
  }
  return out.sort((a, b) => a.score - b.score);
}

export function curatedShapes(instrument: FrettedInstrument): Record<string, Shape[]> {
  return CURATED[instrument];
}

function detectBarre(frets: number[], fingers: number[]): Voicing['barre'] {
  for (let f = 1; f <= 24; f++) {
    const idx = fingers.map((g, i) => (g === 1 && frets[i] === f ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) return { fret: f, from: idx[0], to: idx[idx.length - 1] };
  }
  return undefined;
}

/** Assign fingers to a fret pattern, using an index-finger barre when needed. Null = unplayable. */
export function assignFingers(frets: number[]): { fingers: number[]; barre?: Voicing['barre'] } | null {
  const fingers = frets.map(() => 0);
  const fretted = frets.map((f, i) => ({ f, i })).filter((x) => x.f > 0);
  if (fretted.length === 0) return { fingers };
  const min = Math.min(...fretted.map((x) => x.f));
  const order = (xs: { f: number; i: number }[]) => [...xs].sort((a, b) => a.f - b.f || a.i - b.i);
  if (fretted.length <= 4) {
    order(fretted).forEach((x, k) => (fingers[x.i] = k + 1));
    return { fingers };
  }
  // Barre: index finger across every string from the first min-fret string to the last one,
  // and none of those strings may be open or muted.
  const atMin = fretted.filter((x) => x.f === min).map((x) => x.i);
  const from = atMin[0];
  const to = atMin[atMin.length - 1];
  if (atMin.length < 2) return null;
  for (let i = from; i <= to; i++) if (frets[i] < min) return null;
  const rest = fretted.filter((x) => !(x.f === min && x.i >= from && x.i <= to));
  if (rest.length > 3) return null;
  for (let i = from; i <= to; i++) if (frets[i] === min) fingers[i] = 1;
  order(rest).forEach((x, k) => (fingers[x.i] = k + 2));
  return { fingers, barre: { fret: min, from, to } };
}

function difficultyOf(frets: number[], barre?: Voicing['barre']): Voicing['difficulty'] {
  const max = Math.max(...frets);
  if (barre && barre.to - barre.from >= 3) return 'hard';
  if (barre || max > 5) return 'medium';
  return 'easy';
}

/** Lower is easier. */
function scoreShape(frets: number[], fingers: number[], barre: Voicing['barre'] | undefined, c: Chord, tuning: number[]): number {
  const fretted = frets.filter((f) => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 0;
  const hi = fretted.length ? Math.max(...fretted) : 0;
  const used = new Set(fingers.filter((f) => f > 0)).size;
  const muted = frets.filter((f) => f < 0).length;
  const open = frets.filter((f) => f === 0).length;
  const pcs = frets.map((f, i) => (f < 0 ? -1 : (tuning[i] + f) % 12)).filter((p) => p >= 0);
  const hasFifth = pcs.includes((c.root + 7) % 12);
  const needsFifth = c.quality.intervals.includes(7);
  const span = hi - lo;
  let s = lo * 0.9 + [0, 0.3, 0.9, 2.6][Math.min(3, span)] + used * 0.7 + muted * 0.5 - open * 0.25;
  if (barre) s += 2 + (barre.to - barre.from) * 0.2;
  if (needsFifth && !hasFifth) s += 1.2;
  if (hi > 12) s += 4;
  return s;
}

function shapeIsValid(frets: number[], c: Chord, tuning: number[], instrument: FrettedInstrument): boolean {
  const pcs = chordPitchClasses(c);
  const sounding = frets.map((f, i) => (f < 0 ? null : { pc: (tuning[i] + f) % 12, midi: tuning[i] + f })).filter((x): x is { pc: number; midi: number } => !!x);
  if (sounding.length === 0) return false;
  for (const s of sounding) if (!pcs.includes(s.pc) && s.pc !== c.bass) return false;
  // Required tones: everything except a perfect fifth (which may be omitted) when the chord has ≥ 3 notes.
  const required = c.quality.intervals.length >= 3 ? c.quality.intervals.filter((i) => i !== 7) : c.quality.intervals;
  for (const i of required) if (!sounding.some((s) => s.pc === (c.root + i) % 12)) return false;
  if (instrument === 'guitar') {
    const lowest = sounding.reduce((a, b) => (b.midi < a.midi ? b : a));
    if (lowest.pc !== (c.bass ?? c.root)) return false;
    if (c.bass !== undefined && !sounding.some((s) => s.pc === c.bass)) return false;
  }
  return true;
}

const cache = new Map<string, Voicing[]>();

export function voicingsFor(name: string, instrument: FrettedInstrument, tuningId = 'standard', limit = 6): Voicing[] {
  const key = `${instrument}|${tuningId}|${name}`;
  const hit = cache.get(key);
  if (hit) return hit.slice(0, limit);
  const c = parseChord(name);
  const tuning = TUNINGS[instrument].find((t) => t.id === tuningId) ?? TUNINGS[instrument][0];
  if (!c) return [];
  const out: Voicing[] = [];
  const seen = new Set<string>();
  const push = (v: Voicing) => {
    const k = v.frets.join(',');
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  };

  if (tuningId === 'standard' && c.bass === undefined) {
    const canonical = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][c.root] + c.quality.suffix;
    for (const [frets, fingers] of CURATED[instrument][canonical] ?? []) {
      const barre = detectBarre(frets, fingers);
      push({ frets, fingers, barre, difficulty: difficultyOf(frets, barre), source: 'curated', score: -10 + out.length });
    }
  }

  const strings = tuning.notes.length;
  const generated: Voicing[] = [];
  const frets = new Array<number>(strings).fill(0);
  const pcs = chordPitchClasses(c);
  const power = c.quality.intervals.length < 3;
  const minSounding = power ? 2 : Math.min(4, strings);
  const bassPc = c.bass ?? c.root;
  for (let base = 1; base <= 12; base++) {
    const options = [0, base, base + 1, base + 2, base + 3];
    // `state`: 0 = only muted strings so far, 1 = sounding, 2 = muted after sounding (power chords only).
    const recurse = (s: number, state: number, mutedLow: number) => {
      if (s === strings) {
        const sounding = frets.filter((f) => f >= 0).length;
        if (sounding < minSounding) return;
        if (!frets.some((f) => f >= base)) return; // belongs to a lower window
        if (!shapeIsValid(frets, c, tuning.notes, instrument)) return;
        const fa = assignFingers(frets);
        if (!fa) return;
        const v: Voicing = { frets: [...frets], fingers: fa.fingers, barre: fa.barre, difficulty: difficultyOf(frets, fa.barre), source: 'generated', score: 0 };
        v.score = scoreShape(v.frets, v.fingers, v.barre, c, tuning.notes);
        generated.push(v);
        return;
      }
      if (instrument === 'guitar') {
        // Mute a contiguous run of bass strings (max two), or — for power chords — the treble strings.
        if ((state === 0 && mutedLow < 2) || (power && state >= 1)) {
          frets[s] = -1;
          recurse(s + 1, state === 0 ? 0 : 2, state === 0 ? mutedLow + 1 : mutedLow);
        }
      }
      if (state === 2) return;
      for (const f of options) {
        const pc = (tuning.notes[s] + f) % 12;
        if (!pcs.includes(pc) && pc !== c.bass) continue;
        // On guitar the lowest sounding string must carry the bass note.
        if (instrument === 'guitar' && state === 0 && pc !== bassPc) continue;
        frets[s] = f;
        recurse(s + 1, 1, mutedLow);
      }
    };
    recurse(0, 0, 0);
  }
  generated.sort((a, b) => a.score - b.score);
  // Easy open shapes (no barre, small span, ≤ 3 fingers) beat barre chords for beginners;
  // then the standard movable barre shapes; then everything else the search found.
  const friendly = (v: Voicing) => {
    const fr = v.frets.filter((f) => f > 0);
    const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
    return !v.barre && v.difficulty === 'easy' && span <= 2 && new Set(v.fingers.filter((f) => f > 0)).size <= 3;
  };
  for (const v of generated.filter(friendly).slice(0, 2)) push(v);
  if (instrument === 'guitar' && tuningId === 'standard' && c.bass === undefined) for (const v of movableShapes(c)) push(v);
  for (const v of generated) {
    if (out.length >= 8) break;
    push(v);
  }
  cache.set(key, out);
  return out.slice(0, limit);
}

/** Shapes to play with a capo: transposes the chord down by `capo` frets. */
export function capoShapeName(name: string, capo: number, transpose: (n: string, s: number) => string): string {
  return capo ? transpose(name, -capo) : name;
}

/**
 * Suggest the capo position that makes a progression easiest, weighting each chord by how long
 * it is played. Returns per-capo costs so the UI can show alternatives.
 */
export function suggestCapo(
  chords: { name: string; seconds: number }[],
  instrument: FrettedInstrument,
  transpose: (n: string, s: number) => string,
  maxCapo = 7,
): { capo: number; cost: number }[] {
  const weights = new Map<string, number>();
  for (const { name, seconds } of chords) if (name !== 'N') weights.set(name, (weights.get(name) ?? 0) + seconds);
  const results: { capo: number; cost: number }[] = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    let cost = 0;
    let total = 0;
    for (const [name, w] of weights) {
      const v = voicingsFor(transpose(name, -capo), instrument, 'standard', 1)[0];
      cost += w * (v ? (v.source === 'curated' ? (v.barre ? 2 : 0) : 3 + Math.max(0, v.score) * 0.3) : 10);
      total += w;
    }
    results.push({ capo, cost: total ? cost / total + capo * 0.08 : 0 });
  }
  return results.sort((a, b) => a.cost - b.cost);
}
