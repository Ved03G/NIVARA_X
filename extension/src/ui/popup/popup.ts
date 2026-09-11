import type { PopupToSWMessage, SWToPopupMessage, AgentStatus } from '../../types/index.js';
import { storeCategoryValue, clearVault as clearVaultDB } from '../../privacy/value-resolver.js';

// ─── Agent tab elements ─────────────────────────────────────────────────────────
const taskInput  = document.getElementById('taskInput')     as HTMLTextAreaElement;
const runBtn     = document.getElementById('runBtn')        as HTMLButtonElement;
const stepEl     = document.getElementById('stepIndicator') as HTMLDivElement;
const piiDetEl   = document.getElementById('piiDetected')   as HTMLSpanElement;
const piiRedEl   = document.getElementById('piiRedacted')   as HTMLSpanElement;
const rawPIIEl   = document.getElementById('rawPIISent')    as HTMLSpanElement;
const firewallEl = document.getElementById('firewallStatus')as HTMLDivElement;
const lastActEl  = document.getElementById('lastAction')    as HTMLSpanElement;

// ─── Vault tab elements ─────────────────────────────────────────────────────────
const vName     = document.getElementById('v-name')     as HTMLInputElement;
const vEmail    = document.getElementById('v-email')    as HTMLInputElement;
const vPhone    = document.getElementById('v-phone')    as HTMLInputElement;
const vDob      = document.getElementById('v-dob')      as HTMLInputElement;
const vPassword = document.getElementById('v-password') as HTMLInputElement;
const vAadhaar  = document.getElementById('v-aadhaar')  as HTMLInputElement;
const savedMsg  = document.getElementById('vaultSaved') as HTMLDivElement;

// ─── Agent status UI ────────────────────────────────────────────────────────────

function updateUI(status: AgentStatus) {
  stepEl.textContent      = status.step ?? 'idle';
  piiDetEl.textContent    = String(status.piiDetected  ?? 0);
  piiRedEl.textContent    = String(status.piiRedacted  ?? 0);
  rawPIIEl.textContent    = status.rawPIISent === 0 ? '0 bytes ✅' : `${status.rawPIISent} bytes ⚠`;
  lastActEl.textContent   = status.lastAction ?? '—';

  if (status.rawPIISent === 0) {
    firewallEl.textContent  = '✓ REQUEST ALLOWED';
    firewallEl.className    = 'firewall-ok';
  } else {
    firewallEl.textContent  = '✗ BLOCKED';
    firewallEl.className    = 'firewall-blocked';
  }

  runBtn.disabled     = status.running;
  runBtn.textContent  = status.running ? '⏳ Running...' : '▶ RUN AGENT';

  if (status.error) stepEl.textContent = `⚠ ${status.error}`;
}

function poll() {
  const msg: PopupToSWMessage = { type: 'GET_STATUS' };
  chrome.runtime.sendMessage(msg, (resp: AgentStatus) => {
    if (chrome.runtime.lastError) return;
    if (resp) updateUI(resp);
  });
}

setInterval(poll, 1000);
poll();

chrome.runtime.onMessage.addListener((raw) => {
  const msg = raw as SWToPopupMessage;
  if (msg.type === 'STATUS_UPDATE') updateUI(msg.status);
});

runBtn.addEventListener('click', () => {
  const task = taskInput.value.trim();
  if (!task) { alert('Please enter a task first.'); return; }
  const msg: PopupToSWMessage = { type: 'RUN_AGENT', task };
  chrome.runtime.sendMessage(msg);
  runBtn.disabled     = true;
  stepEl.textContent  = 'starting...';
});

// ─── Vault save / clear ─────────────────────────────────────────────────────────

(window as unknown as Record<string, unknown>).saveVault = async () => {
  const entries: [string, string][] = [
    ['PERSON',   vName.value.trim()],
    ['EMAIL',    vEmail.value.trim()],
    ['PHONE',    vPhone.value.trim()],
    ['DATE_OF_BIRTH', vDob.value.trim()],
    ['PASSWORD', vPassword.value],
    ['GOVERNMENT_ID', vAadhaar.value.trim()],
  ];

  let saved = 0;
  for (const [cat, val] of entries) {
    if (val) {
      await storeCategoryValue(cat, val);
      saved++;
    }
  }

  savedMsg.style.display = 'block';
  savedMsg.textContent   = `✓ ${saved} value${saved !== 1 ? 's' : ''} saved securely on device`;
  setTimeout(() => { savedMsg.style.display = 'none'; }, 3000);

  // Clear inputs after save for safety
  vPassword.value = '';
};

(window as unknown as Record<string, unknown>).clearVault = async () => {
  if (!confirm('Delete all vault data?')) return;
  await clearVaultDB();
  savedMsg.style.display = 'block';
  savedMsg.textContent   = '🗑 Vault cleared';
  savedMsg.style.color   = '#f87171';
  setTimeout(() => {
    savedMsg.style.display = 'none';
    savedMsg.style.color   = '#34d399';
  }, 2500);
};
