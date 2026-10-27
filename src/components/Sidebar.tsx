import { AlertTriangle, FlaskConical, FolderOpen, Keyboard, Library, Trash2, Upload, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UNCERTAIN_THRESHOLD } from '../engine/types';
import { keyName } from '../music/theory';
import { confirmAndDelete, createDemo, importFiles, openProject, runSelfTest, useApp } from '../state/app';
import { storageEstimate } from '../state/db';
import type { Project } from '../state/project';
import { fmtBytes, fmtTime } from './util';

export function Sidebar({ onShortcuts }: { onShortcuts: () => void }) {
  const projects = useApp((s) => s.projects);
  const currentId = useApp((s) => s.currentId);
  const progress = useApp((s) => s.progress);
  const offlineReady = useApp((s) => s.offlineReady);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  useEffect(() => { void storageEstimate().then(setStorage); }, [projects.length]);
  const busy = Object.keys(progress).length;
  return (
    <aside className="panel sidebar" aria-label="Library">
      <nav className="rail" aria-label="Tools">
        <button className="icon-btn on" aria-label="Library" title="Library"><Library size={16} /></button>
        <button className="icon-btn" aria-label="Import audio" title="Import audio" onClick={() => input.current?.click()}><FolderOpen size={16} /></button>
        <button className="icon-btn" aria-label="Create demo song" title="Create a demo song" onClick={() => void createDemo()}><Wand2 size={16} /></button>
        <button className="icon-btn" aria-label="Run engine self-test" title="Run the engine self-test" onClick={() => void runSelfTest()}><FlaskConical size={16} /></button>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onShortcuts}><Keyboard size={16} /></button>
      </nav>
      <div className="library">
        <button className={`drop ${over ? 'over' : ''}`} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); void importFiles(e.dataTransfer.files); }}>
          <span className="drop-icon"><Upload size={16} /></span>
          <span><strong>Import audio</strong><small>Drop files or browse. MP3, WAV, M4A, OGG, FLAC</small></span>
        </button>
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm" multiple hidden onChange={(e) => { void importFiles(e.target.files ?? []); e.target.value = ''; }} />
        <h2>Projects <span>{projects.length || ''}</span></h2>
        <div className="project-list" role="list">
          {projects.length === 0 && (
            <p className="empty-lib">Songs you import are saved here, on this device. No song handy? <button onClick={() => void createDemo()}>Create a demo</button>.</p>
          )}
          {projects.map((p) => <ProjectRow key={p.id} p={p} active={p.id === currentId} progress={progress[p.id]} />)}
        </div>
        <div className="lib-foot">
          <span>{busy ? `Analysing ${busy} song${busy > 1 ? 's' : ''} on this device` : import.meta.env.VITE_SINGLE === '1' ? 'Preview. Install the full build to work offline' : offlineReady ? 'Ready to work offline' : 'Preparing offline mode'}</span>
          {storage && storage.quota > 0 && (
            <>
              <div className="meter" aria-hidden><i style={{ width: `${Math.min(100, (storage.usage / storage.quota) * 100)}%` }} /></div>
              <span className="tnum">{fmtBytes(storage.usage)} used of {fmtBytes(storage.quota)}{storage.persisted ? '' : ', may be cleared if space runs low'}</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function ProjectRow({ p, active, progress }: { p: Project; active: boolean; progress?: { stage: string; fraction: number } }) {
  return (
    <div role="listitem" className={`project-item ${active ? 'active' : ''}`} onClick={() => void openProject(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') void openProject(p.id); }} tabIndex={0} aria-current={active}>
      <Thumb p={p} />
      <div style={{ minWidth: 0 }}>
        <div className="pi-title" title={p.title}>{p.title}</div>
        <div className="pi-meta">
          {p.status === 'error' ? <span className="err"><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> Analysis failed</span>
            : p.status !== 'ready' ? <span>{progress?.stage ?? 'Queued'}</span>
            : <><span className="tnum">{fmtTime(p.duration)}</span>{p.analysis && <span>{keyName(p.analysis.key.tonic, p.analysis.key.mode, p.settings.transpose)}</span>}</>}
        </div>
        {progress && <div className="pi-progress"><i style={{ width: `${progress.fraction * 100}%` }} /></div>}
      </div>
      <button className="icon-btn pi-del" aria-label={`Delete ${p.title}`} onClick={(e) => { e.stopPropagation(); void confirmAndDelete(p.id); }} onKeyDown={(e) => e.stopPropagation()}><Trash2 size={14} /></button>
    </div>
  );
}

/** Thumbnail: the song's chord blocks in miniature over its waveform. */
function Thumb({ p }: { p: Project }) {
  const W = 52; const H = 38;
  const d = p.duration || 1;
  const bars: JSX.Element[] = [];
  if (p.peaks) {
    const n = p.peaks.length / 2; const cols = 24;
    for (let c = 0; c < cols; c++) {
      let m = 0;
      for (let i = Math.floor((c / cols) * n); i < Math.floor(((c + 1) / cols) * n); i++) m = Math.max(m, p.peaks[i * 2 + 1] - p.peaks[i * 2]);
      const h = Math.max(1, m * 9);
      bars.push(<rect key={c} x={2 + c * 2} y={27 - h / 2} width={1.2} height={h} fill="#22b4d2" opacity={0.75} />);
    }
  }
  return (
    <svg className="thumb" viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {p.segments.filter((s) => s.chord !== 'N').map((s) => (
        <rect key={s.id} x={2 + (s.start / d) * 48} y={6} width={Math.max(0.8, ((s.end - s.start) / d) * 48 - 0.6)} height={8} rx={1.5} fill="#8d44f6" opacity={s.confidence < UNCERTAIN_THRESHOLD ? 0.45 : 1} />
      ))}
      {bars}
    </svg>
  );
}
