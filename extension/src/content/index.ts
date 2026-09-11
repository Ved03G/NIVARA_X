/**
 * Content script entry point.
 * Handles OBSERVE and EXECUTE_ACTION messages from the service worker.
 */
import { observePage } from './capture.js';
import { executeAction } from './action-executor.js';
import type { SWToContentMessage, ContentToSWMessage } from '../types/index.js';

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as SWToContentMessage;

  if (msg.type === 'OBSERVE') {
    observePage()
      .then(ctx => sendResponse(ctx))
      .catch(err => sendResponse({ error: String(err) }));
    return true; // async
  }

  if (msg.type === 'EXECUTE_ACTION') {
    executeAction(msg.action)
      .then(success => {
        const reply: ContentToSWMessage = {
          type: 'ACTION_RESULT',
          actionId: msg.actionId,
          success,
        };
        chrome.runtime.sendMessage(reply).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch(err => {
        const reply: ContentToSWMessage = {
          type: 'ACTION_RESULT',
          actionId: msg.actionId,
          success: false,
          error: String(err),
        };
        chrome.runtime.sendMessage(reply).catch(() => {});
        sendResponse({ ok: false });
      });
    return true; // async
  }

  return false;
});

console.log('[PrivacyShield] content script ready on', location.hostname);
