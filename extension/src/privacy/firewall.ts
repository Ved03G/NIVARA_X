/**
 * Privacy Firewall — final outgoing payload scan.
 * Independently checks the assembled payload before network transmission.
 * This is a separate, parallel check — not a replacement for the redaction engine.
 */
import type { PIIDetection } from '../types/index.js';

interface FirewallResult {
  safe: boolean;
  reason?: string;
  blockedPatterns: string[];
}

// Patterns that should NEVER appear in the outgoing payload
const LEAK_PATTERNS: Array<[RegExp, string]> = [
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, 'raw email address'],
  [/(?:\+91[\s-]?)?[6-9]\d{9}/g, 'raw Indian phone number'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'potential Aadhaar'],
  [/[A-Z]{5}[0-9]{4}[A-Z]/g, 'potential PAN'],
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'potential credit card'],
];

export function runFirewall(payload: string, _detections: PIIDetection[]): FirewallResult {
  const blocked: string[] = [];

  for (const [pattern, label] of LEAK_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    if (re.test(payload)) {
      blocked.push(label);
    }
  }

  if (blocked.length > 0) {
    return { safe: false, reason: `Detected: ${blocked.join(', ')}`, blockedPatterns: blocked };
  }

  return { safe: true, blockedPatterns: [] };
}
