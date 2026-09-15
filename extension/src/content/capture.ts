/**
 * capture.ts — builds the sanitized context sent to the server.
 *
 * Canvas OCR strategy: Tesseract.js cannot spawn workers in MV3 content
 * scripts (URL origin mismatch). Instead we capture canvas images directly
 * via canvas.toDataURL() and send the raw base64 to the server.
 * The server uses its own OCR/VLM pipeline to extract text.
 */
import { mapInteractiveElements } from './element-mapper.js';
import type { SanitizedContext } from '../types/index.js';
import { buildSanitizedContext } from '../privacy/sanitizer.js';

import { detectPIIInText } from '../perception/pii-detector.js';

export interface CanvasCapture {
  canvasId:   string | null;
  dataUrl:    string;          // base64 PNG, stripped of data: prefix
  width:      number;
  height:     number;
}

/**
 * Capture all visible canvas elements as base64 images.
 * Performs LOCAL REDACTION on the canvas if PII is detected via the interceptor!
 */
function captureCanvases(): CanvasCapture[] {
  const results: CanvasCapture[] = [];
  const canvases = document.querySelectorAll('canvas');

  for (const canvas of Array.from(canvases)) {
    // Skip tiny / invisible canvases
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) continue;
    const style = getComputedStyle(canvas);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    try {
      // Perform local visual redaction if text was intercepted
      const rawNodes = canvas.getAttribute('data-nivara-text');
      if (rawNodes) {
        const nodes = JSON.parse(rawNodes);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          for (const node of nodes) {
            // Check if this text node contains PII
            const pii = detectPIIInText(node.text, 'canvas');
            if (pii.length > 0) {
              const category = pii[0].category;
              
              // Estimate width better. node.font might be "bold 24px Inter" or similar.
              let fontSize = 12;
              const match = node.font.match(/(\d+)px/);
              if (match) fontSize = parseInt(match[1], 10);
              
              const approxWidth = node.text.length * (fontSize * 0.65) + 10;
              
              // Redact visually: Draw a solid black box over the sensitive text
              ctx.fillStyle = '#0f172a'; // match dark theme bg
              ctx.fillRect(node.x - 4, node.y - (fontSize + 2), approxWidth, fontSize + 8);
              
              // Draw semantic token placeholder [EMAIL], [ACCOUNT_NUMBER], etc.
              ctx.fillStyle = '#3b82f6';
              ctx.font = '12px monospace';
              ctx.fillText(`[${category}]`, node.x, node.y - Math.max(0, (fontSize - 12) / 2));
            }
          }
        }
      }

      // JPEG at 70% quality: ~12KB vs PNG ~80KB — much faster to send/process
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const b64 = dataUrl.split(',')[1] ?? '';
      if (!b64) continue;

      results.push({
        canvasId: canvas.id || null,
        dataUrl:  b64,
        width:    canvas.width,
        height:   canvas.height,
      });
    } catch {
      // Cross-origin canvas (tainted) — skip
    }
  }
  return results;
}

/**
 * Observe the current page state:
 *  1. Map all interactive elements (DOM)
 *  2. Capture screenshot (relayed through service worker)
 *  3. Capture canvas images for server-side OCR
 *  4. Sanitize and build the context object
 */
export async function observePage(): Promise<SanitizedContext> {
  const elements = mapInteractiveElements();

  // ── Screenshot via service worker ──────────────────────────────────────────
  let screenshotB64: string | undefined;
  try {
    screenshotB64 = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (resp) => {
        if (chrome.runtime.lastError) { reject(chrome.runtime.lastError); return; }
        if (resp?.dataUrl) resolve(resp.dataUrl.split(',')[1] ?? '');
        else reject(new Error('No dataUrl in response'));
      });
    });
  } catch {
    screenshotB64 = undefined;
  }

  // ── Canvas capture (zero-dependency, works in all content script contexts) ─
  const canvasCaptures = captureCanvases();
  if (canvasCaptures.length > 0) {
    console.log('[Nivara-X] Captured', canvasCaptures.length, 'canvas(es) for server OCR',
      canvasCaptures.map(c => `${c.width}x${c.height}`));
  }

  return buildSanitizedContext(elements, screenshotB64, canvasCaptures);
}
