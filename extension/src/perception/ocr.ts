/**
 * OCR module — uses Tesseract.js to extract text from canvas/image elements.
 * Runs in content-script context; Tesseract spawns its own worker internally.
 *
 * Used by Demo B (canvas dashboard) and Demo C (mixed KYC page)
 * to detect PII that is only visible as pixels, not in the DOM.
 */
import Tesseract from 'tesseract.js';

export interface OcrResult {
  text:       string;
  confidence: number;  // 0–100
  words:      { text: string; confidence: number; bbox: Tesseract.Bbox }[];
}

let scheduler: Tesseract.Scheduler | null = null;
let initPromise: Promise<void> | null = null;

async function ensureScheduler(): Promise<Tesseract.Scheduler> {
  if (scheduler) return scheduler;
  if (initPromise) { await initPromise; return scheduler!; }

  initPromise = (async () => {
    scheduler = Tesseract.createScheduler();
    // Single worker — good enough for demo, can scale to 2+ for perf
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: () => {}, // silence progress logs
    });
    scheduler.addWorker(worker);
  })();

  await initPromise;
  return scheduler!;
}

/** Run OCR on a canvas element and return extracted text + confidence. */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const sched = await ensureScheduler();
  const result = await sched.recognize(canvas);
  return {
    text:       result.data.text.trim(),
    confidence: result.data.confidence,
    words:      result.data.words.map(w => ({
      text:       w.text,
      confidence: w.confidence,
      bbox:       w.bbox,
    })),
  };
}

/** Run OCR on a base64 PNG/JPEG string. */
export async function ocrBase64(dataUrl: string): Promise<OcrResult> {
  const sched = await ensureScheduler();
  const result = await sched.recognize(dataUrl);
  return {
    text:       result.data.text.trim(),
    confidence: result.data.confidence,
    words:      result.data.words.map(w => ({
      text:       w.text,
      confidence: w.confidence,
      bbox:       w.bbox,
    })),
  };
}

/**
 * Scan all visible canvas elements on the page for PII text.
 * Returns OCR results per canvas (identified by index).
 */
export async function scanPageCanvases(): Promise<
  { index: number; id: string | null; ocr: OcrResult }[]
> {
  const canvases = Array.from(document.querySelectorAll('canvas'));
  const results  = [];

  for (let i = 0; i < canvases.length; i++) {
    const c = canvases[i];
    // Skip tiny / invisible canvases
    if (c.width < 50 || c.height < 50) continue;
    try {
      const ocr = await ocrCanvas(c);
      if (ocr.text.length > 2) {
        results.push({ index: i, id: c.id || null, ocr });
      }
    } catch { /* skip unreadable canvas */ }
  }

  return results;
}
