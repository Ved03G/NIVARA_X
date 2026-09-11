import type {
  AgentStatus,
  AgentResponse,
  BrowserAction,
  ContentToSWMessage,
  SWToContentMessage,
  PopupToSWMessage,
  SWToPopupMessage,
  SanitizedContext,
} from '../types/index.js';

const SERVER_URL = 'http://localhost:8000';

// ─── State ────────────────────────────────────────────────────────────────────

let status: AgentStatus = {
  running: false,
  step: 'idle',
  piiDetected: 0,
  piiRedacted: 0,
  rawPIISent: 0,
};

let activeTabId: number | null = null;
let currentTask = '';
let actionCounter = 0;
const pendingActions = new Map<string, (success: boolean, err?: string) => void>();

// ─── Utilities ────────────────────────────────────────────────────────────────

function updateStatus(patch: Partial<AgentStatus>) {
  status = { ...status, ...patch };
  broadcastStatus();
}

function broadcastStatus() {
  const msg: SWToPopupMessage = { type: 'STATUS_UPDATE', status };
  chrome.runtime.sendMessage(msg).catch(() => {/* popup may be closed */});
}

async function sendToContent(tabId: number, msg: SWToContentMessage) {
  return chrome.tabs.sendMessage(tabId, msg);
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgentLoop(tabId: number, task: string) {
  updateStatus({ running: true, step: 'starting', piiDetected: 0, piiRedacted: 0, rawPIISent: 0 });
  const maxSteps = 10;

  for (let step = 0; step < maxSteps; step++) {
    updateStatus({ step: `observe (step ${step + 1})` });

    // 1. Ask content script to observe page and return sanitized context
    let context: SanitizedContext;
    try {
      context = await sendToContent(tabId, { type: 'OBSERVE' });
    } catch (e) {
      updateStatus({ running: false, error: `Observe failed: ${e}` });
      return;
    }

    updateStatus({
      step: 'calling server',
      piiDetected: context.redactionContract.length,
      piiRedacted: context.redactionContract.length,
      rawPIISent: 0,
    });

    // 2. Send sanitized context to server
    let agentResponse: AgentResponse;
    try {
      const res = await fetch(`${SERVER_URL}/api/agent/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // NOTE: spread context first, then override task — prevents context.task:'' from winning
        body: JSON.stringify({ ...context, task: task + (step > 0 ? ` (step ${step + 1})` : '') }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);
      agentResponse = await res.json() as AgentResponse;
    } catch (e) {
      updateStatus({ running: false, error: `Server error: ${e}` });
      return;
    }

    if (agentResponse.taskComplete && agentResponse.actions.length === 0) {
      updateStatus({ running: false, step: 'complete' });
      return;
    }

    // 3. Execute each action via content script
    for (const action of agentResponse.actions) {
      const actionId = `act_${++actionCounter}`;
      updateStatus({ step: `executing ${action.type}`, lastAction: JSON.stringify(action) });

      const success = await new Promise<boolean>((resolve) => {
        pendingActions.set(actionId, (ok) => resolve(ok));
        sendToContent(tabId, { type: 'EXECUTE_ACTION', action, actionId }).catch(() => resolve(false));
        // Timeout safety
        setTimeout(() => {
          if (pendingActions.has(actionId)) {
            pendingActions.delete(actionId);
            resolve(false);
          }
        }, 10_000);
      });

      if (!success) {
        updateStatus({ running: false, error: `Action ${action.type} failed on ${actionId}` });
        return;
      }

      // Small delay between actions for stability
      await new Promise(r => setTimeout(r, 500));
    }

    if (agentResponse.taskComplete) {
      updateStatus({ running: false, step: 'complete' });
      return;
    }
  }

  updateStatus({ running: false, step: 'max steps reached' });
}

// ─── Message handlers ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const msg = raw as ContentToSWMessage | PopupToSWMessage;

  if (msg.type === 'RUN_AGENT') {
    if (status.running) { sendResponse({ error: 'Already running' }); return true; }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) { sendResponse({ error: 'No active tab' }); return; }
      activeTabId = tab.id;
      currentTask = msg.task;
      runAgentLoop(tab.id, msg.task);
      sendResponse({ ok: true });
    });
    return true; // async
  }

  if (msg.type === 'GET_STATUS') {
    sendResponse(status);
    return false;
  }

  if (msg.type === 'PAGE_CONTEXT') {
    // Content script proactively sending context — not used in loop mode
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ACTION_RESULT') {
    const resolve = pendingActions.get(msg.actionId);
    if (resolve) {
      pendingActions.delete(msg.actionId);
      resolve(msg.success);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Content scripts can't call captureVisibleTab — relay through SW
  if ((raw as { type: string }).type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) { sendResponse({ error: 'No active tab' }); return; }
      chrome.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 60 }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataUrl });
        }
      });
    });
    return true; // async
  }

  return false;
});

console.log('[PrivacyShield SW] service worker started');
