import type { MappedElement, SanitizedContext } from '../types/index.js';
import { detectPII } from '../perception/pii-detector.js';
import { redact } from './redaction-engine.js';
import { runFirewall } from './firewall.js';

export async function buildSanitizedContext(
  elements: MappedElement[],
  screenshotB64?: string
): Promise<SanitizedContext> {
  // 1. Detect PII
  const detections = detectPII(elements);

  // 2. Redact
  const { sanitizedElements, contract } = redact(elements, detections);

  // 3. Privacy Firewall — check we haven't left raw PII in the payload
  const payloadStr = JSON.stringify({ sanitizedElements, contract });
  const firewallResult = runFirewall(payloadStr, detections);
  if (!firewallResult.safe) {
    console.warn('[PrivacyShield Firewall] BLOCKED potential PII leak:', firewallResult.reason);
    // Return empty context rather than risk leaking data
    return {
      task: '',
      elements: [],
      redactionContract: [],
      pageUrl: new URL(location.href).origin,
      timestamp: Date.now(),
    };
  }

  return {
    task: '', // filled in by service worker
    elements: sanitizedElements,
    redactionContract: contract,
    screenshotB64,
    pageUrl: new URL(location.href).origin,
    timestamp: Date.now(),
  };
}
