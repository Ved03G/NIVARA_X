/**
 * Captures the current page state:
 *  1. DOM elements (via element-mapper)
 *  2. PII detection (DOM analyzer + regex)
 *  3. Redaction
 *  4. Privacy Firewall check
 *  5. Returns SanitizedContext
 */
import { mapInteractiveElements } from './element-mapper.js';
import type { SanitizedContext } from '../types/index.js';
import { buildSanitizedContext } from '../privacy/sanitizer.js';

export async function observePage(): Promise<SanitizedContext> {
  // Map all interactive elements
  const elements = mapInteractiveElements();

  // Capture screenshot (best effort — may fail on some pages)
  let screenshotB64: string | undefined;
  try {
    screenshotB64 = await new Promise<string>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (resp) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else if (resp?.dataUrl) resolve(resp.dataUrl.split(',')[1] ?? '');
        else reject(new Error('No dataUrl in response'));
      });
    });
  } catch {
    screenshotB64 = undefined;
  }

  // Build the sanitized context (redaction runs inside)
  return buildSanitizedContext(elements, screenshotB64);
}
