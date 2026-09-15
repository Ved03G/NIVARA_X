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

/** Inject content script into tab programmatically (fallback for pre-existing tabs). */
async function injectContentScript(tabId: number): Promise<void> {
  // Always read from current manifest — hash changes on each build
  const manifest = chrome.runtime.getManifest();
  const contentFiles = manifest.content_scripts?.[0]?.js ?? [];

  if (contentFiles.length === 0) {
    throw new Error('[Nivara-X SW] No content scripts defined in manifest');
  }

  console.log('[Nivara-X SW] Injecting content script:', contentFiles);

  await chrome.scripting.executeScript({
    target: { tabId },
    files: contentFiles,
  });

  // Wait for script to initialise its message listeners
  await new Promise(r => setTimeout(r, 400));
  console.log('[Nivara-X SW] Content script injected successfully into tab', tabId);
}

async function sendToContent(tabId: number, msg: SWToContentMessage): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e: any) {
    const isConnectionErr = String(e).includes('Receiving end does not exist')
      || String(e).includes('Could not establish connection');
    if (isConnectionErr) {
      console.log('[Nivara-X SW] Content script not found — injecting...');
      await injectContentScript(tabId);
      return chrome.tabs.sendMessage(tabId, msg);
    }
    throw e;
  }
}

// ─── Canvas token parser ──────────────────────────────────────────────────────

/** Extract tokens like [ACCOUNT_NUMBER_1] from server reasoning string. */
function parseCanvasTokens(reasoning?: string): string[] {
  if (!reasoning) return [];
  const matches = reasoning.match(/\[[A-Z_]+_\d+\]/g);
  return matches ? [...new Set(matches)] : [];
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgentLoop(tabId: number, task: string) {
  updateStatus({ running: true, step: 'starting', piiDetected: 0, piiRedacted: 0, rawPIISent: 0, canvasDetections: [] });
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
      piiDetected:       context.piiDetected,
      piiRedacted:       context.piiRedacted,
      rawPIISent:        context.rawPIISent,
      redactionContract: context.redactionContract,
    });

    // 2. Send sanitized context to server
    let agentResponse: AgentResponse;
    try {
      const res = await fetch(`${SERVER_URL}/api/agent/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...context, task: task + (step > 0 ? ` (step ${step + 1})` : '') }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);
      agentResponse = await res.json() as AgentResponse;
    } catch (e) {
      updateStatus({ running: false, error: `Server error: ${e}` });
      return;
    }

    // Parse canvas PII tokens the server detected (shown in token pills)
    const canvasDetections = parseCanvasTokens(agentResponse.reasoning);
    const totalDetected = context.piiDetected + canvasDetections.length;
    const totalRedacted = context.piiRedacted + canvasDetections.length;

    if (agentResponse.taskComplete && agentResponse.actions.length === 0) {
      updateStatus({
        running: false,
        step: 'complete',
        piiDetected:       totalDetected,
        piiRedacted:       totalRedacted,
        redactionContract: context.redactionContract,
        canvasDetections,
        lastAction:        agentResponse.reasoning,
      });
      return;
    }

    // 3. Execute each action via content script
    for (const action of agentResponse.actions) {
      const actionId = `act_${++actionCounter}`;
      updateStatus({ step: `executing ${action.type}`, lastAction: JSON.stringify(action) });

      const success = await new Promise<boolean>((resolve) => {
        pendingActions.set(actionId, (ok) => resolve(ok));
        sendToContent(tabId, { type: 'EXECUTE_ACTION', action, actionId }).catch(() => resolve(false));
        setTimeout(() => {
          if (pendingActions.has(actionId)) { pendingActions.delete(actionId); resolve(false); }
        }, 10_000);
      });

      if (!success) {
        updateStatus({ running: false, error: `Action ${action.type} failed on ${actionId}` });
        return;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    if (agentResponse.taskComplete) {
      updateStatus({
        running: false,
        step: 'complete',
        piiDetected:       totalDetected,
        piiRedacted:       totalRedacted,
        redactionContract: context.redactionContract,
        canvasDetections,
      });
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

console.log('[Nivara-X SW] service worker started');
