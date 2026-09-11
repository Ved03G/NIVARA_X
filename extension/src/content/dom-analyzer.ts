/**
 * Analyzes DOM structure to determine which fields are sensitive.
 * This is the first and cheapest signal — runs before any ML.
 */
import type { PIIDetection, PIICategory } from '../types/index.js';

interface FieldSignal {
  elementId: string;
  category: PIICategory;
  confidence: number;
  value: string;
}

const INPUT_TYPE_MAP: Record<string, PIICategory> = {
  password: 'PASSWORD',
  email: 'EMAIL',
  tel: 'PHONE',
  'date': 'DATE_OF_BIRTH',
  'number': 'FINANCIAL_DATA',
};

const LABEL_PATTERNS: Array<[RegExp, PIICategory, number]> = [
  [/\bpassword\b/i, 'PASSWORD', 0.95],
  [/\bpwd\b/i, 'PASSWORD', 0.90],
  [/\bemail\b/i, 'EMAIL', 0.95],
  [/\be-mail\b/i, 'EMAIL', 0.90],
  [/\bphone\b|\bmobile\b|\bcell\b/i, 'PHONE', 0.90],
  [/\bname\b/i, 'PERSON', 0.75],
  [/\bfull.?name\b/i, 'PERSON', 0.85],
  [/\bfirst.?name\b|\blast.?name\b/i, 'PERSON', 0.90],
  [/\baddress\b/i, 'ADDRESS', 0.85],
  [/\bcredit.?card\b|\bcard.?number\b/i, 'CREDIT_CARD', 0.95],
  [/\baadhaar\b|\bpan\b|\bpassport\b|\bdl.?number\b/i, 'GOVERNMENT_ID', 0.90],
  [/\bdob\b|\bdate.?of.?birth\b|\bbirthday\b/i, 'DATE_OF_BIRTH', 0.90],
  [/\baccount.?number\b|\bifsc\b/i, 'BANK_ACCOUNT', 0.90],
];

function getFieldLabel(input: HTMLInputElement | HTMLTextAreaElement): string {
  // Try aria-label
  const aria = input.getAttribute('aria-label');
  if (aria) return aria;
  // Try associated <label>
  const id = input.id;
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${id}"]`);
    if (label) return label.textContent?.trim() || '';
  }
  // Try placeholder
  return input.placeholder || input.name || '';
}

export function analyzeDOMFields(idMap: Map<Element, string>): PIIDetection[] {
  const detections: PIIDetection[] = [];

  const inputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input:not([type=hidden]), textarea'
  );

  inputs.forEach(input => {
    const elementId = idMap.get(input) || 'unknown';
    const value = input.value;
    const type = (input as HTMLInputElement).type?.toLowerCase() || 'text';

    // 1. Type-based detection (highest confidence)
    const typeCat = INPUT_TYPE_MAP[type];
    if (typeCat) {
      detections.push({
        category: typeCat,
        confidence: 0.97,
        source: 'dom',
        elementId,
        value,
      });
      return; // type-based is definitive
    }

    // 2. Autocomplete attribute
    const ac = input.getAttribute('autocomplete') || '';
    if (ac === 'email') {
      detections.push({ category: 'EMAIL', confidence: 0.95, source: 'dom', elementId, value });
      return;
    }
    if (ac === 'tel') {
      detections.push({ category: 'PHONE', confidence: 0.95, source: 'dom', elementId, value });
      return;
    }
    if (ac === 'current-password' || ac === 'new-password') {
      detections.push({ category: 'PASSWORD', confidence: 0.99, source: 'dom', elementId, value });
      return;
    }

    // 3. Label-based detection
    const label = getFieldLabel(input).toLowerCase();
    for (const [pattern, category, confidence] of LABEL_PATTERNS) {
      if (pattern.test(label)) {
        detections.push({ category, confidence, source: 'dom', elementId, value });
        break;
      }
    }
  });

  return detections;
}
