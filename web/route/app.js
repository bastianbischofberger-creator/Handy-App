/* Route & Sperren – Feuerwehr RTL (Testaufbau).
   Route ab Depot(s) zum Einsatzort. Berücksichtigt zeitlich begrenzte Strassensperren (mit optionaler Umleitung)
   und die Vorgabe «Bahnübergänge meiden». Routing: Valhalla (valhalla1.openstreetmap.de, FOSSGIS),
   Bahnübergänge: OpenStreetMap über die Overpass-API. Gemeinsame Daten: Firestore config/routing. */
const VERSION = '1.1.0';
const CFG = window.RT_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
// Öffentliche OpenStreetMap-Abfragedienste – oft überlastet, darum mehrere der Reihe nach versuchen
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TILE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';
const HOME = [47.4655, 9.5905];
const W_SP = 14, W_BX = 15;          // halbe Breite Sperr-Korridor / Bahnübergangs-Quadrat in Metern
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dt = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${hm(t)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => m.textContent = '', 4500); }
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);

/* ---------- Geometrie (lokal in Metern, genügt für das Einsatzgebiet) ---------- */
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

/* ---------- Daten ---------- */
let D = { depots: [], sperren: [], bahn: { meiden: true, list: [] } };
const now = () => Date.now();
const stOf = x => x.st || (x.ok ? 'ok' : 'meiden');
const ST_TXT = { sperre: 'gesperrt', meiden: 'meiden', ok: 'erlaubt' };
const sState = s => { const v = s.von ? +new Date(s.von) : 0, b = s.bis ? +new Date(s.bis) : Infinity; return now() < v ? 'plan' : now() > b ? 'alt' : 'akt'; };
const active = () => D.sperren.filter(s => sState(s) === 'akt' && s.pts && s.pts.length > 1);

/* ---------- Firebase (config/routing) ---------- */
let F, fs, A, auth, ref;
const S = { user: null, err: '' };
function sync() { const el = $('#sync'); let c = 'ok', t = 'Synchronisiert'; if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline'; } else if (!S.user) { c = 'warn'; t = 'Nicht angemeldet'; } el.className = 'sync ' + c; el.textContent = t; }
addEventListener('online', sync); addEventListener('offline', sync);
$('#sync').addEventListener('click', () => { if (F && fs && S.user && window.FWSync) FWSync.open({ F, fs, user: S.user.email, onDone: () => { S.err = ''; sync(); } }); });
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff' : 'Sync-Fehler: ' + (e && (e.code || e.message)); sync(); };
async function boot() {
  try {
    const [appM, Au, Fm] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    F = Fm; A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase);
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    ref = F.doc(fs, 'config', 'routing');
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; msg('Beim ersten Öffnen braucht es Internet.'); return; }
  A.onAuthStateChanged(auth, u => { S.user = u && !u.isAnonymous ? u : null; $('#login').hidden = !!S.user; sync(); if (S.user) start(); });
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.pw.value); f.pw.value = ''; }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung.' : 'E-Mail oder Passwort falsch.'; }
});
let started = false;
function start() {
  if (started) return; started = true;
  F.onSnapshot(ref, d => {
    const v = d.exists() ? d.data() : {};
    D = { depots: v.depots || [], sperren: (v.sperren || []).map(s => ({ ...s, pts: decL(s.pts), uml: decL(s.uml) })), bahn: { meiden: v.bahn ? v.bahn.meiden !== false : true, list: (v.bahn && v.bahn.list) || [] } };
    S.err = ''; sync(); renderAll();
  }, fail);
}
// Firestore kennt keine verschachtelten Listen → Punkte als {la, lo} speichern
const encL = a => a ? a.map(p => ({ la: p[0], lo: p[1] })) : null;
const decL = a => a ? a.map(p => Array.isArray(p) ? p : [p.la, p.lo]) : null;
const save = () => { if (!ref) return msg('Nicht verbunden'); return F.setDoc(ref, { ...D, sperren: D.sperren.map(s => ({ ...s, pts: encL(s.pts), uml: encL(s.uml) })), upd: now(), by: S.user ? S.user.email : '' }).catch(e => { fail(e); msg('Speichern fehlgeschlagen: ' + (e.code || e.message)); }); };

/* ---------- Karte ---------- */
L.Control.Attribution.prototype.options.prefix = false;
const map = L.map('map').setView(HOME, 14);
L.tileLayer(TILE, { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo · Route: OpenStreetMap/Valhalla' }).addTo(map);
const gBase = L.layerGroup().addTo(map), gRoute = L.layerGroup().addTo(map), gDraw = L.layerGroup().addTo(map);
let ziel = null; // {lat,lng,label}
const pinIcon = (bg, txt) => L.divIcon({ className: '', html: `<div style="background:${bg};color:#fff;font:700 12px Barlow,sans-serif;padding:3px 7px;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);white-space:nowrap;width:max-content;transform:translate(-50%,-50%)">${esc(txt)}</div>`, iconSize: [0, 0] });
function drawBase() {
  gBase.clearLayers();
  for (const s of D.sperren) {
    if (!s.pts || s.pts.length < 2) continue; const st = sState(s); if (st === 'alt') continue;
    const col = st === 'akt' ? '#c8102e' : '#d39b00';
    L.polyline(s.pts, { color: col, weight: 9, opacity: .8, dashArray: st === 'akt' ? null : '10 8' }).bindTooltip(`${esc(s.name)} (${st === 'akt' ? 'aktiv' : 'geplant'})`).addTo(gBase);
    if (s.uml && s.uml.length > 1) L.polyline(s.uml, { color: '#1d7a46', weight: 6, opacity: .85, dashArray: '2 10', lineCap: 'round' }).bindTooltip('Umleitung: ' + esc(s.name)).addTo(gBase);
  }
  for (const x of D.bahn.list) {
    const st = stOf(x), sz = st === 'sperre' ? 20 : 16;
    L.marker([x.lat, x.lng], { icon: L.divIcon({ className: '', html: `<div class="lx${st === 'ok' ? ' ok' : st === 'sperre' ? ' sp' : ''}"></div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }) })
      .bindPopup(() => `<div class="lxpop" data-lx="${x.id}"><b>Bahnübergang${x.bez ? ': ' + esc(x.bez) : ''}</b>${['sperre', 'meiden', 'ok'].map(k => `<button type="button" data-st="${k}" class="${stOf(x) === k ? 'on' : ''}">${k === 'sperre' ? 'Gesperrt – immer umfahren' : k === 'meiden' ? 'Meiden (wenn eingeschaltet)' : 'Erlaubt'}</button>`).join('')}<button type="button" data-st="name">Bezeichnung …</button>${x.man ? '<button type="button" data-st="del" class="danger">Löschen</button>' : ''}</div>`)
      .addTo(gBase);
  }
  for (const d of D.depots) L.marker([d.lat, d.lng], { icon: pinIcon('#16181a', d.name) }).addTo(gBase);
  if (ziel) L.marker([ziel.lat, ziel.lng], { icon: pinIcon('#c8102e', 'Einsatz') }).addTo(gBase);
}

// Auswahl im Popup eines Bahnübergangs
// (Leaflet stoppt Klicks im Popup → Handler direkt am Popup anhängen)
map.on('popupopen', ev => { const el = ev.popup.getElement(); if (el && !el._lx) { el._lx = 1; el.addEventListener('click', lxClick); } });
function lxClick(e) {
  const b = e.target.closest('.lxpop [data-st]'); if (!b) return;
  const x = D.bahn.list.find(y => y.id === b.closest('.lxpop').dataset.lx); if (!x) return;
  const k = b.dataset.st;
  if (k === 'del') { if (!confirm('Bahnübergang löschen?')) return; D.bahn.list = D.bahn.list.filter(y => y !== x); }
  else if (k === 'name') { const t = prompt('Bezeichnung (z. B. «Bahnhofstrasse»)', x.bez || ''); if (t == null) return; x.bez = t.trim(); }
  else { x.st = k; delete x.ok; msg('Bahnübergang: ' + ST_TXT[k]); }
  map.closePopup(); save(); renderAll();
}

/* ---------- Zeichnen ---------- */
let mode = null, pts = [], drawCtx = null;
function startDraw(m, ctx, text) { mode = m; pts = []; drawCtx = ctx; $('#drawT').textContent = text; $('#draw').hidden = false; $('#dUndo').hidden = $('#dDone').hidden = !(m === 'sperre' || m === 'uml'); $('#dCancel').textContent = m === 'bahn' ? 'Fertig' : 'Abbrechen'; drawTmp(); }
function endDraw() { mode = null; pts = []; drawCtx = null; $('#draw').hidden = true; gDraw.clearLayers(); }
function drawTmp() { gDraw.clearLayers(); if (pts.length) { L.polyline(pts, { color: mode === 'uml' ? '#1d7a46' : '#c8102e', weight: 7 }).addTo(gDraw); pts.forEach(p => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#16181a', fillOpacity: 1 }).addTo(gDraw)); } }
map.on('click', e => {
  const p = [e.latlng.lat, e.latlng.lng];
  if (mode === 'ziel') { ziel = { lat: p[0], lng: p[1], label: 'Punkt auf Karte' }; $('#zAdr').value = ''; endDraw(); drawBase(); return; }
  if (mode === 'depot') { D.depots.push({ id: uid(), name: drawCtx.name, lat: p[0], lng: p[1] }); endDraw(); save(); renderAll(); msg('Depot gespeichert'); return; }
  if (mode === 'sperre' || mode === 'uml') { pts.push(p); drawTmp(); }
  if (mode === 'bahn') { D.bahn.list.push({ id: 'm' + uid(), lat: +p[0].toFixed(6), lng: +p[1].toFixed(6), st: 'sperre', man: true }); save(); renderAll(); msg('Gesperrter Bahnübergang gesetzt'); }
});
$('#dUndo').onclick = () => { pts.pop(); drawTmp(); };
$('#dCancel').onclick = endDraw;
$('#dDone').onclick = () => {
  if (pts.length < 2) return msg('Mindestens 2 Punkte antippen');
  if (mode === 'sperre') { D.sperren.push({ id: uid(), ...drawCtx, pts: pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]), uml: null }); msg('Sperre gespeichert'); }
  if (mode === 'uml') { const s = D.sperren.find(x => x.id === drawCtx.id); if (s) s.uml = pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]); msg('Umleitung gespeichert'); }
  endDraw(); save(); renderAll();
};

/* ---------- Listen ---------- */
function renderSperren() {
  const order = { akt: 0, plan: 1, alt: 2 };
  const l = [...D.sperren].sort((a, b) => order[sState(a)] - order[sState(b)]);
  $('#sList').innerHTML = l.length ? l.map(s => { const st = sState(s); return `<li><div><span class="st ${st}">${st === 'akt' ? 'AKTIV' : st === 'plan' ? 'GEPLANT' : 'ABGELAUFEN'}</span><b>${esc(s.name)}</b></div>
    <span class="mute small">${esc(s.grund || '')}${s.grund ? ' · ' : ''}${s.von ? dt(s.von) : 'ab sofort'} – ${s.bis ? dt(s.bis) : 'offen'}</span>
    <span class="small">${s.uml ? '✓ Umleitung eingezeichnet' : 'Keine Umleitung – Route sucht selbst einen Weg'}</span>
    <div class="btns"><button type="button" data-z="${s.id}">Zeigen</button><button type="button" data-u="${s.id}">${s.uml ? 'Umleitung neu' : 'Umleitung zeichnen'}</button><button type="button" class="danger" data-x="${s.id}">Löschen</button></div></li>`; }).join('')
    : '<li class="mute">Noch keine Sperren.</li>';
}
function renderDepots() {
  $('#dList').innerHTML = D.depots.length ? D.depots.map(d => `<li><b>${esc(d.name)}</b><div class="btns"><button type="button" data-dz="${d.id}">Zeigen</button><button type="button" class="danger" data-dx="${d.id}">Löschen</button></div></li>`).join('')
    : '<li class="mute">Noch kein Depot. Name eingeben und auf der Karte setzen.</li>';
}
function renderBahn() {
  $('#bMeiden').checked = D.bahn.meiden;
  const n = D.bahn.list.length, c = k => D.bahn.list.filter(x => stOf(x) === k).length;
  $('#bInfo').textContent = n ? `${n} Bahnübergänge: ${c('sperre')} gesperrt, ${c('meiden')} meiden, ${c('ok')} erlaubt.` : 'Noch keine Bahnübergänge erfasst.';
}
function renderAll() { renderSperren(); renderDepots(); renderBahn(); drawBase(); }
$('#sList').addEventListener('click', e => {
  const z = e.target.closest('[data-z]'), u = e.target.closest('[data-u]'), x = e.target.closest('[data-x]');
  if (z) { const s = D.sperren.find(q => q.id === z.dataset.z); if (s && s.pts) map.fitBounds(L.latLngBounds(s.uml ? [...s.pts, ...s.uml] : s.pts).pad(.3)); }
  if (u) { const s = D.sperren.find(q => q.id === u.dataset.u); if (s) { map.fitBounds(L.latLngBounds(s.pts).pad(1)); startDraw('uml', { id: s.id }, 'Umleitung: Punkte entlang der Umleitungsstrecke antippen, von Anfang bis Ende'); } }
  if (x) { const s = D.sperren.find(q => q.id === x.dataset.x); if (s && confirm(`Sperre «${s.name}» löschen?`)) { D.sperren = D.sperren.filter(q => q !== s); save(); renderAll(); } }
});
$('#dList').addEventListener('click', e => {
  const z = e.target.closest('[data-dz]'), x = e.target.closest('[data-dx]');
  if (z) { const d = D.depots.find(q => q.id === z.dataset.dz); if (d) map.setView([d.lat, d.lng], 17); }
  if (x) { const d = D.depots.find(q => q.id === x.dataset.dx); if (d && confirm(`Depot «${d.name}» löschen?`)) { D.depots = D.depots.filter(q => q !== d); save(); renderAll(); } }
});
$('#bSperre').onclick = () => {
  if (!S.user) return msg('Zuerst anmelden');
  const name = $('#sName').value.trim(); if (!name) return msg('Bitte eine Bezeichnung eingeben');
  const von = $('#sVon').value, bis = $('#sBis').value;
  if (von && bis && new Date(bis) <= new Date(von)) return msg('«Bis» muss nach «Von» liegen');
  startDraw('sperre', { name, grund: $('#sGrund').value.trim(), von, bis }, 'Sperre: Punkte entlang der gesperrten Strasse antippen');
  $('#sName').value = $('#sGrund').value = $('#sVon').value = $('#sBis').value = '';
};
$('#bDepot').onclick = () => { if (!S.user) return msg('Zuerst anmelden'); const name = $('#dName').value.trim() || 'Depot'; $('#dName').value = ''; startDraw('depot', { name }, `«${name}»: Standort auf der Karte antippen`); };
$('#bMeiden').onchange = e => { D.bahn.meiden = e.target.checked; save(); };
$('#bLoadBahn').onclick = async () => {
  if (map.getZoom() < 12) return msg('Bitte näher hineinzoomen (Gemeindegebiet)');
  const b = map.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(v => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:20];node["railway"="level_crossing"](${bb});out;`;
  $('#bLoadBahn').disabled = true;
  try {
    let r = null, n = 0;
    for (const srv of OVERPASS) {
      msg(`Lade Bahnübergänge … (Server ${++n} von ${OVERPASS.length})`);
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 20000);
      try { const res = await fetch(srv + '?data=' + encodeURIComponent(q), { signal: ac.signal }); if (res.ok) { r = await res.json(); clearTimeout(to); break; } } catch (e) {}
      clearTimeout(to);
    }
    if (!r) throw new Error('alle Server');
    const old = new Map(D.bahn.list.map(x => [x.id, x])); let neu = 0;
    for (const n of r.elements || []) { if (!old.has('n' + n.id)) { old.set('n' + n.id, { id: 'n' + n.id, lat: n.lat, lng: n.lon, st: 'meiden' }); neu++; } }
    D.bahn.list = [...old.values()]; save(); renderAll(); msg(`${(r.elements || []).length} Bahnübergänge im Ausschnitt, ${neu} neu`);
  } catch (e) { msg('OpenStreetMap-Dienst antwortet nicht. Später nochmals versuchen oder Übergänge von Hand setzen.'); }
  $('#bLoadBahn').disabled = false;
};
$('#bAddBahn').onclick = () => { if (!S.user) return msg('Zuerst anmelden'); startDraw('bahn', null, 'Bahnübergänge auf der Karte antippen – mehrere nacheinander möglich'); };

/* ---------- Ziel ---------- */
$('#bZielMap').onclick = () => startDraw('ziel', null, 'Einsatzort auf der Karte antippen');
function fwZiel(quiet) {
  let e = null; try { e = JSON.parse(localStorage.getItem('fw-einsatz')); } catch (x) {}
  if (!e || e.lat == null) { if (!quiet) msg('Auf der Startseite ist kein Einsatz mit Adresse eröffnet'); return false; }
  ziel = { lat: e.lat, lng: e.lng, label: e.bez + ', ' + e.adr }; $('#zAdr').value = e.adr || ''; drawBase(); map.setView([e.lat, e.lng], 16); return true;
}
$('#bZielFw').onclick = () => fwZiel(false);
let sT, res = [];
const clean = l => l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = l => { const t = clean(l); const m = t.match(/^(.*?)\s(\d{4}\s.+)$/); return m ? m[1] + ', ' + m[2] : t; };
$('#zAdr').addEventListener('input', () => {
  clearTimeout(sT); const q = $('#zAdr').value.trim(); if (q.length < 3) { $('#sug').hidden = true; return; }
  sT = setTimeout(async () => {
    try { const r = await fetch('https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=4326&limit=8&searchText=' + encodeURIComponent(q)).then(r => r.json());
      res = (r.results || []).map(x => x.attrs).filter(a => a && a.lat);
      $('#sug').innerHTML = res.map((a, i) => `<button type="button" data-i="${i}">${esc(fmt(a.label))}</button>`).join(''); $('#sug').hidden = !res.length; } catch (e) { $('#sug').hidden = true; }
  }, 250);
});
$('#sug').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const a = res[+b.dataset.i]; $('#zAdr').value = fmt(a.label); ziel = { lat: a.lat, lng: a.lon, label: fmt(a.label) }; $('#sug').hidden = true; drawBase(); map.setView([a.lat, a.lon], 16); });

/* ---------- Routing ---------- */
async function valhalla(locs, excl) {
  const body = { locations: locs.map(p => ({ lat: p[0], lon: p[1], type: p[2] || 'break' })), costing: 'auto', exclude_polygons: excl, directions_options: { language: 'de-DE', units: 'kilometers' } };
  const r = await fetch(VALHALLA, { method: 'POST', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.trip) { const e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.error_code; throw e; }
  const path = j.trip.legs.flatMap(l => decode6(l.shape));
  return { path, km: j.trip.summary.length, min: j.trip.summary.time / 60 };
}
const avoidList = () => D.bahn.list.filter(x => stOf(x) === 'sperre' || (D.bahn.meiden && stOf(x) === 'meiden'));
async function routeFrom(dep) {
  const sp = active(), start = [dep.lat, dep.lng], end = [ziel.lat, ziel.lng];
  // Umkreis Start–Ziel (+3 km) – weiter entfernte Übergänge spielen keine Rolle
  const la = [start[0], end[0]], lo = [start[1], end[1]], m = 3000 / M_LAT, mo = 3000 / mLng(start[0]);
  const near = x => x.lat > Math.min(...la) - m && x.lat < Math.max(...la) + m && x.lng > Math.min(...lo) - mo && x.lng < Math.max(...lo) + mo;
  const bx = avoidList().filter(near).slice(0, 60);
  const excl = [...sp.flatMap(s => segRects(s.pts, W_SP)), ...bx.map(x => boxRing([x.lat, x.lng], W_BX))];
  const info = { dep, warn: [], used: [] };
  // Gilt für eine aktive Sperre eine eingezeichnete Umleitung? → nur wenn der direkte Weg durch die Sperre führen würde
  let via = [];
  const withUml = sp.filter(s => s.uml && s.uml.length > 1);
  if (withUml.length) {
    let direct = null; try { direct = await valhalla([start, end], []); } catch (e) {}
    for (const s of withUml) if (direct && lineNear(s.pts, direct.path, W_SP)) {
      let u = s.uml; if (Math.hypot(...toXY(u[0], start)) > Math.hypot(...toXY(u[u.length - 1], start))) u = [...u].reverse();
      via.push(...u.map(p => [p[0], p[1], 'through'])); info.used.push(s.name);
    }
  }
  let r;
  try { r = await valhalla([start, ...via, end], excl); }
  catch (e) {
    if (via.length) { info.warn.push('Umleitung liess sich nicht befahren – Route ohne Umleitung berechnet.'); r = await valhalla([start, end], excl); info.used = []; }
    else throw e;
  }
  // Kontrolle: führt die Route trotzdem über einen gemiedenen Bahnübergang?
  const hit = avoidList().filter(x => distLine([x.lat, x.lng], r.path) < 12);
  const hs = hit.filter(x => stOf(x) === 'sperre');
  if (hs.length) info.warn.push(`ACHTUNG: ${hs.length} gesperrte${hs.length > 1 ? '' : 'r'} Bahnübergang nicht vermeidbar – auf der Karte rot markiert.`);
  if (hit.length > hs.length) info.warn.push(`${hit.length - hs.length} Bahnübergang${hit.length - hs.length > 1 ? 'e' : ''} (meiden) nicht vermeidbar.`);
  return { ...r, ...info, hit };
}
let routes = [], selR = 0;
function drawRoutes() {
  gRoute.clearLayers();
  routes.forEach((r, i) => { if (r.err) return; const sel = i === selR;
    L.polyline(r.path, { color: '#fff', weight: sel ? 11 : 8, opacity: .9 }).addTo(gRoute);
    L.polyline(r.path, { color: sel ? '#1565c0' : '#6b8fbf', weight: sel ? 7 : 5, opacity: sel ? 1 : .7 }).addTo(gRoute);
    if (sel) r.hit.forEach(x => L.circleMarker([x.lat, x.lng], { radius: 14, color: '#c8102e', weight: 4, fill: false }).addTo(gRoute)); });
  const r = routes[selR]; if (r && !r.err) map.fitBounds(L.latLngBounds(r.path).pad(.15));
}
function renderRes() {
  const sp = active(), av = avoidList().length;
  const head = `<p class="small mute" style="margin:0">Berücksichtigt: ${sp.length} aktive Sperre${sp.length === 1 ? '' : 'n'}${D.bahn.meiden ? `, ${av} gemiedene Bahnübergänge` : ', Bahnübergänge erlaubt'}.</p>`;
  $('#res').innerHTML = head + routes.map((r, i) => r.err ? `<div class="errl">${esc(r.dep.name)}: ${esc(r.err)}</div>`
    : `<button type="button" class="rt${i === selR ? ' sel' : ''}" data-r="${i}"><span class="mute small">ab ${esc(r.dep.name)}</span><br><b>${Math.round(r.min)} Min</b> · ${r.km.toFixed(1)} km
      ${r.used.length ? `<div class="small okl">Über Umleitung: ${esc(r.used.join(', '))}</div>` : ''}${r.warn.map(w => `<div class="warnl" style="margin-top:6px">${esc(w)}</div>`).join('')}</button>`).join('')
    + (routes.some(r => !r.err) ? `<div class="btns"><button type="button" id="bApple">Apple Karten</button><button type="button" id="bGoogle">Google Maps</button></div>
      ${sp.length || av ? '<div class="warnl">Achtung: Apple/Google kennen eure Sperren und Vorgaben nicht. Massgebend ist die blaue Route auf der Karte.</div>' : ''}` : '');
  const go = u => window.open(u, '_blank', 'noopener');
  if ($('#bApple')) $('#bApple').onclick = () => go(`https://maps.apple.com/?daddr=${ziel.lat},${ziel.lng}&dirflg=d`);
  if ($('#bGoogle')) $('#bGoogle').onclick = () => go(`https://www.google.com/maps/dir/?api=1&destination=${ziel.lat},${ziel.lng}&travelmode=driving`);
}
$('#res').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; selR = +b.dataset.r; renderRes(); drawRoutes(); });
$('#bRoute').onclick = async () => {
  if (!ziel) return msg('Zuerst ein Ziel wählen');
  if (!D.depots.length) return msg('Zuerst unter «Depots» ein Depot setzen');
  if (!navigator.onLine) return msg('Für die Routenberechnung braucht es Internet');
  $('#bRoute').disabled = true; $('#res').innerHTML = '<p class="mute">Berechne Route …</p>';
  routes = [];
  for (const d of D.depots) {
    try { routes.push(await routeFrom(d)); }
    catch (e) { routes.push({ dep: d, err: e.code === 442 || /No path/i.test(e.message) ? 'Kein Weg gefunden – Sperren/Vorgaben lassen keine Route zu.' : 'Routenberechnung fehlgeschlagen (' + e.message + ')' }); }
  }
  const ok = routes.map((r, i) => [r, i]).filter(x => !x[0].err).sort((a, b) => a[0].min - b[0].min);
  selR = ok.length ? ok[0][1] : 0;
  $('#bRoute').disabled = false; renderRes(); drawRoutes();
};

/* ---------- Tabs ---------- */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['route', 'sperren', 'bahn', 'depots']) $('#t-' + t).hidden = t !== b.dataset.t;
  setTimeout(() => map.invalidateSize(), 50);
});
setInterval(() => { renderSperren(); drawBase(); }, 60000); // Sperren werden zur richtigen Zeit aktiv bzw. verschwinden

fwZiel(true); renderAll(); boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.RT_VERSION = VERSION;
