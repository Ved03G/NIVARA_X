/**
 * vision-model.ts — manages the ONNX inference Web Worker.
 * The worker runs off the main thread; we communicate via postMessage.
 *
 * Usage:
 *   import { initVisionModel, inferImage, isReady } from './vision-model.js';
 *   await initVisionModel();                       // load MobileNetV2
 *   const result = await inferImage(imageData);    // classify 224×224 image
 */

export interface InferenceResult {
  topLabels:  string[];   // top-5 class IDs
  topScores:  number[];   // top-5 softmax scores (0-1)
  latencyMs:  number;
}

// ── Worker singleton ──────────────────────────────────────────────────────────

let worker:   Worker | null = null;
let ready                    = false;
let idSeq                    = 0;
const pending = new Map<string, [(r: InferenceResult) => void, (e: Error) => void]>();

function getWorker(): Worker {
  if (worker) return worker;

  // In MV3 extensions, workers must be loaded from the extension origin
  const workerUrl = typeof chrome !== 'undefined'
    ? (() => {
        // Find the bundled worker file by glob pattern
        const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
        const workerSrc = scripts.find(s => s.src.includes('inference.worker'))?.src;
        return workerSrc ?? chrome.runtime.getURL('assets/inference.worker.ts-loader.js');
      })()
    : new URL('./workers/inference.worker.ts', import.meta.url).href;

  worker = new Worker(workerUrl, { type: 'module' });

  worker.onmessage = (evt) => {
    const msg = evt.data;
    if (msg.type === 'READY') { ready = true; return; }
    if (msg.type === 'RESULT') {
      const p = pending.get(msg.id);
      if (p) { p[0]({ topLabels: msg.labels, topScores: msg.scores, latencyMs: msg.latencyMs }); pending.delete(msg.id); }
    }
    if (msg.type === 'INFER_ERROR') {
      const p = pending.get(msg.id);
      if (p) { p[1](new Error(msg.error)); pending.delete(msg.id); }
    }
    if (msg.type === 'LOAD_ERROR') {
      console.error('[VisionModel] failed to load model:', msg.error);
    }
  };

  return worker;
}

/** Load MobileNetV2 into the inference worker. Resolves when ready. */
export async function initVisionModel(): Promise<void> {
  if (ready) return;
  const w = getWorker();
  const modelUrl = typeof chrome !== 'undefined'
    ? chrome.runtime.getURL('models/mobilenet.onnx')
    : './models/mobilenet.onnx';

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Model load timeout (30s)')), 30_000);
    const handler = (evt: MessageEvent) => {
      if (evt.data.type === 'READY') {
        clearTimeout(timer);
        w.removeEventListener('message', handler);
        resolve();
      }
      if (evt.data.type === 'LOAD_ERROR') {
        clearTimeout(timer);
        w.removeEventListener('message', handler);
        reject(new Error(evt.data.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'LOAD', modelUrl });
  });
}

/**
 * Run inference on an ImageData (must be 224×224 for MobileNetV2).
 * The buffer is transferred zero-copy to the worker.
 */
export async function inferImage(imageData: ImageData): Promise<InferenceResult> {
  if (!ready) throw new Error('Model not ready — call initVisionModel() first');
  const id = String(++idSeq);
  return new Promise((resolve, reject) => {
    pending.set(id, [resolve, reject]);
    getWorker().postMessage(
      { type: 'INFER', id, imageData: imageData.data.buffer, width: imageData.width, height: imageData.height },
      [imageData.data.buffer],
    );
  });
}

export const isReady = () => ready;

/**
 * Capture a 224×224 thumbnail of a canvas element for inference.
 * Returns null if the canvas can't be read.
 */
export function canvasToImageData(canvas: HTMLCanvasElement): ImageData | null {
  try {
    const off = new OffscreenCanvas(224, 224);
    const ctx = off.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0, 224, 224);
    return ctx.getImageData(0, 0, 224, 224);
  } catch { return null; }
}
