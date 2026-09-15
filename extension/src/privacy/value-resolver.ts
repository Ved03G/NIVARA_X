/**
 * Local Value Resolver — chrome.storage.local backed, plaintext.
 *
 * WHY chrome.storage.local (not IndexedDB):
 *   IndexedDB is origin-scoped. Popup uses extension origin, content script
 *   uses the page origin → completely separate databases. chrome.storage.local
 *   is extension-scoped and shared across popup, SW, and content scripts.
 *
 * WHY no encryption:
 *   chrome.storage.local is already protected by Chrome's extension sandboxing.
 *   Web pages cannot read it. Encryption via crypto.subtle needs a key that must
 *   be shared across contexts via chrome.storage.session, which is unreliable in
 *   content scripts on some Chrome versions.
 *
 * Resolution order for resolveValue("[EMAIL_1]"):
 *  1. In-memory cache (fast path within same content-script lifecycle)
 *  2. chrome.storage.local exact key match (e.g. "EMAIL_1")
 *  3. Category fallback: EMAIL_1 → vault_EMAIL
 */

const STORAGE_PREFIX = 'ps_v_';
const cache = new Map<string, string>();

// ─── Core storage helpers ─────────────────────────────────────────────────────

async function writeStorage(key: string, value: string): Promise<void> {
  await chrome.storage.local.set({ [`${STORAGE_PREFIX}${key}`]: value });
}

async function readStorage(key: string): Promise<string | null> {
  const storeKey = `${STORAGE_PREFIX}${key}`;
  const result = await chrome.storage.local.get(storeKey);
  const value = result[storeKey] as string | undefined;
  if (value == null) return null;
  cache.set(key, value);
  return value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Store a value under an exact key. */
export async function storeValue(key: string, value: string): Promise<void> {
  cache.set(key, value);
  await writeStorage(key, value);
}

/**
 * Store by PII category (e.g. 'EMAIL' → 'user@example.com').
 * Called by the popup Vault UI — saves as "vault_EMAIL" etc.
 */
export async function storeCategoryValue(category: string, value: string): Promise<void> {
  await storeValue(`vault_${category.toUpperCase()}`, value);
}

/**
 * Resolve a redaction token to its real value.
 *  [EMAIL_1] → EMAIL_1 → tries "EMAIL_1" then "vault_EMAIL"
 */
export async function resolveValue(token: string, targetEl?: HTMLElement): Promise<string | null> {
  // Normalise: strip [ ] brackets
  const key = token.replace(/^\[|\]$/g, '');

  let resolved: string | null = null;

  // 1. Memory cache
  if (cache.has(key)) resolved = cache.get(key)!;
  else {
    // 2. Exact storage key (e.g. manually stored "EMAIL_1")
    const exact = await readStorage(key);
    if (exact !== null) resolved = exact;
    else {
      // 3. Category fallback: EMAIL_1 → EMAIL → vault_EMAIL
      const category = key.replace(/_\d+$/, '').toUpperCase();
      const catKey = `vault_${category}`;
      
      if (cache.has(catKey)) resolved = cache.get(catKey)!;
      else {
        const catVal = await readStorage(catKey);
        if (catVal !== null) resolved = catVal;
      }
    }
  }

  // 4. Context-aware modifications (e.g., splitting First/Last name)
  if (resolved !== null && targetEl && key.startsWith('PERSON')) {
    const label = `${targetEl.getAttribute('aria-label') ?? ''} ${(targetEl as HTMLInputElement).placeholder ?? ''}`.toLowerCase();
    const parts = resolved.split(/\s+/);
    if (parts.length > 1) {
      if (label.includes('first')) return parts[0];
      if (label.includes('last')) return parts[parts.length - 1];
    }
  }

  if (resolved !== null) return resolved;

  // Debug: log all vault keys to help diagnose empty vault
  const all = await chrome.storage.local.get(null);
  const vaultKeys = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));
  console.warn(`[Nivara-X] resolveValue(${token}) found nothing. Vault keys:`, vaultKeys);
  return null;
}

/** List stored category labels (for popup display). */
export async function listVaultCategories(): Promise<string[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter(k => k.startsWith(`${STORAGE_PREFIX}vault_`))
    .map(k => k.replace(`${STORAGE_PREFIX}vault_`, ''));
}

/** Wipe all vault data. */
export async function clearVault(): Promise<void> {
  cache.clear();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(STORAGE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}
