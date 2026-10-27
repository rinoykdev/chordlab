/** Low-level DSP helpers: FFT, windows, resampling. Pure functions, no allocation in hot loops. */

export class FFT {
  readonly n: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** In-place complex FFT. */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Windowed-sinc low-pass + linear interpolation resampler.
 * Used when the host could not resample natively (Node tests, fallback path). */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  if (ratio < 1) {
    for (let i = 0; i < outLen; i++) {
      const p = i * ratio; const i0 = Math.floor(p); const f = p - i0;
      out[i] = input[i0] * (1 - f) + (input[Math.min(i0 + 1, input.length - 1)] ?? 0) * f;
    }
    return out;
  }
  // Anti-alias FIR, cutoff slightly below the new Nyquist.
  const taps = 64;
  const cutoff = (0.45 * toRate) / fromRate;
  const h = new Float64Array(taps + 1);
  let sum = 0;
  for (let k = 0; k <= taps; k++) {
    const m = k - taps / 2;
    const sinc = m === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / taps) + 0.08 * Math.cos((4 * Math.PI * k) / taps);
    h[k] = sinc * w; sum += h[k];
  }
  for (let k = 0; k <= taps; k++) h[k] /= sum;
  const len = input.length;
  const filt = (i: number): number => {
    let acc = 0;
    const base = i - taps / 2;
    for (let k = 0; k <= taps; k++) {
      const j = base + k;
      if (j >= 0 && j < len) acc += input[j] * h[k];
    }
    return acc;
  };
  for (let i = 0; i < outLen; i++) {
    const p = i * ratio; const i0 = Math.floor(p); const f = p - i0;
    out[i] = f < 1e-6 ? filt(i0) : filt(i0) * (1 - f) + filt(i0 + 1) * f;
  }
  return out;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  const g = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
