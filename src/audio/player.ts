/** Audio playback with speed control, looping and a 60 fps time source.
 * Primary backend: an <audio> element (keeps pitch when slowed down).
 * Fallback: Web Audio buffer playback, used when the element can't load the file
 * (an unsupported container, or a host policy that blocks blob media). */
import { createStore } from '../state/store';

export interface PlaybackState {
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
  volume: number;
  loop: { start: number; end: number } | null;
  loopOn: boolean;
  ready: boolean;
  error: string | null;
  /** True when using the Web Audio fallback, where speed changes also change pitch. */
  bufferMode: boolean;
}

export const playback = createStore<PlaybackState>({
  time: 0, duration: 0, playing: false, rate: 1, volume: 0.9, loop: null, loopOn: false, ready: false, error: null, bufferMode: false,
});

class BufferBackend {
  private ctx: AudioContext;
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private rate = 1;
  playing = false;
  constructor(private buffer: AudioBuffer, ctx: AudioContext, volume: number, private onEnded: () => void) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
  }
  get duration() { return this.buffer.duration; }
  get currentTime() {
    return this.playing ? Math.min(this.buffer.duration, this.offset + (this.ctx.currentTime - this.startedAt) * this.rate) : this.offset;
  }
  async play() {
    if (this.playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (this.offset >= this.buffer.duration - 0.05) this.offset = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    src.onended = () => {
      if (this.source !== src) return; // stopped deliberately
      this.offset = this.buffer.duration; this.playing = false; this.source = null; this.onEnded();
    };
    src.start(0, this.offset);
    this.source = src; this.startedAt = this.ctx.currentTime; this.playing = true;
  }
  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    const s = this.source; this.source = null; this.playing = false;
    try { s?.stop(); } catch { /* already stopped */ }
  }
  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.buffer.duration, t));
    if (was) void this.play();
  }
  setRate(r: number) {
    if (this.playing) { this.offset = this.currentTime; this.startedAt = this.ctx.currentTime; }
    this.rate = r;
    if (this.source) this.source.playbackRate.value = r;
  }
  setVolume(v: number) { this.gain.gain.value = v; }
  dispose() { this.pause(); this.gain.disconnect(); }
}

class Player {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private blob: Blob | null = null;
  private buffer: BufferBackend | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  private loadToken = 0;

  private el(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.preload = 'auto';
    // Keep pitch when slowing down for practice.
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    (a as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
    a.addEventListener('loadedmetadata', () => { if (!this.buffer) playback.set({ duration: a.duration, ready: true, error: null }); });
    a.addEventListener('play', () => { playback.set({ playing: true }); this.startTick(); });
    a.addEventListener('pause', () => { if (!this.buffer) { playback.set({ playing: false, time: a.currentTime }); cancelAnimationFrame(this.raf); } });
    a.addEventListener('ended', () => playback.set({ playing: false, time: a.currentTime }));
    a.addEventListener('seeked', () => { if (!this.buffer) playback.set({ time: a.currentTime }); });
    a.addEventListener('error', () => { if (this.url && this.blob && !this.buffer) void this.useBuffer(this.blob, this.loadToken); });
    this.audio = a;
    return a;
  }

  private async useBuffer(blob: Blob, token: number) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx ??= new Ctor();
      const decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer());
      if (token !== this.loadToken) return;
      const s = playback.get();
      this.buffer = new BufferBackend(decoded, this.ctx, s.volume, () => { playback.set({ playing: false, time: decoded.duration }); cancelAnimationFrame(this.raf); });
      this.buffer.setRate(s.rate);
      playback.set({ duration: decoded.duration, ready: true, error: null, bufferMode: true });
    } catch {
      if (token === this.loadToken) playback.set({ ready: false, playing: false, error: 'This browser can’t play the file, although it may still be analysed.' });
    }
  }

  load(blob: Blob, duration: number): void {
    this.loadToken++;
    const a = this.el();
    a.pause();
    this.buffer?.dispose(); this.buffer = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.blob = blob;
    playback.set({ time: 0, duration, playing: false, ready: false, error: null, loop: null, loopOn: false, bufferMode: false });
    try {
      this.url = URL.createObjectURL(blob);
      a.src = this.url;
      a.playbackRate = playback.get().rate;
      a.volume = playback.get().volume;
      a.load();
    } catch {
      void this.useBuffer(blob, this.loadToken);
    }
  }

  unload(): void {
    this.loadToken++;
    this.audio?.pause();
    this.buffer?.dispose(); this.buffer = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.blob = null;
    if (this.audio) this.audio.removeAttribute('src');
    playback.set({ time: 0, duration: 0, playing: false, ready: false, loop: null, loopOn: false, bufferMode: false });
  }

  private now(): number { return this.buffer ? this.buffer.currentTime : this.audio?.currentTime ?? 0; }
  private isPaused(): boolean { return this.buffer ? !this.buffer.playing : this.audio?.paused ?? true; }

  private startTick() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.tick); }

  private tick = () => {
    const s = playback.get();
    let t = this.now();
    if (s.loopOn && s.loop && s.loop.end - s.loop.start > 0.05 && (t >= s.loop.end || t < s.loop.start - 0.25)) {
      this.rawSeek(s.loop.start); t = s.loop.start;
    }
    playback.set({ time: t });
    if (!this.isPaused()) this.raf = requestAnimationFrame(this.tick);
  };

  private rawSeek(t: number) {
    if (this.buffer) this.buffer.seek(t);
    else if (this.audio) this.audio.currentTime = t;
  }

  async play(): Promise<void> {
    const s = playback.get();
    const t = this.now();
    const d = s.duration;
    if (s.loopOn && s.loop && (t < s.loop.start || t >= s.loop.end)) this.rawSeek(s.loop.start);
    else if (d && t >= d - 0.05) this.rawSeek(0);
    if (this.buffer) {
      await this.buffer.play();
      playback.set({ playing: true });
      this.startTick();
      return;
    }
    try { await this.el().play(); } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) playback.set({ error: 'Playback was blocked by the browser. Press play again.' });
    }
  }

  pause(): void {
    if (this.buffer) { this.buffer.pause(); cancelAnimationFrame(this.raf); playback.set({ playing: false, time: this.buffer.currentTime }); }
    else this.audio?.pause();
  }

  toggle(): void { if (playback.get().playing) this.pause(); else void this.play(); }

  seek(t: number): void {
    const d = playback.get().duration;
    const clamped = Math.max(0, Math.min(d || t, t));
    this.rawSeek(clamped);
    playback.set({ time: clamped });
  }

  setRate(rate: number): void {
    if (this.audio) this.audio.playbackRate = rate;
    this.buffer?.setRate(rate);
    playback.set({ rate });
  }

  setVolume(volume: number): void {
    if (this.audio) this.audio.volume = volume;
    this.buffer?.setVolume(volume);
    playback.set({ volume });
  }

  setLoop(loop: { start: number; end: number } | null, on = loop !== null): void {
    playback.set({ loop, loopOn: on && loop !== null });
  }

  toggleLoop(): void {
    const s = playback.get();
    playback.set({ loopOn: !s.loopOn && s.loop !== null });
  }
}

export const player = new Player();
