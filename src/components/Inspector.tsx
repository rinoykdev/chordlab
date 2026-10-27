import { Guitar, Piano, Music2, Minus, Plus, Scissors, Trash2, Merge, Repeat, RotateCcw, Sparkles, PlusCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { player, playback } from '../audio/player';
import { DEFAULT_DECODE_OPTIONS, UNCERTAIN_THRESHOLD, type DecodeOptions } from '../engine/types';
import { suggestCapo, TUNINGS } from '../music/fretted';
import { PIANO_VOICINGS, type PianoVoicingId } from '../music/piano';
import { diatonicChords, EDITABLE_QUALITIES, keyName, noteName, parseChord, QUALITIES, transposeChord } from '../music/theory';
import { askConfirm, reanalyse, select, splitAtPlayhead, toStoredChord, updateSegments, updateSettings, useApp, useCurrent } from '../state/app';
import { deleteSegment, editedCount, insertChordAt, mergeWithNext, renameSegment, setSegmentTimes, type Instrument, type Project } from '../state/project';
import { confidenceColor, fmtTime, useDisplay } from './util';

export function Inspector() {
  const p = useCurrent();
  if (!p) return <aside className="panel inspector" aria-label="Settings"><div className="insp-sec"><p className="hint">Settings for instruments, transposition and chord corrections appear here once a song is open.</p></div></aside>;
  return (
    <aside className="panel inspector" aria-label="Settings">
      <InstrumentSection p={p} />
      <TransposeSection p={p} />
      {p.status === 'ready' && <ChordSection p={p} />}
      {p.status === 'ready' && <AnalysisSection p={p} />}
    </aside>
  );
}

const INSTRUMENTS: { id: Instrument; label: string; icon: JSX.Element }[] = [
  { id: 'guitar', label: 'Guitar', icon: <Guitar size={14} /> },
  { id: 'ukulele', label: 'Ukulele', icon: <Music2 size={14} /> },
  { id: 'piano', label: 'Piano', icon: <Piano size={14} /> },
];

function InstrumentSection({ p }: { p: Project }) {
  const s = p.settings;
  const { show } = useDisplay(p);
  const capoSuggestion = useMemo(() => {
    if (s.instrument !== 'guitar' || s.guitarTuning !== 'standard' || !p.segments.length) return null;
    const chords = p.segments.map((x) => ({ name: show(x.chord), seconds: x.end - x.start })).filter((x) => x.name !== 'N.C.');
    if (!chords.length) return null;
    return suggestCapo(chords, 'guitar', (n, k) => transposeChord(n, k))[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.segments, s.instrument, s.guitarTuning, s.transpose, s.spelling]);
  return (
    <section className="insp-sec">
      <h3>Instrument</h3>
      <div className="seg" role="group" aria-label="Instrument">
        {INSTRUMENTS.map((i) => (
          <button key={i.id} aria-pressed={s.instrument === i.id} onClick={() => updateSettings({ instrument: i.id })}>{i.icon}{i.label}</button>
        ))}
      </div>
      {s.instrument === 'piano' ? (
        <div className="row"><label htmlFor="pv">Voicing</label>
          <select id="pv" className="select grow" style={{ maxWidth: 170 }} value={s.pianoVoicing} onChange={(e) => updateSettings({ pianoVoicing: e.target.value as PianoVoicingId })}>
            {PIANO_VOICINGS.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      ) : (
        <>
          <div className="row"><label htmlFor="tuning">Tuning</label>
            <select id="tuning" className="select grow" style={{ maxWidth: 180 }} value={s.instrument === 'guitar' ? s.guitarTuning : s.ukuleleTuning}
              onChange={(e) => updateSettings(s.instrument === 'guitar' ? { guitarTuning: e.target.value, capo: e.target.value === 'standard' ? s.capo : 0 } : { ukuleleTuning: e.target.value })}>
              {TUNINGS[s.instrument].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {s.instrument === 'guitar' && (
            <div className="row"><label>Capo</label>
              <div className="stepper">
                <button className="icon-btn boxed" aria-label="Lower capo" disabled={s.capo <= 0} onClick={() => updateSettings({ capo: s.capo - 1 })}><Minus size={13} /></button>
                <output className="tnum" aria-live="polite">{s.capo ? `Fret ${s.capo}` : 'None'}</output>
                <button className="icon-btn boxed" aria-label="Raise capo" disabled={s.capo >= 9} onClick={() => updateSettings({ capo: s.capo + 1 })}><Plus size={13} /></button>
              </div>
            </div>
          )}
          {capoSuggestion && capoSuggestion.capo !== s.capo && (
            <button className="chip" style={{ justifySelf: 'start' }} onClick={() => updateSettings({ capo: capoSuggestion.capo })}>
              <Sparkles size={12} /> Easiest shapes: {capoSuggestion.capo ? <>capo on fret <strong>{capoSuggestion.capo}</strong></> : <strong>no capo</strong>}
            </button>
          )}
          <div className="row"><label htmlFor="lh">Left-handed diagrams</label>
            <button id="lh" role="switch" aria-checked={s.leftHanded} className="toggle" onClick={() => updateSettings({ leftHanded: !s.leftHanded })} />
          </div>
        </>
      )}
    </section>
  );
}

function TransposeSection({ p }: { p: Project }) {
  const s = p.settings;
  const k = p.analysis?.key;
  const t = s.transpose;
  return (
    <section className="insp-sec">
      <h3>Transpose <small>{t === 0 ? 'Original key' : `${t > 0 ? '+' : ''}${t} semitone${Math.abs(t) === 1 ? '' : 's'}`}</small></h3>
      <div className="row">
        <div className="stepper">
          <button className="icon-btn boxed" aria-label="Transpose down a semitone" onClick={() => updateSettings({ transpose: Math.max(-11, t - 1) })}><Minus size={13} /></button>
          <output className="tnum" aria-live="polite">{t > 0 ? `+${t}` : t}</output>
          <button className="icon-btn boxed" aria-label="Transpose up a semitone" onClick={() => updateSettings({ transpose: Math.min(11, t + 1) })}><Plus size={13} /></button>
        </div>
        <button className="btn ghost sm" disabled={t === 0} onClick={() => updateSettings({ transpose: 0 })}><RotateCcw size={12} /> Reset</button>
      </div>
      {k && <div className="row"><span>Key</span><span style={{ color: 'var(--text)' }}>{t ? <>{keyName(k.tonic, k.mode)} → <b>{keyName(k.tonic, k.mode, t)}</b></> : keyName(k.tonic, k.mode)}</span></div>}
      <div className="row"><label>Spelling</label>
        <div className="seg" role="group" aria-label="Accidentals" style={{ width: 150 }}>
          {(['auto', 'sharps', 'flats'] as const).map((v) => <button key={v} aria-pressed={s.spelling === v} onClick={() => updateSettings({ spelling: v })}>{v === 'auto' ? 'Auto' : v === 'sharps' ? '♯' : '♭'}</button>)}
        </div>
      </div>
    </section>
  );
}

function ChordSection({ p }: { p: Project }) {
  const selectedId = useApp((s) => s.selectedId);
  const seg = p.segments.find((x) => x.id === selectedId);
  const { show, flats, transpose } = useDisplay(p);
  const k = p.analysis?.key;
  if (!seg) {
    return (
      <section className="insp-sec">
        <h3>Chord</h3>
        <p className="hint">Select a chord on the timeline to rename it, change its timing or remove it. Double-click a chord to type a new name.</p>
        <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => {
          const t = playback.get().time;
          const i = p.segments.findIndex((x) => t >= x.start && t < x.end);
          const base = i >= 0 ? p.segments[i].chord : 'C';
          updateSegments((s) => { const r = insertChordAt(s, t, base === 'N' ? 'C' : base); if (r.newId) setTimeout(() => select(r.newId), 0); return r.segments; });
        }}><PlusCircle size={13} /> Add chord at playhead</button>
      </section>
    );
  }
  const display = show(seg.chord);
  const parsed = parseChord(display);
  const setChord = (name: string) => updateSegments((s) => renameSegment(s, seg.id, toStoredChord(name, transpose)));
  const root = parsed?.root ?? -1;
  const suffix = parsed?.quality.suffix ?? '';
  const uncertain = seg.chord !== 'N' && seg.confidence < UNCERTAIN_THRESHOLD;
  const suggestions = k ? diatonicChords((k.tonic + transpose + 120) % 12, k.mode) : [];
  return (
    <section className="insp-sec" aria-label="Selected chord">
      <h3>Chord <small className="tnum">{fmtTime(seg.start, true)} – {fmtTime(seg.end, true)}</small></h3>
      <div className="sel-chord">
        <b>{display}</b>
        <span className="hint">{seg.edited ? 'Edited by you' : uncertain ? 'Uncertain detection' : 'Detected'}</span>
      </div>
      {!seg.edited && seg.chord !== 'N' && (
        <div>
          <div className="row" style={{ marginBottom: 4 }}><span>Confidence</span><span className="tnum" style={{ color: confidenceColor(seg.confidence) }}>{Math.round(seg.confidence * 100)}%</span></div>
          <div className="conf"><i style={{ width: `${seg.confidence * 100}%`, background: confidenceColor(seg.confidence) }} /></div>
        </div>
      )}
      {seg.alternatives && seg.alternatives.filter((a) => a.chord !== 'N').length > 0 && !seg.edited && (
        <div className="row" style={{ alignItems: 'flex-start' }}><span style={{ paddingTop: 3 }}>Could be</span>
          <div className="chips" style={{ justifyContent: 'flex-end' }}>
            {seg.alternatives.filter((a) => a.chord !== 'N').map((a) => <button key={a.chord} className="chip" onClick={() => setChord(show(a.chord))}><strong>{show(a.chord)}</strong> {Math.round(a.p * 100)}%</button>)}
          </div>
        </div>
      )}
      <div className="roots" role="group" aria-label="Root note">
        {Array.from({ length: 12 }, (_, r) => (
          <button key={r} aria-pressed={root === r} onClick={() => setChord(noteName(r, flats) + suffix)}>{noteName(r, flats)}</button>
        ))}
      </div>
      <div className="grid2">
        <select className="select" aria-label="Chord quality" value={parsed ? suffix : ''} disabled={!parsed} onChange={(e) => parsed && setChord(noteName(root, flats) + e.target.value)}>
          {EDITABLE_QUALITIES.map((q) => <option key={q} value={q}>{QUALITIES.find((x) => x.suffix === q)?.name}</option>)}
        </select>
        <button className="btn sm" aria-pressed={seg.chord === 'N'} onClick={() => setChord('N')}>No chord</button>
      </div>
      {suggestions.length > 0 && (
        <div className="chips" aria-label="Chords in this key">
          {suggestions.map((c) => <button key={c} className="chip" onClick={() => setChord(c)}>{c}</button>)}
        </div>
      )}
      <TimeEditor key={seg.id + seg.start + seg.end} p={p} id={seg.id} start={seg.start} end={seg.end} />
      <div className="grid2">
        <button className="btn sm" onClick={() => splitAtPlayhead(playback.get().time)} title="Split at the playhead (S)"><Scissors size={13} /> Split</button>
        <button className="btn sm" onClick={() => updateSegments((s) => mergeWithNext(s, seg.id))} disabled={p.segments[p.segments.length - 1]?.id === seg.id}><Merge size={13} /> Merge next</button>
        <button className="btn sm" onClick={() => { player.setLoop({ start: seg.start, end: seg.end }); void player.play(); }}><Repeat size={13} /> Loop chord</button>
        <button className="btn sm danger" onClick={() => { updateSegments((s) => deleteSegment(s, seg.id)); select(null); }} title="Remove (Delete)"><Trash2 size={13} /> Remove</button>
      </div>
    </section>
  );
}

function TimeEditor({ p, id, start, end }: { p: Project; id: string; start: number; end: number }) {
  const [a, setA] = useState(start.toFixed(2));
  const [b, setB] = useState(end.toFixed(2));
  const commit = () => {
    const s = Number(a); const e = Number(b);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) updateSegments((x) => setSegmentTimes(x, id, Math.max(0, s), Math.min(p.duration, e)));
  };
  return (
    <div className="time-inputs">
      <label>Starts (s)<input className="input tnum" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label>
      <label>Ends (s)<input className="input tnum" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} /></label>
    </div>
  );
}

function AnalysisSection({ p }: { p: Project }) {
  const a = p.analysis!;
  const [opts, setOpts] = useState<DecodeOptions>(p.settings.decode ?? DEFAULT_DECODE_OPTIONS);
  const busy = useApp((s) => !!s.progress[p.id]);
  const edits = editedCount(p.segments);
  const dirty = JSON.stringify(opts) !== JSON.stringify(a.options);
  const apply = async () => {
    if (edits && !(await askConfirm({ title: 'Replace your edits?', message: `Re-analysing replaces your ${edits} manual edit${edits === 1 ? '' : 's'}. You can undo this afterwards.`, confirmLabel: 'Re-analyse' }))) return;
    void reanalyse(opts);
  };
  return (
    <section className="insp-sec">
      <h3>Analysis</h3>
      <div className="row"><label htmlFor="vocab">Chord types</label>
        <select id="vocab" className="select grow" style={{ maxWidth: 170 }} value={opts.vocabulary} onChange={(e) => setOpts({ ...opts, vocabulary: e.target.value as DecodeOptions['vocabulary'] })}>
          <option value="majmin">Major and minor</option>
          <option value="extended">Add sevenths (beta)</option>
        </select>
      </div>
      <div className="row"><label htmlFor="smooth">Smoothing</label><span className="tnum">{opts.smoothing < 0.34 ? 'Responsive' : opts.smoothing < 0.67 ? 'Balanced' : 'Steady'}</span></div>
      <input id="smooth" className="range" type="range" min={0} max={1} step={0.05} value={opts.smoothing} onChange={(e) => setOpts({ ...opts, smoothing: Number(e.target.value) })} />
      <div className="row"><label htmlFor="minlen">Shortest chord</label><span className="tnum">{opts.minDuration.toFixed(1)} s</span></div>
      <input id="minlen" className="range" type="range" min={0.2} max={3} step={0.1} value={opts.minDuration} onChange={(e) => setOpts({ ...opts, minDuration: Number(e.target.value) })} />
      <button className="btn sm primary" disabled={!dirty || busy} onClick={() => void apply()}>{busy ? 'Re-analysing…' : 'Re-analyse with these settings'}</button>
      <dl className="kv">
        <dt>Engine</dt><dd>{a.engine} {a.engineVersion}</dd>
        <dt>Tuning offset</dt><dd className="tnum">{a.tuningCents > 0 ? '+' : ''}{a.tuningCents} cents</dd>
        <dt>Key confidence</dt><dd className="tnum">{Math.round(a.key.confidence * 100)}%</dd>
        <dt>Uncertain time</dt><dd className="tnum">{Math.round(a.uncertainShare * 100)}%</dd>
        <dt>Analysed in</dt><dd className="tnum">{(a.elapsedMs / 1000).toFixed(1)} s</dd>
        <dt>Manual edits</dt><dd className="tnum">{edits}</dd>
      </dl>
    </section>
  );
}
