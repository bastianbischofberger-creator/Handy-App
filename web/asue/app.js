/* Atemschutzüberwachung – Feuerwehr RTL
   Offline-fähige Web-App mit optionaler Synchronisation über Firebase. */
(function () {
'use strict';
const VERSION = '1.3.1';
const CFG = window.ASUE_CONFIG || {};
const FB_VERSION = '10.12.2';

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hms = t => { const d = new Date(t); return hm(t) + ':' + pad(d.getSeconds()); };
const dur = ms => { const neg = ms < 0; const s = Math.floor(Math.abs(ms) / 1000); return (neg ? '−' : '') + pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
const durH = ms => { const s = Math.floor(ms / 1000); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
const dt = t => t ? new Date(t).toLocaleDateString('de-CH') + ' ' + hm(t) : '-';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== String(v)) e.textContent = v; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));

/* Geräte-Einstellungen (nur dieses Gerät) */
const LP = (() => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('asue-prefs')) || {}; } catch (e) {}
  return { get: k => o[k], set: (k, v) => { o[k] = v; try { localStorage.setItem('asue-prefs', JSON.stringify(o)); } catch (e) {} } };
})();

const DEF = { interval: 10, rzMode: 'half', rzFixed: 150, reserve: 50, pfeife: 55, defRate: 8, defP0: 300, kanaele: '3, 4, 6, 8, 12', floors: 'UG -3, UG -2, UG -1, EG, 1. OG, 2. OG, 3. OG, Dach', org: CFG.feuerwehr || 'Feuerwehr Rheineck-Thal-Lutzenberg' };
const S = { settings: { ...DEF }, eid: null, meta: {}, teams: [], log: [], list: [] };
const SY = { mode: 'local', pending: false, error: '', user: null };
let BE = null;

/* ================= Speicher: nur lokal ================= */
function LocalBackend() {
  const KEY = 'asue-db-v1';
  let db = null; try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!db || !db.einsaetze) db = { einsaetze: {}, settings: {} };
  let cur = null, curCb = null, listCb = null, setCb = null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { SY.error = 'Speicher voll oder gesperrt'; } };
  const emitList = () => listCb && listCb(Object.entries(db.einsaetze).map(([id, e]) => ({ id, ...clone(e.meta) })).sort((a, b) => b.created - a.created));
  const emitCur = () => { if (!curCb) return; const e = db.einsaetze[cur]; if (!e) return curCb({ meta: {}, teams: [], log: [] });
    curCb({ meta: clone(e.meta), teams: clone(Object.values(e.teams)), log: clone(Object.values(e.log)).sort((a, b) => a.t - b.t) }); };
  const ch = () => { persist(); emitCur(); emitList(); };
  return {
    mode: 'local',
    has: eid => !!db.einsaetze[eid],
    watchSettings(cb) { setCb = cb; cb(clone(db.settings || {})); },
    putSettings(s) { db.settings = clone(s); persist(); setCb && setCb(clone(s)); },
    watchList(cb) { listCb = cb; emitList(); },
    open(eid, cb) { cur = eid; curCb = cb; emitCur(); },
    create(meta) { const id = uid(); db.einsaetze[id] = { meta: clone(meta), teams: {}, log: {} }; persist(); emitList(); return id; },
    putMeta(eid, meta) { if (!db.einsaetze[eid]) return; db.einsaetze[eid].meta = clone(meta); ch(); },
    putTeam(eid, T) { if (!db.einsaetze[eid]) return; db.einsaetze[eid].teams[T.id] = clone(T); ch(); },
    delTeam(eid, id) { if (!db.einsaetze[eid]) return; delete db.einsaetze[eid].teams[id]; ch(); },
    addLog(eid, id, e) { if (!db.einsaetze[eid]) return; db.einsaetze[eid].log[id] = clone(e); ch(); },
    exportAll() { return clone(db); },
    importAll(o) { let n = 0; for (const [id, e] of Object.entries(o.einsaetze || {})) { if (!e || !e.meta) continue; const cur = db.einsaetze[id];
      if (!cur) { db.einsaetze[id] = e; n++; } else { Object.assign(cur.teams, e.teams || {}); Object.assign(cur.log, e.log || {}); cur.meta = { ...e.meta, ...cur.meta }; n++; } }
      if (o.settings && !Object.keys(db.settings || {}).length) db.settings = o.settings; persist(); emitCur(); emitList(); setCb && setCb(clone(db.settings)); return n; }
  };
}

/* ================= Speicher: Firebase (offline + Sync) ================= */
async function CloudBackend(fbConfig) {
  const B = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, A, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
  const app = appM.initializeApp(fbConfig);
  const auth = A.getAuth(app);
  await A.setPersistence(auth, A.indexedDBLocalPersistence).catch(() => {});
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { fs = F.getFirestore(app); }
  const E = F.collection(fs, 'einsaetze');
  const fail = e => { SY.error = (e && e.code === 'permission-denied') ? 'Kein Zugriff (Konto nicht freigegeben)' : 'Sync-Fehler: ' + (e && (e.code || e.message)); renderSync(); };
  const w = p => p.catch(fail);
  let subs = [];
  return {
    mode: 'cloud',
    onUser: cb => A.onAuthStateChanged(auth, cb),
    login: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
    logout: () => A.signOut(auth),
    watchSettings(cb) { F.onSnapshot(F.doc(fs, 'config', 'settings'), d => cb(d.exists() ? d.data() : {}), fail); },
    putSettings(s) { w(F.setDoc(F.doc(fs, 'config', 'settings'), clone(s))); },
    watchList(cb) { F.onSnapshot(F.query(E, F.orderBy('created', 'desc'), F.limit(60)), q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), fail); },
    open(eid, cb) {
      subs.forEach(u => u()); subs = [];
      let meta = {}, teams = [], log = []; const p = { m: false, t: false, l: false };
      const emit = () => { SY.pending = p.m || p.t || p.l; SY.error = ''; cb({ meta, teams, log }); renderSync(); };
      const o = { includeMetadataChanges: true };
      subs.push(F.onSnapshot(F.doc(E, eid), o, d => { meta = d.exists() ? d.data() : {}; p.m = d.metadata.hasPendingWrites; emit(); }, fail));
      subs.push(F.onSnapshot(F.collection(E, eid, 'teams'), o, q => { teams = q.docs.map(d => d.data()); p.t = q.metadata.hasPendingWrites; emit(); }, fail));
      subs.push(F.onSnapshot(F.query(F.collection(E, eid, 'log'), F.orderBy('t')), o, q => { log = q.docs.map(d => d.data()); p.l = q.metadata.hasPendingWrites; emit(); }, fail));
    },
    create(meta) { const id = uid(); w(F.setDoc(F.doc(E, id), clone(meta))); return id; },
    putMeta(eid, meta) { w(F.setDoc(F.doc(E, eid), clone(meta))); },
    putTeam(eid, T) { w(F.setDoc(F.doc(E, eid, 'teams', T.id), clone(T))); },
    delTeam(eid, id) { w(F.deleteDoc(F.doc(E, eid, 'teams', id))); },
    addLog(eid, id, e) { w(F.setDoc(F.doc(E, eid, 'log', id), clone(e))); }
  };
}

/* ---------- Einsatz-Verwaltung ---------- */
function openE(eid) {
  S.eid = eid; LP.set('eid', eid);
  BE.open(eid, st => { S.meta = st.meta || {}; S.teams = st.teams || []; S.log = st.log || []; render(); });
}
function newMeta() { return { created: Date.now(), start: null, end: null, closed: false, ereignis: '', ort: '', asue: '', el: '' }; }
function ensureE() { if (!S.eid) openE(BE.create(newMeta())); return S.eid; }
function saveTeam(T) { BE.putTeam(ensureE(), T); }
function saveMeta() { const m = { ...newMeta(), ...S.meta }; const id = ensureE(); S.meta = m; BE.putMeta(id, m); }
function log(text, id) { BE.addLog(ensureE(), id || uid(), { t: Date.now(), text, dev: LP.get('dev') || '' }); }
const team = id => S.teams.find(t => t.id === id);

/* ---------- Ton ---------- */
let AC = null;
function initAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
function beep(n) {
  if (LP.get('mute') || !AC) return;
  try { for (let i = 0; i < n; i++) { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'square'; o.frequency.value = n > 1 ? 1040 : 780;
    const t = AC.currentTime + i * .35; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .25);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + .3); } } catch (e) {}
}
document.addEventListener('pointerdown', initAudio);

/* ---------- Berechnung ---------- */
function rzOf(m) {
  const st = S.settings; let r;
  if (st.rzMode === 'fixed') r = st.rzFixed;
  else r = m.p0 / 2;
  return Math.max(Math.round(r), st.pfeife);
}
function mCalc(m, now) {
  const r = m.readings, first = r[0], last = r[r.length - 1];
  let rate = S.settings.defRate, measured = false;
  if (r.length > 1) { const d = (last.t - first.t) / 60000; if (d >= 0.5 && first.p > last.p) { rate = (first.p - last.p) / d; measured = true; } }
  const est = Math.max(0, last.p - rate * (now - last.t) / 60000);
  const rz = rzOf(m);
  return { est, rate, measured, rz, tRz: last.t + Math.max(0, last.p - rz) / rate * 60000 };
}
function tCalc(T, now) {
  const ms = T.members.map(m => mCalc(m, now));
  let low = 0; ms.forEach((x, i) => { if (x.tRz < ms[low].tRz) low = i; });
  const lastRead = Math.max(...T.members.map(m => m.readings[m.readings.length - 1].t));
  return { ms, low, tRz: ms[low].tRz, nextCheck: lastRead + S.settings.interval * 60000 };
}
const active = T => (T.status === 'innen' || T.status === 'rueckzug') && T.members.every(m => m.readings && m.readings.length);

/* ---------- Darstellung ---------- */
const presets = () => String(S.settings.kanaele || '').split(/[,;]+/).map(k => k.trim()).filter(Boolean).map(k => /^\d+$/.test(k) ? 'K ' + k : k);
function renderChips() { const v = $('#fTeam').elements.kanal.value.trim();
  $('#kChips').innerHTML = presets().map(k => `<button type="button" data-k="${esc(k)}" class="${k === v ? 'on' : ''}">${esc(k)}</button>`).join(''); }
$('#kChips').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; $('#fTeam').elements.kanal.value = b.dataset.k; renderChips(); });
$('#fTeam').elements.kanal.addEventListener('input', renderChips);
const STL = { bereit: 'Bereit', innen: 'Im Einsatz', rueckzug: 'Rückzug', draussen: 'Draussen' };
function card(T) {
  const mem = T.members.map((m, i) => `<tr id="m-${T.id}-${i}"><td>${esc(m.name)}</td><td class="n">${m.p0}</td><td class="n"><b id="p-${T.id}-${i}">${m.p0}</b></td><td class="n" id="r-${T.id}-${i}">–</td><td class="n" id="z-${T.id}-${i}">${rzOf(m)}</td></tr>`).join('');
  const B = {
    bereit: `<button data-a="in" class="pri" data-s="Eingang">Eingang – Trupp geht rein</button><button data-a="edit">Bearbeiten</button><button data-a="del" class="ghost">Entfernen</button>`,
    innen: `<button data-a="druck" class="pri" data-s="Druck">Druck erfassen</button><button data-a="rz" class="warnb">Rückzug</button><button data-a="out">Draussen</button><button data-a="edit">Bearbeiten</button>`,
    rueckzug: `<button data-a="druck" class="pri" data-s="Druck">Druck erfassen</button><button data-a="out">Draussen</button><button data-a="edit">Bearbeiten</button>`,
    draussen: `<button data-a="hide" class="ghost">Von der Tafel nehmen</button>`
  }[T.status];
  return `<article class="card" id="c-${T.id}" data-id="${T.id}">
  <header><div class="nr">${esc(T.nr)}</div><div class="hd">
    <div class="row"><span class="kanal"><span class="fw">Funk </span>${esc(T.kanal || '–')}</span>${T.stock && T.status !== 'draussen' ? `<button type="button" class="stk" data-a="stock">${esc(T.stock)}</button>` : ''}<span class="st st-${T.status}">${STL[T.status]}</span><span class="lbl d">Druckkontrolle fällig</span><span class="lbl a">RÜCKZUG!</span></div>
    <div class="auftrag">${esc(T.auftrag || 'Kein Auftrag erfasst')}</div></div></header>
  <table class="mt"><thead><tr><th>Name</th><th>Start</th><th>Druck</th><th>bar/Min.</th><th>RZ-Druck</th></tr></thead><tbody>${mem}</tbody></table>
  <div class="kpis"><div><span data-s="Einsatz">Im Einsatz</span><b id="k1-${T.id}">–</b></div><div><span data-s="Kontrolle">Nächste Kontrolle</span><b id="k2-${T.id}">–</b></div><div><span data-s="${T.status === 'draussen' ? 'Raus' : 'Rückzug'}">${T.status === 'draussen' ? 'Raus um' : 'Rückzug spätestens'}</span><b id="k3-${T.id}">–</b></div></div>
  <div class="btns">${B}</div></article>`;
}
function render() {
  const vis = S.teams.filter(t => !t.hidden);
  set('sub', [S.settings.org, S.meta.ereignis].filter(Boolean).join(' · '));
  for (const i of document.querySelectorAll('[data-m]')) if (document.activeElement !== i) i.value = S.meta[i.dataset.m] || '';
  const g = $('#grid');
  if (!vis.length) g.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Noch kein Trupp auf der Tafel</h2><p>Erfasse Trupp-Nummer, Funkkanal, Auftrag und die Namen mit Anfangsdruck. Beim Eingang startet die Überwachung.</p><div class="row"><button class="pri" data-g="add">+ Trupp erfassen</button></div></div>`;
  else { const o = { innen: 0, rueckzug: 1, bereit: 2, draussen: 3 };
    g.innerHTML = [...vis].sort((a, b) => o[a.status] - o[b.status] || String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true })).map(card).join(''); }
  $('#kanaele').innerHTML = [...new Set([...presets(), ...S.teams.map(t => t.kanal).filter(Boolean)])].map(k => `<option value="${esc(k)}">`).join('');
  const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
  $('#bMute').innerHTML = LP.get('mute')
    ? SPK + '<path d="M17 9l5 6M22 9l-5 6"/></svg>Ton aus'
    : SPK + '<path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13"/></svg>Ton an';
  const cmp = LP.get('view') !== 'gross'; document.body.classList.toggle('compact', cmp); $('#bView').textContent = cmp ? 'Ansicht: Kompakt' : 'Ansicht: Gross';
  $('#bMute').title = LP.get('mute') ? 'Ton ist aus – tippen zum Einschalten' : 'Ton ist an – tippen zum Ausschalten';
  const st = $('#eState'); st.textContent = S.eid ? (S.meta.closed ? 'Abgeschlossen' : 'Laufend') : 'Kein Einsatz'; st.className = 'tag' + (S.eid && !S.meta.closed ? ' on' : '');
  $('#bClose').hidden = !S.eid || !!S.meta.closed;
  $('#log').innerHTML = S.log.length ? [...S.log].reverse().map(l => `<li><time>${hms(l.t)}</time><span>${esc(l.text)}</span>${l.dev ? `<em>${esc(l.dev)}</em>` : ''}</li>`).join('') : '<li><span style="color:var(--mute)">Noch keine Einträge.</span></li>';
  document.body.classList.toggle('nobau', LP.get('bau') === 'aus'); $('#bBau').textContent = LP.get('bau') === 'aus' ? 'Gebäude: aus' : 'Gebäude: an';
  renderBau(); renderList(); renderSync(); tick();
}
function renderSync() {
  const el = $('#sync'); let t, c;
  if (SY.mode === 'local') { t = 'Nur dieses Gerät'; c = ''; }
  else if (SY.error) { t = SY.error; c = 'err'; }
  else if (!SY.user) { t = 'Nicht angemeldet'; c = 'warn'; }
  else if (!navigator.onLine) { t = 'Offline – gleicht später ab'; c = 'warn'; }
  else if (SY.pending) { t = 'Synchronisiere …'; c = 'warn'; }
  else { t = 'Synchronisiert'; c = 'ok'; }
  el.textContent = t; el.className = 'sync ' + c;
}
addEventListener('online', renderSync); addEventListener('offline', renderSync);
function banner(t) { const b = $('#banner'); b.hidden = !t; b.textContent = t || ''; }

const AL = {};
function tick() {
  const now = Date.now();
  set('clock', hms(now));
  set('einsatz', S.meta.start ? durH((S.meta.end && S.meta.closed ? S.meta.end : now) - S.meta.start) : '00:00:00');
  for (const T of S.teams) {
    const c = document.getElementById('c-' + T.id); if (!c) continue;
    let cls = '';
    if (active(T)) {
      const k = tCalc(T, now);
      k.ms.forEach((x, i) => {
        set(`p-${T.id}-${i}`, (now - T.members[i].readings[T.members[i].readings.length - 1].t < 20000 ? '' : '≈') + Math.round(x.est));
        set(`r-${T.id}-${i}`, (x.measured ? '' : '~') + x.rate.toFixed(1)); set(`z-${T.id}-${i}`, x.rz);
        const tr = document.getElementById(`m-${T.id}-${i}`); if (tr) tr.classList.toggle('low', T.members.length > 1 && i === k.low);
      });
      set('k1-' + T.id, dur(now - T.tIn));
      set('k2-' + T.id, dur(k.nextCheck - now));
      set('k3-' + T.id, T.status === 'rueckzug' ? 'läuft' : hm(k.tRz) + ' · ' + dur(k.tRz - now));
      if (T.status === 'innen' && now >= k.tRz) cls = 'alarm'; else if (now >= k.nextCheck) cls = 'due'; else if (T.status === 'innen' && k.tRz - now < 180000) cls = 'soon';
      const a = AL[T.id] || (AL[T.id] = {});
      const nRead = T.members.reduce((s, m) => s + m.readings.length, 0);
      if (cls === 'alarm' && a.rz !== nRead) { a.rz = nRead; beep(3); log(`Trupp ${T.nr}: berechneter Rückzugsdruck erreicht`, `rz-${T.id}-${nRead}`); }
      if (cls === 'due' && a.check !== k.nextCheck) { a.check = k.nextCheck; beep(1); }
    } else if (T.status === 'draussen' && T.tIn) {
      T.members.forEach((m, i) => set(`p-${T.id}-${i}`, m.readings.length ? m.readings[m.readings.length - 1].p : m.p0));
      set('k1-' + T.id, dur(T.tOut - T.tIn)); set('k2-' + T.id, '–'); set('k3-' + T.id, hm(T.tOut));
    }
    const nc = 'card ' + cls; if (c.className !== nc) c.className = nc;
    const bd = document.getElementById('b-' + T.id); if (bd) { const bc = 'tbg ' + T.status + (cls ? ' ' + cls : ''); if (bd.className !== bc) bd.className = bc; }
  }
}

/* ---------- Einsätze-Liste ---------- */
function renderList() {
  const ul = $('#elist'); if (!ul) return;
  ul.innerHTML = S.list.length ? S.list.map(e => `<li><div><b>${esc(e.ereignis || 'Ohne Bezeichnung')}</b><span>${dt(e.start || e.created)}${e.ort ? ' · ' + esc(e.ort) : ''}</span></div>
    <span class="tag${e.id === S.eid ? ' on' : ''}">${e.id === S.eid ? 'Geöffnet' : e.closed ? 'Abgeschlossen' : 'Laufend'}</span>
    ${e.id === S.eid ? '' : `<button data-open="${esc(e.id)}">Öffnen</button>`}</li>`).join('') : '<li><span>Noch keine Einsätze.</span></li>';
}
$('#elist').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) { openE(b.dataset.open); $('#dE').close(); } });
$('#bList').onclick = () => { renderList(); $('#eMsg').textContent = ''; $('#bBackup').hidden = !BE.exportAll; $('#lImport').hidden = !BE.importAll; $('#dE').showModal(); };
$('#bEClose').onclick = () => $('#dE').close();
$('#bNew').onclick = () => {
  const go = () => { openE(BE.create(newMeta())); $('#dE').close(); };
  if (S.teams.some(t => t.status === 'innen' || t.status === 'rueckzug')) { $('#dE').close(); confirmBox('Neuen Einsatz starten?', 'Im geöffneten Einsatz sind noch Trupps drin. Der Einsatz bleibt gespeichert und ist unter «Einsätze» weiter erreichbar.', go); }
  else go();
};
$('#bDemo').onclick = () => { demo(); $('#dE').close(); };
$('#bBackup').onclick = async () => {
  if (!BE.exportAll) return;
  const d = new Date(), data = { app: 'asue', version: VERSION, exported: Date.now(), device: LP.get('dev') || '', ...BE.exportAll() };
  const r = await deliver(new Blob([JSON.stringify(data)], { type: 'application/json' }), `ASUE-Datensicherung_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${LP.get('dev') ? '_' + clean(LP.get('dev')).replace(/[^A-Za-z0-9]+/g, '-') : ''}.json`);
  $('#eMsg').textContent = r === 'abgebrochen' ? '' : 'Datensicherung ' + r + '.';
};
$('#fImport').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file || !BE.importAll) return;
  try { const o = JSON.parse(await file.text()); if (o.app !== 'asue') throw new Error('keine ASÜ-Datensicherung');
    const n = BE.importAll(o); $('#eMsg').textContent = n + ' Einsatz/Einsätze eingelesen bzw. ergänzt.'; }
  catch (err) { $('#eMsg').textContent = 'Einlesen fehlgeschlagen: ' + err.message; }
});
$('#bClose').onclick = () => {
  const inside = S.teams.filter(t => t.status === 'innen' || t.status === 'rueckzug').length;
  confirmBox('Einsatz abschliessen?', inside ? `Achtung: ${inside} Trupp(s) sind noch nicht als draussen erfasst.` : 'Der Einsatz wird archiviert. Du kannst ihn unter «Einsätze» jederzeit wieder öffnen und das Protokoll exportieren.', () => {
    S.meta.closed = true; S.meta.end = Date.now(); saveMeta(); log('Einsatz abgeschlossen');
  });
};

/* ---------- Dialoge ---------- */
function confirmBox(title, text, ok) { $('#cTitle').textContent = title; $('#cText').textContent = text; const d = $('#dC'); d.returnValue = ''; d.onclose = () => { if (d.returnValue === 'ok') ok(); }; d.showModal(); }

let editId = null;
function openTeam(id) {
  editId = id || null; const f = $('#fTeam'); f.reset(); $('#tErr').textContent = '';
  const T = id && team(id);
  $('#tTitle').textContent = T ? 'Trupp ' + T.nr + ' bearbeiten' : 'Neuer Trupp';
  f.elements.stock.value = (T && T.stock) || '';
  if (T) { f.elements.nr.value = T.nr; f.elements.kanal.value = T.kanal || ''; f.elements.auftrag.value = T.auftrag || ''; T.members.forEach((m, i) => { f.elements['n' + i].value = m.name; f.elements['p' + i].value = m.p0; }); }
  else { const max = S.teams.reduce((a, t) => Math.max(a, parseInt(t.nr) || 0), 0); f.elements.nr.value = max + 1; const last = S.teams[S.teams.length - 1]; f.elements.kanal.value = (last && last.kanal) || presets()[0] || ''; }
  for (let i = 0; i < 3; i++) { f.elements['p' + i].placeholder = S.settings.defP0; const locked = T && T.status !== 'bereit'; f.elements['p' + i].disabled = !!locked; f.elements['n' + i].disabled = !!(locked && !T.members[i]); const qb = document.querySelector(`[data-qr="n${i}"]`); if (qb) qb.disabled = f.elements['n' + i].disabled; }
  renderChips(); renderSChips(); $('#dTeam').showModal();
}
$('#fTeam').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const f = e.target, mem = [];
  for (let i = 0; i < 3; i++) { const n = f.elements['n' + i].value.trim(); if (n) mem.push({ name: n, p0: parseInt(f.elements['p' + i].value) || S.settings.defP0, readings: [], pArr: null }); }
  if (!mem.length) { e.preventDefault(); $('#tErr').textContent = 'Mindestens einen Namen erfassen.'; return; }
  const T = editId && team(editId), kanal = f.elements.kanal.value.trim(), auftrag = f.elements.auftrag.value.trim(), stock = f.elements.stock.value.trim();
  if (T) {
    const ch = []; if ((T.kanal || '') !== kanal) ch.push('Funk ' + (kanal || '–')); if ((T.auftrag || '') !== auftrag) ch.push('Auftrag: ' + (auftrag || '–')); if ((T.stock || '') !== stock) ch.push('Stockwerk ' + (stock || '–'));
    T.nr = f.elements.nr.value.trim(); T.kanal = kanal; T.auftrag = auftrag; T.stock = stock;
    if (T.status === 'bereit') T.members = mem; else T.members.forEach((m, i) => { const n = f.elements['n' + i].value.trim(); if (n) m.name = n; });
    saveTeam(T); if (ch.length && T.status !== 'bereit') log(`Trupp ${T.nr}: ${ch.join(', ')}`);
  } else {
    const N = { id: uid(), nr: f.elements.nr.value.trim(), kanal, auftrag, stock, status: 'bereit', members: mem, tIn: null, tOut: null, hidden: false };
    saveTeam(N); log(`Trupp ${N.nr} erfasst (Funk ${kanal || '–'}): ${mem.map(m => m.name + ' ' + m.p0 + ' bar').join(', ')}`);
  }
});

let pCtx = null;
function openP(id, mode) {
  const T = team(id); pCtx = { id, mode };
  $('#pTitle').textContent = { check: 'Druck erfassen', arr: 'Am Arbeitsort', out: 'Trupp draussen' }[mode] + ' – Trupp ' + T.nr;
  $('#pHint').textContent = { check: 'Aktuellen Druck pro Person in bar eingeben.', arr: 'Druck bei Ankunft am Arbeitsort. Daraus wird bei entsprechender Einstellung der Rückzugsdruck berechnet.', out: 'Enddruck eingeben (optional). Der Trupp wird als draussen erfasst.' }[mode];
  $('#pErr').textContent = '';
  $('#pRows').innerHTML = T.members.map((m, i) => `<label class="prow"><span>${esc(m.name)}</span><input name="q${i}" type="number" inputmode="numeric" placeholder="${m.readings[m.readings.length - 1].p}"></label>`).join('');
  $('#dP').showModal(); setTimeout(() => { const i = $('#pRows input'); if (i) i.focus(); }, 50);
}
$('#fP').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const T = team(pCtx.id); if (!T) return;
  const now = Date.now(), vals = T.members.map((m, i) => parseInt(e.target.elements['q' + i].value));
  if (pCtx.mode !== 'out' && vals.every(v => isNaN(v))) { e.preventDefault(); $('#pErr').textContent = 'Mindestens einen Druck eingeben.'; return; }
  const bad = vals.find((v, i) => !isNaN(v) && (v < 0 || v > T.members[i].p0 + 20));
  if (bad !== undefined) { e.preventDefault(); $('#pErr').textContent = 'Druck ' + bad + ' bar ist nicht plausibel.'; return; }
  const parts = [];
  T.members.forEach((m, i) => { const v = vals[i]; if (isNaN(v)) return; m.readings.push({ t: now, p: v }); if (pCtx.mode === 'arr') m.pArr = v; parts.push(m.name + ' ' + v); });
  const txt = parts.length ? ': ' + parts.join(', ') + ' bar' : '';
  if (pCtx.mode === 'out') { T.status = 'draussen'; T.tOut = now; }
  saveTeam(T);
  log({ check: `Trupp ${T.nr} Druck${txt}`, arr: `Trupp ${T.nr} am Arbeitsort${txt}`, out: `Trupp ${T.nr} draussen nach ${dur(now - T.tIn)} Min.${txt}` }[pCtx.mode]);
});

function openSettings() {
  const f = $('#fS'), st = S.settings;
  for (const k of ['org', 'kanaele', 'interval', 'defP0', 'rzMode', 'rzFixed', 'pfeife', 'defRate']) f.elements[k].value = st[k];
  f.elements.dev.value = LP.get('dev') || '';
  $('#bLogout').hidden = SY.mode !== 'cloud' || !SY.user;
  $('#sInfo').textContent = `Version ${VERSION} · ${SY.mode === 'cloud' ? 'Synchronisation über Firebase' + (SY.user ? ' · angemeldet als ' + SY.user.email : '') : 'Nur lokal (keine Firebase-Konfiguration)'}`;
  $('#dS').showModal();
}
$('#fS').addEventListener('submit', e => {
  const f = e.target;
  if (e.submitter && e.submitter.value === 'logout') { confirmBox('Abmelden?', 'Danach braucht dieses Gerät Internet, um sich wieder anzumelden.', () => BE.logout()); return; }
  if (e.submitter && e.submitter.value !== 'ok') return;
  const s = { ...S.settings };
  for (const k of ['interval', 'defP0', 'rzFixed', 'pfeife', 'defRate']) { const v = parseFloat(f.elements[k].value); if (v > 0 || (k === 'reserve' && v >= 0)) s[k] = v; }
  s.rzMode = f.elements.rzMode.value; s.org = f.elements.org.value.trim(); s.kanaele = f.elements.kanaele.value.trim();
  LP.set('dev', f.elements.dev.value.trim());
  BE.putSettings(s);
});


/* ---------- QR-Code scannen (Kamera) ---------- */
let qr = null;
function stopScan() { if (!qr) return; qr.stop = true; if (qr.stream) qr.stream.getTracks().forEach(t => t.stop()); $('#qrVideo').srcObject = null; qr = null; }
function qrText(raw) { let t = String(raw || '').trim(); t = t.replace(/^(ASUE|ASÜ|AdA)\s*[:;]\s*/i, ''); return t.split(/[|;\n]/)[0].trim().slice(0, 60); }
async function startScan(field) {
  const hint = $('#qrHint');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { hint.textContent = 'Kamera ist hier nicht verfügbar. Die App muss über https geöffnet sein.'; $('#dQR').showModal(); return; }
  hint.textContent = 'Kamera startet …'; $('#dQR').showModal();
  qr = { field, stop: false };
  try {
    qr.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
  } catch (e) { hint.textContent = 'Kein Zugriff auf die Kamera. Bitte in den Einstellungen des Geräts erlauben.'; return; }
  if (!qr || qr.stop) { stopScan(); return; }
  const v = $('#qrVideo'); v.srcObject = qr.stream; try { await v.play(); } catch (e) {}
  hint.textContent = 'QR-Code in den Rahmen halten.';
  const det = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const me = qr;
  const loop = async () => {
    if (me.stop) return;
    let txt = null;
    if (v.readyState >= 2 && v.videoWidth) {
      try {
        if (det) { const r = await det.detect(v); if (r[0]) txt = r[0].rawValue; }
        else if (window.jsQR) { const sc = Math.min(1, 640 / v.videoWidth); cv.width = v.videoWidth * sc; cv.height = v.videoHeight * sc;
          cx.drawImage(v, 0, 0, cv.width, cv.height); const r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' }); if (r) txt = r.data; }
      } catch (e) {}
    }
    const name = txt && qrText(txt);
    if (name) { const inp = $('#fTeam').elements[me.field]; inp.value = name; inp.dispatchEvent(new Event('input')); initAudio(); beep(1); stopScan(); $('#dQR').close(); return; }
    setTimeout(loop, 150);
  };
  loop();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-qr]'); if (b) { e.preventDefault(); startScan(b.dataset.qr); } });
$('#bQrCancel').onclick = () => $('#dQR').close();
$('#dQR').addEventListener('close', stopScan);


/* ---------- Stockwerke / Gebäude ---------- */
const floors = () => String(S.meta.floors || S.settings.floors || '').split(',').map(f => f.trim()).filter(Boolean);
const isEG = f => /^(eg|erdgeschoss|parterre)$/i.test(f.replace(/\s+/g, ''));
function badge(T, extra) { return `<button type="button" class="tbg ${T.status}" id="b-${T.id}" data-st="${esc(T.id)}" title="Trupp ${esc(T.nr)}${T.stock ? ' · ' + esc(T.stock) : ''}">${esc(T.nr)}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`; }
function renderBau() {
  const el = $('#bau'); if (!el) return;
  const fl = floors(), vis = S.teams.filter(t => !t.hidden), inside = vis.filter(t => t.status === 'innen' || t.status === 'rueckzug');
  const byNr = (a, b) => String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true });
  const egI = fl.findIndex(isEG);
  let h = `<div class="bau-h"><b>Gebäude</b><button type="button" id="bFl">Stockwerke</button></div><div class="roof"></div>`;
  for (let i = fl.length - 1; i >= 0; i--) {
    const ts = inside.filter(t => t.stock === fl[i]).sort(byNr);
    h += `<div class="fl${egI >= 0 && i < egI ? ' ug' : ''}"><div class="fn">${esc(fl[i])}</div><div class="tm">${ts.map(t => badge(t)).join('')}</div></div>`;
    if (i === egI) h += '<div class="ground"></div>';
  }
  if (egI < 0) h += '<div class="ground"></div>';
  const other = inside.filter(t => t.stock && !fl.includes(t.stock)).sort(byNr), none = inside.filter(t => !t.stock).sort(byNr), ready = vis.filter(t => t.status === 'bereit').sort(byNr);
  if (other.length) h += `<div class="zone">Anderer Ort<div class="tm">${other.map(t => badge(t, t.stock)).join('')}</div></div>`;
  if (none.length) h += `<div class="zone">Ohne Stockwerk<div class="tm">${none.map(t => badge(t)).join('')}</div></div>`;
  if (ready.length) h += `<div class="zone">Bereit<div class="tm">${ready.map(t => badge(t)).join('')}</div></div>`;
  if (!inside.length && !ready.length) h += '<div class="zone">Noch kein Trupp im Gebäude.</div>';
  el.innerHTML = h;
}
$('#bau').addEventListener('click', e => {
  if (e.target.closest('#bFl')) return openFloors();
  const b = e.target.closest('[data-st]'); if (!b) return;
  const T = team(b.dataset.st); if (!T) return;
  const c = document.getElementById('c-' + T.id); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1500); }
  if (T.status === 'bereit') return;
  openStock(T.id, 'move');
});
function renderSChips() { const v = $('#fTeam').elements.stock.value.trim();
  $('#sChips').innerHTML = floors().map(k => `<button type="button" data-k="${esc(k)}" class="${k === v ? 'on' : ''}">${esc(k)}</button>`).join(''); }
$('#sChips').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; const i = $('#fTeam').elements.stock; i.value = i.value.trim() === b.dataset.k ? '' : b.dataset.k; renderSChips(); });
$('#fTeam').elements.stock.addEventListener('input', renderSChips);

function enter(T, stock) {
  const now = Date.now();
  T.status = 'innen'; T.tIn = now; T.stock = stock || ''; T.members.forEach(m => { m.readings = [{ t: now, p: m.p0 }]; m.pArr = null; });
  if (!S.meta.start) { S.meta.start = now; saveMeta(); }
  saveTeam(T);
  log(`Trupp ${T.nr} Eingang (Funk ${T.kanal || '–'}${T.stock ? ', ' + T.stock : ''}${T.auftrag ? ', ' + T.auftrag : ''}): ${T.members.map(m => m.name + ' ' + m.p0).join(', ')} bar`);
}
let stCtx = null;
function openStock(id, mode) {
  const T = team(id); if (!T) return; stCtx = { id, mode };
  $('#stTitle').textContent = mode === 'in' ? `Trupp ${T.nr}: Wohin geht der Trupp?` : `Trupp ${T.nr}: Stockwerk wechseln`;
  const fl = floors(), egI = fl.findIndex(isEG);
  $('#stPick').innerHTML = fl.map((f, i) => (i === egI ? '' : '') + `<button type="button" data-f="${esc(f)}" class="${f === T.stock ? 'on' : ''}">${esc(f)}</button>` + (i === egI - 1 ? '<div class="gl"></div>' : '')).join('');
  $('#stOther').value = T.stock && !fl.includes(T.stock) ? T.stock : '';
  $('#stSkip').textContent = mode === 'in' ? 'Ohne Angabe' : 'Kein Stockwerk';
  $('#dStock').showModal();
}
function applyStock(val) {
  const ctx = stCtx; $('#dStock').close(); if (!ctx) return; const T = team(ctx.id); if (!T) return;
  if (ctx.mode === 'in') return enter(T, val);
  if ((T.stock || '') === val) return;
  T.stock = val; saveTeam(T); log(`Trupp ${T.nr}: Stockwerk ${val || '–'}`);
}
$('#stPick').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) applyStock(b.dataset.f); });
$('#stOk').onclick = () => applyStock($('#stOther').value.trim());
$('#stSkip').onclick = () => applyStock('');
$('#stCancel').onclick = () => { stCtx = null; $('#dStock').close(); };
function openFloors() { $('#fFl').elements.floors.value = floors().join(', '); $('#dFl').showModal(); }
$('#fFl').addEventListener('submit', e => {
  const v = e.target.elements.floors.value.split(',').map(f => f.trim()).filter(Boolean).join(', ');
  if (!e.submitter || e.submitter.value === 'cancel' || !v) return;
  if (e.submitter.value === 'std') BE.putSettings({ ...S.settings, floors: v });
  S.meta.floors = v; saveMeta();
});

/* ---------- Aktionen auf der Tafel ---------- */
$('#grid').addEventListener('click', e => {
  if (e.target.closest('[data-g="add"]')) return openTeam();
  const sk = e.target.closest('[data-a="stock"]'); if (sk) return openStock(sk.closest('.card').dataset.id, 'move');
  const hd = e.target.closest('.card header');
  if (hd && document.body.classList.contains('compact')) { const T0 = team(hd.closest('.card').dataset.id); if (T0 && T0.status !== 'draussen') openTeam(T0.id); return; }
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.closest('.card').dataset.id, T = team(id), now = Date.now(), a = b.dataset.a;
  if (!T) return;
  if (a === 'in') { if (floors().length) openStock(id, 'in'); else enter(T, T.stock || ''); }
  else if (a === 'druck') openP(id, 'check');
  else if (a === 'arr') openP(id, 'arr');
  else if (a === 'out') confirmBox('Trupp ' + T.nr + ' draussen?', 'Die Überwachung für diesen Trupp wird beendet.', () => {
    const t = Date.now(); T.status = 'draussen'; T.tOut = t; saveTeam(T); log(`Trupp ${T.nr} draussen nach ${dur(t - T.tIn)} Min.`); });
  else if (a === 'rz') { T.status = 'rueckzug'; saveTeam(T); log(`Trupp ${T.nr} Rückzug angetreten`); }
  else if (a === 'edit') openTeam(id);
  else if (a === 'hide') { T.hidden = true; saveTeam(T); }
  else if (a === 'del') confirmBox('Trupp ' + T.nr + ' entfernen?', 'Der Trupp wird gelöscht, er war noch nicht im Einsatz.', () => { BE.delTeam(S.eid, id); log(`Trupp ${T.nr} gelöscht`); });
});
$('#bAdd').onclick = () => openTeam();
$('#bBau').onclick = () => { LP.set('bau', LP.get('bau') === 'aus' ? 'an' : 'aus'); render(); };
$('#bView').onclick = () => { LP.set('view', LP.get('view') === 'gross' ? 'kompakt' : 'gross'); render(); };
$('#bSet').onclick = openSettings;
$('#bMute').onclick = () => { LP.set('mute', !LP.get('mute')); render(); if (!LP.get('mute')) { initAudio(); beep(1); } };
let metaT = null;
$('#meta').addEventListener('input', e => { const i = e.target.closest('[data-m]'); if (!i) return; S.meta[i.dataset.m] = i.value; clearTimeout(metaT); metaT = setTimeout(saveMeta, 700); });

function demo() {
  const now = Date.now(), m = 60000;
  const id = BE.create({ ...newMeta(), ereignis: 'Demo / Übung', ort: 'Übungsplatz', start: now - 14 * m });
  openE(id);
  const teams = [
    { id: uid(), nr: '1', kanal: 'K 12', auftrag: 'Menschenrettung, Treppenhaus links', stock: '2. OG', status: 'innen', tIn: now - 14 * m, tOut: null, hidden: false, members: [
      { name: 'Meier', p0: 300, pArr: null, readings: [{ t: now - 14 * m, p: 300 }, { t: now - 4 * m, p: 215 }] },
      { name: 'Keller', p0: 300, pArr: null, readings: [{ t: now - 14 * m, p: 300 }, { t: now - 4 * m, p: 225 }] }] },
    { id: uid(), nr: '2', kanal: 'K 12', auftrag: 'Brandbekämpfung Keller', stock: 'UG', status: 'innen', tIn: now - 6 * m, tOut: null, hidden: false, members: [
      { name: 'Huber', p0: 300, pArr: null, readings: [{ t: now - 6 * m, p: 300 }] },
      { name: 'Graf', p0: 290, pArr: null, readings: [{ t: now - 6 * m, p: 290 }] },
      { name: 'Brunner', p0: 300, pArr: null, readings: [{ t: now - 6 * m, p: 300 }] }] },
    { id: uid(), nr: '3', kanal: 'K 14', auftrag: 'Sicherungstrupp', status: 'bereit', tIn: null, tOut: null, hidden: false, members: [
      { name: 'Frei', p0: 300, pArr: null, readings: [] }, { name: 'Lenz', p0: 300, pArr: null, readings: [] }] }];
  teams.forEach(T => BE.putTeam(id, T));
  [[14, 'Trupp 1 Eingang (Funk K 12, Menschenrettung 2. OG): Meier 300, Keller 300 bar'], [6, 'Trupp 2 Eingang (Funk K 12, Brandbekämpfung Keller): Huber 300, Graf 290, Brunner 300 bar'], [4, 'Trupp 1 Druck: Meier 215, Keller 225 bar']]
    .forEach(([ago, text]) => BE.addLog(id, uid(), { t: now - ago * m, text, dev: 'Demo' }));
}

/* ================= Protokoll-Export ================= */
const clean = s => String(s ?? '').replace(/[–—−]/g, '-').replace(/≈/g, 'ca. ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const RED = '#c8102e', INK = '#16181a', MUTE = '#5b6166', LINE = '#cfcac3';
function wrap(R, str, w, size, bold) {
  const words = clean(str).split(/\s+/); const out = []; let cur = '';
  for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (R.w(t, size, bold) <= w || !cur) cur = t; else { out.push(cur); cur = wd; } }
  out.push(cur); return out;
}
function layout(R, W, pageH) {
  const M = 40, CW = W - 2 * M; let y = M; const now = Date.now();
  const need = h => { if (pageH && y + h > pageH - M - 20) { R.page(); y = M; return true; } return false; };
  R.img(M, y, 52, 54);
  R.t(M + 66, y + 4, 'Atemschutzüberwachung - Einsatzprotokoll', 17, 1, INK);
  R.t(M + 66, y + 27, S.settings.org || '', 10.5, 0, MUTE);
  R.t(M + 66, y + 41, 'Erstellt ' + dt(now) + (LP.get('dev') ? ' auf ' + LP.get('dev') : ''), 9, 0, MUTE);
  y += 66; R.rect(M, y, CW, 2, RED); y += 12;
  const used = S.teams.filter(t => t.tIn);
  const tEnd = used.length && used.every(t => t.tOut) ? Math.max(...used.map(t => t.tOut)) : null;
  const meta = [['Ereignis', S.meta.ereignis], ['Einsatzort', S.meta.ort], ['Atemschutzüberwacher', S.meta.asue], ['Einsatzleiter', S.meta.el], ['Erster Eingang', dt(S.meta.start)], ['Letzter Trupp draussen', tEnd ? dt(tEnd) : '-']];
  meta.forEach((m, i) => { const x = M + (i % 2) * CW / 2, yy = y + Math.floor(i / 2) * 30; R.t(x, yy, m[0], 8, 0, MUTE); R.t(x, yy + 10, clean(m[1] || '-'), 10.5, 1, INK); });
  y += Math.ceil(meta.length / 2) * 30 + 10;
  R.t(M, y, 'Trupps', 13, 1, RED); y += 20;
  const cols = [['Nr', 24], ['Funk', 36], ['Auftrag', 112], ['Stock', 42], ['Name', 80], ['Start', 36, 1], ['Letzter', 40, 1], ['Eingang', 44, 1], ['Ausgang', 44, 1], ['Dauer', 40, 1]];
  const sc = CW / cols.reduce((a, c) => a + c[1], 0); cols.forEach(c => c[1] *= sc);
  const head = () => { let x = M; R.rect(M, y, CW, 16, '#f1efec'); cols.forEach(c => { R.t(c[2] ? x + c[1] - 4 - R.w(c[0], 8, 1) : x + 4, y + 4, c[0], 8, 1, MUTE); x += c[1]; }); y += 18; };
  head();
  if (!used.length) { R.t(M + 4, y + 2, 'Kein Trupp im Einsatz erfasst.', 9.5, 0, MUTE); y += 18; }
  for (const T of [...used].sort((a, b) => a.tIn - b.tIn)) {
    const last = T.members.map(m => m.readings.length ? m.readings[m.readings.length - 1].p : m.p0);
    const auf = wrap(R, T.auftrag || '-', cols[2][1] - 8, 9, 0);
    const rh = 13, h = Math.max(T.members.length, auf.length) * rh + 6;
    if (need(h)) head();
    const v = [clean(T.nr), clean(T.kanal || '-'), 0, wrap(R, T.stock || '-', cols[3][1] - 8, 9, 0)[0], 0, 0, 0, hm(T.tIn), T.tOut ? hm(T.tOut) : 'drin', T.tOut ? dur(T.tOut - T.tIn) : '-'];
    let x = M;
    cols.forEach((c, ci) => {
      if (ci === 2) auf.forEach((l, li) => R.t(x + 4, y + 4 + li * rh, l, 9, 0, INK));
      else if (ci === 4) T.members.forEach((m, mi) => R.t(x + 4, y + 4 + mi * rh, clean(m.name), 9, 0, INK));
      else if (ci === 5 || ci === 6) T.members.forEach((m, mi) => { const s = String(ci === 5 ? m.p0 : last[mi]); R.t(x + c[1] - 4 - R.w(s, 9, ci === 6), y + 4 + mi * rh, s, 9, ci === 6, INK); });
      else { const s = v[ci]; R.t(c[2] ? x + c[1] - 4 - R.w(s, 9, ci === 0) : x + 4, y + 4, s, 9, ci === 0, INK); }
      x += c[1];
    });
    y += h; R.rect(M, y, CW, .7, LINE); y += 2;
  }
  y += 16; need(40); R.t(M, y, 'Chronologie', 13, 1, RED); y += 20;
  const ev = [...S.log].sort((a, b) => a.t - b.t);
  if (!ev.length) { R.t(M, y, 'Keine Einträge.', 9.5, 0, MUTE); y += 16; }
  for (const l of ev) {
    const lines = wrap(R, l.text + (l.dev ? ' (' + l.dev + ')' : ''), CW - 62, 9.5, 0); need(lines.length * 13 + 4);
    R.t(M, y, hms(l.t), 9.5, 1, MUTE); lines.forEach((ln, i) => R.t(M + 62, y + i * 13, ln, 9.5, 0, INK)); y += lines.length * 13 + 4;
  }
  return y + 10 + M;
}
function logoData() {
  const img = $('#logo'); const c = document.createElement('canvas'); c.width = img.naturalWidth || 220; c.height = img.naturalHeight || 229;
  c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png');
}
function makePdf() {
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  let logo = null; try { logo = logoData(); } catch (e) {}
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const R = {
    w: (s, size, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); return doc.getStringUnitWidth(clean(s)) * size; },
    t: (x, y, s, size, b, col) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(col); doc.text(clean(s), x, y, { baseline: 'top' }); },
    rect: (x, y, w, h, col) => { doc.setFillColor(col); doc.rect(x, y, w, h, 'F'); },
    img: (x, y, w, h) => { if (logo) doc.addImage(logo, 'PNG', x, y, w, h); },
    page: () => doc.addPage()
  };
  layout(R, W, H);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(MUTE);
    doc.text(clean(`Atemschutzüberwachung - ${S.settings.org || ''}`), 40, H - 28); doc.text(`Seite ${i} / ${n}`, W - 40, H - 28, { align: 'right' }); }
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}
function makePng() {
  return new Promise(res => {
    const W = 620, SC = 2, FONT = 'Helvetica, Arial, sans-serif', logo = $('#logo');
    const mc = document.createElement('canvas').getContext('2d');
    const w = (s, size, b) => { mc.font = `${b ? 'bold ' : ''}${size}px ${FONT}`; return mc.measureText(clean(s)).width; };
    const H = Math.ceil(layout({ w, t() {}, rect() {}, img() {}, page() {} }, W, 0));
    const cv = document.createElement('canvas'); cv.width = W * SC; cv.height = H * SC; const c = cv.getContext('2d');
    c.scale(SC, SC); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.textBaseline = 'top';
    layout({ w,
      t: (x, y, s, size, b, col) => { c.font = `${b ? 'bold ' : ''}${size}px ${FONT}`; c.fillStyle = col; c.fillText(clean(s), x, y); },
      rect: (x, y, ww, h, col) => { c.fillStyle = col; c.fillRect(x, y, ww, h); },
      img: (x, y, ww, h) => { try { c.drawImage(logo, x, y, ww, h); } catch (e) {} }, page() {} }, W, 0);
    cv.toBlob(b => res(b), 'image/png');
  });
}
function fname(ext) {
  const d = new Date(S.meta.start || Date.now());
  const slug = clean(S.meta.ereignis || '').replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  return `ASUE-Protokoll_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${slug ? '_' + slug : ''}.${ext}`;
}
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    try { await navigator.share({ files: [file], title: name }); return 'geteilt'; }
    catch (e) { if (e && e.name === 'AbortError') return 'abgebrochen'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'gespeichert';
}
function msg(t, ok) { const m = $('#msg'); m.style.color = ok ? 'var(--ok)' : ''; m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 5000); }
async function exportAs(kind) {
  if (!S.log.length && !S.teams.some(t => t.tIn)) return msg('Noch nichts zu exportieren.');
  try {
    let blob;
    if (kind === 'pdf') { if (!window.jspdf) return msg('PDF-Modul nicht geladen. App einmal mit Internet öffnen, dann klappt es auch offline.'); blob = makePdf(); }
    else blob = await makePng();
    const r = await deliver(blob, fname(kind));
    if (r !== 'abgebrochen') { msg((kind === 'pdf' ? 'PDF ' : 'Foto ') + r + '.', true); log('Protokoll als ' + (kind === 'pdf' ? 'PDF' : 'Foto') + ' exportiert'); }
  } catch (e) { msg('Export fehlgeschlagen: ' + (e && e.message || e)); }
}
$('#bPdf').onclick = () => exportAs('pdf');
$('#bPng').onclick = () => exportAs('png');
$('#bCopy').onclick = () => {
  const txt = 'Atemschutzüberwachung – Protokoll ' + (S.meta.ereignis || '') + ' ' + dt(S.meta.start || Date.now()) + '\n' + [...S.log].sort((a, b) => a.t - b.t).map(l => hms(l.t) + '  ' + l.text).join('\n');
  try { navigator.clipboard.writeText(txt).then(() => msg('Protokoll kopiert.', true), () => msg('Kopieren nicht möglich.')); } catch (e) { msg('Kopieren nicht möglich.'); }
};

/* ================= Start ================= */
let started = false;
function start() {
  if (started) return; started = true;
  BE.watchSettings(s => { S.settings = { ...DEF, ...s }; render(); });
  BE.watchList(l => {
    S.list = l; renderList();
    if (!S.eid) { const want = LP.get('eid'); const hit = l.find(e => e.id === want) || l.find(e => !e.closed); if (hit) openE(hit.id); }
  });
  const last = LP.get('eid');
  if (last && BE.has && BE.has(last)) openE(last);
  render();
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await BE.login(f.elements.email.value.trim(), f.elements.pw.value); }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung – für die erste Anmeldung braucht es Internet.' : 'Anmeldung fehlgeschlagen (E-Mail oder Passwort falsch).'; }
});
async function boot() {
  render(); setInterval(tick, 1000);
  const fb = CFG.firebase;
  if (fb && fb.apiKey) {
    try {
      BE = await CloudBackend(fb); SY.mode = 'cloud';
      BE.onUser(u => { SY.user = u; $('#login').classList.toggle('show', !u); renderSync(); if (u) start(); else if (started) location.reload(); });
      return;
    } catch (e) {
      banner('Synchronisation nicht verfügbar (App wurde auf diesem Gerät noch nie mit Internet geöffnet). Es wird nur lokal gespeichert – diese Daten werden später NICHT abgeglichen.');
    }
  }
  BE = LocalBackend(); SY.mode = 'local'; start();
}
boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
