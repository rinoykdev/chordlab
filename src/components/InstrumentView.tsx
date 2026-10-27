import { ChevronLeft, ChevronRight, Volume2 } from 'lucide-react';
import { auditionNotes } from '../audio/audition';
import { TUNINGS, voicingsFor } from '../music/fretted';
import { pianoVoicing, PIANO_VOICINGS } from '../music/piano';
import { parseChord, transposeChord } from '../music/theory';
import { updateSettings } from '../state/app';
import type { Project } from '../state/project';
import { FretDiagram, PianoKeyboard } from './Diagrams';

/** Diagram for one display chord on the project's selected instrument. */
export function InstrumentView({ project, chord, flats }: { project: Project; chord: string; flats: boolean }) {
  const s = project.settings;
  const playable = chord !== 'N.C.' && parseChord(chord) !== null;

  if (s.instrument === 'piano') {
    const v = playable ? pianoVoicing(chord, s.pianoVoicing) : null;
    return (
      <div className="diagram-card">
        <div className="diagram-head">
          <span>Piano · {PIANO_VOICINGS.find((x) => x.id === s.pianoVoicing)?.name}</span>
          <button className="icon-btn" aria-label="Hear this chord" disabled={!v} onClick={() => v && auditionNotes([...v.left, ...v.right], 'block')}><Volume2 size={15} /></button>
        </div>
        <div className="diagram-body">
          <PianoKeyboard right={v?.right ?? []} left={v?.left ?? []} flats={flats} onKey={(m) => auditionNotes([m], 'block')} />
        </div>
        <div className="diagram-foot">{v ? <>Right hand in violet{v.left.length ? ', left hand in cyan' : ''}. Tap a key to hear it.</> : 'No chord to show here.'}</div>
      </div>
    );
  }

  const inst = s.instrument;
  const tuningId = inst === 'guitar' ? s.guitarTuning : s.ukuleleTuning;
  const tuning = TUNINGS[inst].find((t) => t.id === tuningId) ?? TUNINGS[inst][0];
  const capo = inst === 'guitar' ? s.capo : 0;
  const shape = playable ? (capo ? transposeChord(chord, -capo, flats) : chord) : '';
  const voicings = playable ? voicingsFor(shape, inst, tuning.id) : [];
  const key = `${inst}|${tuning.id}|${shape}`;
  const idx = Math.min(s.voicingChoice[key] ?? 0, Math.max(0, voicings.length - 1));
  const v = voicings[idx];
  const choose = (d: number) => updateSettings({ voicingChoice: { ...s.voicingChoice, [key]: (idx + d + voicings.length) % voicings.length } });
  const midis = v ? v.frets.map((f, i) => (f < 0 ? -1 : tuning.notes[i] + f + capo)).filter((m) => m >= 0) : [];
  return (
    <div className="diagram-card">
      <div className="diagram-head">
        <span>{inst === 'guitar' ? 'Guitar' : 'Ukulele'}{capo ? ` · ${shape} shape` : ''}</span>
        <div className="vnav">
          <button className="icon-btn" aria-label="Previous voicing" disabled={voicings.length < 2} onClick={() => choose(-1)}><ChevronLeft size={15} /></button>
          <span className="tnum" aria-live="polite">{voicings.length ? `${idx + 1}/${voicings.length}` : '–'}</span>
          <button className="icon-btn" aria-label="Next voicing" disabled={voicings.length < 2} onClick={() => choose(1)}><ChevronRight size={15} /></button>
          <button className="icon-btn" aria-label="Hear this voicing" disabled={!v} onClick={() => auditionNotes(midis.sort((a, b) => a - b), 'strum')}><Volume2 size={15} /></button>
        </div>
      </div>
      <div className="diagram-body">
        {v ? <FretDiagram voicing={v} labels={tuning.labels} leftHanded={s.leftHanded} capo={capo} title={`${chord} on ${inst}`} /> : <span className="hint">{playable ? 'No playable shape found in this tuning.' : 'No chord here. Let it ring or rest.'}</span>}
      </div>
      <div className="diagram-foot">{v ? `${v.difficulty === 'easy' ? 'Beginner friendly' : v.difficulty === 'medium' ? 'Intermediate' : 'Barre chord'}${v.barre ? `, barre at fret ${v.barre.fret}` : ''}` : ''}</div>
    </div>
  );
}
