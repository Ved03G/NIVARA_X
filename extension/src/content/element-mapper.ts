/**
 * Assigns stable opaque IDs to interactive DOM elements.
 * IDs are content-free: el_7f2a — not el_email_field.
 */
import type { MappedElement } from '../types/index.js';

const idMap = new WeakMap<Element, string>();
let counter = 0;

function getOrAssignId(el: Element): string {
  if (!idMap.has(el)) {
    const hex = (++counter).toString(16).padStart(4, '0');
    idMap.set(el, `el_${hex}`);
  }
  return idMap.get(el)!;
}

function getRole(el: Element): string {
  const aria = el.getAttribute('aria-role') || el.getAttribute('role');
  if (aria) return aria;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'select') return 'listbox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type.toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'submit' || t === 'button') return 'button';
    return 'textbox';
  }
  return tag;
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// Returns safe display text that likely isn't PII (labels, button text, etc.)
function getSafeText(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  // For inputs, placeholder only — not the actual value
  if (tag === 'input' || tag === 'textarea') {
    return (el as HTMLInputElement).placeholder || undefined;
  }
  const text = (el.textContent || '').trim().slice(0, 100);
  return text || undefined;
}

export function mapInteractiveElements(): MappedElement[] {
  const selectors = [
    'input:not([type=hidden])',
    'textarea',
    'select',
    'button',
    'a[href]',
    '[role="button"]',
    '[role="textbox"]',
    '[role="listbox"]',
    '[tabindex]:not([tabindex="-1"])',
  ];

  const seen = new Set<Element>();
  const elements: MappedElement[] = [];

  for (const sel of selectors) {
    document.querySelectorAll<Element>(sel).forEach(el => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el)) return;

      const rect = el.getBoundingClientRect();
      elements.push({
        id: getOrAssignId(el),
        role: getRole(el),
        type: (el as HTMLInputElement).type?.toLowerCase() || undefined,
        text: getSafeText(el),
        ariaLabel: el.getAttribute('aria-label') || undefined,
        placeholder: (el as HTMLInputElement).placeholder || undefined,
        disabled: (el as HTMLInputElement).disabled ?? false,
        visible: true,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    });
  }

  return elements;
}

/** Get a DOM element by its opaque ID. */
export function getElementByOpaqueId(opaqueId: string): Element | null {
  // Iterate all mapped entries
  const all = document.querySelectorAll('*');
  for (const el of Array.from(all)) {
    if (idMap.get(el) === opaqueId) return el;
  }
  return null;
}
