/* Alarmdisplay – Verwaltung. Bildschirme koppeln (Code vom TV), Ansicht pro TV, Alarm auslösen / Test / beenden,
   Ruheanzeige (Infotext, Termine, Sperren). Zustand für die TVs: Firestore ad_state/current und ad_state/ruhe.
   Beim Alarm wird hier die Route ab Depot berechnet (inkl. Sperren/Bahnübergänge) und mitgegeben. */
const VERSION = '1.3.1';
const CFG = window.AD_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const TILE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';
const HOME = [47.4655, 9.5905];
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => m.textContent = '', 4500); }
const STW = ['Brand', 'Brand Wohnhaus', 'BMA', 'Verkehrsunfall', 'Elementar', 'Öl / Chemie', 'Technische Hilfe', 'Tierrettung'];
const STUFEN = ['Stufe 1', 'Stufe 2', 'Stufe 3'];
const DAUER = [[15, '15 Min.'], [30, '30 Min.'], [60, '60 Min.'], [120, '2 Std.']];
const LAYOUT = [['karte', 'Karte & Route gross'], ['text', 'Stichwort gross'], ['ruhe', 'Nur Ruheanzeige']];
let stufe = '', dauer = 30, pos = null;
$('#tvUrl').textContent = new URL('anzeige.html', location.href).href;

/* ---------- Firebase ---------- */
let F, fs, A, auth;
const S = { user: null, err: '', screens: [], cur: null, ruhe: {}, routing: null };
function sync() { const el = $('#sync'); let c = 'ok', t = 'Synchronisiert'; if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline'; } else if (!S.user) { c = 'warn'; t = 'Nicht angemeldet'; } el.className = 'sync ' + c; el.textContent = t; }
addEventListener('online', sync); addEventListener('offline', sync);
$('#sync').addEventListener('click', () => { if (F && fs && S.user && window.FWSync) FWSync.open({ F, fs, user: S.user.email, onDone: () => { S.err = ''; sync(); } }); });
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Regeln «Alarmdisplay» veröffentlichen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); sync(); msg(S.err); };
async function boot() {
  try {
    const [appM, Au, Fm] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    F = Fm; A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase);
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; return; }
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
  F.onSnapshot(F.collection(fs, 'ad_screens'), q => { S.screens = q.docs.map(d => ({ id: d.id, ...d.data() })); S.err = ''; sync(); renderScreens(); }, fail);
  F.onSnapshot(F.doc(fs, 'ad_state', 'current'), d => { S.cur = d.exists() ? d.data() : null; renderState(); }, fail);
  F.onSnapshot(F.doc(fs, 'ad_state', 'ruhe'), d => { S.ruhe = d.exists() ? d.data() : {}; renderRuhe(); }, fail);
  F.onSnapshot(F.collection(fs, 'ad_bilder'), q => { S.bilder = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.n || 0) - (b.n || 0)); renderGal(); }, fail);
  F.onSnapshot(F.doc(fs, 'config', 'routing'), d => { S.routing = d.exists() ? d.data() : {}; syncSperren(); }, () => {});
  setInterval(() => { renderScreens(); renderState(); }, 30000);
}

/* ---------- Zustand ---------- */
const alarmOn = () => S.cur && S.cur.aktiv && Date.now() < S.cur.bis;
function renderState() {
  const el = $('#state'), c = S.cur;
  if (alarmOn()) {
    el.className = 'card full state alarm';
    el.innerHTML = `<div style="flex:1"><div class="big">${c.test ? 'TEST-ALARM · ' : ''}${esc(c.stw)}${c.stufe ? ' · ' + esc(c.stufe) : ''}</div><div class="mute">${esc(c.adr || '')} · ausgelöst ${hm(c.t)} · auf den TVs bis ${hm(c.bis)}${c.route ? ` · Fahrzeit ${Math.round(c.route.min)} Min. ab ${esc(c.route.dep)}` : ''}</div></div><button type="button" id="bEnd">Alarm beenden</button>`;
    $('#bEnd').onclick = endAlarm;
  } else {
    el.className = 'card full state';
    const on = S.screens.filter(s => s.paired && Date.now() - (s.seen || 0) < 180000).length, all = S.screens.filter(s => s.paired).length;
    el.innerHTML = `<div style="flex:1"><div class="big">Ruheanzeige</div><div class="mute">${all ? `${on} von ${all} Bildschirm${all > 1 ? 'en' : ''} online` : 'Noch kein Bildschirm gekoppelt'}${c && c.t ? ' · letzter Alarm ' + hm(c.t) + ' (' + esc(c.stw) + ')' : ''}</div></div>`;
  }
}
async function endAlarm() { if (!confirm('Alarm auf allen Bildschirmen beenden?')) return; try { await F.updateDoc(F.doc(fs, 'ad_state', 'current'), { aktiv: false, ende: Date.now() }); msg('Alarm beendet'); } catch (e) { fail(e); } }

/* ---------- Alarm-Formular ---------- */
function renderForm() {
  $('#cStw').innerHTML = STW.map(s => `<button type="button" data-s="${esc(s)}" class="${$('#stw').value === s ? 'on' : ''}">${esc(s)}</button>`).join('');
  $('#cStufe').innerHTML = STUFEN.map(s => `<button type="button" data-st="${s}" class="${stufe === s ? 'on' : ''}">${s}</button>`).join('');
  $('#cDauer').innerHTML = DAUER.map(([m, l]) => `<button type="button" data-d="${m}" class="${dauer === m ? 'on' : ''}">${l}</button>`).join('');
}
$('#cStw').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) { $('#stw').value = b.dataset.s; renderForm(); } });
$('#stw').addEventListener('input', renderForm);
$('#cStufe').addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (b) { stufe = stufe === b.dataset.st ? '' : b.dataset.st; renderForm(); } });
$('#cDauer').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { dauer = +b.dataset.d; renderForm(); } });
L.Control.Attribution.prototype.options.prefix = false;
const pmap = L.map('pMap').setView(HOME, 13);
L.tileLayer(TILE, { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(pmap);
let pin = null;
function setPos(p, label) { pos = p; if (label != null) $('#adr').value = label; if (pin) pin.remove(); pin = L.circleMarker(p, { radius: 10, color: '#fff', weight: 3, fillColor: '#c8102e', fillOpacity: 1 }).addTo(pmap); pmap.setView(p, 16); }
pmap.on('click', e => setPos([e.latlng.lat, e.latlng.lng]));
let sT, res = [];
const clean = l => l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const fmt = l => { const t = clean(l); const m = t.match(/^(.*?)\s(\d{4}\s.+)$/); return m ? m[1] + ', ' + m[2] : t; };
$('#adr').addEventListener('input', () => {
  clearTimeout(sT); const q = $('#adr').value.trim(); if (q.length < 3) { $('#sug').hidden = true; return; }
  sT = setTimeout(async () => { try { const r = await fetch('https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=4326&limit=6&searchText=' + encodeURIComponent(q)).then(r => r.json());
    res = (r.results || []).map(x => x.attrs).filter(a => a && a.lat); $('#sug').innerHTML = res.map((a, i) => `<button type="button" data-i="${i}">${esc(fmt(a.label))}</button>`).join(''); $('#sug').hidden = !res.length; } catch (e) { $('#sug').hidden = true; } }, 250);
});
$('#sug').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const a = res[+b.dataset.i]; $('#sug').hidden = true; setPos([a.lat, a.lon], fmt(a.label)); });
$('#bFw').onclick = () => {
  let e = null; try { e = JSON.parse(localStorage.getItem('fw-einsatz')); } catch (x) {}
  if (!e || !e.bez) return msg('Auf der Startseite ist kein Einsatz eröffnet');
  $('#stw').value = e.bez; if (e.lat != null) setPos([e.lat, e.lng], e.adr || ''); else $('#adr').value = e.adr || ''; renderForm(); msg('Einsatz übernommen – prüfen und «Alarm» drücken');
};

// Einsatzpläne im Radius (Index der App «Einsatzpläne» auf diesem Gerät)
function planHits(p) {
  let idx = []; try { idx = (JSON.parse(localStorage.getItem('fw-plaene')) || {}).list || []; } catch (x) {}
  const kx = 111320 * Math.cos(p[0] * Math.PI / 180), xy = q => [(q[1] - p[1]) * kx, (q[0] - p[0]) * 111320];
  const dSeg = (a, b) => { const A = xy(a), B = xy(b), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(A[0] * dx + A[1] * dy) / L2)) : 0; return Math.hypot(A[0] + t * dx, A[1] + t * dy); };
  const dLine = P => { let m = Infinity; for (let i = 0; i < P.length - 1; i++) m = Math.min(m, dSeg(P[i], P[i + 1])); return m; };
  const inside = P => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const A2 = xy(P[i]), B = xy(P[j]); if ((A2[1] > 0) !== (B[1] > 0) && 0 < (B[0] - A2[0]) * (0 - A2[1]) / (B[1] - A2[1]) + A2[0]) c = !c; } return c; };
  const d = o => { const P = o.pts || []; if (o.geo === 'linie' && P.length > 1) return dLine(P); if (o.geo === 'flaeche' && P.length > 2) return inside(P) ? 0 : dLine([...P, P[0]]); return Math.hypot(...xy([o.lat, o.lng])); };
  return idx.map(o => ({ o, d: d(o) })).filter(x => x.d <= (x.o.geo === 'flaeche' ? (x.o.radius || 0) : (x.o.radius || 100))).sort((a, b) => a.d - b.d).slice(0, 3).map(x => ({ name: x.o.name, tags: (x.o.tags || []).slice(0, 4) }));
}
async function bestRoute(p) {
  const deps = (S.routing && S.routing.depots) || []; if (!deps.length || !window.FWRoute) return null;
  let best = null;
  for (const d of deps.slice(0, 3)) { try { const r = await FWRoute.route(S.routing, [d.lat, d.lng], p); if (!best || r.min < best.min) best = { ...r, dep: d.name, depPos: { la: d.lat, lo: d.lng } }; } catch (e) {} }
  return best && { dep: best.dep, depPos: best.depPos, min: best.min, km: best.km, path: FWRoute.packPath(best.path), sperrBahn: best.sperrBahn || 0 };
}
async function trigger(test) {
  $('#aErr').textContent = '';
  if (!S.user) return msg('Zuerst anmelden');
  const stw = test ? 'Test-Alarm' : $('#stw').value.trim();
  if (!stw) { $('#aErr').textContent = 'Stichwort fehlt.'; return; }
  if (!test && !pos && !$('#adr').value.trim()) { $('#aErr').textContent = 'Adresse oder Kartenpunkt fehlt.'; return; }
  if (!test && !confirm(`Alarm «${stw}» auf allen Bildschirmen anzeigen?`)) return;
  $('#bAlarm').disabled = $('#bTest').disabled = true; msg('Alarm wird gesendet …');
  const now = Date.now(), p = pos || (test ? HOME : null);
  const cur = { aktiv: true, test: !!test, t: now, bis: now + (test ? 1 : dauer) * 60000, stw, stufe: test ? '' : stufe, adr: test ? 'Depot (Test)' : $('#adr').value.trim(), bem: test ? 'Dies ist ein Test des Alarmdisplays.' : $('#bem').value.trim(),
    lat: p ? p[0] : null, lng: p ? p[1] : null, plaene: p && !test ? planHits(p) : [], route: null, by: S.user.email };
  try {
    await F.setDoc(F.doc(fs, 'ad_state', 'current'), cur);             // sofort anzeigen …
    if (p && !test && navigator.onLine) { const r = await bestRoute(p); if (r) await F.updateDoc(F.doc(fs, 'ad_state', 'current'), { route: r }); } // … Route folgt
    msg(test ? 'Test-Alarm läuft 1 Minute' : 'Alarm wird angezeigt');
  } catch (e) { fail(e); }
  $('#bAlarm').disabled = $('#bTest').disabled = false;
}
$('#bAlarm').onclick = () => trigger(false);
$('#bTest').onclick = () => trigger(true);

/* ---------- Bildschirme ---------- */
function renderScreens() {
  const l = S.screens.filter(s => s.paired).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  $('#sList').innerHTML = l.length ? l.map(s => { const on = Date.now() - (s.seen || 0) < 180000;
    return `<li><div class="h"><b><span class="dot${on ? ' on' : ''}"></span>${esc(s.name || 'Bildschirm')}</b><span class="small mute">${on ? 'online' : 'offline' + (s.seen ? ' seit ' + hm(s.seen) : '')}</span></div>
      <select data-lay="${s.id}" aria-label="Ansicht">${LAYOUT.map(([k, t]) => `<option value="${k}"${(s.layout || 'karte') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <div class="btns" style="margin-top:0"><button type="button" data-ren="${s.id}">Umbenennen</button><button type="button" data-rel="${s.id}">Neu laden</button><button type="button" class="danger" data-del="${s.id}">Entfernen</button></div></li>`; }).join('')
    : '<li class="mute">Noch kein Bildschirm gekoppelt.</li>';
  renderState();
}
$('#bPair').onclick = async () => {
  if (!S.user) return msg('Zuerst anmelden');
  const code = $('#code').value.trim().toUpperCase(), name = $('#sName').value.trim() || 'Bildschirm';
  if (code.length !== 6) return msg('Der Code hat 6 Zeichen');
  try {
    const q = await F.getDocs(F.query(F.collection(fs, 'ad_screens'), F.where('code', '==', code)));
    const d = q.docs.find(x => !x.data().paired); if (!d) return msg('Code nicht gefunden – am TV die Seite neu laden und Code nochmals ablesen');
    await F.updateDoc(d.ref, { paired: true, name, layout: 'karte', pairedBy: S.user.email, pairedAt: Date.now() });
    $('#code').value = $('#sName').value = ''; msg(`«${name}» gekoppelt`);
  } catch (e) { fail(e); }
};
$('#sList').addEventListener('change', e => { const s = e.target.closest('[data-lay]'); if (s) F.updateDoc(F.doc(fs, 'ad_screens', s.dataset.lay), { layout: s.value }).then(() => msg('Ansicht geändert')).catch(fail); });
$('#sList').addEventListener('click', e => {
  const r = e.target.closest('[data-ren]'), x = e.target.closest('[data-del]'), rl = e.target.closest('[data-rel]');
  if (r) { const s = S.screens.find(q => q.id === r.dataset.ren); const n = prompt('Name / Standort', s && s.name || ''); if (n) F.updateDoc(F.doc(fs, 'ad_screens', s.id), { name: n.trim() }).catch(fail); }
  if (rl) F.updateDoc(F.doc(fs, 'ad_screens', rl.dataset.rel), { reload: Date.now() }).then(() => msg('Bildschirm lädt neu')).catch(fail);
  if (x) { const s = S.screens.find(q => q.id === x.dataset.del); if (s && confirm(`Bildschirm «${s.name}» entfernen? Er zeigt danach wieder einen Kopplungscode.`)) F.deleteDoc(F.doc(fs, 'ad_screens', s.id)).catch(fail); }
});
$('#bPrev').onclick = () => window.open('anzeige.html?vorschau=1', '_blank', 'noopener');

/* ---------- Wetter-Ort ---------- */
let wxOrt = 'Thal';
function renderOrt() { $('#cOrt').innerHTML = 'Ort: ' + ['Rheineck', 'Thal', 'Lutzenberg'].map(o => `<button type="button" data-ort="${o}" class="${wxOrt === o ? 'on' : ''}">${o}</button>`).join(''); }
$('#cOrt').addEventListener('click', e => { const b = e.target.closest('[data-ort]'); if (b) { wxOrt = b.dataset.ort; renderOrt(); msg('Mit «Ruheanzeige speichern» übernehmen'); } });

/* ---------- Bildergalerie ---------- */
let galInt = 10;
const INT = [[6, '6 s'], [10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 Min.']];
function renderInt() { $('#cInt').innerHTML = 'Wechsel alle ' + INT.map(([s, l]) => `<button type="button" data-int="${s}" class="${galInt === s ? 'on' : ''}">${l}</button>`).join(''); }
$('#cInt').addEventListener('click', e => { const b = e.target.closest('[data-int]'); if (b) { galInt = +b.dataset.int; renderInt(); msg('Mit «Ruheanzeige speichern» übernehmen'); } });
function renderGal() {
  const l = S.bilder || [];
  $('#gal').innerHTML = l.map(b => `<figure><img src="${b.d}" alt=""><button type="button" data-gd="${b.id}" aria-label="Bild entfernen">✕</button><figcaption>${esc(b.name || '')}</figcaption></figure>`).join('');
  $('#galInfo').textContent = l.length ? `${l.length} Bild${l.length > 1 ? 'er' : ''} – werden auf den TVs abwechselnd gezeigt.` : 'Noch keine Bilder.';
}
$('#gal').addEventListener('click', e => { const b = e.target.closest('[data-gd]'); if (b && confirm('Bild aus der Galerie entfernen?')) F.deleteDoc(F.doc(fs, 'ad_bilder', b.dataset.gd)).catch(fail); });
// Bilder auf max. 1600 px verkleinern (JPEG) – passt so in ein Firestore-Dokument
function shrink(file) { return new Promise((ok, no) => { const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); let q = .82, d = c.toDataURL('image/jpeg', q); while (d.length > 900000 && q > .4) { q -= .1; d = c.toDataURL('image/jpeg', q); } ok(d); };
  img.onerror = () => { URL.revokeObjectURL(u); no(new Error('Bild nicht lesbar')); }; img.src = u; }); }
$('#galFile').addEventListener('change', async e => {
  if (!S.user) return msg('Zuerst anmelden');
  const files = [...e.target.files]; e.target.value = ''; let n = (S.bilder || []).reduce((m, b) => Math.max(m, b.n || 0), 0), k = 0;
  for (const f of files) { msg(`Lade Bild ${++k} von ${files.length} …`);
    try { const d = await shrink(f); await F.setDoc(F.doc(fs, 'ad_bilder', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), { d, name: f.name, n: ++n, t: Date.now(), by: S.user.email }); }
    catch (err) { msg(`«${f.name}»: ${err.code === 'permission-denied' ? 'kein Zugriff – Regeln veröffentlichen' : 'konnte nicht hochgeladen werden'}`); } }
  msg('Bilder hinzugefügt');
});

/* ---------- Ruheanzeige ---------- */
let terms = [];
let ruheGeladen = false;
function renderRuhe() { // nur beim ersten Laden ins Formular übernehmen – sonst würde laufende Eingabe überschrieben
  if (ruheGeladen) return; ruheGeladen = true;
  $('#info').value = S.ruhe.info || ''; $('#showSp').checked = S.ruhe.showSp !== false; $('#galOn').checked = S.ruhe.galOn !== false; galInt = S.ruhe.galInt || 10; renderInt(); $('#wxOn').checked = S.ruhe.wxOn !== false; $('#newsOn').checked = S.ruhe.newsOn === true; wxOrt = S.ruhe.wxOrt || 'Thal'; renderOrt(); terms = [...(S.ruhe.termine || [])]; renderTerms();
}
function renderTerms() {
  $('#terms').innerHTML = terms.sort((a, b) => a.d.localeCompare(b.d)).map((t, i) => `<div class="term"><span>${esc(t.d.split('-').reverse().join('.'))}</span><span>${esc(t.text)}</span><button type="button" class="danger" data-ti="${i}">Entfernen</button></div>`).join('') || '<p class="small mute" style="margin:0">Keine Termine.</p>';
}
$('#terms').addEventListener('click', e => { const b = e.target.closest('[data-ti]'); if (b) { terms.splice(+b.dataset.ti, 1); renderTerms(); } });
$('#tAdd').onclick = () => { const d = $('#tDat').value, t = $('#tTxt').value.trim(); if (!d || !t) return msg('Datum und Text eingeben'); terms.push({ d, text: t }); $('#tTxt').value = ''; renderTerms(); };
$('#bRuhe').onclick = () => { if (!S.user) return msg('Zuerst anmelden');
  F.setDoc(F.doc(fs, 'ad_state', 'ruhe'), { info: $('#info').value.trim(), termine: terms, showSp: $('#showSp').checked, galOn: $('#galOn').checked, galInt, wxOn: $('#wxOn').checked, wxOrt, newsOn: $('#newsOn').checked, upd: Date.now() }, { merge: true }).then(() => msg('Ruheanzeige gespeichert')).catch(fail); };
// Aktive Sperren für die TVs kopieren (die TVs haben keinen Zugriff auf config/routing)
let spLast = '';
function syncSperren() {
  if (!S.routing || !window.FWRoute) return;
  const sp = (S.routing.sperren || []).filter(s => FWRoute.sState(s) !== 'alt').map(s => ({ name: s.name, grund: s.grund || '', von: s.von || '', bis: s.bis || '', pts: FWRoute.packPath(FWRoute.decL(s.pts) || []) }));
  const k = JSON.stringify(sp); if (k === spLast) return; spLast = k;
  F.setDoc(F.doc(fs, 'ad_state', 'ruhe'), { sperren: sp, spUpd: Date.now() }, { merge: true }).catch(() => {});
}

renderForm(); renderState(); renderInt(); renderOrt(); boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.AD_VERSION = VERSION;
