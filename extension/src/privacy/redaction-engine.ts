import type { PIIDetection, RedactionToken, MappedElement } from '../types/index.js';

let tokenCounters: Record<string, number> = {};

export function resetTokenCounters() { tokenCounters = {}; }

function nextToken(category: string): string {
  tokenCounters[category] = (tokenCounters[category] ?? 0) + 1;
  return `[${category}_${tokenCounters[category]}]`;
}

/**
 * Applies redaction to elements based on PII detections.
 * Returns:
 *  - sanitized element list (values stripped/replaced)
 *  - redaction contract (what each token means)
 */
export function redact(
  elements: MappedElement[],
  detections: PIIDetection[]
): { sanitizedElements: MappedElement[]; contract: RedactionToken[] } {
  resetTokenCounters();
  const detectionMap = new Map(detections.map(d => [d.elementId, d]));
  const contract: RedactionToken[] = [];

  const sanitizedElements: MappedElement[] = elements.map(el => {
    const detection = detectionMap.get(el.id);
    if (!detection) return el;

    const token = nextToken(detection.category);
    contract.push({
      token,
      category: detection.category,
      elementId: el.id,
      serverMay: ['identify', 'reason', 'reference'],
      serverMayNot: ['recover_value'],
    });

    // Return element with value stripped and token as placeholder
    return {
      ...el,
      text: token,          // what server sees in text/label position
      placeholder: token,   // what server sees in placeholder position
      // Original value is NEVER included here
    };
  });

  return { sanitizedElements, contract };
}
