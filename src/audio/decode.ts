/** Decode an uploaded file in the browser, downmixed to mono at a low analysis rate. */
import { ANALYSIS_RATE } from '../engine/features';

export const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'wave', 'm4a', 'aac', 'mp4', 'ogg', 'oga', 'opus', 'flac', 'webm', 'aif', 'aiff', 'caf'];
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const LONG_RECORDING_SECONDS = 15 * 60;
export const MAX_SECONDS = 60 * 60;

export class AudioFileError extends Error {}

export function checkFile(file: File): void {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const looksAudio = file.type.startsWith('audio/') || file.type === 'video/mp4' || file.type === 'video/webm' || ACCEPTED_EXTENSIONS.includes(ext);
  if (!looksAudio) throw new AudioFileError(`“${file.name}” isn’t an audio file. Import MP3, WAV, M4A/AAC, OGG, Opus or FLAC.`);
  if (file.size === 0) throw new AudioFileError(`“${file.name}” is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new AudioFileError(`“${file.name}” is larger than 300 MB. Trim or compress it, then import it again.`);
}

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
  /** Min/max pairs, PEAKS_PER_SECOND per second, for the waveform display. */
  peaks: Float32Array;
}

export const PEAKS_PER_SECOND = 100;

type OfflineCtor = typeof OfflineAudioContext;
function offlineCtor(): OfflineCtor | null {
  return (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext) ?? null;
}

/**
 * Decoding through an OfflineAudioContext running at 11 025 Hz makes the browser resample
 * natively, which needs a quarter of the memory of decoding at 44.1 kHz. Browsers that refuse
 * low rates fall back to 22 050 / 44 100 Hz and the engine resamples the rest of the way.
 */
async function decodeAtLowRate(data: ArrayBuffer): Promise<AudioBuffer> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new AudioFileError('This browser can’t decode audio (Web Audio API unavailable).');
  let lastError: unknown;
  for (const rate of [ANALYSIS_RATE, 22050, 44100]) {
    let ctx: OfflineAudioContext;
    try { ctx = new Ctor(1, 1, rate); } catch (e) { lastError = e; continue; }
    try {
      // slice(): decodeAudioData detaches the buffer, and we may need to retry.
      return await ctx.decodeAudioData(data.slice(0));
    } catch (e) {
      lastError = e;
      if (e instanceof DOMException && e.name === 'EncodingError') break; // the data itself is bad
    }
  }
  const detail = lastError instanceof Error ? ` (${lastError.message})` : '';
  throw new AudioFileError(`The file couldn’t be decoded. It may be corrupted, or use a codec this browser can’t play${detail}.`);
}

export function computePeaks(samples: Float32Array, sampleRate: number): Float32Array {
  const per = Math.max(1, Math.floor(sampleRate / PEAKS_PER_SECOND));
  const n = Math.ceil(samples.length / per);
  const peaks = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let lo = 0; let hi = 0;
    const end = Math.min(samples.length, (i + 1) * per);
    for (let j = i * per; j < end; j++) { const v = samples[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    peaks[i * 2] = lo; peaks[i * 2 + 1] = hi;
  }
  let m = 0;
  for (const v of peaks) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= m;
  return peaks;
}

export async function decodeBlob(blob: Blob): Promise<DecodedAudio> {
  let data: ArrayBuffer;
  try { data = await blob.arrayBuffer(); } catch { throw new AudioFileError('The file couldn’t be read from disk.'); }
  let buf: AudioBuffer;
  try {
    buf = await decodeAtLowRate(data);
  } catch (e) {
    if (e instanceof AudioFileError) throw e;
    if (e instanceof RangeError || (e instanceof DOMException && e.name === 'NotSupportedError')) {
      throw new AudioFileError('The recording is too long to decode with the memory available on this device. Try a shorter excerpt.');
    }
    throw e;
  }
  if (buf.duration > MAX_SECONDS) throw new AudioFileError('Recordings longer than 60 minutes aren’t supported. Try a shorter excerpt.');
  if (buf.duration < 0.5) throw new AudioFileError('The recording is shorter than half a second, which is too short to analyse.');
  const n = buf.length;
  const samples = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < n; i++) samples[i] += ch[i];
  }
  if (buf.numberOfChannels > 1) { const g = 1 / buf.numberOfChannels; for (let i = 0; i < n; i++) samples[i] *= g; }
  let energy = 0;
  for (let i = 0; i < n; i += 64) energy += Math.abs(samples[i]);
  if (energy === 0) throw new AudioFileError('The recording is completely silent, so there are no chords to detect.');
  return { samples, sampleRate: buf.sampleRate, duration: buf.duration, peaks: computePeaks(samples, buf.sampleRate) };
}

/** Encode mono PCM as a 16-bit WAV blob (used for the generated demo song). */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buffer], { type: 'audio/wav' });
}
