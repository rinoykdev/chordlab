/** Main-thread facade over the analysis worker, with an in-thread fallback. */
import type { AnalysisResult, DecodeOptions, Features, ProgressFn } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

type Pending = { resolve: (v: { result: AnalysisResult; features?: Features }) => void; reject: (e: Error) => void; onProgress?: ProgressFn };

let ready: Promise<Worker | null> | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

async function createWorker(): Promise<Worker> {
  if (import.meta.env.VITE_SINGLE === '1') {
    const { default: InlineWorker } = await import('./worker?worker&inline');
    return new InlineWorker();
  }
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Start the worker and confirm it answers before trusting it with audio. Some hosts block
 * workers (content-security policy); then analysis runs on the main thread instead.
 */
function getWorker(): Promise<Worker | null> {
  if (workerFailed) return Promise.resolve(null);
  if (ready) return ready;
  ready = (async () => {
    let w: Worker;
    try { w = await createWorker(); } catch { workerFailed = true; return null; }
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => { if (e.data?.type === 'pong') { clearTimeout(timer); resolve(true); } };
      w.onerror = () => { clearTimeout(timer); resolve(false); };
      try { w.postMessage({ type: 'ping', id: 0 } satisfies WorkerRequest); } catch { clearTimeout(timer); resolve(false); }
    });
    if (!ok) { w.terminate(); workerFailed = true; return null; }
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p || msg.type === 'pong') return;
      if (msg.type === 'progress') p.onProgress?.(msg.stage, msg.fraction);
      else if (msg.type === 'result') { pending.delete(msg.id); p.resolve({ result: msg.result, features: msg.features }); }
      else { pending.delete(msg.id); p.reject(new Error(msg.message)); }
    };
    w.onerror = (e) => {
      // A crashed worker (often out-of-memory on very long files) fails every pending job.
      for (const [id, p] of pending) { p.reject(new Error(e.message || 'The analysis worker stopped unexpectedly, possibly because the recording is too long for this device’s memory.')); pending.delete(id); }
      w.terminate();
      ready = null;
    };
    return w;
  })();
  return ready;
}

/** Yield to the event loop so the main-thread fallback can repaint between stages. */
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export async function analyzeInBackground(samples: Float32Array, sampleRate: number, options: DecodeOptions, onProgress?: ProgressFn): Promise<{ result: AnalysisResult; features: Features }> {
  const w = await getWorker();
  if (!w) {
    await yieldFrame();
    const { analyzeAudio } = await import('./analyze');
    return analyzeAudio(samples, sampleRate, options, onProgress);
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as { result: AnalysisResult; features: Features }), reject, onProgress });
    w.postMessage({ type: 'analyze', id, samples, sampleRate, options } satisfies WorkerRequest, [samples.buffer]);
  });
}

export async function redecodeInBackground(features: Features, options: DecodeOptions): Promise<AnalysisResult> {
  const w = await getWorker();
  if (!w) {
    const { decodeFeatures } = await import('./analyze');
    return decodeFeatures(features, options);
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v.result), reject });
    w.postMessage({ type: 'decode', id, features, options } satisfies WorkerRequest);
  });
}

export function cancelAll(): void {
  void ready?.then((w) => w?.terminate());
  ready = null;
  for (const [id, p] of pending) { p.reject(new Error('Analysis cancelled')); pending.delete(id); }
}
