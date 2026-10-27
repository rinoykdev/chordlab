import { describe, expect, it } from 'vitest';
import { deleteSegment, insertChordAt, mergeWithNext, moveBoundary, renameSegment, segmentIndexAt, setSegmentTimes, splitAt } from '../src/state/project';
import type { Segment } from '../src/engine/types';

const segs = (): Segment[] => [
  { id: 'a', start: 0, end: 2, chord: 'C', confidence: 0.9 },
  { id: 'b', start: 2, end: 4, chord: 'G', confidence: 0.4 },
  { id: 'c', start: 4, end: 6, chord: 'Am', confidence: 0.8 },
];
const contiguous = (s: Segment[]) => s.every((x, i) => i === 0 || Math.abs(x.start - s[i - 1].end) < 1e-9);

describe('chord editing', () => {
  it('finds the segment at a time', () => {
    expect(segmentIndexAt(segs(), 0)).toBe(0);
    expect(segmentIndexAt(segs(), 2)).toBe(1);
    expect(segmentIndexAt(segs(), 5.99)).toBe(2);
    expect(segmentIndexAt(segs(), 6)).toBe(2);
    expect(segmentIndexAt([], 1)).toBe(-1);
  });
  it('renames and marks as edited with full confidence', () => {
    const s = renameSegment(segs(), 'b', 'Em');
    expect(s[1]).toMatchObject({ chord: 'Em', edited: true, confidence: 1 });
  });
  it('splits, inserts, deletes and merges while staying contiguous', () => {
    const { segments: s1, newId } = splitAt(segs(), 3);
    expect(s1).toHaveLength(4);
    expect(newId).not.toBeNull();
    expect(contiguous(s1)).toBe(true);
    const { segments: s2 } = insertChordAt(segs(), 1, 'F');
    expect(s2.map((s) => s.chord)).toEqual(['C', 'F', 'G', 'Am']);
    const s3 = deleteSegment(segs(), 'b');
    expect(s3.map((s) => [s.chord, s.start, s.end])).toEqual([['C', 0, 4], ['Am', 4, 6]]);
    const s4 = deleteSegment(segs(), 'a');
    expect(s4[0]).toMatchObject({ chord: 'G', start: 0 });
    const s5 = mergeWithNext(segs(), 'a');
    expect(s5.map((s) => [s.chord, s.end])).toEqual([['C', 4], ['Am', 6]]);
    expect(splitAt(segs(), 0.05).newId).toBeNull();
  });
  it('moves boundaries with clamping', () => {
    const s = moveBoundary(segs(), 1, 2.5);
    expect(s[0].end).toBe(2.5);
    expect(s[1].start).toBe(2.5);
    const clamped = moveBoundary(segs(), 1, 10);
    expect(clamped[1].start).toBeCloseTo(3.9);
    const t = setSegmentTimes(segs(), 'b', 1.5, 4.5);
    expect([t[0].end, t[1].start, t[1].end, t[2].start]).toEqual([1.5, 1.5, 4.5, 4.5]);
    expect(contiguous(t)).toBe(true);
  });
});
