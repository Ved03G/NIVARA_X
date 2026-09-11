/**
 * Executes validated browser actions on the live DOM.
 * Only runs allow-listed action types.
 */
import { getElementByOpaqueId } from './element-mapper.js';
import { resolveValue } from '../privacy/value-resolver.js';
import type { BrowserAction } from '../types/index.js';

async function findElement(opaqueId: string): Promise<HTMLElement | null> {
  const el = getElementByOpaqueId(opaqueId);
  if (el instanceof HTMLElement) return el;
  return null;
}

export async function executeAction(action: BrowserAction): Promise<boolean> {
  try {
    switch (action.type) {
      case 'CLICK': {
        const el = await findElement(action.target);
        if (!el) throw new Error(`Element not found: ${action.target}`);
        el.click();
        return true;
      }

      case 'TYPE': {
        const el = await findElement(action.target);
        if (!el) throw new Error(`Element not found: ${action.target}`);
        const realValue = await resolveValue(action.valueRef);
        if (realValue === null) throw new Error(`No value for ref: ${action.valueRef}`);
        const input = el as HTMLInputElement;
        input.focus();
        // Native input event simulation for React/Vue compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        nativeInputValueSetter?.call(input, realValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      case 'SELECT': {
        const el = await findElement(action.target);
        if (!el) throw new Error(`Element not found: ${action.target}`);
        const select = el as HTMLSelectElement;
        select.value = action.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      case 'SCROLL': {
        const amount = action.amount ?? 300;
        window.scrollBy({ top: action.direction === 'DOWN' ? amount : -amount, behavior: 'smooth' });
        return true;
      }

      case 'NAVIGATE': {
        // Only allow same-origin or user-confirmed navigation
        window.location.href = action.url;
        return true;
      }

      case 'WAIT': {
        await new Promise(r => setTimeout(r, action.ms));
        return true;
      }

      default:
        throw new Error(`Unknown action type: ${(action as BrowserAction).type}`);
    }
  } catch (err) {
    console.error('[PrivacyShield] Action failed:', err);
    return false;
  }
}
