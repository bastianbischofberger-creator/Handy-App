/* Service Worker: macht die App offline verfügbar.
   Nach jedem Update der App-Dateien hier die Versionsnummer erhöhen. */
const CACHE = 'asue-1.0.7';
const SHELL = ['./', './index.html', './app.js', './config.js', './logo.png', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './vendor/jspdf.umd.min.js', './vendor/jsQR.js'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const EXTRA = [];
const FBMODS = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    await Promise.all(EXTRA.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
    await Promise.all(FBMODS.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const handled = u => u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com' || u.hostname === 'fonts.googleapis.com' ||
  u.hostname === 'fonts.gstatic.com' || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'));

/* Aus dem Cache liefern (sofort, auch offline) und im Hintergrund aktualisieren. */
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (!handled(u)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(r, { ignoreSearch: u.origin === location.origin });
    const net = fetch(r, u.origin === location.origin ? { cache: 'no-cache' } : {}).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (r.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
