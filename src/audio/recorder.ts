/** Microphone capture for Teach Chordlab: raw PCM (no codec), with a live level meter. */

export class MicError extends Error {}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;
  private buf = new Float32Array(1024);

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  async open(): Promise<void> {
    if (this.ctx) return;
    if (!MicRecorder.supported()) throw new MicError('This browser can’t record audio. Use “Use a file instead” to import recordings.');
    try {
      // Voice processing (echo cancellation, noise suppression, auto gain) distorts music, so turn it off.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('Microphone access is blocked. Allow it in your browser’s site settings, or use “Use a file instead”. Embedded previews often can’t use the microphone; the installed app can.');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('No microphone was found. Connect one, or use “Use a file instead”.');
      throw new MicError(`The microphone couldn’t start (${name || (e as Error).message}).`);
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    if (ctx.state === 'suspended') await ctx.resume();
    const source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    // ScriptProcessor is deprecated but universally supported and needs no separate module file,
    // which keeps capture working under strict content-security policies.
    this.proc = ctx.createScriptProcessor(4096, 1, 1);
    this.proc.onaudioprocess = (e) => { if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.analyser);
    source.connect(this.proc);
    this.proc.connect(mute).connect(ctx.destination);
    this.ctx = ctx;
  }

  get isOpen(): boolean { return this.ctx !== null; }

  /** Input level 0..1 (RMS, scaled so a normal strum sits around 0.5–0.8). */
  level(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    const db = 20 * Math.log10(Math.sqrt(s / this.buf.length) + 1e-9);
    return Math.max(0, Math.min(1, (db + 60) / 54));
  }

  async record(seconds: number, signal?: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (!this.ctx) throw new MicError('The microphone isn’t open.');
    this.chunks = [];
    this.recording = true;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, seconds * 1000);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); });
    });
    this.recording = false;
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const samples = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) { samples.set(c, o); o += c.length; }
    return { samples, sampleRate: this.ctx.sampleRate };
  }

  close(): void {
    this.recording = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null; this.stream = null; this.analyser = null; this.proc = null;
  }
}
