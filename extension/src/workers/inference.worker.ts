/**
 * ONNX Runtime Web — inference worker.
 * Runs ALL ML inference off the main thread.
 * Loaded by vision-model.ts via new Worker().
 */
import * as ort from 'onnxruntime-web';

// Point ONNX wasm binaries at extension's web_accessible_resources
ort.env.wasm.wasmPaths = chrome.runtime.getURL('assets/');

type WorkerInMsg =
  | { type: 'LOAD';  modelUrl: string }
  | { type: 'INFER'; id: string; imageData: ArrayBuffer; width: number; height: number };

type WorkerOutMsg =
  | { type: 'READY' }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'RESULT';     id: string; scores: number[]; labels: string[]; latencyMs: number }
  | { type: 'INFER_ERROR'; id: string; error: string };

let session: ort.InferenceSession | null = null;

// Preprocess: RGBA ImageData → CHW float32 tensor normalised to ImageNet stats
function preprocess(buf: ArrayBuffer, width: number, height: number): ort.Tensor {
  const rgba   = new Uint8ClampedArray(buf);
  const floats = new Float32Array(3 * width * height);
  const mean   = [0.485, 0.456, 0.406];
  const std    = [0.229, 0.224, 0.225];
  for (let i = 0; i < width * height; i++) {
    floats[0 * width * height + i] = (rgba[i * 4 + 0] / 255 - mean[0]) / std[0];
    floats[1 * width * height + i] = (rgba[i * 4 + 1] / 255 - mean[1]) / std[1];
    floats[2 * width * height + i] = (rgba[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', floats, [1, 3, height, width]);
}

function softmax(arr: Float32Array): number[] {
  const max  = Math.max(...arr);
  const exps = Array.from(arr).map(v => Math.exp(v - max));
  const sum  = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sum);
}

self.addEventListener('message', async (evt: MessageEvent<WorkerInMsg>) => {
  const msg = evt.data;

  if (msg.type === 'LOAD') {
    try {
      session = await ort.InferenceSession.create(msg.modelUrl, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      (self as unknown as Worker).postMessage({ type: 'READY' } satisfies WorkerOutMsg);
    } catch (e) {
      (self as unknown as Worker).postMessage({
        type: 'LOAD_ERROR', error: String(e),
      } satisfies WorkerOutMsg);
    }
    return;
  }

  if (msg.type === 'INFER') {
    if (!session) {
      (self as unknown as Worker).postMessage({
        type: 'INFER_ERROR', id: msg.id, error: 'Session not loaded',
      } satisfies WorkerOutMsg);
      return;
    }
    try {
      const t0     = performance.now();
      const tensor = preprocess(msg.imageData, msg.width, msg.height);
      const feeds  = { [session.inputNames[0]]: tensor };
      const out    = await session.run(feeds);
      const raw    = out[session.outputNames[0]].data as Float32Array;
      const scores = softmax(raw);
      const top5   = Array.from(scores)
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 5);
      const latencyMs = performance.now() - t0;
      (self as unknown as Worker).postMessage({
        type: 'RESULT',
        id: msg.id,
        scores:  top5.map(x => x.s),
        labels:  top5.map(x => `class_${x.i}`),
        latencyMs,
      } satisfies WorkerOutMsg);
    } catch (e) {
      (self as unknown as Worker).postMessage({
        type: 'INFER_ERROR', id: msg.id, error: String(e),
      } satisfies WorkerOutMsg);
    }
  }
});
