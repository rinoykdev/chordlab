/** Shared types for the analysis engine. Kept free of DOM/React imports so the
 * engine runs identically in a Web Worker, on the main thread and in Node tests. */

export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type Vocabulary = 'majmin' | 'extended';

/** Frame-level features. All matrices are row-major: frame * 12 + pitchClass. */
export interface Features {
  /** Analysis sample rate after resampling. */
  sampleRate: number;
  /** Seconds between chroma frames. */
  hopSeconds: number;
  /** Seconds covered by one analysis window. */
  windowSeconds: number;
  duration: number;
  nFrames: number;
  /** Treble/mid chroma (≈ 130 Hz – 2 kHz). L2-normalised per frame, 0 for silent frames. */
  chroma: Float32Array;
  /** Bass chroma (≈ 50 – 190 Hz). L2-normalised per frame. */
  bass: Float32Array;
  /** Frame loudness in dBFS. */
  loudness: Float32Array;
  /** Estimated deviation from A440 in cents (−50..50). */
  tuningCents: number;
  /** Onset-strength envelope used for tempo estimation. */
  onset: Float32Array;
  onsetRate: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  /** Chord symbol in canonical sharp spelling, e.g. "C", "F#m", "A7". "N" = no chord. */
  chord: string;
  /** 0..1 — mean posterior of the chosen label across the segment. */
  confidence: number;
  /** Runner-up labels with their relative probability. */
  alternatives?: { chord: string; p: number }[];
  /** True once a person has changed this segment. */
  edited?: boolean;
}

export interface KeyEstimate {
  tonic: number;
  mode: 'major' | 'minor';
  /** e.g. "C major", "F# minor" (canonical sharps; UI re-spells). */
  name: string;
  confidence: number;
}

export interface TempoEstimate {
  bpm: number;
  confidence: number;
}

export interface DecodeOptions {
  vocabulary: Vocabulary;
  /** 0 (responsive) .. 1 (very smooth). */
  smoothing: number;
  /** Segments shorter than this (seconds) are merged into neighbours. */
  minDuration: number;
}

export const DEFAULT_DECODE_OPTIONS: DecodeOptions = {
  vocabulary: 'majmin',
  smoothing: 0.5,
  minDuration: 0.6,
};

export interface AnalysisResult {
  engine: string;
  engineVersion: string;
  options: DecodeOptions;
  duration: number;
  segments: Segment[];
  key: KeyEstimate;
  tempo: TempoEstimate;
  tuningCents: number;
  /** Fraction of non-silent frames whose chosen label is uncertain. */
  uncertainShare: number;
  elapsedMs: number;
}

export type ProgressFn = (stage: string, fraction: number) => void;

/** Below this segment confidence the UI marks a chord as uncertain. */
export const UNCERTAIN_THRESHOLD = 0.55;
