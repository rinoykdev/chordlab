/** Application state and actions. UI components read via useApp(selector) and call actions. */
import { checkFile, decodeBlob, encodeWav, AudioFileError, LONG_RECORDING_SECONDS } from '../audio/decode';
import { player, playback } from '../audio/player';
import { analyzeInBackground, redecodeInBackground } from '../engine/client';
import { DEFAULT_DECODE_OPTIONS, type DecodeOptions, type Segment } from '../engine/types';
import { bars, overlapAccuracy, synthesize, type SynthOptions } from '../engine/testing/synth';
import { canonicalChord, keyPrefersFlats, transposeChord } from '../music/theory';
import { db, requestPersistence } from './db';
import { activeProfile, loadTakes } from './teach';
import { DEFAULT_SETTINGS, newProjectId, splitAt, titleFromFile, type Project, type ProjectSettings } from './project';
import { createStore, useStore } from './store';

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface AppState {
  confirm: ConfirmRequest | null;
  projects: Project[];
  currentId: string | null;
  selectedId: string | null;
  progress: Record<string, { stage: string; fraction: number }>;
  pxPerSec: number;
  follow: boolean;
  past: Segment[][];
  future: Segment[][];
  toasts: Toast[];
  saveState: 'saved' | 'saving' | 'error';
  mobilePanel: 'library' | 'inspector';
  online: boolean;
  offlineReady: boolean;
  installPrompt: (Event & { prompt: () => Promise<void> }) | null;
  loaded: boolean;
  selfTest: { running: boolean; rows: { name: string; accuracy: number; expected: string; detected: string; ms: number }[] } | null;
}

export const app = createStore<AppState>({
  confirm: null,
  projects: [],
  currentId: null,
  selectedId: null,
  progress: {},
  pxPerSec: 60,
  follow: true,
  past: [],
  future: [],
  toasts: [],
  saveState: 'saved',
  mobilePanel: 'inspector',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  offlineReady: false,
  installPrompt: null,
  loaded: false,
  selfTest: null,
});

export const useApp = <S,>(sel: (s: AppState) => S, eq?: (a: S, b: S) => boolean) => useStore(app, sel, eq);

export function currentProject(): Project | null {
  const s = app.get();
  return s.projects.find((p) => p.id === s.currentId) ?? null;
}
export const useCurrent = () => useApp((s) => s.projects.find((p) => p.id === s.currentId) ?? null);

/* ---------- confirmation ---------- */
/** In-app replacement for window.confirm(), which sandboxed frames and some webviews silently block. */
export function askConfirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  app.get().confirm?.resolve(false);
  return new Promise((resolve) => app.set({ confirm: { ...opts, resolve } }));
}

export function answerConfirm(ok: boolean): void {
  const c = app.get().confirm;
  if (!c) return;
  app.set({ confirm: null });
  c.resolve(ok);
}

/* ---------- toasts ---------- */
let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4500): void {
  const id = toastId++;
  app.set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/* ---------- persistence ---------- */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleSave(p: Project, delay = 400): void {
  clearTimeout(saveTimers.get(p.id));
  app.set({ saveState: 'saving' });
  saveTimers.set(p.id, setTimeout(async () => {
    saveTimers.delete(p.id);
    const latest = app.get().projects.find((x) => x.id === p.id);
    if (!latest) return;
    try { await db.putProject(latest); app.set({ saveState: 'saved' }); }
    catch (e) { app.set({ saveState: 'error' }); toast(`Couldn’t save: ${(e as Error).message}`, 'error'); }
  }, delay));
}

function patchProject(id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>), save = true): void {
  let updated: Project | null = null;
  app.set((s) => ({
    projects: s.projects.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...(typeof patch === 'function' ? patch(p) : patch), updatedAt: Date.now() };
      return updated;
    }),
  }));
  if (save && updated) scheduleSave(updated);
}

/* ---------- lifecycle ---------- */
export async function init(): Promise<void> {
  void loadTakes();
  try {
    const projects = (await db.listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
    app.set({ projects, loaded: true });
    let last: string | null = null;
    try { last = localStorage.getItem('chordlab:last'); } catch { /* storage unavailable */ }
    const target = projects.find((p) => p.id === last) ?? projects[0];
    if (target) await openProject(target.id);
    // Analyses interrupted by a reload are restarted.
    for (const p of projects) if (p.status === 'decoding' || p.status === 'analysing') void resumeAnalysis(p.id);
  } catch (e) {
    app.set({ loaded: true });
    toast((e as Error).message, 'error', 8000);
  }
  window.addEventListener('online', () => app.set({ online: true }));
  window.addEventListener('offline', () => app.set({ online: false }));
}

export async function openProject(id: string): Promise<void> {
  const p = app.get().projects.find((x) => x.id === id);
  if (!p) return;
  app.set({ currentId: id, selectedId: null, past: [], future: [] });
  try { localStorage.setItem('chordlab:last', id); } catch { /* ignore */ }
  const blob = await db.getAudio(id).catch(() => undefined);
  if (app.get().currentId !== id) return;
  if (blob) player.load(blob, p.duration);
  else { player.unload(); if (p.status !== 'error') toast('The audio for this project is missing from local storage.', 'error'); }
}

async function resumeAnalysis(id: string): Promise<void> {
  const blob = await db.getAudio(id).catch(() => undefined);
  if (blob) await runAnalysis(id, blob);
  else patchProject(id, { status: 'error', error: 'The audio was not saved before the page closed. Import the file again.' });
}

export async function importFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files);
  if (!list.length) return;
  void requestPersistence();
  for (const file of list) {
    try { checkFile(file); } catch (e) { toast((e as Error).message, 'error', 7000); continue; }
    await importBlob(file, file.name, file.type);
  }
}

async function importBlob(blob: Blob, name: string, type: string, synthetic = false, title?: string): Promise<string> {
  const id = newProjectId();
  let settings: ProjectSettings = DEFAULT_SETTINGS;
  try {
    const inst = localStorage.getItem('chordlab:instrument') as ProjectSettings['instrument'] | null;
    if (inst) settings = { ...settings, instrument: inst };
  } catch { /* ignore */ }
  const project: Project = {
    id, title: title ?? titleFromFile(name), fileName: name, mimeType: type || 'audio/*', size: blob.size,
    createdAt: Date.now(), updatedAt: Date.now(), duration: 0, status: 'decoding', segments: [], settings, synthetic,
  };
  app.set((s) => ({ projects: [project, ...s.projects] }));
  try {
    await db.putAudio(id, blob);
    await db.putProject(project);
  } catch (e) {
    toast(`Couldn’t store “${name}” locally: ${(e as Error).message}`, 'error', 8000);
  }
  await openProject(id);
  await runAnalysis(id, blob);
  return id;
}

export async function runAnalysis(id: string, blob: Blob): Promise<void> {
  const setProgress = (stage: string, fraction: number) => app.set((s) => ({ progress: { ...s.progress, [id]: { stage, fraction } } }));
  const clearProgress = () => app.set((s) => { const { [id]: _, ...rest } = s.progress; return { progress: rest }; });
  patchProject(id, { status: 'decoding', error: undefined });
  setProgress('Decoding audio', 0.02);
  try {
    const decoded = await decodeBlob(blob);
    if (decoded.duration > LONG_RECORDING_SECONDS) toast(`This is a long recording (${Math.round(decoded.duration / 60)} min). Analysis runs in the background and may take a while.`, 'info', 7000);
    patchProject(id, { status: 'analysing', duration: decoded.duration, peaks: decoded.peaks });
    if (app.get().currentId === id && playback.get().duration === 0) playback.set({ duration: decoded.duration });
    const options = app.get().projects.find((p) => p.id === id)?.settings.decode ?? DEFAULT_DECODE_OPTIONS;
    const { result, features } = await analyzeInBackground(decoded.samples, decoded.sampleRate, options, (stage, f) => setProgress(stage, 0.1 + f * 0.9), activeProfile());
    await db.putFeatures(id, features).catch(() => undefined);
    patchProject(id, { status: 'ready', analysis: result, segments: result.segments, duration: result.duration });
    const p = app.get().projects.find((x) => x.id === id);
    if (p && result.uncertainShare > 0.35) toast(`Analysis finished, but ${Math.round(result.uncertainShare * 100)}% of the song is uncertain. Dashed chords need checking.`, 'info', 7000);
    else toast(`Found ${result.segments.filter((s) => s.chord !== 'N').length} chord changes in “${p?.title}”.`, 'success');
  } catch (e) {
    const msg = e instanceof AudioFileError ? e.message : `Analysis failed: ${(e as Error).message}`;
    patchProject(id, { status: 'error', error: msg });
    toast(msg, 'error', 8000);
  } finally {
    clearProgress();
  }
}

export async function retryAnalysis(id: string): Promise<void> {
  const blob = await db.getAudio(id).catch(() => undefined);
  if (!blob) { toast('The audio is no longer stored. Import the file again.', 'error'); return; }
  await runAnalysis(id, blob);
}

export async function confirmAndDelete(id: string): Promise<void> {
  const p = app.get().projects.find((x) => x.id === id);
  if (!p) return;
  const ok = await askConfirm({ title: 'Delete this song?', message: `“${p.title}”, its audio and your chord edits will be removed from this device. This can’t be undone.`, confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  await deleteProject(id);
  toast(`Deleted “${p.title}”.`, 'success');
}

export async function deleteProject(id: string): Promise<void> {
  if (app.get().currentId === id) { player.unload(); app.set({ currentId: null, selectedId: null }); }
  app.set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  await db.deleteProject(id).catch((e) => toast(`Couldn’t delete: ${(e as Error).message}`, 'error'));
}

export function renameProject(id: string, title: string): void {
  patchProject(id, { title: title.trim() || 'Untitled' });
}

/* ---------- editing ---------- */
export function updateSegments(fn: (s: Segment[]) => Segment[], record = true): void {
  const p = currentProject();
  if (!p) return;
  const next = fn(p.segments);
  if (next === p.segments) return;
  if (record) app.set((s) => ({ past: [...s.past.slice(-99), p.segments], future: [] }));
  patchProject(p.id, { segments: next });
}

/** Split the chord under the playhead, explaining when that isn't possible. */
export function splitAtPlayhead(t: number): void {
  const p = currentProject();
  if (!p) return;
  const { segments, newId } = splitAt(p.segments, t);
  if (!newId) { toast('Move the playhead inside a chord, at least 0.1 s from its edges, to split it.'); return; }
  updateSegments(() => segments);
  select(newId);
}

/** Start a continuous edit (e.g. dragging a boundary): records one undo step up front. */
export function beginEdit(): void {
  const p = currentProject();
  if (p) app.set((s) => ({ past: [...s.past.slice(-99), p.segments], future: [] }));
}

export function undo(): void {
  const p = currentProject();
  const { past } = app.get();
  if (!p || !past.length) return;
  app.set((s) => ({ past: s.past.slice(0, -1), future: [p.segments, ...s.future] }));
  patchProject(p.id, { segments: past[past.length - 1] });
}

export function redo(): void {
  const p = currentProject();
  const { future } = app.get();
  if (!p || !future.length) return;
  app.set((s) => ({ future: s.future.slice(1), past: [...s.past, p.segments] }));
  patchProject(p.id, { segments: future[0] });
}

export function select(id: string | null): void { app.set({ selectedId: id }); }

export function updateSettings(patch: Partial<ProjectSettings>): void {
  const p = currentProject();
  if (!p) return;
  if (patch.instrument) { try { localStorage.setItem('chordlab:instrument', patch.instrument); } catch { /* ignore */ } }
  patchProject(p.id, { settings: { ...p.settings, ...patch } });
}

/** Re-run the cheap decoding stages with new analysis settings. Replaces manual edits. */
export async function reanalyse(options: DecodeOptions): Promise<void> {
  const p = currentProject();
  if (!p) return;
  const features = await db.getFeatures(p.id).catch(() => undefined);
  if (!features) { await retryAnalysis(p.id); return; }
  app.set((s) => ({ progress: { ...s.progress, [p.id]: { stage: 'Decoding chords', fraction: 0.5 } } }));
  try {
    const result = await redecodeInBackground(features, options, activeProfile());
    app.set((s) => ({ past: [...s.past.slice(-99), p.segments], future: [] }));
    patchProject(p.id, { analysis: { ...result, tempo: p.analysis?.tempo ?? result.tempo }, segments: result.segments, settings: { ...p.settings, decode: options } });
    toast(`Re-analysed: ${result.segments.filter((s) => s.chord !== 'N').length} chord changes. Undo restores your previous chords.`, 'success');
  } catch (e) {
    toast(`Re-analysis failed: ${(e as Error).message}`, 'error');
  } finally {
    app.set((s) => { const { [p.id]: _, ...rest } = s.progress; return { progress: rest }; });
  }
}

export function setTempo(bpm: number): void {
  const p = currentProject();
  if (!p?.analysis) return;
  patchProject(p.id, { analysis: { ...p.analysis, tempo: { ...p.analysis.tempo, bpm: Math.round(bpm * 10) / 10 } } });
}

/** Whether chord names should be spelled with flats for the current (transposed) key. */
export function prefersFlats(p: Project): boolean {
  if (p.settings.spelling !== 'auto') return p.settings.spelling === 'flats';
  const k = p.analysis?.key;
  if (!k) return false;
  return keyPrefersFlats((k.tonic + p.settings.transpose + 120) % 12, k.mode);
}

/** Convert a chord typed in the transposed (display) key back to stored canonical form. */
export function toStoredChord(displayName: string, transpose: number): string {
  if (displayName === 'N' || displayName === 'N.C.') return 'N';
  return canonicalChord(transposeChord(displayName, -transpose));
}

/* ---------- demo + self-test ---------- */
const DEMO = { chords: 'C G Am F C G Am F Am F C G Dm G C C', bpm: 96 };

export async function createDemo(): Promise<void> {
  const { samples, sampleRate } = synthesize(bars(DEMO.chords, DEMO.bpm), { sampleRate: 22050, bass: true, melody: true, drumsBpm: DEMO.bpm, inversion: 1, noise: 0.01, leadIn: 1 });
  await importBlob(encodeWav(samples, sampleRate), 'demo-progression.wav', 'audio/wav', true, 'Demo: synthetic progression in C');
}

const SELF_TESTS: { name: string; chords: string; bpm: number; opts: SynthOptions }[] = [
  { name: 'All 24 triads', chords: 'C C# D D# E F F# G G# A A# B Cm C#m Dm D#m Em Fm F#m Gm G#m Am A#m Bm', bpm: 120, opts: { bass: true } },
  { name: 'Pop progression + drums', chords: 'G D Em C G D Em C', bpm: 110, opts: { bass: true, drumsBpm: 110, melody: true } },
  { name: 'Minor key, inverted', chords: 'Am Dm E Am F G E Am', bpm: 90, opts: { inversion: 1 } },
  { name: 'Noisy and detuned', chords: 'D Bm G A F#m Bm Em A', bpm: 100, opts: { bass: true, noise: 0.08, detuneCents: -30 } },
];

export async function runSelfTest(): Promise<void> {
  app.set({ selfTest: { running: true, rows: [] } });
  for (const t of SELF_TESTS) {
    const { samples, sampleRate, truth } = synthesize(bars(t.chords, t.bpm, 3), { sampleRate: 22050, ...t.opts });
    const t0 = performance.now();
    try {
      const { result } = await analyzeInBackground(samples, sampleRate, DEFAULT_DECODE_OPTIONS);
      const row = {
        name: t.name,
        accuracy: overlapAccuracy(result.segments, truth, 0.2),
        expected: truth.map((x) => x.chord).join(' '),
        detected: result.segments.filter((s) => s.chord !== 'N').map((s) => s.chord).join(' '),
        ms: performance.now() - t0,
      };
      app.set((s) => ({ selfTest: { running: true, rows: [...(s.selfTest?.rows ?? []), row] } }));
    } catch (e) {
      app.set((s) => ({ selfTest: { running: true, rows: [...(s.selfTest?.rows ?? []), { name: t.name, accuracy: 0, expected: t.chords, detected: `Error: ${(e as Error).message}`, ms: 0 }] } }));
    }
  }
  app.set((s) => ({ selfTest: s.selfTest ? { ...s.selfTest, running: false } : null }));
}
