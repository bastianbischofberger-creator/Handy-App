/* Einsatzpläne – Feuerwehr RTL. Objektpläne (PDF) mit Standort und Radius. Gespeichert in Firestore
   («pl_objekte», PDF in Stücken unter «chunks»), nur für Konten. Für die Startseite wird ein kleiner Index
   (Name, Adresse, Koordinaten, Radius) lokal als «fw-plaene» abgelegt → Hinweis «Einsatzplan vorhanden». */
const VERSION = '1.1.1';
const CFG = window.PL_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CHUNK = 700000, MAXPDF = 8 * 1024 * 1024;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nrm = s => String(s || '').toLowerCase();
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 4000); }
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);
/* Geometrie: Punkt (Radius), Strecke (Korridor beidseitig) oder Fläche (Polygon + Rand) */
const M_LAT = 111320, mLng = lat => 111320 * Math.cos(lat * Math.PI / 180);
const encL = a => (a || []).map(p => ({ la: p[0], lo: p[1] }));       // Firestore: keine verschachtelten Listen
const decL = a => (a || []).map(p => Array.isArray(p) ? p : [p.la, p.lo]);
const ptsOf = o => decL(o.line);
const center = pts => { const n = pts.length; return n ? [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n] : null; };
const TAGS = ['BMA', 'Schlüsseldepot', 'Sprinkler', 'Gefahrstoffe', 'Photovoltaik', 'Gas', 'Personen nachts', 'Hydrant', 'Aufzug', 'RWA'];
const TILE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';
const HOME = [47.4655, 9.5905];

/* ---------- Firebase ---------- */
let F, fs, A, auth, O;
const S = { list: [], sel: null, user: null, err: '', gem: '', q: '', off: JSON.parse(localStorage.getItem('pl-offline') || '{}') };
function sync() {
  const el = $('#sync'); let c = 'ok', t = 'Synchronisiert';
  if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline'; } else if (!S.user) { c = 'warn'; t = 'Nicht angemeldet'; }
  el.className = 'sync ' + c; el.textContent = t;
}
addEventListener('online', sync); addEventListener('offline', sync);
$('#sync').addEventListener('click', () => { if (F && fs && S.user && window.FWSync) FWSync.open({ F, fs, user: S.user.email, onDone: () => { S.err = ''; sync(); } }); });
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Firestore-Regeln «Einsatzpläne» veröffentlichen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); sync(); msg(S.err); };

async function boot() {
  try {
    const [appM, Au, Fm] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    F = Fm; A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase);
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    O = F.collection(fs, 'pl_objekte');
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; msg('Einsatzpläne brauchen beim ersten Öffnen Internet.'); renderList(); return; }
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
  F.onSnapshot(F.query(O, F.orderBy('name')), q => {
    S.list = q.docs.map(d => ({ id: d.id, ...d.data() })); S.err = ''; sync();
    writeIndex(); renderAll();
    const h = location.hash.match(/o=([\w-]+)/); if (h && !S.sel) select(h[1], true);
  }, fail);
}
// kleiner Index für den Hinweis auf der Startseite (gleiche Herkunft → gleicher Speicher)
function writeIndex() {
  const idx = S.list.filter(o => o.lat != null).map(o => ({ id: o.id, name: o.name, adr: o.adr || '', lat: o.lat, lng: o.lng, radius: o.radius || 100, stand: o.stand || '', tags: o.tags || [], geo: o.geo || 'punkt', pts: ptsOf(o) }));
  try { localStorage.setItem('fw-plaene', JSON.stringify({ t: Date.now(), list: idx })); } catch (e) {}
}

/* ---------- Übersicht ---------- */
const gemeinde = o => o.gemeinde || (String(o.adr || '').match(/\d{4}\s+([^,]+)$/) || [])[1] || '';
const isOld = o => { const m = String(o.pruef || '').match(/(\d{1,2})\.(\d{4})/); if (!m) return false; return new Date(+m[2], +m[1] - 1, 1) < new Date(); };
function filtered() {
  const q = nrm(S.q).trim();
  return S.list.filter(o => (!S.gem || gemeinde(o) === S.gem) && (!q || nrm(o.name + ' ' + o.adr + ' ' + o.typ + ' ' + (o.tags || []).join(' ')).includes(q)));
}
function renderChips() {
  const g = [...new Set(S.list.map(gemeinde).filter(Boolean))].sort();
  $('#cG').innerHTML = ['', ...g].map(x => `<button type="button" data-g="${esc(x)}" class="${S.gem === x ? 'on' : ''}">${esc(x || 'Alle')}</button>`).join('');
}
function renderList() {
  const l = filtered();
  $('#list').innerHTML = l.length ? l.map(o => `<li><button type="button" data-o="${o.id}" class="${S.sel === o.id ? 'sel' : ''}"><span class="pdfic">${o.pdf ? 'PDF' : '–'}</span><span class="li-t"><b>${esc(o.name)}</b><small>${esc(o.adr || 'ohne Adresse')}</small><small class="${isOld(o) ? 'old' : ''}">${o.stand ? 'Stand ' + esc(o.stand) : 'ohne Stand'}${isOld(o) ? ' – überprüfen' : ''}${S.off[o.id] === o.upd ? ' · offline ✓' : ''}</small></span><span class="typ">${esc(o.typ || '')}</span></button></li>`).join('')
    : `<li class="empty">${S.list.length ? 'Keine Treffer.' : (S.user ? 'Noch keine Einsatzpläne. Mit «+ Plan hinzufügen» den ersten Testplan erfassen.' : 'Anmelden, um die Einsatzpläne zu sehen.')}</li>`;
}
let map = null, pins = null;
const metersPerPx = () => map ? 156543.03 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, map.getZoom()) : 1;
function renderMap() {
  if (!window.L) return;
  if (!map) {
    L.Control.Attribution.prototype.options.prefix = false;
    map = L.map('map').setView(HOME, 14);
    L.tileLayer(TILE, { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(map);
    pins = L.layerGroup().addTo(map);
    map.on('zoomend', renderMap);
  }
  pins.clearLayers();
  const l = filtered().filter(o => o.lat != null);
  for (const o of l) {
    const sel = o.id === S.sel;
    const g = o.geo || 'punkt', P = ptsOf(o);
    if (g === 'linie' && P.length > 1) { L.polyline(P, { color: sel ? '#44546a' : '#c8102e', weight: sel ? 7 : 5, opacity: .85 }).bindTooltip(esc(o.name)).on('click', () => select(o.id, true)).addTo(pins);
      if (sel) L.polyline(P, { color: '#44546a', weight: Math.max(8, 2 * (o.radius || 100) / metersPerPx()), opacity: .15 }).addTo(pins); }
    else if (g === 'flaeche' && P.length > 2) L.polygon(P, { color: sel ? '#44546a' : '#c8102e', weight: 3, fillOpacity: sel ? .25 : .12 }).bindTooltip(esc(o.name)).on('click', () => select(o.id, true)).addTo(pins);
    else if (sel) L.circle([o.lat, o.lng], { radius: o.radius || 100, color: '#44546a', weight: 2, fillOpacity: .12 }).addTo(pins);
    L.circleMarker([o.lat, o.lng], { radius: sel ? 11 : 8, color: '#fff', weight: 3, fillColor: sel ? '#44546a' : (isOld(o) ? '#8a5a00' : '#c8102e'), fillOpacity: 1 })
      .bindTooltip(esc(o.name), { direction: 'top', offset: [0, -8] }).on('click', () => select(o.id, true)).addTo(pins);
  }
}
function renderDet() {
  const o = S.list.find(x => x.id === S.sel), d = $('#det');
  if (!o) { d.hidden = true; return; }
  d.hidden = false;
  d.innerHTML = `<div class="info"><span class="mute" style="font-size:13px;font-weight:700;letter-spacing:.06em">AUSGEWÄHLT</span><b>${esc(o.name)}</b>
    <div class="mute">${esc(o.adr || 'ohne Adresse')} · ${o.geo === 'linie' ? 'Strecke, Bereich ±' + (o.radius || 100) + ' m' : o.geo === 'flaeche' ? 'Fläche + ' + (o.radius || 0) + ' m Rand' : 'Radius ' + (o.radius || 100) + ' m'}</div>
    <div class="mute">${o.stand ? 'Stand ' + esc(o.stand) : 'ohne Stand'}${o.pruef ? ' · Überprüfung ' + esc(o.pruef) : ''}${o.pdf ? ' · ' + esc(o.pdf.name) + ' (' + Math.round(o.pdf.size / 1024) + ' KB)' : ' · noch kein PDF'}</div>
    ${o.tags && o.tags.length ? `<div class="tags">${o.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    ${o.bem ? `<p style="margin:8px 0 0">${esc(o.bem)}</p>` : ''}</div>
    <div class="acts"><button type="button" class="pri" data-a="open"${o.pdf ? '' : ' disabled'}>Plan öffnen</button><button type="button" data-a="edit">Bearbeiten</button><button type="button" class="danger" data-a="del">Löschen</button></div>`;
}
function renderAll() { renderChips(); renderList(); renderMap(); renderDet(); }
function select(id, doCenter) { const center = doCenter;
  S.sel = id; history.replaceState(null, '', id ? '#o=' + id : location.pathname); renderList(); renderMap(); renderDet();
  const o = S.list.find(x => x.id === id); if (!(center && o && o.lat != null && map)) return;
  const P = ptsOf(o); if ((o.geo === 'linie' || o.geo === 'flaeche') && P.length > 1) map.fitBounds(L.latLngBounds(P).pad(.2)); else map.setView([o.lat, o.lng], 17);
}
$('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); renderMap(); });
$('#cG').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; S.gem = b.dataset.g; renderAll(); });
$('#list').addEventListener('click', e => { const b = e.target.closest('[data-o]'); if (b) select(b.dataset.o, true); });
$('#det').addEventListener('click', async e => {
  const a = e.target.closest('[data-a]'); if (!a) return; const o = S.list.find(x => x.id === S.sel); if (!o) return;
  if (a.dataset.a === 'open') openPdf(o);
  if (a.dataset.a === 'edit') openForm(o);
  if (a.dataset.a === 'del') {
    if (!confirm(`«${o.name}» mit dem Plan endgültig löschen – auf allen Geräten?`)) return;
    try { const q = await F.getDocs(F.collection(O, o.id, 'chunks')); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); await F.deleteDoc(F.doc(O, o.id)); select(null); msg('Gelöscht'); }
    catch (err) { fail(err); }
  }
});

/* ---------- PDF ---------- */
async function loadPdf(o, fromCache) {
  const get = fromCache ? F.getDocsFromCache : F.getDocs;
  const q = await get(o.pdf.v ? F.query(F.collection(O, o.id, 'chunks'), F.where('v', '==', o.pdf.v)) : F.query(F.collection(O, o.id, 'chunks'), F.orderBy(F.documentId())));
  if (q.size < (o.pdf.n || 1)) throw new Error('unvollständig');
  const b64 = [...q.docs].sort((a, b) => a.id < b.id ? -1 : 1).map(d => d.data().d).join(''), bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: 'application/pdf' });
}
async function openPdf(o) {
  const w = window.open('', '_blank'); // im Klick öffnen, sonst blockiert Safari das Fenster
  msg('Plan wird geladen …');
  try {
    let blob; try { blob = await loadPdf(o, true); } catch (e) { blob = await loadPdf(o, false); }
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url; else location.href = url;
    S.off[o.id] = o.upd; localStorage.setItem('pl-offline', JSON.stringify(S.off)); renderList(); msg('');
  } catch (e) { if (w) w.close(); msg(!navigator.onLine ? 'Plan ist auf diesem Gerät noch nicht offline verfügbar.' : 'Plan konnte nicht geladen werden.'); }
}
$('#bOff').onclick = async () => {
  if (!S.user) return msg('Zuerst anmelden');
  if (!navigator.onLine) return msg('Dafür braucht es Internet');
  const l = S.list.filter(o => o.pdf); let n = 0;
  for (const o of l) { msg(`Lade ${++n} von ${l.length} …`); try { await loadPdf(o, false); S.off[o.id] = o.upd; } catch (e) {} }
  localStorage.setItem('pl-offline', JSON.stringify(S.off)); renderList(); msg(`${n} Pläne offline verfügbar`);
};

/* ---------- Formular ---------- */
let edit = null, fpos = null, pdfFile = null, ftags = [], fmap = null, fpin = null, fcirc = null, fgeo = 'punkt', fline = [], flay = null;
const GEO = {
  punkt: { hint: 'Adresse wählen oder Karte antippen, um den Punkt zu setzen.', rl: 'Radius für automatischen Hinweis', info: 'Liegt der Einsatzort in diesem Kreis, zeigt die Startseite «Einsatzplan vorhanden».', min: 20, max: 500, step: 10, def: 100 },
  linie: { hint: 'Strecke entlang der Strasse/Autobahn Punkt für Punkt antippen (z. B. Anschluss bis Anschluss).', rl: 'Bereich links und rechts der Strecke', info: 'Liegt der Einsatzort in diesem Band entlang der Strecke, zeigt die Startseite «Einsatzplan vorhanden».', min: 20, max: 300, step: 10, def: 60 },
  flaeche: { hint: 'Ecken des Sektors der Reihe nach antippen (mind. 3 Punkte).', rl: 'Zusätzlicher Rand um die Fläche', info: 'Liegt der Einsatzort in der Fläche oder im Rand, zeigt die Startseite «Einsatzplan vorhanden».', min: 0, max: 300, step: 10, def: 0 }
};
function setGeo(g, keepR) {
  fgeo = g; const c = GEO[g];
  document.querySelectorAll('#cGeo button').forEach(b => b.classList.toggle('on', b.dataset.geo === g));
  $('#geoHint').textContent = c.hint; $('#rL').textContent = c.rl; $('#geoInfo').textContent = c.info; $('#geoTools').hidden = g === 'punkt';
  const R = f.elements.radius; R.min = c.min; R.max = c.max; R.step = c.step; if (!keepR) R.value = c.def;
  drawF();
}
$('#cGeo').addEventListener('click', e => { const b = e.target.closest('[data-geo]'); if (b && b.dataset.geo !== fgeo) { fline = []; setGeo(b.dataset.geo); } });
$('#gUndo').onclick = () => { fline.pop(); drawF(); };
$('#gClear').onclick = () => { fline = []; drawF(); };
const f = $('#fF');
function renderTags() { $('#cT').innerHTML = TAGS.map(t => `<button type="button" data-t="${esc(t)}" class="${ftags.includes(t) ? 'on' : ''}">${esc(t)}</button>`).join(''); }
$('#cT').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; const t = b.dataset.t; ftags = ftags.includes(t) ? ftags.filter(x => x !== t) : [...ftags, t]; renderTags(); });
function drawF() {
  if (!fmap) return;
  const r = +f.elements.radius.value; $('#rV').textContent = r + ' m';
  if (fpin) { fmap.removeLayer(fpin); fpin = null; } if (fcirc) { fmap.removeLayer(fcirc); fcirc = null; } if (flay) { fmap.removeLayer(flay); flay = null; }
  if (fgeo !== 'punkt') {
    flay = L.layerGroup().addTo(fmap);
    if (fline.length > 1) {
      if (fgeo === 'linie') { const px = 156543.03 * Math.cos(fline[0][0] * Math.PI / 180) / Math.pow(2, fmap.getZoom());
        L.polyline(fline, { color: '#44546a', weight: Math.max(6, 2 * r / px), opacity: .18 }).addTo(flay); L.polyline(fline, { color: '#44546a', weight: 5 }).addTo(flay); }
      else L.polygon(fline, { color: '#44546a', weight: 3, fillOpacity: .18 }).addTo(flay);
    }
    fline.forEach(p => L.circleMarker(p, { radius: 6, color: '#fff', weight: 2, fillColor: '#16181a', fillOpacity: 1 }).addTo(flay));
    return;
  }
  if (!fpos) return;
  fcirc = L.circle([fpos.lat, fpos.lng], { radius: r, color: '#44546a', weight: 3, fillOpacity: .15 }).addTo(fmap);
  fpin = L.circleMarker([fpos.lat, fpos.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#44546a', fillOpacity: 1 }).addTo(fmap);
}
f.elements.radius.addEventListener('input', drawF);
function openForm(o) {
  edit = o || null; f.reset(); $('#fErr').textContent = ''; pdfFile = null;
  $('#fT').textContent = o ? 'Einsatzplan bearbeiten' : 'Neuer Einsatzplan';
  ftags = o ? [...(o.tags || [])] : []; renderTags();
  fpos = o && o.lat != null ? { lat: o.lat, lng: o.lng } : null;
  fline = o ? ptsOf(o) : []; setGeo(o && o.geo ? o.geo : 'punkt', true);
  if (o) { for (const k of ['name', 'typ', 'adr', 'stand', 'pruef', 'bem']) if (o[k] != null) f.elements[k].value = o[k]; f.elements.radius.value = o.radius || 100; }
  $('#pdfN').textContent = o && o.pdf ? o.pdf.name : 'Noch kein PDF'; $('#pdfI').textContent = o && o.pdf ? Math.round(o.pdf.size / 1024) + ' KB · neues PDF wählen zum Ersetzen' : 'max. 8 MB';
  $('#dF').showModal();
  if (!fmap) {
    fmap = L.map('fMap').setView(HOME, 14);
    L.tileLayer(TILE, { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(fmap);
    fmap.on('click', e => { if (fgeo === 'punkt') fpos = { lat: e.latlng.lat, lng: e.latlng.lng }; else fline.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]); drawF(); });
    fmap.on('zoomend', drawF);
  }
  setTimeout(() => { fmap.invalidateSize(); if (fgeo !== 'punkt' && fline.length > 1) fmap.fitBounds(L.latLngBounds(fline).pad(.2)); else fmap.setView(fpos ? [fpos.lat, fpos.lng] : HOME, fpos ? 17 : 14); drawF(); }, 60);
}
$('#bAdd').onclick = () => { if (!S.user) return msg('Zuerst anmelden'); openForm(null); };
$('#pdf').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { msg('Bitte eine PDF-Datei wählen'); return; }
  if (file.size > MAXPDF) { msg('PDF ist grösser als 8 MB'); return; }
  pdfFile = file; $('#pdfN').textContent = file.name; $('#pdfI').textContent = Math.round(file.size / 1024) + ' KB · wird beim Speichern hochgeladen';
});
// Adresssuche (amtliches Verzeichnis swisstopo)
let sT, res = [];
const clean = l => l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = l => { const t = clean(l); const m = t.match(/^(.*?)\s(\d{4}\s.+)$/); return m ? m[1] + ', ' + m[2] : t; };
f.elements.adr.addEventListener('input', () => {
  clearTimeout(sT); const q = f.elements.adr.value.trim();
  if (q.length < 3) { res = []; $('#sug').hidden = true; return; }
  sT = setTimeout(async () => {
    try {
      const r = await fetch('https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=4326&limit=8&searchText=' + encodeURIComponent(q)).then(r => r.json());
      res = (r.results || []).map(x => x.attrs).filter(a => a && a.lat);
      $('#sug').innerHTML = res.map((a, i) => `<button type="button" data-i="${i}">${esc(fmt(a.label))}</button>`).join(''); $('#sug').hidden = !res.length;
    } catch (e) { $('#sug').hidden = true; }
  }, 250);
});
$('#sug').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return; const a = res[+b.dataset.i];
  f.elements.adr.value = fmt(a.label); fpos = { lat: a.lat, lng: a.lon }; $('#sug').hidden = true;
  if (fmap) fmap.setView([fpos.lat, fpos.lng], 17); drawF();
});
const toB64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(file); });
f.addEventListener('submit', async e => {
  if (!e.submitter || e.submitter.value !== 'ok') return;
  e.preventDefault();
  const v = k => f.elements[k].value.trim();
  if (!v('name')) { $('#fErr').textContent = 'Objektname fehlt.'; return; }
  if (fgeo === 'punkt' && !fpos) { $('#fErr').textContent = 'Standort fehlt: Adresse wählen oder Karte antippen.'; return; }
  if (fgeo === 'linie' && fline.length < 2) { $('#fErr').textContent = 'Strecke fehlt: mindestens 2 Punkte auf der Karte antippen.'; return; }
  if (fgeo === 'flaeche' && fline.length < 3) { $('#fErr').textContent = 'Fläche fehlt: mindestens 3 Ecken auf der Karte antippen.'; return; }
  const repr = fgeo === 'punkt' ? fpos : (c => ({ lat: c[0], lng: c[1] }))(fgeo === 'linie' ? fline[Math.floor(fline.length / 2)] : center(fline));
  const id = edit ? edit.id : uid(), now = Date.now();
  const data = { name: v('name'), typ: v('typ'), adr: v('adr'), gemeinde: (v('adr').match(/\d{4}\s+([^,]+)$/) || [])[1] || '', lat: repr.lat, lng: repr.lng, radius: +f.elements.radius.value, geo: fgeo, line: fgeo === 'punkt' ? [] : encL(fline),
    stand: v('stand'), pruef: v('pruef'), tags: ftags, bem: v('bem'), upd: now, by: S.user.email, test: true, created: edit ? (edit.created || now) : now, pdf: edit ? (edit.pdf || null) : null };
  $('#bSave').disabled = true;
  try {
    if (pdfFile) {
      $('#fErr').textContent = 'PDF wird hochgeladen …';
      const b64 = await toB64(pdfFile), parts = [];
      for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
      for (let k = 0; k < parts.length; k++) { $('#fErr').textContent = `PDF wird hochgeladen … ${k + 1}/${parts.length}`; await F.setDoc(F.doc(O, id, 'chunks', now + '_' + String(k).padStart(3, '0')), { d: parts[k], v: now }); }
      data.pdf = { name: pdfFile.name, size: pdfFile.size, n: parts.length, t: now, v: now };
    }
    await F.setDoc(F.doc(O, id), data);
    if (pdfFile && edit && edit.pdf) { const q = await F.getDocs(F.collection(O, id, 'chunks')); await Promise.all(q.docs.filter(d => d.data().v !== now).map(d => F.deleteDoc(d.ref))); }
    $('#dF').close(); select(id, true); msg('Gespeichert');
  } catch (err) { $('#fErr').textContent = err && err.code === 'permission-denied' ? 'Kein Zugriff: In der Firebase-Konsole die Regeln (Abschnitt «Einsatzpläne») veröffentlichen.' : 'Speichern fehlgeschlagen: ' + (err.code || err.message); }
  $('#bSave').disabled = false;
});

renderList(); renderMap(); boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.PL_VERSION = VERSION;
