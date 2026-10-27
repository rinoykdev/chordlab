/** Teach Chordlab: stored takes, the learned profile and whether analysis uses it. */
import { decodeBlob } from '../audio/decode';
import { resample } from '../engine/dsp';
import { ANALYSIS_RATE, extractFeatures } from '../engine/features';
import { buildProfile, checkTake, chordLabel, clipChroma, evaluate, type Evaluation, type LearnedProfile, type TakeCheck } from '../engine/learn';
import { db } from './db';
import { createStore, useStore } from './store';

export interface TeachTake {
  id: string;
  root: number;
  suffix: string;
  style: 'strum' | 'pick';
  source: 'mic' | 'file';
  createdAt: number;
  /** Root-agnostic chroma of the take (absolute pitch classes, L2-normalised). */
  chroma: number[];
  /** Mono audio at the analysis rate, kept so takes can be replayed and re-analysed later. */
  audio: Float32Array;
  sampleRate: number;
  /** Set when the take was kept despite not matching the requested chord. */
  forced?: boolean;
}

interface TeachState {
  open: boolean;
  loaded: boolean;
  takes: TeachTake[];
  enabled: boolean;
  profile: LearnedProfile | null;
  evaluation: Evaluation | null;
}

const readEnabled = () => { try { return localStorage.getItem('chordlab:profile') === 'on'; } catch { return false; } };

export const teach = createStore<TeachState>({ open: false, loaded: false, takes: [], enabled: readEnabled(), profile: null, evaluation: null });
export const useTeach = <S,>(sel: (s: TeachState) => S) => useStore(teach, sel);

function recompute(takes: TeachTake[]) {
  const examples = takes.map((t) => ({ root: t.root, suffix: t.suffix, chroma: t.chroma }));
  const profile = takes.length ? buildProfile(examples) : null;
  teach.set({ takes, profile: profile?.templates.length ? profile : null, evaluation: takes.length >= 2 ? evaluate(examples) : null });
}

export async function loadTakes(): Promise<void> {
  try { recompute((await db.listTakes()).sort((a, b) => a.createdAt - b.createdAt)); } catch { /* storage unavailable */ }
  teach.set({ loaded: true });
}

/** The profile analysis should use right now, if any. */
export function activeProfile(): LearnedProfile | undefined {
  const s = teach.get();
  return s.enabled && s.profile ? s.profile : undefined;
}

export function setProfileEnabled(on: boolean): void {
  try { localStorage.setItem('chordlab:profile', on ? 'on' : 'off'); } catch { /* ignore */ }
  teach.set({ enabled: on });
}

export const openTeach = () => { teach.set({ open: true }); if (!teach.get().loaded) void loadTakes(); };
export const closeTeach = () => teach.set({ open: false });

export interface AnalysedTake { chroma: number[]; audio: Float32Array; check: TakeCheck; rms: number }

export class TakeError extends Error {}

/** Turn raw audio into a take candidate and check it against the requested chord. */
export function analyseTake(samples: Float32Array, sampleRate: number, root: number, suffix: string, maxSeconds = 8): AnalysedTake {
  let x = sampleRate === ANALYSIS_RATE ? samples : resample(samples, sampleRate, ANALYSIS_RATE);
  if (x.length > maxSeconds * ANALYSIS_RATE) x = x.slice(0, maxSeconds * ANALYSIS_RATE);
  let s = 0;
  for (const v of x) s += v * v;
  const rms = Math.sqrt(s / Math.max(1, x.length));
  if (x.length < ANALYSIS_RATE * 1.2) throw new TakeError('The recording is too short. Let the chord ring for at least two seconds.');
  if (rms < 0.003) throw new TakeError('That was too quiet to use. Move the guitar closer to the microphone, or play a little louder.');
  const chroma = clipChroma(extractFeatures(x, ANALYSIS_RATE));
  if (!chroma) throw new TakeError('No chord could be heard in that take. Let the strings ring after you play.');
  return { chroma, audio: x, check: checkTake(chroma, root, suffix), rms };
}

export async function analyseTakeFile(file: Blob, root: number, suffix: string): Promise<AnalysedTake> {
  const d = await decodeBlob(file);
  return analyseTake(d.samples, d.sampleRate, root, suffix);
}

export async function saveTake(t: Omit<TeachTake, 'id' | 'createdAt' | 'sampleRate'>): Promise<void> {
  const take: TeachTake = { ...t, id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now(), sampleRate: ANALYSIS_RATE };
  await db.putTake(take);
  recompute([...teach.get().takes, take]);
}

export async function deleteTake(id: string): Promise<void> {
  await db.deleteTake(id);
  recompute(teach.get().takes.filter((t) => t.id !== id));
}

export async function clearTakes(): Promise<void> {
  await db.clearTakes();
  recompute([]);
  setProfileEnabled(false);
}

export const takeLabel = (t: { root: number; suffix: string }) => chordLabel(t.root, t.suffix);
