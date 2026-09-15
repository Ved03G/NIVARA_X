import type { PopupToSWMessage, SWToPopupMessage, AgentStatus } from '../../types/index.js';
import { storeCategoryValue, clearVault as clearVaultDB } from '../../privacy/value-resolver.js';

// ─── Refs ─────────────────────────────────────────────────────────────────────
const taskInput   = document.getElementById('taskInput')    as HTMLTextAreaElement;
const runBtn      = document.getElementById('runBtn')       as HTMLButtonElement;
const runIcon     = () => document.getElementById('runIcon')!;
const runLabel    = document.getElementById('runLabel')     as HTMLSpanElement;
const statusLine  = document.getElementById('statusLine')   as HTMLDivElement;
const piiDetEl    = document.getElementById('piiDetected')  as HTMLElement;
const piiRedEl    = document.getElementById('piiRedacted')  as HTMLElement;
const tokenRow    = document.getElementById('tokenRow')     as HTMLDivElement;
const lastActEl   = document.getElementById('lastAction')   as HTMLDivElement;
const agentBadge  = document.getElementById('agentBadge')  as HTMLElement;
const privacyDot  = document.getElementById('privacyDot')  as HTMLElement;
const privacyLabel = document.getElementById('privacyLabel') as HTMLElement;
const privacyBytes = document.getElementById('privacyBytes') as HTMLElement;
const vaultMsg    = document.getElementById('vaultSaved')   as HTMLDivElement;

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(name: string) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${name}`)!.classList.add('active');
  document.getElementById(`panel-${name}`)!.classList.add('active');
}
document.getElementById('tab-agent')!.addEventListener('click', () => switchTab('agent'));
document.getElementById('tab-vault')!.addEventListener('click', () => switchTab('vault'));

// ─── Token rendering ──────────────────────────────────────────────────────────
function renderTokens(
  contract?: { token: string; category: string }[],
  canvasDetections?: string[],
) {
  const domPills  = (contract ?? []).map(t =>
    `<span class="token">${t.token}</span>`);
  const canvPills = (canvasDetections ?? []).map(t =>
    `<span class="token canvas-token" title="Detected via Vision OCR">${t} 👁</span>`);
  const all = [...domPills, ...canvPills];

  tokenRow.innerHTML = all.length
    ? all.join('')
    : '<span class="token-empty">Run agent to scan page</span>';
}

// ─── Last action rendering ────────────────────────────────────────────────────
function renderLastAction(raw?: string | object) {
  if (!raw) { lastActEl.innerHTML = '<span style="color:var(--text3)">—</span>'; return; }
  const a: unknown = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return raw; } })()
    : raw;

  if (typeof a === 'object' && a !== null) {
    const o = a as Record<string, unknown>;
    const type    = String(o.type ?? '');
    const target  = o.target  ? `<span style="color:var(--text)">${o.target}</span>` : '';
    const valueRef = o.valueRef ? ` → <span class="action-green">${o.valueRef}</span>` : '';
    const value   = o.value   ? ` = "${o.value}"` : '';
    lastActEl.innerHTML = `<span class="action-type">${type}</span>${target}${valueRef}${value}`;
  } else {
    lastActEl.textContent = String(a).slice(0, 140);
  }
}

// ─── Main UI update ───────────────────────────────────────────────────────────
function updateUI(s: AgentStatus) {
  const running = s.running ?? false;

  // Badge + button
  agentBadge.textContent = running ? 'RUNNING' : s.error ? 'ERROR' : 'IDLE';
  runBtn.disabled = running;

  if (running) {
    runIcon().outerHTML = '<div class="spinner" id="runIcon"></div>';
    runLabel.textContent = s.step ?? 'Running…';
  } else {
    const el = document.getElementById('runIcon');
    if (el?.classList.contains('spinner')) el.outerHTML = '<span id="runIcon">▶</span>';
    runLabel.textContent = 'Run Agent';
  }

  // Status line
  if (s.error) {
    statusLine.className = 'status-line err';
    statusLine.textContent = s.error.slice(0, 80);
  } else if (running) {
    statusLine.className = 'status-line active';
    statusLine.textContent = s.step ?? 'Working…';
  } else if (s.step && !['idle', 'done', 'ready'].includes(s.step)) {
    statusLine.className = 'status-line ok';
    statusLine.textContent = s.step;
  } else {
    statusLine.className = 'status-line';
    statusLine.textContent = 'Idle';
  }

  // PII counts
  const det = s.piiDetected ?? 0;
  const red = s.piiRedacted ?? 0;
  piiDetEl.textContent = det > 0 ? String(det) : '—';
  piiRedEl.textContent = red > 0 ? String(red) : '—';

  // Tokens — DOM contract + canvas visual detections
  renderTokens((s as any).redactionContract, (s as any).canvasDetections);

  // Firewall / privacy bar
  const leaked = s.rawPIISent ?? 0;
  privacyBytes.textContent = leaked === 0 ? '0 bytes' : `${leaked} bytes`;
  privacyBytes.className   = leaked === 0 ? 'privacy-bytes' : 'privacy-bytes alert';
  privacyDot.className     = leaked === 0 ? 'privacy-indicator' : 'privacy-indicator alert';
  privacyLabel.textContent = leaked === 0 ? 'Firewall Active' : 'Leak Detected';

  // Last action
  renderLastAction(s.lastAction as string | undefined);
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function poll() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' } as PopupToSWMessage, (resp: AgentStatus) => {
    if (chrome.runtime.lastError) return;
    if (resp) updateUI(resp);
  });
}
setInterval(poll, 800);
poll();

chrome.runtime.onMessage.addListener((raw) => {
  const msg = raw as SWToPopupMessage;
  if (msg.type === 'STATUS_UPDATE') updateUI(msg.status);
});

// ─── Run agent ────────────────────────────────────────────────────────────────
runBtn.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) {
    statusLine.className = 'status-line err';
    statusLine.textContent = 'Enter a task first';
    return;
  }
  chrome.runtime.sendMessage({ type: 'RUN_AGENT', task } as PopupToSWMessage);
  runBtn.disabled = true;
  statusLine.className = 'status-line active';
  statusLine.textContent = 'Starting…';
});

// ─── Save vault ───────────────────────────────────────────────────────────────
document.getElementById('saveVaultBtn')!.addEventListener('click', async () => {
  const fields: [string, string][] = [
    ['PERSON',        (document.getElementById('v-name')     as HTMLInputElement).value.trim()],
    ['EMAIL',         (document.getElementById('v-email')    as HTMLInputElement).value.trim()],
    ['PHONE',         (document.getElementById('v-phone')    as HTMLInputElement).value.trim()],
    ['DATE_OF_BIRTH', (document.getElementById('v-dob')      as HTMLInputElement).value.trim()],
    ['PASSWORD',      (document.getElementById('v-password') as HTMLInputElement).value],
    ['GOVERNMENT_ID', (document.getElementById('v-aadhaar')  as HTMLInputElement).value.trim()],
  ];
  let saved = 0;
  for (const [cat, val] of fields) {
    if (val) { await storeCategoryValue(cat, val); saved++; }
  }
  (document.getElementById('v-password') as HTMLInputElement).value = '';
  vaultMsg.style.display = 'block';
  vaultMsg.style.color = saved > 0 ? 'var(--green-lt)' : 'var(--text3)';
  vaultMsg.textContent = saved > 0
    ? `${saved} value${saved !== 1 ? 's' : ''} saved on device`
    : 'Nothing to save';
  setTimeout(() => { vaultMsg.style.display = 'none'; }, 3000);
});

// ─── Clear vault ──────────────────────────────────────────────────────────────
document.getElementById('clearVaultBtn')!.addEventListener('click', async () => {
  if (!confirm('Delete all vault data?')) return;
  await clearVaultDB();
  vaultMsg.style.display = 'block';
  vaultMsg.style.color = 'var(--text3)';
  vaultMsg.textContent = 'Vault cleared';
  setTimeout(() => { vaultMsg.style.display = 'none'; }, 2500);
});
