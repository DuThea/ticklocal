/* TickLocal v4 — storage. IndexedDB is the main store: one row per record, each save writes only what changed.
   v3 rewrote all data to localStorage after every edit (267 ms UI freezes by year three, ~5 million character cap). */
import { STORAGE_KEY, LEGACY_KEYS, normalizeDb, seedData, todayStr } from './core.js';

export const safeStorage = {
  available: (() => {
    try { const k = '__tl_probe__'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  })(),
  getItem(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
  setItem(key, val) { try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; } },
  removeItem(key) { try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ } }
};

const DB_NAME = 'ticklocal';
const META = 'meta';
const COLLS = ['tasks', 'focusSessions', 'habits', 'lists', 'folders', 'tags', 'countdowns', 'smartFilters'];
// Small collections that must keep the user's creation order (IndexedDB returns rows in key order)
const ORDERED = ['folders', 'lists', 'tags', 'habits', 'countdowns', 'smartFilters'];

function openIdb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err || new Error('IndexedDB unavailable')); } };
    const timer = setTimeout(() => fail(new Error('IndexedDB not responding')), 4000);
    try {
      const rq = window.indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        for (const c of COLLS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      rq.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { rq.result.close(); return; }
        settled = true;
        resolve(rq.result);
      };
      rq.onerror = () => { clearTimeout(timer); fail(rq.error); };
      rq.onblocked = () => { clearTimeout(timer); fail(new Error('IndexedDB is blocked')); };
    } catch (e) { clearTimeout(timer); fail(e); }
  });
}

const reqP = (rq) => new Promise((resolve, reject) => { rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error); });
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted (possibly out of space)'));
});

async function idbLoad(idb) {
  const tx = idb.transaction([...COLLS, META], 'readonly');
  const out = {};
  const meta = tx.objectStore(META);
  const jobs = COLLS.map((c) => reqP(tx.objectStore(c).getAll()).then((rows) => { out[c] = rows; }));
  for (const key of ['schemaVersion', 'settings', 'archive', 'order', 'lastUpdatedAt']) jobs.push(reqP(meta.get(key)).then((v) => { out[key] = v; }));
  await Promise.all(jobs);
  if (out.schemaVersion == null) return null; // the store is still empty
  const order = out.order || {};
  for (const c of ORDERED) {
    const pos = new Map((order[c] || []).map((id, i) => [id, i]));
    out[c].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  }
  out.tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  out.focusSessions.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  return out;
}

// Compare by reference: state is immutable, so a record that is still the same object has not changed → not rewritten.
// prev = null means overwrite everything (first run, after an import, after a migration).
function idbSave(idb, prev, next) {
  const tx = idb.transaction([...COLLS, META], 'readwrite');
  let writes = 0;
  for (const c of COLLS) {
    if (prev && prev[c] === next[c]) continue;
    const store = tx.objectStore(c);
    if (!prev) {
      store.clear();
      for (const row of next[c]) { store.put(row); writes++; }
      continue;
    }
    const old = new Map(prev[c].map((row) => [row.id, row]));
    for (const row of next[c]) {
      if (old.get(row.id) !== row) { store.put(row); writes++; }
      old.delete(row.id);
    }
    for (const id of old.keys()) { store.delete(id); writes++; }
  }
  const meta = tx.objectStore(META);
  if (!prev || prev.settings !== next.settings) meta.put(next.settings, 'settings');
  if (!prev || prev.archive !== next.archive) meta.put(next.archive, 'archive');
  if (!prev || ORDERED.some((c) => prev[c] !== next[c])) meta.put(Object.fromEntries(ORDERED.map((c) => [c, next[c].map((x) => x.id)])), 'order');
  meta.put(next.schemaVersion, 'schemaVersion');
  meta.put(new Date().toISOString(), 'lastUpdatedAt');
  return txDone(tx).then(() => writes);
}

function readLocalStorage() {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    const raw = safeStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tasks)) return { db: normalizeDb(parsed).db, key };
    } catch (e) { /* fall through to keeping the corrupted copy */ }
    safeStorage.setItem(`${key}_CORRUPT_${Date.now()}`, raw); // keep the original for recovery, never overwrite it
    return { corrupt: true };
  }
  return null;
}

/* Open the store and return:
     mode    'idb' | 'ls' (no IndexedDB, falls back to localStorage) | 'memory' (cannot save anything)
     initial normalized data used to initialize state
     saved   snapshot already in the store (null = never written)
     origin  'v4' | 'migrated' | 'seed' | 'corrupt'
     save(prev, next) → Promise<number of records written> */
export async function openStore() {
  let idb = null;
  try { idb = await openIdb(); } catch (e) { idb = null; }

  if (idb) {
    try {
      const raw = await idbLoad(idb);
      if (raw) {
        const initial = normalizeDb(raw).db;
        return { mode: 'idb', initial, saved: initial, origin: 'v4', save: (prev, next) => idbSave(idb, prev, next) };
      }
    } catch (e) { idb = null; }
  }

  const legacy = readLocalStorage();
  const fresh = () => seedData(todayStr(), new Date().toISOString());
  const initial = legacy && legacy.db ? legacy.db : fresh();
  const origin = legacy && legacy.db ? (legacy.key === STORAGE_KEY ? 'v4' : 'migrated') : legacy && legacy.corrupt ? 'corrupt' : 'seed';

  if (idb) return { mode: 'idb', initial, saved: null, origin, save: (prev, next) => idbSave(idb, prev, next) };
  if (safeStorage.available) {
    return {
      mode: 'ls', initial, origin, saved: legacy && legacy.key === STORAGE_KEY ? initial : null,
      save: (prev, next) => (safeStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, lastUpdatedAt: new Date().toISOString() }))
        ? Promise.resolve(1) : Promise.reject(new Error('localStorage is full')))
    };
  }
  return { mode: 'memory', initial, saved: null, origin, save: () => Promise.resolve(0) };
}

// Ask the browser not to evict the app's data when the device runs low on space
export async function requestPersistence() {
  try { return !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) { return false; }
}

export async function storageEstimate() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usageMB: usage / 1048576, quotaMB: quota / 1048576 };
  } catch (e) { return null; }
}
