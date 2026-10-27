/** Analysis runs here so long recordings never block the interface. */
import { analyzeAudio, decodeFeatures } from './analyze';
import { createProfileRecognizer, type LearnedProfile } from './learn';
import { templateRecognizer } from './recognizers/template';
import type { DecodeOptions, Features } from './types';

export type WorkerRequest =
  | { type: 'ping'; id: number }
  | { type: 'analyze'; id: number; samples: Float32Array; sampleRate: number; options: DecodeOptions; profile?: LearnedProfile }
  | { type: 'decode'; id: number; features: Features; options: DecodeOptions; profile?: LearnedProfile };

export type WorkerResponse =
  | { type: 'pong'; id: number }
  | { type: 'progress'; id: number; stage: string; fraction: number }
  | { type: 'result'; id: number; result: import('./types').AnalysisResult; features?: Features }
  | { type: 'error'; id: number; message: string };

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'ping') { ctx.postMessage({ type: 'pong', id: msg.id }); return; }
  try {
    const recognizer = msg.profile?.templates.length ? createProfileRecognizer(msg.profile) : templateRecognizer;
    if (msg.type === 'analyze') {
      let last = 0;
      const { features, result } = await analyzeAudio(msg.samples, msg.sampleRate, msg.options, (stage, fraction) => {
        const now = performance.now();
        if (now - last > 80 || fraction >= 1) { last = now; ctx.postMessage({ type: 'progress', id: msg.id, stage, fraction } satisfies WorkerResponse); }
      }, recognizer);
      const transfer = [features.chroma.buffer, features.bass.buffer, features.loudness.buffer, features.onset.buffer] as ArrayBuffer[];
      ctx.postMessage({ type: 'result', id: msg.id, result, features } satisfies WorkerResponse, transfer);
    } else {
      const result = await decodeFeatures(msg.features, msg.options, recognizer);
      ctx.postMessage({ type: 'result', id: msg.id, result } satisfies WorkerResponse);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
