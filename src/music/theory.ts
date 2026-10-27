/** Chord symbols, spelling and transposition. Deterministic and instrument-agnostic. */

export const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface QualityInfo { suffix: string; name: string; intervals: number[] }

/** Ordered so the longest suffix is matched first. */
export const QUALITIES: QualityInfo[] = [
  { suffix: 'maj7', name: 'major 7th', intervals: [0, 4, 7, 11] },
  { suffix: 'm7b5', name: 'half-diminished', intervals: [0, 3, 6, 10] },
  { suffix: 'dim7', name: 'diminished 7th', intervals: [0, 3, 6, 9] },
  { suffix: 'add9', name: 'add 9', intervals: [0, 4, 7, 2] },
  { suffix: 'sus2', name: 'suspended 2nd', intervals: [0, 2, 7] },
  { suffix: 'sus4', name: 'suspended 4th', intervals: [0, 5, 7] },
  { suffix: 'dim', name: 'diminished', intervals: [0, 3, 6] },
  { suffix: 'aug', name: 'augmented', intervals: [0, 4, 8] },
  { suffix: 'm7', name: 'minor 7th', intervals: [0, 3, 7, 10] },
  { suffix: 'm6', name: 'minor 6th', intervals: [0, 3, 7, 9] },
  { suffix: 'm', name: 'minor', intervals: [0, 3, 7] },
  { suffix: '7', name: 'dominant 7th', intervals: [0, 4, 7, 10] },
  { suffix: '6', name: 'major 6th', intervals: [0, 4, 7, 9] },
  { suffix: '5', name: 'power chord', intervals: [0, 7] },
  { suffix: '', name: 'major', intervals: [0, 4, 7] },
];

/** Qualities offered in the correction menu, in a sensible order. */
export const EDITABLE_QUALITIES = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', '6', 'm6', 'add9', '5'];

export interface Chord { root: number; quality: QualityInfo; bass?: number }

export function parseNote(s: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(s.trim());
  if (!m) return null;
  let pc = LETTER[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return (pc + 12) % 12;
}

const ALIASES: [RegExp, string][] = [
  [/^(maj|M)$/, ''],
  [/^(min|-)$/, 'm'],
  [/^(Δ|M7|Maj7|Δ7)$/, 'maj7'],
  [/^(min7|-7)$/, 'm7'],
  [/^(ø|ø7|min7b5)$/, 'm7b5'],
  [/^(°|o)$/, 'dim'],
  [/^(°7|o7)$/, 'dim7'],
  [/^\+$/, 'aug'],
  [/^sus$/, 'sus4'],
];

export function parseChord(name: string): Chord | null {
  if (!name || name === 'N') return null;
  const m = /^([A-Ga-g][#b♯♭]?)([^/]*)(?:\/([A-Ga-g][#b♯♭]?))?$/.exec(name.trim());
  if (!m) return null;
  const root = parseNote(m[1]);
  if (root === null) return null;
  let suffix = m[2].trim();
  for (const [re, to] of ALIASES) if (re.test(suffix)) suffix = to;
  const quality = QUALITIES.find((q) => q.suffix === suffix);
  if (!quality) return null;
  const bass = m[3] ? parseNote(m[3]) ?? undefined : undefined;
  return { root, quality, bass: bass === root ? undefined : bass };
}

export function isValidChord(name: string): boolean {
  return name === 'N' || parseChord(name) !== null;
}

export function chordPitchClasses(c: Chord): number[] {
  return c.quality.intervals.map((i) => (c.root + i) % 12);
}

/** Major keys that are conventionally written with flats; minor keys use their relative major. */
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb
export function keyPrefersFlats(tonic: number, mode: 'major' | 'minor'): boolean {
  const major = mode === 'major' ? tonic : (tonic + 3) % 12;
  return FLAT_MAJOR.has(major);
}

export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLATS : SHARPS)[((pc % 12) + 12) % 12];
}

export function formatChord(c: Chord, flats: boolean): string {
  return noteName(c.root, flats) + c.quality.suffix + (c.bass !== undefined ? `/${noteName(c.bass, flats)}` : '');
}

/** Transpose a chord symbol. Unparseable input and "N" are returned unchanged. */
export function transposeChord(name: string, semitones: number, flats = false): string {
  const c = parseChord(name);
  if (!c) return name;
  return formatChord({ ...c, root: (c.root + semitones + 120) % 12, bass: c.bass === undefined ? undefined : (c.bass + semitones + 120) % 12 }, flats);
}

/** Canonical sharp spelling used for storage, e.g. "Bbm" → "A#m". */
export function canonicalChord(name: string): string {
  if (name === 'N') return 'N';
  const c = parseChord(name);
  return c ? formatChord(c, false) : name;
}

export function displayChord(name: string, semitones: number, flats: boolean): string {
  if (name === 'N') return 'N.C.';
  return transposeChord(name, semitones, flats);
}

/** Split a display symbol into root and suffix for typographic treatment. */
export function splitSymbol(symbol: string): { root: string; suffix: string } {
  const m = /^([A-G][#b]?)(.*)$/.exec(symbol);
  return m ? { root: m[1], suffix: m[2] } : { root: symbol, suffix: '' };
}

export function keyName(tonic: number, mode: 'major' | 'minor', semitones = 0): string {
  const t = (tonic + semitones + 120) % 12;
  return `${noteName(t, keyPrefersFlats(t, mode))} ${mode}`;
}

/** Diatonic chords for a key, for quick correction suggestions. */
export function diatonicChords(tonic: number, mode: 'major' | 'minor'): string[] {
  const flats = keyPrefersFlats(tonic, mode);
  const major: [number, string][] = [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm'], [11, 'dim']];
  const minor: [number, string][] = [[0, 'm'], [2, 'dim'], [3, ''], [5, 'm'], [7, ''], [8, ''], [10, '']];
  return (mode === 'major' ? major : minor).map(([i, q]) => noteName(tonic + i, flats) + q);
}
