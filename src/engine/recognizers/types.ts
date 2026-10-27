import type { Features } from '../types';
import type { VocabEntry } from '../vocabulary';

/**
 * A recognizer turns features into per-frame scores (log-likelihood-like, higher = better)
 * for each vocabulary label. The HMM decoder, segmentation, key and tempo stages are shared,
 * so a pretrained model (e.g. ONNX/TF.js) only needs to implement this interface.
 * Models that want raw audio receive it via `audio`.
 */
export interface ChordRecognizer {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  /** Chord types beyond the chosen vocabulary that this recognizer can score (e.g. learned sus4). */
  readonly extraSuffixes?: string[];
  frameScores(input: {
    features: Features;
    vocab: VocabEntry[];
    audio?: { samples: Float32Array; sampleRate: number };
  }): Float32Array | Promise<Float32Array>;
}
