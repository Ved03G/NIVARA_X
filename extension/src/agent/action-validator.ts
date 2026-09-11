import type { BrowserAction, AllowedActionType } from '../types/index.js';
import { ALLOWED_ACTIONS, ACTION_RISK } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateAction(action: BrowserAction): ValidationResult {
  // 1. Must be an allowed type
  if (!ALLOWED_ACTIONS.includes(action.type as AllowedActionType)) {
    return { valid: false, reason: `Action type '${action.type}' is not in allow-list` };
  }

  // 2. No JavaScript execution
  if ('url' in action && typeof action.url === 'string') {
    if (action.url.startsWith('javascript:')) {
      return { valid: false, reason: 'JavaScript URLs are forbidden' };
    }
  }

  // 3. Navigation must be http/https
  if (action.type === 'NAVIGATE') {
    try {
      const u = new URL(action.url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        return { valid: false, reason: 'Non-HTTP navigation is forbidden' };
      }
    } catch {
      return { valid: false, reason: 'Invalid navigation URL' };
    }
  }

  return { valid: true };
}

export function getRiskLevel(action: BrowserAction) {
  return ACTION_RISK[action.type as AllowedActionType] ?? 'HIGH';
}
