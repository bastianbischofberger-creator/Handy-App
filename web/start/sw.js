/* Service Worker der Startseite: macht sie offline verfügbar.
   Nach jedem Update der Dateien hier die Versionsnummer erhöhen. */
const CACHE = 'start-1.6.0';
const SHELL = ['./', './index.html', './logo.png', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  '../asue/icon-192.png', '../mehrfach/icon-192.png', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('start-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* Zuerst aus dem Netz (neuste Version), offline aus dem Cache. */
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    try {
      const res = await fetch(r, { cache: 'no-cache' });
      if (res && res.ok) { c.put(r, res.clone()); return res; }
    } catch (err) {}
    const hit = await c.match(r, { ignoreSearch: true });
    if (hit) return hit;
    if (r.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
