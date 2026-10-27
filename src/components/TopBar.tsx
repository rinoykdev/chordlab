import { Download, FileJson, FileText, MonitorDown, Upload, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { app, createDemo, importFiles, renameProject, toast, useApp, useCurrent } from '../state/app';
import type { Project } from '../state/project';
import { keyName } from '../music/theory';
import { fmtTime, useDisplay } from './util';

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 26 26" aria-hidden>
      <circle cx="9" cy="10" r="6.5" fill="#8d44f6" />
      <circle cx="17" cy="10" r="6.5" fill="#22b4d2" opacity="0.9" />
      <circle cx="13" cy="17" r="6.5" fill="#f47b2a" opacity="0.92" />
    </svg>
  );
}

export function TopBar() {
  const p = useCurrent();
  const saveState = useApp((s) => s.saveState);
  const online = useApp((s) => s.online);
  const install = useApp((s) => s.installPrompt);
  const input = useRef<HTMLInputElement>(null);
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <div><div className="brand-name">Chordlab</div><div className="brand-sub">Chord workspace</div></div>
      </div>
      <div className="topbar-tools">
        <button className="icon-btn" aria-label="Import audio" title="Import audio" onClick={() => input.current?.click()}><Upload size={15} /></button>
        <button className="icon-btn" aria-label="Create demo song" title="Create a demo song" onClick={() => void createDemo()}><Wand2 size={15} /></button>
        <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => { void importFiles(e.target.files ?? []); e.target.value = ''; }} />
      </div>
      <div className="project-title">
        {p ? (
          <>
            <span className="crumb">Project /</span>
            <TitleInput key={p.id} p={p} />
            <span className={`save-dot ${saveState}`} title={saveState === 'saved' ? 'Saved on this device' : saveState === 'saving' ? 'Saving…' : 'Not saved'} aria-label={saveState === 'saved' ? 'Saved' : saveState} />
          </>
        ) : <span>No song open</span>}
      </div>
      <div className="topbar-right">
        <span className={`net ${online ? '' : 'off'}`} title={online ? 'Online. Everything still runs on this device.' : 'Offline. Analysis and saved projects keep working.'}><i className="dot" /><span>{online ? 'On-device' : 'Offline'}</span></span>
        {install && <button className="btn sm" onClick={async () => { await install.prompt(); app.set({ installPrompt: null }); }}><MonitorDown size={14} /> Install</button>}
        <ExportMenu p={p} />
      </div>
    </header>
  );
}

function TitleInput({ p }: { p: Project }) {
  const [v, setV] = useState(p.title);
  useEffect(() => setV(p.title), [p.title]);
  return <input aria-label="Project name" size={Math.max(6, Math.min(48, v.length + 1))} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => renameProject(p.id, v)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

type Downloads = { save(r: { filename: string; data: Blob }): Promise<unknown> };
type ClaudeHost = { use(name: string): Promise<unknown> };

/** Returns false when nothing was saved. Hosted previews must go through the viewer's save prompt. */
async function download(name: string, blob: Blob): Promise<boolean> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const dl = (await host.use('downloads').catch(() => null)) as Downloads | null;
    if (dl) {
      try { await dl.save({ filename: name, data: blob }); return true; } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== 'declined') toast(code === 'rate_limited' ? 'A save prompt is already open.' : 'Saving files isn’t available in this view.', 'error');
        return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

function ExportMenu({ p }: { p: Project | null }) {
  const [open, setOpen] = useState(false);
  const { show } = useDisplay(p);
  const disabled = !p || p.status !== 'ready';
  const safe = (p?.title ?? 'chords').replace(/[^\w\- ]+/g, '').trim() || 'chords';
  const chart = async () => {
    if (!p?.analysis) return;
    const a = p.analysis;
    const lines = [
      p.title,
      `Key: ${keyName(a.key.tonic, a.key.mode, p.settings.transpose)}${p.settings.transpose ? ` (transposed ${p.settings.transpose > 0 ? '+' : ''}${p.settings.transpose})` : ''}`,
      `Tempo: ${a.tempo.bpm ? `${Math.round(a.tempo.bpm)} BPM` : 'unclear'}`,
      p.settings.instrument === 'guitar' && p.settings.capo ? `Capo: fret ${p.settings.capo}` : '',
      '',
      ...p.segments.map((s) => `${fmtTime(s.start, true).padStart(7)}  ${show(s.chord).padEnd(8)}${s.chord !== 'N' && !s.edited && s.confidence < 0.55 ? '  (uncertain)' : ''}`),
      '',
      'Detected with Chordlab on this device. Check uncertain chords by ear.',
    ].filter((l, i) => l !== '' || i > 3);
    if (await download(`${safe} chords.txt`, new Blob([lines.join('\n')], { type: 'text/plain' }))) toast('Chord chart exported.', 'success');
  };
  const json = async () => {
    if (!p) return;
    const { peaks: _peaks, ...rest } = p;
    if (await download(`${safe}.chordlab.json`, new Blob([JSON.stringify({ format: 'chordlab-project', version: 1, project: rest }, null, 2)], { type: 'application/json' }))) toast('Project data exported.', 'success');
  };
  return (
    <div className="menu">
      <button className="btn light" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}><Download size={14} /> Export</button>
      {open && (
        <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); void chart(); }}><FileText size={15} /><span>Chord chart<small>Timestamps and chords as text, in the current key</small></span></button>
          <button onClick={() => { setOpen(false); void json(); }}><FileJson size={15} /><span>Project data<small>Chords, confidence and settings as JSON</small></span></button>
        </div>
      )}
    </div>
  );
}
