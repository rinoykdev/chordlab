/** Project model and pure chord-editing operations (unit-tested, no side effects). */
import { segmentId } from '../engine/decode';
import { DEFAULT_DECODE_OPTIONS, type AnalysisResult, type DecodeOptions, type Segment } from '../engine/types';
import type { PianoVoicingId } from '../music/piano';

export type Instrument = 'guitar' | 'ukulele' | 'piano';
export type Spelling = 'auto' | 'sharps' | 'flats';

export interface ProjectSettings {
  instrument: Instrument;
  guitarTuning: string;
  ukuleleTuning: string;
  pianoVoicing: PianoVoicingId;
  transpose: number;
  capo: number;
  spelling: Spelling;
  leftHanded: boolean;
  /** Chosen voicing index per instrument|tuning|chord. */
  voicingChoice: Record<string, number>;
  decode: DecodeOptions;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  instrument: 'guitar',
  guitarTuning: 'standard',
  ukuleleTuning: 'standard',
  pianoVoicing: 'root',
  transpose: 0,
  capo: 0,
  spelling: 'auto',
  leftHanded: false,
  voicingChoice: {},
  decode: DEFAULT_DECODE_OPTIONS,
};

export type ProjectStatus = 'decoding' | 'analysing' | 'ready' | 'error';

export interface Project {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  duration: number;
  status: ProjectStatus;
  error?: string;
  peaks?: Float32Array;
  analysis?: AnalysisResult;
  segments: Segment[];
  settings: ProjectSettings;
  /** True for the generated demo/self-test song. */
  synthetic?: boolean;
}

export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function titleFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
}

/** Index of the segment containing time t (binary search), or −1. */
export function segmentIndexAt(segments: Segment[], t: number): number {
  let lo = 0; let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return segments.length && t >= segments[segments.length - 1].end ? segments.length - 1 : -1;
}

const MIN_LEN = 0.1;

export function renameSegment(segments: Segment[], id: string, chord: string): Segment[] {
  return segments.map((s) => (s.id === id ? { ...s, chord, edited: true, confidence: 1, alternatives: s.alternatives } : s));
}

export function splitAt(segments: Segment[], t: number): { segments: Segment[]; newId: string | null } {
  const i = segmentIndexAt(segments, t);
  if (i < 0) return { segments, newId: null };
  const s = segments[i];
  if (t - s.start < MIN_LEN || s.end - t < MIN_LEN) return { segments, newId: null };
  const right: Segment = { ...s, id: segmentId(), start: t, edited: true };
  return { segments: [...segments.slice(0, i), { ...s, end: t }, right, ...segments.slice(i + 1)], newId: right.id };
}

/** Insert a chord starting at t (splits the current segment and renames the right part). */
export function insertChordAt(segments: Segment[], t: number, chord: string): { segments: Segment[]; newId: string | null } {
  const { segments: split, newId } = splitAt(segments, t);
  if (!newId) {
    const i = segmentIndexAt(segments, t);
    if (i < 0) return { segments, newId: null };
    return { segments: renameSegment(segments, segments[i].id, chord), newId: segments[i].id };
  }
  return { segments: renameSegment(split, newId, chord), newId };
}

/** Remove a segment; its time is absorbed by the previous segment (or the next, if first). */
export function deleteSegment(segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || segments.length < 2) return segments;
  const out = [...segments];
  const [gone] = out.splice(i, 1);
  if (i > 0) out[i - 1] = { ...out[i - 1], end: gone.end, edited: true };
  else out[0] = { ...out[0], start: gone.start, edited: true };
  return out;
}

export function mergeWithNext(segments: Segment[], id: string): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0 || i >= segments.length - 1) return segments;
  const out = [...segments];
  out.splice(i, 2, { ...segments[i], end: segments[i + 1].end, edited: true });
  return out;
}

/** Move the boundary between segments[i-1] and segments[i]. */
export function moveBoundary(segments: Segment[], i: number, t: number): Segment[] {
  if (i <= 0 || i >= segments.length) return segments;
  const prev = segments[i - 1];
  const cur = segments[i];
  const clamped = Math.max(prev.start + MIN_LEN, Math.min(cur.end - MIN_LEN, t));
  const out = [...segments];
  out[i - 1] = { ...prev, end: clamped, edited: true };
  out[i] = { ...cur, start: clamped, edited: true };
  return out;
}

export function setSegmentTimes(segments: Segment[], id: string, start: number, end: number): Segment[] {
  const i = segments.findIndex((s) => s.id === id);
  if (i < 0) return segments;
  let out = segments;
  if (i > 0 && Math.abs(start - segments[i].start) > 1e-6) out = moveBoundary(out, i, start);
  if (i < out.length - 1 && Math.abs(end - out[i].end) > 1e-6) out = moveBoundary(out, i + 1, end);
  return out;
}

export function editedCount(segments: Segment[]): number {
  return segments.filter((s) => s.edited).length;
}
