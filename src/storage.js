/* TickLocal v4 — lưu trữ. IndexedDB là kho chính: mỗi bản ghi một dòng, mỗi lần lưu chỉ ghi phần thay đổi.
   v3 ghi lại toàn bộ dữ liệu vào localStorage sau mỗi chỉnh sửa (đứng giao diện 267 ms ở năm thứ ba, trần ~5 triệu ký tự). */
import { STORAGE_KEY, LEGACY_KEYS, normalizeDb, seedData, todayStr } from './core.js';

export const safeStorage = {
  available: (() => {
    try { const k = '__tl_probe__'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); return true; } catch (e) { return false; }
  })(),
  getItem(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
  setItem(key, val) { try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; } },
  removeItem(key) { try { window.localStorage.removeItem(key); } catch (e) { /* bỏ qua */ } }
};

const DB_NAME = 'ticklocal';
const META = 'meta';
const COLLS = ['tasks', 'focusSessions', 'habits', 'lists', 'folders', 'tags', 'countdowns', 'smartFilters'];
// Bộ sưu tập nhỏ cần giữ đúng thứ tự người dùng tạo (IndexedDB trả về theo thứ tự khoá)
const ORDERED = ['folders', 'lists', 'tags', 'habits', 'countdowns', 'smartFilters'];

function openIdb() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err || new Error('IndexedDB không dùng được')); } };
    const timer = setTimeout(() => fail(new Error('IndexedDB không phản hồi')), 4000);
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
      rq.onblocked = () => { clearTimeout(timer); fail(new Error('IndexedDB đang bị khoá')); };
    } catch (e) { clearTimeout(timer); fail(e); }
  });
}

const reqP = (rq) => new Promise((resolve, reject) => { rq.onsuccess = () => resolve(rq.result); rq.onerror = () => reject(rq.error); });
const txDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error || new Error('Giao dịch lỗi'));
  tx.onabort = () => reject(tx.error || new Error('Giao dịch bị huỷ (có thể hết dung lượng)'));
});

async function idbLoad(idb) {
  const tx = idb.transaction([...COLLS, META], 'readonly');
  const out = {};
  const meta = tx.objectStore(META);
  const jobs = COLLS.map((c) => reqP(tx.objectStore(c).getAll()).then((rows) => { out[c] = rows; }));
  for (const key of ['schemaVersion', 'settings', 'archive', 'order', 'lastUpdatedAt']) jobs.push(reqP(meta.get(key)).then((v) => { out[key] = v; }));
  await Promise.all(jobs);
  if (out.schemaVersion == null) return null; // kho còn trống
  const order = out.order || {};
  for (const c of ORDERED) {
    const pos = new Map((order[c] || []).map((id, i) => [id, i]));
    out[c].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 1e9) - (pos.has(b.id) ? pos.get(b.id) : 1e9));
  }
  out.tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  out.focusSessions.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  return out;
}

// So theo tham chiếu: state bất biến nên bản ghi nào còn nguyên object cũ là chưa đổi → không ghi lại.
// prev = null nghĩa là ghi đè toàn bộ (lần đầu, sau khi nhập file, sau di trú).
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
    } catch (e) { /* rơi xuống nhánh giữ bản hỏng */ }
    safeStorage.setItem(`${key}_CORRUPT_${Date.now()}`, raw); // giữ bản gốc để cứu, không ghi đè
    return { corrupt: true };
  }
  return null;
}

/* Mở kho và trả về:
     mode    'idb' | 'ls' (không có IndexedDB, quay về localStorage) | 'memory' (không lưu được gì)
     initial dữ liệu đã normalize để khởi tạo state
     saved   ảnh chụp đã nằm trong kho (null = chưa ghi lần nào)
     origin  'v4' | 'migrated' | 'seed' | 'corrupt'
     save(prev, next) → Promise<số bản ghi đã ghi> */
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
        ? Promise.resolve(1) : Promise.reject(new Error('localStorage đầy')))
    };
  }
  return { mode: 'memory', initial, saved: null, origin, save: () => Promise.resolve(0) };
}

// Xin trình duyệt không tự dọn dữ liệu của app khi máy thiếu chỗ
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
