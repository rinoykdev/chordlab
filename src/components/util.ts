import { useCallback } from 'react';
import { playback } from '../audio/player';
import { useStore } from '../state/store';
import { prefersFlats } from '../state/app';
import { segmentIndexAt, type Project } from '../state/project';
import { displayChord } from '../music/theory';

export function fmtTime(t: number, tenths = false): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Index of the segment under the playhead; re-renders only when it changes. */
export function useActiveIndex(p: Project | null): number {
  const segs = p?.segments;
  const sel = useCallback((s: { time: number }) => (segs ? segmentIndexAt(segs, s.time) : -1), [segs]);
  return useStore(playback, sel);
}

export function useDisplay(p: Project | null) {
  const flats = p ? prefersFlats(p) : false;
  const transpose = p?.settings.transpose ?? 0;
  return { flats, transpose, show: (name: string) => displayChord(name, transpose, flats) };
}

export const confidenceColor = (c: number) => (c >= 0.75 ? 'var(--ok)' : c >= 0.55 ? 'var(--cyan)' : 'var(--amber)');
