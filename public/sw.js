/* TickLocal — service worker. Đổi số phiên bản CACHE mỗi lần phát hành để máy người dùng nhận bản mới. */
const CACHE = 'ticklocal-v4.0.1';
// Đường dẫn tương đối theo vị trí của sw.js → chạy được cả ở gốc tên miền lẫn ở /<tên-repo>/ của GitHub Pages
const HOME = new URL('./', self.location).href;
const SHELL = [HOME, 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'].map((p) => new URL(p, HOME).href);

// Đọc index.html để lưu đệm luôn file JS/CSS có hash do Vite sinh ra → mất mạng ngay sau lần mở đầu tiên vẫn chạy được
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  try {
    const html = await (await fetch(HOME, { cache: 'no-cache' })).text();
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], HOME))
      .filter((u) => u.origin === self.location.origin && /\.(js|css)$/.test(u.pathname)).map((u) => u.href);
    await c.addAll([...new Set(urls)]);
  } catch (e) { /* mất mạng lúc cài: các file sẽ được lưu ở lần mở sau */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const put = (res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
  if (req.mode === 'navigate') {
    // Trang chính: ưu tiên mạng để nhận bản mới, mất mạng thì dùng bản đã lưu
    event.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((hit) => hit || caches.match(HOME))));
    return;
  }
  // Tài nguyên tĩnh (JS/CSS có hash): trả ngay từ cache, đồng thời cập nhật ngầm
  event.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then(put).catch(() => hit);
    return hit || net;
  }));
});
