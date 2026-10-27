/** Teach Chordlab: record labelled guitar chords, learn a profile, and measure whether it helps. */
import { Check, FileAudio, GraduationCap, Mic, Pause, Play, RotateCcw, SkipForward, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MicError, MicRecorder } from '../audio/recorder';
import { MIN_TAKES, TEACHABLE } from '../engine/learn';
import { voicingsFor, TUNINGS } from '../music/fretted';
import { app, askConfirm, currentProject, reanalyse, toast } from '../state/app';
import { editedCount } from '../state/project';
import { analyseTake, analyseTakeFile, clearTakes, closeTeach, deleteTake, saveTake, setProfileEnabled, takeLabel, TakeError, useTeach, type AnalysedTake, type TeachTake } from '../state/teach';
import { FretDiagram } from './Diagrams';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ROOT_SETS: { id: string; label: string; roots: number[] }[] = [
  { id: 'quick', label: 'Quick: 3 roots (G, A, E)', roots: [7, 9, 4] },
  { id: 'standard', label: 'Standard: 4 roots (G, A, C, E)', roots: [7, 9, 0, 4] },
  { id: 'thorough', label: 'Thorough: 6 roots (G, A, C, D, E, F)', roots: [7, 9, 0, 2, 4, 5] },
];
const typeName = (s: string) => TEACHABLE.find((t) => t.suffix === s)?.name ?? s;
const display = (root: number, suffix: string) => NAMES[root] + suffix;

interface PlanItem { root: number; suffix: string; style: 'strum' | 'pick' }

export function TeachModal() {
  const open = useTeach((s) => s.open);
  return open ? <TeachInner /> : null;
}

function TeachInner() {
  const takes = useTeach((s) => s.takes);
  const [tab, setTab] = useState<'record' | 'takes' | 'results'>('record');
  const [plan, setPlan] = useState<{ items: PlanItem[]; mic: MicRecorder | null } | null>(null);
  const close = () => { plan?.mic?.close(); closeTeach(); };
  useEffect(() => () => plan?.mic?.close(), [plan]);
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal teach" role="dialog" aria-modal="true" aria-labelledby="teach-title" onClick={(e) => e.stopPropagation()}>
        <header className="teach-head">
          <GraduationCap size={18} color="var(--violet-hi)" />
          <h2 id="teach-title">Teach Chordlab your guitar</h2>
          <div className="seg teach-tabs" role="tablist">
            <button role="tab" aria-pressed={tab === 'record'} onClick={() => setTab('record')}>Record</button>
            <button role="tab" aria-pressed={tab === 'takes'} onClick={() => setTab('takes')}>Takes {takes.length ? `(${takes.length})` : ''}</button>
            <button role="tab" aria-pressed={tab === 'results'} onClick={() => setTab('results')}>Results</button>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={close}><X size={16} /></button>
        </header>
        <div className="teach-body">
          {tab === 'record' && (plan
            ? <Session items={plan.items} mic={plan.mic} onExit={(done) => { plan.mic?.close(); setPlan(null); if (done) setTab('results'); }} />
            : <Setup onStart={(items, mic) => setPlan({ items, mic })} />)}
          {tab === 'takes' && <Takes />}
          {tab === 'results' && <Results />}
        </div>
      </div>
    </div>
  );
}

function Setup({ onStart }: { onStart: (items: PlanItem[], mic: MicRecorder | null) => void }) {
  const takes = useTeach((s) => s.takes);
  const [types, setTypes] = useState<string[]>(['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4']);
  const [rootSet, setRootSet] = useState('quick');
  const [styles, setStyles] = useState<'strum' | 'both'>('strum');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const roots = ROOT_SETS.find((r) => r.id === rootSet)!.roots;
  const items: PlanItem[] = [];
  for (const suffix of types) for (const root of roots) for (const style of styles === 'both' ? (['strum', 'pick'] as const) : (['strum'] as const)) items.push({ root, suffix, style });
  const minutes = Math.max(1, Math.round((items.length * 8) / 60));
  const counts = (s: string) => takes.filter((t) => t.suffix === s).length;
  const start = async (useMic: boolean) => {
    setError(null);
    if (!useMic) { onStart(items, null); return; }
    setStarting(true);
    const mic = new MicRecorder();
    try { await mic.open(); onStart(items, mic); } catch (e) { setError(e instanceof MicError ? e.message : String(e)); } finally { setStarting(false); }
  };
  return (
    <div className="teach-setup">
      <p className="teach-lead">Chordlab asks for one chord at a time and records about three seconds of you playing it. It learns how each chord type sounds on your guitar, then tests whether that actually improves detection before you switch it on. Everything stays on this device.</p>
      <section>
        <h3>Chord types</h3>
        <div className="pick-chips" role="group" aria-label="Chord types">
          {TEACHABLE.map((t) => (
            <button key={t.suffix} className="pick-chip" aria-pressed={types.includes(t.suffix)} onClick={() => setTypes((v) => (v.includes(t.suffix) ? v.filter((x) => x !== t.suffix) : [...v, t.suffix]))}>
              {t.name}{counts(t.suffix) > 0 && <small>{counts(t.suffix)} recorded</small>}
            </button>
          ))}
        </div>
      </section>
      <div className="grid2 teach-opts">
        <label>Roots<select className="select" value={rootSet} onChange={(e) => setRootSet(e.target.value)}>{ROOT_SETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label>Playing style<select className="select" value={styles} onChange={(e) => setStyles(e.target.value as 'strum' | 'both')}><option value="strum">Strummed</option><option value="both">Strummed and fingerpicked</option></select></label>
      </div>
      <p className="hint">Learning from a few roots is enough: what Chordlab learns from G and A applies in every key. Tune your guitar first, play somewhere quiet, and use any shape you like.</p>
      {error && <p className="teach-error"><TriangleAlert size={14} /> {error}</p>}
      <div className="teach-actions">
        <span className="hint tnum">{items.length} takes, about {minutes} min</span>
        <button className="btn" disabled={!items.length} onClick={() => void start(false)}><FileAudio size={14} /> Use audio files instead</button>
        <button className="btn primary" disabled={!items.length || starting} onClick={() => void start(true)}><Mic size={14} /> {starting ? 'Opening microphone…' : 'Start recording'}</button>
      </div>
    </div>
  );
}

type Phase = 'ready' | 'countdown' | 'recording' | 'checking' | 'review' | 'saved' | 'done';

function Session({ items, mic, onExit }: { items: PlanItem[]; mic: MicRecorder | null; onExit: (done: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [count, setCount] = useState(3);
  const [take, setTake] = useState<AnalysedTake | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [saved, setSaved] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const item = items[index];
  const name = item ? display(item.root, item.suffix) : '';
  const voicing = useMemo(() => (item ? voicingsFor(name, 'guitar')[0] : undefined), [item, name]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!mic) return;
    let raf = 0;
    const tick = () => { if (meter.current) meter.current.style.width = `${mic.level() * 100}%`; raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mic]);

  const next = (autoStart: boolean) => {
    setTake(null); setProblem(null);
    if (index + 1 >= items.length) { setPhase('done'); return; }
    setIndex((i) => i + 1);
    setPhase('ready');
    if (autoStart && mic) setTimeout(() => void record(), 500);
  };

  const handle = async (get: () => Promise<AnalysedTake>, source: 'mic' | 'file') => {
    setPhase('checking'); setProblem(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const t = await get();
      setTake(t);
      if (t.check.ok) { await keep(t, source, false); return; }
      setProblem(`That sounded more like ${t.check.heardAs.replace('A#', 'Bb').replace('D#', 'Eb').replace('G#', 'Ab')} than ${name}. Check the shape and your tuning, then retake it.`);
      setPhase('review');
    } catch (e) {
      setProblem(e instanceof TakeError ? e.message : `That take couldn’t be used: ${(e as Error).message}`);
      setPhase('review');
    }
  };

  const keep = async (t: AnalysedTake, source: 'mic' | 'file', forced: boolean) => {
    await saveTake({ root: item.root, suffix: item.suffix, style: item.style, source, chroma: t.chroma, audio: t.audio, forced: forced || undefined });
    setSaved((n) => n + 1);
    setPhase('saved');
    setTimeout(() => next(auto), 700);
  };

  const record = async () => {
    if (!mic) { fileInput.current?.click(); return; }
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase('countdown');
    for (let c = 3; c >= 1; c--) {
      setCount(c);
      await new Promise((r) => setTimeout(r, 650));
      if (ctl.signal.aborted) { setPhase('ready'); return; }
    }
    setPhase('recording');
    const { samples, sampleRate } = await mic.record(3.2, ctl.signal);
    if (ctl.signal.aborted) { setPhase('ready'); return; }
    await handle(async () => analyseTake(samples.subarray(Math.floor(sampleRate * 0.1)), sampleRate, item.root, item.suffix), 'mic');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && (phase === 'ready' || phase === 'review')) { e.preventDefault(); void record(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (phase === 'done') {
    return (
      <div className="teach-done">
        <Check size={28} color="var(--ok)" />
        <h3>Session complete</h3>
        <p className="hint">{saved} take{saved === 1 ? '' : 's'} saved. See how your profile performs before switching it on.</p>
        <div className="teach-actions" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => onExit(false)}>Record more</button>
          <button className="btn primary" onClick={() => onExit(true)}>See results</button>
        </div>
      </div>
    );
  }

  return (
    <div className="session">
      <div className="session-progress"><i style={{ width: `${(index / items.length) * 100}%` }} /></div>
      <div className="session-main">
        <div className="session-left">
          <span className="hint tnum">Take {index + 1} of {items.length} · {typeName(item.suffix)}</span>
          <div className="teach-chord" aria-live="polite" aria-label={`Play ${name}`}>{name}</div>
          <p className="session-instr">{item.style === 'strum' ? 'Strum once or twice and let it ring.' : 'Fingerpick slowly across the strings.'}</p>
          <div className={`session-status ${phase}`} aria-live="polite">
            {phase === 'ready' && <span>{mic ? 'Press Record (or Space) when ready.' : 'Choose a recording of this chord.'}</span>}
            {phase === 'countdown' && <span className="countdown tnum">{count}</span>}
            {phase === 'recording' && <span className="rec"><i className="rec-dot" /> Recording… play now</span>}
            {phase === 'checking' && <span>Checking the take…</span>}
            {phase === 'saved' && <span className="ok"><Check size={15} /> Saved</span>}
            {phase === 'review' && <span className="warn"><TriangleAlert size={15} /> {problem}</span>}
          </div>
          {mic && <div className="input-meter" aria-hidden><div ref={meter} /></div>}
          <div className="teach-actions start">
            {(phase === 'ready' || phase === 'review') && (
              <button className="btn primary" onClick={() => void record()}>{mic ? <><Mic size={14} /> {phase === 'review' ? 'Retake' : 'Record'}</> : <><FileAudio size={14} /> Choose file</>}</button>
            )}
            {phase === 'review' && take && <button className="btn" onClick={() => void keep(take, mic ? 'mic' : 'file', true)}>Keep anyway</button>}
            {(phase === 'countdown' || phase === 'recording') && <button className="btn" onClick={() => abort.current?.abort()}><Pause size={14} /> Stop</button>}
            <button className="btn ghost" disabled={phase === 'recording' || phase === 'checking'} onClick={() => next(false)}><SkipForward size={14} /> Skip</button>
            {mic && <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={phase === 'recording'}><FileAudio size={14} /> Use a file</button>}
          </div>
          <input ref={fileInput} data-teach-file type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" hidden onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (f) void handle(() => analyseTakeFile(f, item.root, item.suffix), 'file');
          }} />
        </div>
        <div className="session-right">
          {voicing ? <FretDiagram voicing={voicing} labels={TUNINGS.guitar[0].labels} title={`${name} on guitar`} /> : null}
          <span className="hint">Suggested shape. Any voicing of {name} works.</span>
        </div>
      </div>
      <footer className="session-foot">
        <label className="row" style={{ gap: 8 }}><button role="switch" aria-checked={auto} className="toggle" onClick={() => setAuto((a) => !a)} /> Continue to the next chord automatically</label>
        <button className="btn ghost sm" onClick={() => onExit(saved > 0)}>End session</button>
      </footer>
    </div>
  );
}

function playTake(t: TeachTake) {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const buf = ctx.createBuffer(1, t.audio.length, t.sampleRate);
  buf.copyToChannel(Float32Array.from(t.audio), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start();
  src.onended = () => void ctx.close();
}

function Takes() {
  const takes = useTeach((s) => s.takes);
  if (!takes.length) return <p className="hint">No takes yet. Record some on the Record tab.</p>;
  const groups = TEACHABLE.map((t) => ({ ...t, list: takes.filter((x) => x.suffix === t.suffix) })).filter((g) => g.list.length);
  return (
    <div className="takes">
      {groups.map((g) => (
        <section key={g.suffix}>
          <h3>{g.name} <small>{g.list.length} take{g.list.length === 1 ? '' : 's'}, {new Set(g.list.map((t) => t.root)).size} root{new Set(g.list.map((t) => t.root)).size === 1 ? '' : 's'}</small></h3>
          <div className="take-chips">
            {g.list.map((t) => (
              <span key={t.id} className={`take-chip ${t.forced ? 'forced' : ''}`} title={t.forced ? 'Kept even though it didn’t match the requested chord' : `${t.style === 'strum' ? 'Strummed' : 'Fingerpicked'}, ${t.source === 'mic' ? 'recorded' : 'imported'}`}>
                <b>{takeLabel(t).replace('A#', 'Bb')}</b>{t.style === 'pick' && <small>picked</small>}
                <button className="icon-btn" aria-label={`Play ${takeLabel(t)}`} onClick={() => playTake(t)}><Play size={12} /></button>
                <button className="icon-btn" aria-label={`Delete ${takeLabel(t)}`} onClick={() => void deleteTake(t.id)}><X size={12} /></button>
              </span>
            ))}
          </div>
        </section>
      ))}
      <button className="btn sm danger" style={{ justifySelf: 'start' }} onClick={async () => {
        if (await askConfirm({ title: 'Delete all takes?', message: `All ${takes.length} recordings and the profile learned from them will be removed from this device.`, confirmLabel: 'Delete all', danger: true })) { await clearTakes(); toast('All takes deleted.', 'success'); }
      }}><Trash2 size={13} /> Delete all takes</button>
    </div>
  );
}

function Results() {
  const ev = useTeach((s) => s.evaluation);
  const profile = useTeach((s) => s.profile);
  const enabled = useTeach((s) => s.enabled);
  if (!ev) return <p className="hint">Record at least two takes to see results.</p>;
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const extra = profile?.templates.map((t) => t.suffix).filter((s) => s !== '' && s !== 'm') ?? [];
  const better = ev.learnedCorrect - ev.defaultCorrect;
  const p = currentProject();
  const applyToSong = async () => {
    if (!p) return;
    const edits = editedCount(p.segments);
    if (edits && !(await askConfirm({ title: 'Replace your edits?', message: `Re-analysing “${p.title}” replaces your ${edits} manual edit${edits === 1 ? '' : 's'}. You can undo this afterwards.`, confirmLabel: 'Re-analyse' }))) return;
    closeTeach();
    void reanalyse(p.settings.decode);
  };
  return (
    <div className="results">
      <div className="score-cards">
        <div className="score"><span>Default engine</span><b className="tnum">{pct(ev.defaultCorrect, ev.total)}%</b><small className="tnum">{ev.defaultCorrect} of {ev.total} takes</small></div>
        <div className="score accent"><span>With your profile</span><b className="tnum">{pct(ev.learnedCorrect, ev.total)}%</b><small className="tnum">{ev.learnedCorrect} of {ev.total} takes</small></div>
      </div>
      <p className="hint">Each take is checked by a profile built from your <em>other</em> takes, so this measures chords it hasn’t memorised. {better > 0 ? `Your profile identifies ${better} more take${better === 1 ? '' : 's'} correctly.` : better < 0 ? 'Your profile does worse than the default engine on these takes. Check the Takes tab for mismatched recordings, or record more.' : 'Your profile performs the same as the default engine on these takes.'}</p>
      <table>
        <thead><tr><th>Chord type</th><th>Takes</th><th>Default</th><th>Profile</th><th>Status</th></tr></thead>
        <tbody>
          {ev.perType.map((r) => (
            <tr key={r.suffix}>
              <td>{typeName(r.suffix)}</td>
              <td className="tnum">{r.takes} <span className="hint">({r.roots} root{r.roots === 1 ? '' : 's'})</span></td>
              <td className="tnum">{pct(r.defaultCorrect, r.tested)}%</td>
              <td className="tnum">{pct(r.learnedCorrect, r.tested)}%</td>
              <td>{r.takes < MIN_TAKES ? <span className="hint">Needs {MIN_TAKES - r.takes} more</span> : r.roots < 2 ? <span className="hint">Learned; add another root</span> : <span className="pass">Learned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ev.mistakes.length > 0 && (
        <details>
          <summary className="hint">Takes that were misidentified ({ev.mistakes.length})</summary>
          <ul className="mistakes">{ev.mistakes.slice(0, 12).map((m, i) => <li key={i}>Played <b>{m.expected}</b>: default heard {m.byDefault}, profile heard {m.byProfile}</li>)}</ul>
        </details>
      )}
      <div className="profile-switch">
        <div>
          <b>Use my guitar profile when analysing songs</b>
          <p className="hint">{profile ? <>Applies to new analyses and re-analysis.{extra.length ? ` Adds detection of ${extra.map((s) => typeName(s).toLowerCase()).join(', ')} chords.` : ''} Songs with drums, vocals and other instruments may gain less than these takes suggest.</> : `Record at least ${MIN_TAKES} takes of a chord type to build a profile.`}</p>
        </div>
        <button role="switch" aria-checked={enabled && !!profile} aria-label="Use my guitar profile" className="toggle" disabled={!profile} onClick={() => { setProfileEnabled(!enabled); app.set({}); }} />
      </div>
      {p?.status === 'ready' && profile && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void applyToSong()}><RotateCcw size={13} /> Re-analyse “{p.title}” {enabled ? 'with' : 'without'} the profile</button>}
    </div>
  );
}
