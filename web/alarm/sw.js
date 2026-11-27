/* Service Worker: macht die App offline verfügbar.
   Nach jedem Update der App-Dateien hier die Versionsnummer erhöhen. */
const CACHE = 'ad-1.3.0';
const SHELL = ['./', './index.html', './app.js', './logo.png', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './config.js', './anzeige.html', './anzeige.js', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css', '../vendor/qrcode-generator/qrcode.js', '../shared/fwsync.js', '../shared/fwui.js', '../shared/fwroute.js'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const EXTRA = [];
const FBMODS = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(EXTRA.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
    await Promise.all(FBMODS.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('ad-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const handled = u => u.origin === location.origin || u.hostname === 'cdnjs.cloudflare.com' || u.hostname === 'fonts.googleapis.com' ||
  u.hostname === 'fonts.gstatic.com' || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'));

/* Eigene Dateien: zuerst aus dem Netz (immer neuste Version), offline aus dem Cache.
   Fremde Bibliotheken (Firebase, Schriften): aus dem Cache, im Hintergrund aktualisieren. */
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (!handled(u)) return;
  const own = u.origin === location.origin;
  e.respondWith(caches.open(CACHE).then(async c => {
    if (own) {
      try {
        const res = await timeout(fetch(r, { cache: 'no-cache' }), 4000);
        if (res && res.ok) { c.put(r, res.clone()); return res; }
      } catch (err) {}
      const hit = await c.match(r, { ignoreSearch: true });
      if (hit) return hit;
      if (r.mode === 'navigate') return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      return Response.error();
    }
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  }));
});
