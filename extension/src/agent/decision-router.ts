/**
 * Decides whether an action can be executed locally (no server call)
 * or needs to be escalated through the privacy pipeline to the server.
 *
 * Phase 1: simple heuristic. Phase 6: trained classifier.
 */
import type { MappedElement, SanitizedContext } from '../types/index.js';

export type RouteDecision = 'LOCAL' | 'REMOTE';

interface RoutingContext {
  task: string;
  elements: MappedElement[];
  hasPIIDetected: boolean;
}

export function route(ctx: RoutingContext): RouteDecision {
  const task = ctx.task.toLowerCase();

  // Heuristic: simple navigation/scroll actions can stay local
  if (/^scroll (down|up)$/i.test(task)) return 'LOCAL';
  if (/^(go back|navigate back)$/i.test(task)) return 'LOCAL';

  // If PII is involved, must go through privacy pipeline -> remote
  if (ctx.hasPIIDetected) return 'REMOTE';

  // If task is very short and maps to a single obvious element, maybe local
  // (Phase 6 will make this smarter with confidence scoring)
  return 'REMOTE';
}
