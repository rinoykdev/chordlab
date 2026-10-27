/**
 * Evaluate the engine on REAL recordings, separately from the synthetic test suite.
 *
 *   npm run eval:real -- eval/real            # folder of song.wav + song.lab pairs
 *
 * Annotations use the MIREX / Harte .lab format ("start end label", e.g. "12.3 14.1 A:min7").
 * Scores use the MIREX "majmin" convention: references are reduced to major/minor/N, and
 * chords that are neither (dim, aug, sus, power chords) are excluded from scoring.
 * Convert other formats first, e.g.  ffmpeg -i song.mp3 -ac 1 song.wav
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { analyzeAudio } from '../src/engine';
import type { DecodeOptions } from '../src/engine/types';

const NOTES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
  let off = 12; let fmt = 1; let ch = 1; let sr = 44100; let bits = 16; let data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(off + 8); ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); if (fmt === 0xfffe) fmt = b.readUInt16LE(off + 32); }
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error(`${path} has no audio data`);
  const bps = bits / 8; const frames = Math.floor(data.length / (bps * ch));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const o = (i * ch + c) * bps;
      s += fmt === 3 ? (bits === 32 ? data.readFloatLE(o) : data.readDoubleLE(o))
        : bits === 16 ? data.readInt16LE(o) / 32768 : bits === 24 ? data.readIntLE(o, 3) / 8388608 : bits === 32 ? data.readInt32LE(o) / 2147483648 : (data[o] - 128) / 128;
    }
    out[i] = s / ch;
  }
  return { samples: out, sampleRate: sr };
}

/** Harte label → "C", "Am", "N", or null when excluded from majmin scoring. */
export function harteToMajMin(label: string): string | null {
  if (label === 'N') return 'N';
  if (label === 'X') return null;
  const m = /^([A-G])([#b]*)(?::([^/]+))?(?:\/.*)?$/.exec(label.trim());
  if (!m) return null;
  let root = NOTES[m[1]];
  for (const a of m[2]) root += a === '#' ? 1 : -1;
  const q = (m[3] ?? 'maj').replace(/\(.*\)/, '') || 'maj';
  const name = SHARPS[(root + 12) % 12];
  if (/^(min|min7|minmaj7|min6|min9|min11|min13)$/.test(q)) return `${name}m`;
  if (/^(maj|7|maj7|maj6|9|maj9|11|13|maj13|6)$/.test(q)) return name;
  return null; // dim, aug, sus, hdim7, 1, 5 …
}

function readLab(path: string) {
  return readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3)
    .map(([s, e, l]) => ({ start: Number(s), end: Number(e), chord: harteToMajMin(l) }));
}

async function main() {
  const dir = process.argv[2] ?? 'eval/real';
  if (!existsSync(dir)) { console.error(`No folder ${dir}. Put song.wav + song.lab pairs there.`); process.exit(1); }
  const options: DecodeOptions = { vocabulary: 'majmin', smoothing: Number(process.env.SMOOTHING ?? 0.5), minDuration: Number(process.env.MIN_DURATION ?? 0.6) };
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav') && existsSync(join(dir, f.replace(/\.wav$/i, '.lab'))));
  if (!files.length) { console.error(`No .wav files with matching .lab annotations in ${dir}.`); process.exit(1); }
  let hit = 0; let total = 0; let rootHit = 0;
  console.log(`Real-recording evaluation (majmin WCSR), smoothing ${options.smoothing}, min ${options.minDuration}s\n`);
  for (const f of files) {
    const { samples, sampleRate } = readWav(join(dir, f));
    const ref = readLab(join(dir, f.replace(/\.wav$/i, '.lab')));
    const { result } = await analyzeAudio(samples, sampleRate, options);
    let h = 0; let t = 0; let rh = 0;
    for (const r of ref) {
      if (r.chord === null) continue;
      for (const p of result.segments) {
        const ov = Math.min(r.end, p.end) - Math.max(r.start, p.start);
        if (ov <= 0) continue;
        if (p.chord === r.chord) h += ov;
        if (p.chord.replace('m', '') === r.chord.replace('m', '')) rh += ov;
      }
      t += r.end - r.start;
    }
    hit += h; total += t; rootHit += rh;
    console.log(`${basename(f).padEnd(40)} WCSR ${(100 * h / t).toFixed(1).padStart(5)}%  root ${(100 * rh / t).toFixed(1).padStart(5)}%  key ${result.key.name}  tempo ${result.tempo.bpm}  uncertain ${(100 * result.uncertainShare).toFixed(0)}%`);
  }
  console.log(`\nOverall (duration-weighted): WCSR ${(100 * hit / total).toFixed(1)}%, root ${(100 * rootHit / total).toFixed(1)}% over ${(total / 60).toFixed(1)} min`);
}

if (process.argv[1]?.endsWith("eval-real.ts")) void main();
