/**
 * Local Value Resolver — IndexedDB backed, AES-GCM encrypted.
 * Sensitive values NEVER leave this module.
 * The server only ever sees tokens like [EMAIL_1].
 *
 * Resolution order:
 *  1. In-memory session cache (fastest)
 *  2. IndexedDB exact key match (e.g. "EMAIL_1")
 *  3. Category fallback (e.g. "EMAIL_1" → looks up "vault_EMAIL")
 */

const DB_NAME = 'privacyshield-vault';
const STORE_NAME = 'secrets';
const KEY_STORE = 'encryption-key';

const cache = new Map<string, string>();

async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = await chrome.storage.session.get(KEY_STORE);
  if (stored[KEY_STORE]) {
    const raw = Uint8Array.from(stored[KEY_STORE] as number[]);
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const exported = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({ [KEY_STORE]: Array.from(new Uint8Array(exported)) });
  return key;
}

async function encrypt(value: string): Promise<{ iv: number[]; data: number[] }> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}

async function decrypt(payload: { iv: number[]; data: number[] }): Promise<string> {
  const key = await getOrCreateKey();
  const iv = new Uint8Array(payload.iv);
  const data = new Uint8Array(payload.data);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function lookupDB(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    const encrypted: { iv: number[]; data: number[] } | undefined = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!encrypted) return null;
    const value = await decrypt(encrypted);
    cache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/** Store a real value under an exact key (e.g. token or vault_EMAIL). */
export async function storeValue(key: string, value: string): Promise<void> {
  cache.set(key, value);
  const db = await openDB();
  const encrypted = await encrypt(value);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(encrypted, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Store a value by PII category (e.g. EMAIL → "user@example.com").
 * This is used by the popup Vault UI so users pre-fill their details once.
 */
export async function storeCategoryValue(category: string, value: string): Promise<void> {
  await storeValue(`vault_${category.toUpperCase()}`, value);
}

/**
 * Resolve a token like [EMAIL_1] to its real value.
 * Falls back to the category vault entry (vault_EMAIL) if no exact match.
 */
export async function resolveValue(token: string): Promise<string | null> {
  // Normalize: [EMAIL_1] → EMAIL_1
  const key = token.replace(/^\[|\]$/g, '');

  // 1. Session cache
  if (cache.has(key)) return cache.get(key)!;

  // 2. Exact DB match
  const exact = await lookupDB(key);
  if (exact !== null) return exact;

  // 3. Category fallback: EMAIL_1 → vault_EMAIL
  const category = key.replace(/_\d+$/, '').toUpperCase();
  const catKey = `vault_${category}`;
  if (cache.has(catKey)) return cache.get(catKey)!;
  return lookupDB(catKey);
}

/** Clear all stored secrets (call on user request or extension unload). */
export async function clearVault(): Promise<void> {
  cache.clear();
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Return all vault category keys currently stored (for UI display). */
export async function listVaultCategories(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => {
      const keys = (req.result as string[]).filter(k => k.startsWith('vault_'));
      resolve(keys.map(k => k.replace('vault_', '')));
    };
    req.onerror = () => reject(req.error);
  });
}
