/**
 * Multi-signal PII detector.
 * Phase 1: DOM + regex only. OCR + vision added in Phase 2/3.
 */
import type { PIIDetection, PIICategory } from '../types/index.js';
import type { MappedElement } from '../types/index.js';

// ─── Regex patterns ───────────────────────────────────────────────────────────

const PATTERNS: Array<[RegExp, PIICategory, number]> = [
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, 'EMAIL', 0.92],
  [/(\+91[\s-]?)?\d{5}[\s-]?\d{5}\b/g, 'PHONE', 0.88],
  [/(?<!\d)(?<!\d[\s-])\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b(?![\s-]\d)(?!\d)/g, 'GOVERNMENT_ID', 0.85], // Aadhaar
  [/[A-Z]{5}[0-9]{4}[A-Z]/g, 'GOVERNMENT_ID', 0.90], // PAN
  [/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, 'ACCOUNT_NUMBER', 0.90],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, 'IFSC', 0.95],
  [/[₹$]\s?[\d,]+\.?\d*/g, 'BALANCE', 0.95],
  [/\b(?!(?:ACCOUNT|AVAILABLE|REGISTERED|CODE|HOLDER|NUMBER|BALANCE|MOBILE|IFSC)\b)[A-Z]{2,}(?:\s(?!(?:ACCOUNT|AVAILABLE|REGISTERED|CODE|HOLDER|NUMBER|BALANCE|MOBILE|IFSC)\b)[A-Z]{2,}){1,3}\b/g, 'PERSON', 0.80], // ALL CAPS Name, excluding labels
  [/\b\d{1,2}\s?[/\-.]\s?\d{2}\s?[/\-.]\s?\d{4}\b/g, 'DATE_OF_BIRTH', 0.90],
];

export function detectPIIInText(text: string, elementId: string): PIIDetection[] {
  const results: PIIDetection[] = [];
  for (const [pattern, category, confidence] of PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    if (re.test(text)) {
      results.push({ category, confidence, source: 'regex', elementId, value: text });
    }
  }
  return results;
}

/**
 * Run all available detectors and fuse results.
 * Returns the highest-confidence detection per element.
 */
export function detectPII(elements: MappedElement[]): PIIDetection[] {
  const byElement = new Map<string, PIIDetection>();

  for (const el of elements) {
    // DOM type/label signals (cheapest)
    const domSignals = detectFromElementMeta(el);
    for (const sig of domSignals) {
      const existing = byElement.get(sig.elementId);
      if (!existing || sig.confidence > existing.confidence) {
        byElement.set(sig.elementId, sig);
      }
    }

    // Regex on visible text
    const textToScan = [el.text, el.ariaLabel, el.placeholder].filter(Boolean).join(' ');
    if (textToScan) {
      const regexSigs = detectPIIInText(textToScan, el.id);
      for (const sig of regexSigs) {
        const existing = byElement.get(sig.elementId);
        if (!existing || sig.confidence > existing.confidence) {
          byElement.set(sig.elementId, sig);
        }
      }
    }
  }

  return Array.from(byElement.values());
}

function detectFromElementMeta(el: MappedElement): PIIDetection[] {
  const results: PIIDetection[] = [];

  // Input type
  const t = el.type?.toLowerCase();
  if (t === 'password') results.push({ category: 'PASSWORD', confidence: 0.99, source: 'dom', elementId: el.id });
  else if (t === 'email') results.push({ category: 'EMAIL', confidence: 0.97, source: 'dom', elementId: el.id });
  else if (t === 'tel') results.push({ category: 'PHONE', confidence: 0.95, source: 'dom', elementId: el.id });

  // Label patterns
  const label = `${el.ariaLabel ?? ''} ${el.placeholder ?? ''}`.toLowerCase();
  if (/password|pwd/.test(label)) results.push({ category: 'PASSWORD', confidence: 0.93, source: 'dom', elementId: el.id });
  if (/email|e-mail/.test(label)) results.push({ category: 'EMAIL', confidence: 0.90, source: 'dom', elementId: el.id });
  if (/phone|mobile|tel/.test(label)) results.push({ category: 'PHONE', confidence: 0.88, source: 'dom', elementId: el.id });
  if (/\bname\b/.test(label)) results.push({ category: 'PERSON', confidence: 0.80, source: 'dom', elementId: el.id });
  if (/dob|birth/.test(label)) results.push({ category: 'DATE_OF_BIRTH', confidence: 0.90, source: 'dom', elementId: el.id });
  if (/aadhaar|aadhar|ssn|gov id/.test(label)) results.push({ category: 'GOVERNMENT_ID', confidence: 0.95, source: 'dom', elementId: el.id });

  return results;
}
