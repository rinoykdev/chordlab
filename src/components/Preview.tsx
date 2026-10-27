import { AlertTriangle, Pause, Play, Repeat, SkipBack, SkipForward, Upload, Wand2, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { player, playback } from '../audio/player';
import { UNCERTAIN_THRESHOLD } from '../engine/types';
import { keyName, parseChord, splitSymbol } from '../music/theory';
import { app, createDemo, importFiles, retryAnalysis, setTempo, useApp, useCurrent } from '../state/app';
import type { Project } from '../state/project';
import { useStore } from '../state/store';
import { InstrumentView } from './InstrumentView';
import { fmtTime, useActiveIndex, useDisplay } from './util';

export function Preview() {
  const p = useCurrent();
  const progress = useApp((s) => (s.currentId ? s.progress[s.currentId] : undefined));
  const loaded = useApp((s) => s.loaded);
  if (!p) return <section className="panel preview"><EmptyState loaded={loaded} /></section>;
  return (
    <section className="panel preview" aria-label="Song preview">
      <header className="pv-head">
        <h1 title={p.title}>{p.title}</h1>
        {p.status === 'ready' && <Meta p={p} />}
      </header>
      {p.status === 'ready' ? <Stage p={p} /> : <Status p={p} progress={progress} />}
      <Transport p={p} />
    </section>
  );
}

function EmptyState({ loaded }: { loaded: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  if (!loaded) return <div className="empty-stage"><p className="hint">Opening your library…</p></div>;
  return (
    <div className="empty-stage">
      <div className="inner">
        <h2>Find the chords in any song</h2>
        <p>Import a recording and Chordlab works out its chords, key and tempo on this device. Nothing is uploaded, and it keeps working offline.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => input.current?.click()}><Upload size={15} /> Import audio</button>
          <button className="btn" onClick={() => void createDemo()}><Wand2 size={15} /> Try a demo song</button>
        </div>
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm" multiple hidden onChange={(e) => { void importFiles(e.target.files ?? []); e.target.value = ''; }} />
      </div>
    </div>
  );
}

function Status({ p, progress }: { p: Project; progress?: { stage: string; fraction: number } }) {
  if (p.status === 'error') {
    return (
      <div className="empty-stage">
        <div className="inner">
          <AlertTriangle size={28} color="var(--danger)" />
          <h2>Analysis didn’t finish</h2>
          <p className="err-text">{p.error}</p>
          <button className="btn" onClick={() => void retryAnalysis(p.id)}><RotateCcw size={14} /> Try again</button>
        </div>
      </div>
    );
  }
  const f = progress?.fraction ?? 0.02;
  return (
    <div className="empty-stage" aria-live="polite">
      <div className="status-card">
        <h2 style={{ fontSize: 17 }}>{progress?.stage ?? 'Waiting to analyse'}…</h2>
        <div className="bigbar" role="progressbar" aria-valuenow={Math.round(f * 100)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${f * 100}%` }} /></div>
        <p className="hint">Analysis runs in the background on this device. You can keep working, or listen while it finishes.</p>
      </div>
    </div>
  );
}

function Meta({ p }: { p: Project }) {
  const a = p.analysis!;
  const t = p.settings.transpose;
  const [tempoOpen, setTempoOpen] = useState(false);
  const bpm = a.tempo.bpm;
  return (
    <div className="pv-meta">
      <span className="chip" title={`Detected: ${keyName(a.key.tonic, a.key.mode)}. Confidence ${Math.round(a.key.confidence * 100)}%`}>Key <strong>{keyName(a.key.tonic, a.key.mode, t)}</strong></span>
      <span className="menu">
        <button className="chip" onClick={() => setTempoOpen((o) => !o)} aria-expanded={tempoOpen} title="Tempo estimates can be off by a factor of two">
          Tempo <strong className="tnum">{bpm ? `${Math.round(bpm)} BPM` : 'unclear'}</strong>
        </button>
        {tempoOpen && bpm > 0 && (
          <div className="menu-pop" style={{ minWidth: 190 }} onMouseLeave={() => setTempoOpen(false)}>
            <button onClick={() => { setTempo(bpm * 2); setTempoOpen(false); }}>Double to {Math.round(bpm * 2)} BPM</button>
            <button onClick={() => { setTempo(bpm / 2); setTempoOpen(false); }}>Halve to {Math.round(bpm / 2)} BPM</button>
          </div>
        )}
      </span>
      {a.uncertainShare > 0.2 && <span className="chip warn"><AlertTriangle size={12} /> {Math.round(a.uncertainShare * 100)}% uncertain</span>}
    </div>
  );
}

function Stage({ p }: { p: Project }) {
  const idx = useActiveIndex(p);
  const selectedId = useApp((s) => s.selectedId);
  const playing = useStore(playback, (s) => s.playing);
  const { show, flats } = useDisplay(p);
  // While paused, a selected chord takes over the stage so it can be studied.
  const selIdx = !playing && selectedId ? p.segments.findIndex((s) => s.id === selectedId) : -1;
  const i = selIdx >= 0 ? selIdx : idx;
  const seg = p.segments[i];
  const name = seg ? show(seg.chord) : 'N.C.';
  const { root, suffix } = splitSymbol(name);
  const quality = parseChord(name)?.quality.name;
  const uncertain = seg && seg.chord !== 'N' && seg.confidence < UNCERTAIN_THRESHOLD;
  const upcoming = p.segments.slice(i + 1).filter((s) => s.chord !== 'N').slice(0, 4);
  return (
    <div className="stage">
      <div className="chord-stage">
        <div className="chord-label">
          <span>{selIdx >= 0 ? 'Selected chord' : 'Now playing'}</span>
          {uncertain && <span className="badge-unc"><AlertTriangle size={12} /> Uncertain, {Math.round(seg.confidence * 100)}%</span>}
        </div>
        <div key={seg?.id ?? 'none'} className={`chord-big chord-change ${name === 'N.C.' ? 'nc' : ''} ${uncertain ? 'uncertain' : ''}`} aria-live="polite" aria-label={`Current chord ${name}`}>
          <span className="root">{root}</span>{suffix && <span className="suffix">{suffix}</span>}
        </div>
        <div>
          <div className="chord-quality">{name === 'N.C.' ? 'No chord' : quality}{seg && seg.chord !== 'N' && !uncertain ? `, ${Math.round(seg.confidence * 100)}% confidence` : ''}</div>
          {upcoming.length > 0 && (
            <div className="next-row" style={{ marginTop: 10 }}>
              <span>Next <b>{show(upcoming[0].chord)}</b></span>
              <NextIn start={upcoming[0].start} />
              <span className="upcoming">{upcoming.slice(1).map((u) => <span key={u.id}>{show(u.chord)}</span>)}</span>
            </div>
          )}
          {seg && <Remaining start={seg.start} end={seg.end} />}
        </div>
      </div>
      <InstrumentView project={p} chord={name} flats={flats} />
    </div>
  );
}

function NextIn({ start }: { start: number }) {
  const secs = useStore(playback, (s) => Math.max(0, Math.ceil((start - s.time) * 2) / 2));
  return <span className="tnum">in {secs.toFixed(1)} s</span>;
}

function Remaining({ start, end }: { start: number; end: number }) {
  const f = useStore(playback, (s) => Math.round(Math.max(0, Math.min(1, (s.time - start) / (end - start || 1))) * 200) / 200);
  return <div className="remaining" aria-hidden><i style={{ width: `${f * 100}%` }} /></div>;
}

function Transport({ p }: { p: Project }) {
  const s = useStore(playback, (x) => x.playing);
  const rate = useStore(playback, (x) => x.rate);
  const volume = useStore(playback, (x) => x.volume);
  const loopOn = useStore(playback, (x) => x.loopOn);
  const hasLoop = useStore(playback, (x) => x.loop !== null);
  const ready = useStore(playback, (x) => x.ready);
  const err = useStore(playback, (x) => x.error);
  const bufferMode = useStore(playback, (x) => x.bufferMode);
  const jump = (dir: 1 | -1) => {
    const t = playback.get().time;
    const segs = p.segments;
    if (!segs.length) { player.seek(t + dir * 5); return; }
    if (dir > 0) { const n = segs.find((x) => x.start > t + 0.05); player.seek(n ? n.start : p.duration); }
    else { const prev = [...segs].reverse().find((x) => x.start < t - 0.6); player.seek(prev ? prev.start : 0); }
  };
  return (
    <div className="transport">
      <Overview p={p} />
      <div className="controls">
        <TimeDisplay duration={p.duration} />
        <div className="center">
          <button className="icon-btn" aria-label="Previous chord" onClick={() => jump(-1)}><SkipBack size={16} /></button>
          <button className="play" aria-label={s ? 'Pause' : 'Play'} onClick={() => player.toggle()} disabled={!ready}>{s ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}</button>
          <button className="icon-btn" aria-label="Next chord" onClick={() => jump(1)}><SkipForward size={16} /></button>
          <button className={`icon-btn ${loopOn ? 'on' : ''}`} aria-label="Loop section" aria-pressed={loopOn} disabled={!hasLoop} title={hasLoop ? 'Loop the selected section (L)' : 'Drag across the ruler to choose a section to loop'} onClick={() => player.toggleLoop()}><Repeat size={16} /></button>
        </div>
        <div className="right">
          <label className="sr-only" htmlFor="speed">Playback speed</label>
          <select id="speed" className="select speed tnum" value={rate} onChange={(e) => player.setRate(Number(e.target.value))}>
            {[0.5, 0.6, 0.75, 0.85, 1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
          <label className="sr-only" htmlFor="vol">Volume</label>
          <input id="vol" className="range vol" type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => player.setVolume(Number(e.target.value))} />
        </div>
      </div>
      {err && <p className="hint err-text" style={{ margin: 0 }}>{err}</p>}
      {bufferMode && rate !== 1 && <p className="hint" style={{ margin: 0 }}>In this view, changing speed also changes pitch.</p>}
    </div>
  );
}

function TimeDisplay({ duration }: { duration: number }) {
  const t = useStore(playback, (x) => Math.floor(x.time * 10) / 10);
  return <span className="time tnum"><b>{fmtTime(t, true)}</b> / {fmtTime(duration)}</span>;
}

/** Whole-song waveform with chord strip; click or drag to seek. */
function Overview({ p }: { p: Project }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const H = 54;
      c.width = Math.max(1, Math.floor(w * dpr)); c.height = H * dpr;
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, H);
      const dur = p.duration || 1;
      const t = playback.get().time;
      const px = (t / dur) * w;
      // chord strip
      for (const s of p.segments) {
        if (s.chord === 'N') continue;
        const x0 = (s.start / dur) * w; const x1 = (s.end / dur) * w;
        g.fillStyle = s.confidence < UNCERTAIN_THRESHOLD ? 'rgba(141,68,246,0.4)' : '#8d44f6';
        g.fillRect(x0 + 0.5, 4, Math.max(1, x1 - x0 - 1), 5);
      }
      const peaks = p.peaks;
      const mid = 32; const amp = 18;
      if (peaks) {
        const n = peaks.length / 2;
        for (let x = 0; x < w; x += 2) {
          const a = Math.floor((x / w) * n); const b = Math.max(a + 1, Math.floor(((x + 2) / w) * n));
          let lo = 0; let hi = 0;
          for (let i = a; i < b && i < n; i++) { lo = Math.min(lo, peaks[i * 2]); hi = Math.max(hi, peaks[i * 2 + 1]); }
          g.fillStyle = x < px ? '#5fdcf3' : 'rgba(34,180,210,0.45)';
          g.fillRect(x, mid - hi * amp, 1.4, Math.max(1, (hi - lo) * amp));
        }
      }
      const loop = playback.get().loop;
      if (loop) { g.fillStyle = playback.get().loopOn ? 'rgba(34,180,210,0.14)' : 'rgba(255,255,255,0.05)'; g.fillRect((loop.start / dur) * w, 0, ((loop.end - loop.start) / dur) * w, H); }
      g.fillStyle = '#f47b2a';
      g.fillRect(px - 1, 0, 2, H);
    };
    draw();
    let last = -1;
    return playback.subscribe(() => {
      const t = Math.round((playback.get().time / (p.duration || 1)) * w * 2);
      if (t !== last) { last = t; draw(); }
    });
  }, [p.peaks, p.segments, p.duration, w]);
  const seekFrom = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    player.seek(((e.clientX - r.left) / r.width) * p.duration);
  };
  return (
    <div ref={wrap} className="overview" role="slider" aria-label="Song position" aria-valuemin={0} aria-valuemax={Math.round(p.duration)} tabIndex={-1}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); seekFrom(e); app.set({ follow: true }); }}
      onPointerMove={(e) => { if (e.buttons) seekFrom(e); }}>
      <canvas ref={ref} style={{ width: w, height: 54 }} />
    </div>
  );
}

