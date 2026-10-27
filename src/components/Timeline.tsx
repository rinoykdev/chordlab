import { Crosshair, Maximize2, Minus, Plus, Redo2, Repeat, Scissors, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { player, playback } from '../audio/player';
import { PEAKS_PER_SECOND } from '../audio/decode';
import { UNCERTAIN_THRESHOLD, type Segment } from '../engine/types';
import { isValidChord } from '../music/theory';
import { app, beginEdit, select, splitAtPlayhead, toast, toStoredChord, updateSegments, useApp, useCurrent, redo, undo } from '../state/app';
import { deleteSegment, moveBoundary, renameSegment, type Project } from '../state/project';
import { useStore } from '../state/store';
import { fmtTime, useActiveIndex, useDisplay } from './util';

const MIN_PPS = 4;
const MAX_PPS = 400;
const PAD = 40;

export function Timeline() {
  const p = useCurrent();
  const pps = useApp((s) => s.pxPerSec);
  const follow = useApp((s) => s.follow);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const selectedId = useApp((s) => s.selectedId);
  const loopOn = useStore(playback, (s) => s.loopOn);
  const hasLoop = useStore(playback, (s) => s.loop !== null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const ready = p?.status === 'ready';
  const duration = p?.duration ?? 0;

  // Track the visible window for virtualisation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: el.clientWidth })); };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [ready, p?.id]);

  // Pick a comfortable zoom when a song opens.
  const pid = p?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !duration) return;
    const w = el.clientWidth || 800;
    app.set({ pxPerSec: clampPps(Math.max(w / duration, Math.min(70, w / 24))) });
    el.scrollLeft = 0;
  }, [pid, duration]);

  const zoomTo = useCallback((next: number, anchorX?: number) => {
    const el = scrollRef.current;
    const cur = app.get().pxPerSec;
    const z = clampPps(next);
    if (!el) { app.set({ pxPerSec: z }); return; }
    const ax = anchorX ?? (playback.get().time * cur - el.scrollLeft);
    const t = (el.scrollLeft + ax) / cur;
    app.set({ pxPerSec: z });
    requestAnimationFrame(() => { el.scrollLeft = t * z - ax; });
  }, []);

  // Ctrl/⌘ + wheel zooms around the pointer; plain wheel scrolls and pauses auto-follow.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomTo(app.get().pxPerSec * Math.exp(-e.deltaY * 0.004), e.clientX - r.left);
      } else {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) { el.scrollLeft += e.deltaY; e.preventDefault(); }
        if (app.get().follow && playback.get().playing) app.set({ follow: false });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready, zoomTo]);

  const width = duration * pps + PAD;
  const sel = p?.segments.find((s) => s.id === selectedId);
  return (
    <section className="timeline" aria-label="Chord timeline">
      <div className="tl-bar">
        <div className="tl-tools">
          <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}><Undo2 size={15} /></button>
          <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}><Redo2 size={15} /></button>
          <button className="icon-btn" aria-label="Split chord at playhead" title="Split at playhead (S)" disabled={!ready} onClick={() => splitAtPlayhead(playback.get().time)}><Scissors size={15} /></button>
          <button className="icon-btn" aria-label="Remove selected chord" title="Remove selected chord (Delete)" disabled={!sel} onClick={() => { if (sel) { updateSegments((s) => deleteSegment(s, sel.id)); select(null); } }}><Trash2 size={15} /></button>
        </div>
        <div className="tl-tools2">
          <div className="grp">
            <button className={`icon-btn ${loopOn ? 'on' : ''}`} aria-pressed={loopOn} aria-label="Loop section" title={hasLoop ? 'Loop section (L)' : 'Drag across the ruler to choose a section'} disabled={!hasLoop} onClick={() => player.toggleLoop()}><Repeat size={15} /></button>
            {hasLoop && <LoopLabel />}
            {hasLoop && <button className="icon-btn" aria-label="Clear loop" onClick={() => player.setLoop(null)}><X size={14} /></button>}
            {!hasLoop && <span className="hint" style={{ fontSize: 11.5 }}>Drag on the ruler to loop a section</span>}
          </div>
          <div className="grp">
            <button className={`icon-btn ${follow ? 'on' : ''}`} aria-pressed={follow} aria-label="Follow playhead" title="Keep the playhead in view" onClick={() => app.set({ follow: !follow })}><Crosshair size={15} /></button>
            <span className="tl-sep" />
            <div className="zoom">
              <button className="icon-btn" aria-label="Zoom out" onClick={() => zoomTo(pps / 1.5)}><Minus size={14} /></button>
              <label className="sr-only" htmlFor="zoom">Zoom</label>
              <input id="zoom" className="range" type="range" min={Math.log(MIN_PPS)} max={Math.log(MAX_PPS)} step={0.01} value={Math.log(pps)} onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))} />
              <button className="icon-btn" aria-label="Zoom in" onClick={() => zoomTo(pps * 1.5)}><Plus size={14} /></button>
              <button className="icon-btn" aria-label="Fit song to view" title="Fit whole song" onClick={() => { const el = scrollRef.current; if (el && duration) { app.set({ pxPerSec: clampPps((el.clientWidth - PAD) / duration) }); el.scrollLeft = 0; } }}><Maximize2 size={13} /></button>
            </div>
          </div>
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          <div className="tl-head dim"><span className="lbl">Time</span></div>
          <div className="tl-head"><span className="sw" style={{ background: 'var(--violet)' }} /><span className="lbl">Chords</span></div>
          <div className="tl-head"><span className="sw" style={{ background: 'var(--cyan)' }} /><span className="lbl">Audio</span></div>
          <div className="tl-head dim"><span className="sw" style={{ background: 'var(--raised)' }} /><span className="lbl">Melody</span></div>
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          {p && (p.peaks || ready) ? (
            <div className="tl-content" style={{ width }}>
              <Ruler duration={duration} pps={pps} view={view} />
              <ChordTrack p={p} pps={pps} view={view} />
              <WaveTrack p={p} pps={pps} view={view} />
              <div className="track melody-track"><span className="melody-note">Note transcription will appear here in a future version</span></div>
              <LoopRegion pps={pps} />
              <Playhead pps={pps} scrollRef={scrollRef} />
            </div>
          ) : (
            <div className="tl-empty">{p ? 'The timeline appears once the audio is decoded.' : 'Import a song to see its chords on the timeline.'}</div>
          )}
        </div>
      </div>
    </section>
  );
}

const clampPps = (v: number) => Math.max(MIN_PPS, Math.min(MAX_PPS, v));

function LoopLabel() {
  const loop = useStore(playback, (s) => s.loop, (a, b) => a?.start === b?.start && a?.end === b?.end);
  if (!loop) return null;
  return <span className="tnum hint" style={{ fontSize: 11.5, padding: '0 4px' }}>{fmtTime(loop.start, true)} – {fmtTime(loop.end, true)}</span>;
}

function contentX(e: { clientX: number }, el: Element): number {
  const r = el.getBoundingClientRect();
  return e.clientX - r.left;
}

function Ruler({ duration, pps, view }: { duration: number; pps: number; view: { left: number; width: number } }) {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const major = steps.find((s) => s * pps >= 64) ?? 600;
  const minor = major / (major >= 10 ? 5 : major >= 2 ? 2 : 5);
  const t0 = Math.max(0, Math.floor((view.left - 100) / pps / minor) * minor);
  const t1 = Math.min(duration, (view.left + view.width + 100) / pps);
  const ticks: JSX.Element[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(isMajor
      ? <span key={t.toFixed(3)} className="tick tnum" style={{ left: t * pps }}>{fmtTime(t)}</span>
      : <span key={t.toFixed(3)} className="tick minor" style={{ left: t * pps }} />);
  }
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  return (
    <div className="ruler"
      onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { x0: contentX(e, e.currentTarget), moved: false }; }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const x = contentX(e, e.currentTarget);
        if (!d.moved && Math.abs(x - d.x0) < 5) return;
        d.moved = true;
        const a = Math.max(0, Math.min(d.x0, x) / pps); const b = Math.min(duration, Math.max(d.x0, x) / pps);
        player.setLoop({ start: a, end: b });
      }}
      onPointerUp={(e) => {
        const d = drag.current; drag.current = null;
        if (d && !d.moved) { player.seek(contentX(e, e.currentTarget) / pps); app.set({ follow: true }); }
      }}>
      {ticks}
    </div>
  );
}

function ChordTrack({ p, pps, view }: { p: Project; pps: number; view: { left: number; width: number } }) {
  const active = useActiveIndex(p);
  const selectedId = useApp((s) => s.selectedId);
  const { show, transpose } = useDisplay(p);
  const [editing, setEditing] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lo = (view.left - 300) / pps; const hi = (view.left + view.width + 300) / pps;
  const segs = p.segments;

  const commit = (s: Segment, value: string) => {
    setEditing(null);
    const v = value.trim();
    if (!v || v === show(s.chord)) return;
    const stored = toStoredChord(v, transpose);
    if (!isValidChord(stored)) { toast(`“${v}” isn’t a chord name Chordlab understands. Try names like Am, F#, Bb7 or Csus4.`, 'error'); return; }
    updateSegments((x) => renameSegment(x, s.id, stored));
  };

  const startBoundaryDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('drag');
    beginEdit();
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - trackRef.current!.getBoundingClientRect().left;
      updateSegments((s) => moveBoundary(s, i, x / pps), false);
    };
    const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  if (p.status !== 'ready') return <div className="track chord-track" ref={trackRef} />;
  return (
    <div className="track chord-track" ref={trackRef}>
      {segs.map((s, i) => {
        if (s.end < lo || s.start > hi) return null;
        const w = (s.end - s.start) * pps - 3;
        const name = show(s.chord);
        const unc = s.chord !== 'N' && s.confidence < UNCERTAIN_THRESHOLD && !s.edited;
        const cls = ['cseg', i === active && 'active', s.id === selectedId && 'selected', unc && 'uncertain', s.chord === 'N' && 'nc', s.edited && 'edited', w < 38 && 'tiny'].filter(Boolean).join(' ');
        return (
          <div key={s.id} style={{ display: 'contents' }}>
            {i > 0 && <div className="bound" style={{ left: s.start * pps }} onPointerDown={(e) => startBoundaryDrag(i, e)} role="separator" aria-label={`Boundary at ${fmtTime(s.start, true)}`} />}
            <button
              className={cls}
              style={{ left: s.start * pps + 1.5, width: Math.max(2, w) }}
              aria-label={`${name}, ${fmtTime(s.start, true)} to ${fmtTime(s.end, true)}${unc ? ', uncertain' : ''}`}
              aria-current={i === active}
              title={`${name} · ${fmtTime(s.start, true)}–${fmtTime(s.end, true)} · ${s.edited ? 'edited' : `${Math.round(s.confidence * 100)}% confidence`}`}
              onClick={() => { select(s.id); player.seek(s.start); app.set({ follow: true }); }}
              onDoubleClick={() => setEditing(s.id)}
            >
              {editing === s.id ? (
                <input autoFocus defaultValue={name === 'N.C.' ? '' : name} placeholder="N" aria-label="Chord name"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(s, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditing(null); }}
                  onBlur={(e) => commit(s, e.target.value)} />
              ) : (
                <>
                  {w >= 16 && <span className="nm">{name}</span>}
                  {w >= 38 && s.chord !== 'N' && !s.edited && <span className="cf" aria-hidden><i style={{ width: `${s.confidence * 100}%` }} /></span>}
                </>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function WaveTrack({ p, pps, view }: { p: Project; pps: number; view: { left: number; width: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const H = 50;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !p.peaks) return;
    const peaks = p.peaks;
    const n = peaks.length / 2;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = view.width;
      if (c.width !== Math.floor(W * dpr)) { c.width = Math.floor(W * dpr); c.height = H * dpr; c.style.width = `${W}px`; }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const played = playback.get().time * pps - view.left;
      const mid = H / 2; const amp = H * 0.42;
      const bar = 2; const gap = pps > 120 ? 1 : 1.2;
      for (let x = 0; x < W; x += bar + gap) {
        const t0 = (view.left + x) / pps; const t1 = (view.left + x + bar + gap) / pps;
        let a = Math.floor(t0 * PEAKS_PER_SECOND); const b = Math.max(a + 1, Math.floor(t1 * PEAKS_PER_SECOND));
        if (a >= n) break;
        let lo = 0; let hi = 0;
        for (; a < b && a < n; a++) { lo = Math.min(lo, peaks[a * 2]); hi = Math.max(hi, peaks[a * 2 + 1]); }
        const h = Math.max(1.5, (hi - lo) * amp);
        g.fillStyle = x < played ? '#5fdcf3' : '#1d8fa8';
        g.beginPath();
        if (g.roundRect) g.roundRect(x, mid - h / 2, bar, h, 1); else g.rect(x, mid - h / 2, bar, h);
        g.fill();
      }
    };
    draw();
    let last = -1;
    return playback.subscribe(() => {
      const x = Math.round(playback.get().time * pps);
      if (x !== last) { last = x; draw(); }
    });
  }, [p.peaks, pps, view.left, view.width]);
  return (
    <div className="track wave-track" onPointerDown={(e) => { player.seek(contentX(e, e.currentTarget) / pps); app.set({ follow: true }); }}>
      <canvas ref={canvas} style={{ transform: `translateX(${view.left}px)`, height: H }} aria-hidden />
    </div>
  );
}

function LoopRegion({ pps }: { pps: number }) {
  const loop = useStore(playback, (s) => s.loop, (a, b) => a?.start === b?.start && a?.end === b?.end);
  const on = useStore(playback, (s) => s.loopOn);
  if (!loop) return null;
  return <div className={`loop-region ${on ? '' : 'off'}`} style={{ left: loop.start * pps, width: (loop.end - loop.start) * pps }}><div className="lr-tab" /></div>;
}

function Playhead({ pps, scrollRef }: { pps: number; scrollRef: React.RefObject<HTMLDivElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      const s = playback.get();
      const x = s.time * pps;
      if (ref.current) ref.current.style.transform = `translateX(${x}px)`;
      const el = scrollRef.current;
      if (el && app.get().follow) {
        const vw = el.clientWidth;
        if (s.playing ? (x > el.scrollLeft + vw * 0.85 || x < el.scrollLeft) : (x > el.scrollLeft + vw - 20 || x < el.scrollLeft)) {
          el.scrollLeft = Math.max(0, x - vw * 0.2);
        }
      }
    };
    update();
    return playback.subscribe(update);
  }, [pps, scrollRef]);
  return <div ref={ref} className="playhead" aria-hidden />;
}
