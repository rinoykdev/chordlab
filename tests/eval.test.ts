import { describe, expect, it } from 'vitest';
import { harteToMajMin } from '../scripts/eval-real';

describe('real-recording harness: Harte label reduction', () => {
  it('maps labels to the major/minor vocabulary and excludes others', () => {
    expect(harteToMajMin('C:maj')).toBe('C');
    expect(harteToMajMin('Bb:min7')).toBe('A#m');
    expect(harteToMajMin('F#:7/3')).toBe('F#');
    expect(harteToMajMin('E')).toBe('E');
    expect(harteToMajMin('N')).toBe('N');
    expect(harteToMajMin('G:dim')).toBeNull();
    expect(harteToMajMin('D:sus4(b7)')).toBeNull();
    expect(harteToMajMin('X')).toBeNull();
  });
});
