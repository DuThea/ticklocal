/* TickLocal — service worker. Bump the CACHE version on every release so users' devices pick up the new build. */
const CACHE = 'ticklocal-v4.0.2';
// Paths are relative to sw.js → works both at the domain root and under /<repo-name>/ on GitHub Pages
const HOME = new URL('./', self.location).href;
const SHELL = [HOME, 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'].map((p) => new URL(p, HOME).href);

// Read index.html to also cache Vite's hashed JS/CSS files → works offline right after the first visit
async function precache() {
  const c = await caches.open(CACHE);
  await c.addAll(SHELL);
  try {
    const html = await (await fetch(HOME, { cache: 'no-cache' })).text();
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1], HOME))
      .filter((u) => u.origin === self.location.origin && /\.(js|css)$/.test(u.pathname)).map((u) => u.href);
    await c.addAll([...new Set(urls)]);
  } catch (e) { /* offline during install: the files will be cached on the next visit */ }
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
    // Main page: network first to get updates, fall back to the cached copy when offline
    event.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((hit) => hit || caches.match(HOME))));
    return;
  }
  // Static assets (hashed JS/CSS): serve from cache immediately and refresh in the background
  event.respondWith(caches.match(req).then((hit) => {
    const net = fetch(req).then(put).catch(() => hit);
    return hit || net;
  }));
});
