import { writeFileSync } from 'node:fs';
import { synthesize, bars } from '../../src/engine/testing/synth';
function wav(samples: Float32Array, sr: number) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}
const a = synthesize(bars('A E F#m D A E F#m D Bm D E A', 100), { bass: true, melody: true, drumsBpm: 100, inversion: 1 });
writeFileSync('/tmp/e2e/song.wav', wav(a.samples, a.sampleRate));
const b = synthesize(bars('Dm A# F C Dm A# C Dm', 90), { bass: true });
writeFileSync('/tmp/e2e/second.wav', wav(b.samples, b.sampleRate));
