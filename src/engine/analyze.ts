/** Pipeline orchestration. `analyzeAudio` runs every stage; `decodeFeatures` re-runs only the
 * cheap stages so analysis settings can change instantly without touching the audio again. */
import { extractFeatures } from './features';
import { segmentPath, switchPenalty, viterbi } from './decode';
import { estimateKey } from './key';
import { estimateTempo } from './tempo';
import { templateRecognizer } from './recognizers/template';
import type { ChordRecognizer } from './recognizers/types';
import { buildVocabulary } from './vocabulary';
import {
  DEFAULT_DECODE_OPTIONS,
  type AnalysisResult,
  type DecodeOptions,
  type Features,
  type ProgressFn,
  type TempoEstimate,
} from './types';

export const ENGINE_VERSION = '1.0.0';

export async function decodeFeatures(
  features: Features,
  options: DecodeOptions = DEFAULT_DECODE_OPTIONS,
  recognizer: ChordRecognizer = templateRecognizer,
  tempo?: TempoEstimate,
): Promise<AnalysisResult> {
  const t0 = performance.now();
  const vocab = buildVocabulary(options.vocabulary, recognizer.extraSuffixes);
  const scores = await recognizer.frameScores({ features, vocab });
  const path = viterbi(scores, features.nFrames, vocab.length, switchPenalty(options.smoothing));
  const { segments, uncertainShare } = segmentPath(path, scores, features, vocab, options);
  return {
    engine: recognizer.id,
    engineVersion: `${ENGINE_VERSION}/${recognizer.version}`,
    options,
    duration: features.duration,
    segments,
    key: estimateKey(features, segments),
    tempo: tempo ?? estimateTempo(features),
    tuningCents: Math.round(features.tuningCents * 10) / 10,
    uncertainShare,
    elapsedMs: performance.now() - t0,
  };
}

export async function analyzeAudio(
  samples: Float32Array,
  sampleRate: number,
  options: DecodeOptions = DEFAULT_DECODE_OPTIONS,
  onProgress?: ProgressFn,
  recognizer: ChordRecognizer = templateRecognizer,
): Promise<{ features: Features; result: AnalysisResult }> {
  const t0 = performance.now();
  if (samples.length < sampleRate * 0.5) throw new Error('The recording is shorter than half a second, which is too short to analyse.');
  let finite = true;
  for (let i = 0; i < samples.length; i += 97) if (!Number.isFinite(samples[i])) { finite = false; break; }
  if (!finite) throw new Error('The decoded audio contains invalid samples. The file may be corrupted.');
  const features = extractFeatures(samples, sampleRate, onProgress);
  onProgress?.('Estimating tempo', 0.92);
  const tempo = estimateTempo(features);
  onProgress?.('Decoding chords', 0.95);
  const result = await decodeFeatures(features, options, recognizer, tempo);
  result.elapsedMs = performance.now() - t0;
  onProgress?.('Done', 1);
  return { features, result };
}
