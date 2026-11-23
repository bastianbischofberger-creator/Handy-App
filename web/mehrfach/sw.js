/* Service Worker: macht die App offline verfügbar.
   Nach jedem Update der App-Dateien hier die Versionsnummer erhöhen. */
const CACHE = 'mf-0.6.0';
const SHELL = ['./', './index.html', './app.js', './config.js', './logo.png', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './apple-touch-icon.png', './vendor/jspdf.umd.min.js', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css',
  '../vendor/qrcode-generator/qrcode.js', './checkin.html', './checkin.js'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const FBMODS = [FB + 'firebase-app.js', FB + 'firebase-auth.js', FB + 'firebase-firestore.js'];
const TILES = 'mf-tiles';
const MAXTILES = 1500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(FBMODS.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  /* Kartenkacheln: einmal angesehene Gebiete bleiben offline verfügbar */
  if (u.hostname === 'wmts.geo.admin.ch') {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(r); if (hit) return hit;
      try { const res = await fetch(r); if (res && (res.ok || res.type === 'opaque')) { c.put(r, res.clone()); trim(c); } return res; }
      catch (err) { return Response.error(); }
    }));
    return;
  }
  const own = u.origin === location.origin;
  const lib = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || (u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/'));
  if (!own && !lib) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    if (own) {
      try { const res = await timeout(fetch(r, { cache: 'no-cache' }), 4000); if (res && res.ok) { c.put(r, res.clone()); return res; } } catch (err) {}
      const hit = await c.match(r, { ignoreSearch: true }); if (hit) return hit;
      if (r.mode === 'navigate') return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      return Response.error();
    }
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  }));
});
let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try { const ks = await c.keys(); if (ks.length > MAXTILES) await Promise.all(ks.slice(0, ks.length - MAXTILES).map(k => c.delete(k))); } catch (e) {}
  trimming = false;
}
