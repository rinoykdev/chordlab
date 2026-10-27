/** Piano voicings: deterministic close-position triads and inversions plus a two-hand spread. */
import { chordPitchClasses, parseChord } from './theory';

export type PianoVoicingId = 'root' | 'first' | 'second' | 'spread';
export const PIANO_VOICINGS: { id: PianoVoicingId; name: string }[] = [
  { id: 'root', name: 'Root position' },
  { id: 'first', name: '1st inversion' },
  { id: 'second', name: '2nd inversion' },
  { id: 'spread', name: 'Two hands' },
];

export interface PianoVoicing { right: number[]; left: number[] }

export function pianoVoicing(name: string, id: PianoVoicingId = 'root'): PianoVoicing | null {
  const c = parseChord(name);
  if (!c) return null;
  const pcs = chordPitchClasses(c);
  // Root position starting near middle C (C4 = 60), kept between F#3 and F4 for the root.
  let rootMidi = 60 + c.root;
  if (rootMidi > 65) rootMidi -= 12;
  const close = [rootMidi];
  for (const pc of pcs.slice(1)) {
    let m = rootMidi + ((pc - c.root + 12) % 12);
    while (m <= close[close.length - 1]) m += 12;
    close.push(m);
  }
  close.sort((a, b) => a - b);
  const invert = (notes: number[], times: number) => {
    const n = [...notes];
    for (let i = 0; i < times; i++) n.push(n.shift()! + 12);
    // Keep inversions in the same register by dropping an octave if they climb too high.
    return n[0] > 67 ? n.map((x) => x - 12) : n;
  };
  const bassPc = c.bass ?? c.root;
  const bassNote = 36 + bassPc + (bassPc < 4 ? 12 : 0); // C3..D#3 or E2..B2
  switch (id) {
    case 'first': return { right: invert(close, 1), left: c.bass !== undefined ? [bassNote] : [] };
    case 'second': return { right: invert(close, Math.min(2, close.length - 1)), left: c.bass !== undefined ? [bassNote] : [] };
    case 'spread': return { right: close.map((m) => (m < 60 ? m + 12 : m)), left: [bassNote, bassNote + 12].filter((m) => m < 60) };
    default: return { right: close, left: c.bass !== undefined ? [bassNote] : [] };
  }
}

export const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
