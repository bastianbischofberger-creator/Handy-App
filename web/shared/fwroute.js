/* Gemeinsame Routenberechnung der FW-RTL-Apps (aus «Route & Sperren»): berücksichtigt aktive Sperren mit Umleitung
   und Bahnübergänge (gesperrt / meiden). Routing: Valhalla (FOSSGIS). Aufruf: await FWRoute.route(D, [lat,lng], [lat,lng])
   D = Inhalt von Firestore config/routing (Punkte als {la,lo}). */
(function () {
'use strict';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const W_SP = 14, W_BX = 15;
const M_LAT = 111320, mLng = lat => 111320 * Math.cos(lat * Math.PI / 180);
const toXY = (p, o) => [(p[1] - o[1]) * mLng(o[0]), (p[0] - o[0]) * M_LAT];
const toLL = (xy, o) => [o[0] + xy[1] / M_LAT, o[1] + xy[0] / mLng(o[0])];
function segRects(pts, w) { // pro Strecken-Abschnitt ein Rechteck (Korridor) → Ringe [[lon,lat],…]
  const rings = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const o = pts[i], a = [0, 0], b = toXY(pts[i + 1], o), L = Math.hypot(b[0], b[1]) || 1;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy * w, ny = ux * w;
    const A = [a[0] - ux * w, a[1] - uy * w], B = [b[0] + ux * w, b[1] + uy * w];
    const c = [[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]];
    const ring = c.map(p => toLL(p, o)).map(p => [p[1], p[0]]); ring.push(ring[0]); rings.push(ring);
  }
  return rings;
}
function boxRing(p, w) { const o = p; const c = [[-w, -w], [w, -w], [w, w], [-w, w]].map(q => toLL(q, o)).map(q => [q[1], q[0]]); c.push(c[0]); return c; }
function distSeg(p, a, b) { // Distanz Punkt–Strecke in Metern
  const o = p, A = toXY(a, o), B = toXY(b, o), dx = B[0] - A[0], dy = B[1] - A[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / L)) : 0;
  return Math.hypot(A[0] + t * dx, A[1] + t * dy);
}
const distLine = (p, line) => { let m = Infinity; for (let i = 0; i < line.length - 1; i++) m = Math.min(m, distSeg(p, line[i], line[i + 1])); return m; };
const lineNear = (line, path, d) => path.some(p => distLine(p, line) <= d);
function decode6(s) { // Valhalla-Polyline (Genauigkeit 6)
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < s.length) {
    for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k === 0) lat += d; else lng += d; }
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}


const decL = a => a ? a.map(p => Array.isArray(p) ? p : [p.la, p.lo]) : null;
const stOf = x => x.st || (x.ok ? 'ok' : 'meiden');
function sState(s) { const now = Date.now(), v = s.von ? +new Date(s.von) : 0, b = s.bis ? +new Date(s.bis) : Infinity; return now < v ? 'plan' : now > b ? 'alt' : 'akt'; }
async function valhalla(locs, excl) {
  const body = { locations: locs.map(p => ({ lat: p[0], lon: p[1], type: p[2] || 'break' })), costing: 'auto', exclude_polygons: excl, directions_options: { language: 'de-DE', units: 'kilometers' } };
  const r = await fetch(VALHALLA, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.trip) throw new Error(j.error || ('HTTP ' + r.status));
  return { path: j.trip.legs.flatMap(l => decode6(l.shape)), km: j.trip.summary.length, min: j.trip.summary.time / 60 };
}
async function route(V, start, end) {
  const sp = (V.sperren || []).map(s => ({ ...s, pts: decL(s.pts), uml: decL(s.uml) })).filter(s => sState(s) === 'akt' && s.pts && s.pts.length > 1);
  const bahn = V.bahn || {}, meiden = bahn.meiden !== false;
  const la = [start[0], end[0]], lo = [start[1], end[1]], m = 3000 / M_LAT, mo = 3000 / mLng(start[0]);
  const near = x => x.lat > Math.min(...la) - m && x.lat < Math.max(...la) + m && x.lng > Math.min(...lo) - mo && x.lng < Math.max(...lo) + mo;
  const av = (bahn.list || []).filter(x => stOf(x) === 'sperre' || (meiden && stOf(x) === 'meiden'));
  const excl = [...sp.flatMap(s => segRects(s.pts, W_SP)), ...av.filter(near).slice(0, 60).map(x => boxRing([x.lat, x.lng], W_BX))];
  let via = [];
  const withUml = sp.filter(s => s.uml && s.uml.length > 1);
  if (withUml.length) { let d = null; try { d = await valhalla([start, end], []); } catch (e) {}
    for (const s of withUml) if (d && lineNear(s.pts, d.path, W_SP)) { let u = s.uml; if (Math.hypot(...toXY(u[0], start)) > Math.hypot(...toXY(u[u.length - 1], start))) u = [...u].reverse(); via.push(...u.map(p => [p[0], p[1], 'through'])); } }
  let r; try { r = await valhalla([start, ...via, end], excl); } catch (e) { if (!via.length) throw e; r = await valhalla([start, end], excl); }
  r.sperrBahn = av.filter(x => stOf(x) === 'sperre' && distLine([x.lat, x.lng], r.path) < 12).length;
  return r;
}
// kompakte Speicherung eines Pfads als Text (Firestore: keine verschachtelten Listen)
const packPath = P => P.filter((p, i) => i % 2 === 0 || i === P.length - 1).map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');
const unpackPath = s => String(s || '').split(';').filter(Boolean).map(x => x.split(',').map(Number));
window.FWRoute = { route, packPath, unpackPath, sState, decL };
})();
