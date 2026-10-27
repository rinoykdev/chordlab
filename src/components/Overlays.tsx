import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { Fragment } from 'react';
import { answerConfirm, app, runSelfTest, useApp } from '../state/app';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle size={16} color="var(--danger)" /> : t.kind === 'success' ? <CheckCircle2 size={16} color="var(--ok)" /> : <Info size={16} color="var(--cyan)" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function SelfTestModal() {
  const st = useApp((s) => s.selfTest);
  if (!st) return null;
  const close = () => app.set({ selfTest: null });
  const done = !st.running;
  const passed = st.rows.filter((r) => r.accuracy >= 0.9).length;
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="st-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="st-title">Engine self-test <button className="icon-btn" aria-label="Close" onClick={close}><X size={16} /></button></h2>
        <p>Chordlab synthesises audio with known chords in this browser and runs it through the same analysis engine your songs use. It checks the engine works here; real recordings are harder than these signals.</p>
        <table>
          <thead><tr><th>Test</th><th>Accuracy</th><th>Time</th></tr></thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}<div className="seq">Expected {r.expected}</div><div className="seq">Detected {r.detected}</div></td>
                <td className={r.accuracy >= 0.9 ? 'pass' : 'fail'}>{Math.round(r.accuracy * 100)}%</td>
                <td className="tnum">{(r.ms / 1000).toFixed(1)} s</td>
              </tr>
            ))}
            {st.running && <tr><td colSpan={3} className="hint">Running test {st.rows.length + 1} of 4…</td></tr>}
          </tbody>
        </table>
        {done && <p><b className={passed === st.rows.length ? 'pass' : 'fail'}>{passed} of {st.rows.length} passed</b> (90% of time labelled correctly). <button className="btn sm" onClick={() => void runSelfTest()}>Run again</button></p>}
      </div>
    </div>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Space', 'Play or pause'],
    ['← →', 'Back or forward 5 seconds'],
    ['⇧ ← →', 'Previous or next chord'],
    ['L', 'Loop the selected section'],
    ['S', 'Split the chord at the playhead'],
    ['Delete', 'Remove the selected chord'],
    ['Enter', 'Rename the selected chord'],
    ['⌘Z / ⇧⌘Z', 'Undo or redo'],
    ['+ −', 'Zoom the timeline'],
    ['1 2 3', 'Guitar, ukulele or piano'],
    ['[ ]', 'Transpose down or up'],
    ['Esc', 'Clear the selection'],
  ];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ks-title" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)' }}>
        <h2 id="ks-title">Keyboard shortcuts <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></h2>
        <div className="keys">{rows.map(([k, d]) => <Fragment key={k}><span><kbd>{k}</kbd></span><span>{d}</span></Fragment>)}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog() {
  const c = useApp((s) => s.confirm);
  if (!c) return null;
  return (
    <div className="modal-back" onClick={() => answerConfirm(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-msg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') answerConfirm(false); }}>
        <h2 id="cf-title">{c.title}</h2>
        <p id="cf-msg">{c.message}</p>
        <div className="confirm-actions">
          <button className="btn" onClick={() => answerConfirm(false)}>Cancel</button>
          <button className={`btn ${c.danger ? 'destructive' : 'primary'}`} data-confirm autoFocus onClick={() => answerConfirm(true)}>{c.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
