import type { MappedElement, SanitizedContext } from '../types/index.js';
import { detectPII } from '../perception/pii-detector.js';
import { redact } from './redaction-engine.js';
import { runFirewall } from './firewall.js';
import type { CanvasCapture } from '../content/capture.js';

export async function buildSanitizedContext(
  elements: MappedElement[],
  canvasCaptures?: CanvasCapture[],
): Promise<SanitizedContext> {
  // 1. Detect PII (DOM + regex signals)
  const detections = detectPII(elements);

  // 2. Redact — replaces real values with tokens
  const { sanitizedElements, contract } = redact(elements, detections);

  // 3. Privacy Firewall — ensure no raw PII in the outgoing payload
  const payloadStr = JSON.stringify({ sanitizedElements, contract });
  const firewallResult = runFirewall(payloadStr, detections);
  if (!firewallResult.safe) {
    console.warn('[Nivara-X Firewall] BLOCKED potential PII leak:', firewallResult.reason);
    throw new Error(`FIREWALL BLOCKED: ${firewallResult.reason}`);
  }

  // 4. Canvas images — base64 JPEG (already compressed by capture.ts)
  const canvasImages = (canvasCaptures ?? []).map(c => c.dataUrl);

  return {
    task: '',   // Set by service worker before sending
    elements: sanitizedElements,
    redactionContract: contract,
    pageUrl: new URL(location.href).origin,
    timestamp: Date.now(),
    piiDetected:  detections.length,
    piiRedacted:  contract.length,
    rawPIISent:   0,
    canvasOcrText: [],
    canvasImages,
  };
}
