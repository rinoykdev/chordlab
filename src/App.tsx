import { useEffect, useState } from 'react';
import { player, playback } from './audio/player';
import { Inspector } from './components/Inspector';
import { ConfirmDialog, SelfTestModal, ShortcutsModal, Toasts } from './components/Overlays';
import { Preview } from './components/Preview';
import { Sidebar } from './components/Sidebar';
import { Timeline } from './components/Timeline';
import { TeachModal } from './components/Teach';
import { teach } from './state/teach';
import { TopBar } from './components/TopBar';
import { app, currentProject, importFiles, init, redo, select, splitAtPlayhead, undo, updateSegments, updateSettings, useApp } from './state/app';
import { deleteSegment } from './state/project';

export function App() {
  const panel = useApp((s) => s.mobilePanel);
  const [shortcuts, setShortcuts] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => { void init(); }, []);

  // Drop audio anywhere in the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; setDragging(false); void importFiles(e.dataTransfer!.files); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea, [contenteditable="true"]') || app.get().confirm || teach.get().open) return;
      const p = currentProject();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      const segs = p?.segments ?? [];
      const t = playback.get().time;
      const selected = segs.find((s) => s.id === app.get().selectedId);
      if (k === ' ') { if (el.closest('button')) return; e.preventDefault(); player.toggle(); }
      else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod) return;
      else if (k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault();
        const dir = k === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey && segs.length) {
          const target = dir > 0 ? segs.find((s) => s.start > t + 0.05) : [...segs].reverse().find((s) => s.start < t - 0.6);
          player.seek(target ? target.start : dir > 0 ? playback.get().duration : 0);
          if (target) select(target.id);
        } else player.seek(t + dir * 5);
      }
      else if (k === 'l' || k === 'L') player.toggleLoop();
      else if (k === 's' || k === 'S') splitAtPlayhead(t);
      else if ((k === 'Delete' || k === 'Backspace') && selected) { e.preventDefault(); updateSegments((s) => deleteSegment(s, selected.id)); select(null); }
      else if (k === 'Enter' && selected) { (document.querySelector('.cseg.selected') as HTMLElement | null)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }
      else if (k === 'Escape') select(null);
      else if (k === '+' || k === '=') app.set((s) => ({ pxPerSec: Math.min(400, s.pxPerSec * 1.4) }));
      else if (k === '-' || k === '_') app.set((s) => ({ pxPerSec: Math.max(4, s.pxPerSec / 1.4) }));
      else if (k === '1' || k === '2' || k === '3') updateSettings({ instrument: (['guitar', 'ukulele', 'piano'] as const)[Number(k) - 1] });
      else if (k === '[' && p) updateSettings({ transpose: Math.max(-11, p.settings.transpose - 1) });
      else if (k === ']' && p) updateSettings({ transpose: Math.min(11, p.settings.transpose + 1) });
      else if (k === '?') setShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <div className="frame">
        <TopBar />
        <main className="workspace" data-panel={panel}>
          <Sidebar onShortcuts={() => setShortcuts(true)} />
          <Preview />
          <div className="mobile-tabs">
            <div className="seg" role="tablist" aria-label="Panels">
              <button role="tab" aria-pressed={panel === 'inspector'} aria-selected={panel === 'inspector'} onClick={() => app.set({ mobilePanel: 'inspector' })}>Settings and chords</button>
              <button role="tab" aria-pressed={panel === 'library'} aria-selected={panel === 'library'} onClick={() => app.set({ mobilePanel: 'library' })}>Library</button>
            </div>
          </div>
          <Inspector />
        </main>
        <Timeline />
      </div>
      <Toasts />
      <SelfTestModal />
      <TeachModal />
      <ConfirmDialog />
      {shortcuts && <ShortcutsModal onClose={() => setShortcuts(false)} />}
      {dragging && <div className="drag-overlay">Drop audio to analyse it</div>}
    </div>
  );
}
