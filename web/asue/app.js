/* Atemschutzüberwachung – Feuerwehr RTL
   Offline-fähige Web-App mit optionaler Synchronisation über Firebase. */
(function () {
'use strict';
const VERSION = '3.0.0';
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

const DEF = { interval: 10, rzMode: 'half', rzFixed: 150, reserve: 50, pfeife: 55, defRate: 8, defP0: 300, kanaele: '3, 4, 6, 8, 12', personal: [{v:'Hans',n:'Meier',r:'Kpl',nr:'101'},{v:'Lukas',n:'Keller',r:'Sdt',nr:'102'},{v:'Sandra',n:'Huber',r:'Gfr',nr:'103'},{v:'Marco',n:'Graf',r:'Wm',nr:'104'},{v:'Reto',n:'Brunner',r:'Sdt',nr:'105'},{v:'Nadine',n:'Frei',r:'Lt',nr:'106'},{v:'Daniel',n:'Lenz',r:'Gfr',nr:'107'},{v:'Patrick',n:'Koch',r:'Fw',nr:'108'},{v:'Simon',n:'Weber',r:'Sdt',nr:'109'},{v:'Michael',n:'Schmid',r:'Oblt',nr:'110'}].map(p => ({ id: 'm' + p.nr, vorname: p.v, name: p.n, rang: p.r, nr: p.nr, muster: true })), kanalStd: '6', auftraege: 'Absuchen, Brandbekämpfung, Rettung', floors: 'UG -1, EG, 1. OG, 2. OG, 3. OG, Dach', org: CFG.feuerwehr || 'Feuerwehr Rheineck-Thal-Lutzenberg' };
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
    delEinsatz(eid) { delete db.einsaetze[eid]; persist(); emitList(); },
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
    addLog(eid, id, e) { w(F.setDoc(F.doc(E, eid, 'log', id), clone(e))); },
    putPublic(k, d) { w(F.setDoc(F.doc(fs, 'asue_public', k), clone(d))); },
    delPublic(k) { w(F.deleteDoc(F.doc(fs, 'asue_public', k))); },
    async delEinsatz(eid) {
      for (const sub of ['teams', 'log']) { const q = await F.getDocs(F.collection(E, eid, sub)); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); }
      await F.deleteDoc(F.doc(E, eid));
    }
  };
}

/* ---------- Einsatz-Verwaltung ---------- */
function openE(eid) {
  S.eid = eid; LP.set('eid', eid);
  BE.open(eid, st => { S.meta = st.meta || {}; S.teams = st.teams || []; S.log = st.log || []; render(); });
}
function newMeta() { return { created: Date.now(), start: null, end: null, closed: false, ereignis: '', ort: '', asue: '', aso: '', el: '' }; }
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
const auftraege = () => String(S.settings.auftraege || '').split(/[,;]+/).map(k => k.trim()).filter(Boolean);
const kanalStd = () => { const k = String(S.settings.kanalStd || '').trim(); return /^\d+$/.test(k) ? 'K ' + k : k; };
/* Auswahlliste mit «Andere…»/«Freitext…»: der Wert liegt im Textfeld daneben */
function fillSel(selName, inpName, list, val, otherLabel, emptyLabel) {
  const f = $('#fTeam'), sel = f.elements[selName], inp = f.elements[inpName];
  const inList = list.includes(val);
  sel.innerHTML = (emptyLabel != null ? `<option value="">${esc(emptyLabel)}</option>` : '') + list.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('') + `<option value="__other">${esc(otherLabel)}</option>`;
  sel.value = inList ? val : (val ? '__other' : (emptyLabel != null ? '' : (list[0] || '__other')));
  inp.value = val || (sel.value !== '__other' ? sel.value : '');
  inp.hidden = sel.value !== '__other';
}
function selChanged(selName, inpName) {
  const f = $('#fTeam'), sel = f.elements[selName], inp = f.elements[inpName];
  if (sel.value === '__other') { inp.hidden = false; inp.value = ''; inp.focus(); } else { inp.hidden = true; inp.value = sel.value; }
}
/* Sichtbare Auswahlknöpfe (Funkkanal, Stockwerk) mit «Andere …» */
function renderPick(boxId, inpName, list, otherLabel, allowNone) {
  const f = $('#fTeam'), inp = f.elements[inpName], v = inp.value.trim(), other = !!v && !list.includes(v);
  const box = document.getElementById(boxId); box.dataset.inp = inpName; box.dataset.none = allowNone ? '1' : '';
  box.innerHTML = (allowNone ? `<button type="button" data-k="" class="${!v && inp.hidden ? 'on' : ''}">${esc(allowNone === true ? 'Keins' : allowNone)}</button>` : '') + list.map(k => `<button type="button" data-k="${esc(k)}" class="${k === v ? 'on' : ''}">${esc(k)}</button>`).join('') + `<button type="button" data-k="__other" class="oth${other || (!inp.hidden && !v) ? ' on' : ''}">${esc(otherLabel)}</button>`;
  inp.hidden = !(other || box.querySelector('.oth.on'));
}
for (const id of ['kChips', 'sChips']) document.getElementById(id).addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return; const box = e.currentTarget, inp = $('#fTeam').elements[box.dataset.inp];
  box.querySelectorAll('button').forEach(x => x.classList.remove('on'));
  if (b.dataset.k === '__other') { b.classList.add('on'); inp.hidden = false; inp.value = ''; inp.focus(); return; }
  if (box.dataset.none && (b.dataset.k === '' || inp.value.trim() === b.dataset.k)) { inp.value = ''; inp.hidden = true; box.querySelector('[data-k=""]').classList.add('on'); return; }
  b.classList.add('on'); inp.value = b.dataset.k; inp.hidden = true;
});
$('#fTeam').elements.aufSel.addEventListener('change', () => selChanged('aufSel', 'auftrag'));
const RT_AUF = 'Rettungstrupp / Sicherheitstrupp';
const p0t = m => m.full !== false && m.p0 >= (S.settings.defP0 || 300) ? m.p0 + '+' : String(m.p0);
const personal = () => Array.isArray(S.settings.personal) ? S.settings.personal : [];
const pName = p => `${p.name} ${p.vorname}`;
function persByCode(raw) { const t = String(raw || '').trim().replace(/^(ASUE|ASÜ|AdA)\s*[:;]\s*/i, ''); const p = personal().find(p => p.nr && p.nr === t); return p ? pName(p) : null; }
const aufText = T => [T.auftrag, T.zusatz].filter(Boolean).join(' – ');
function syncZusatz() { const f = $('#fTeam'), v = f.elements.aufSel.value; f.elements.zusatz.hidden = !v || v === '__other'; }
$('#fTeam').elements.aufSel.addEventListener('change', syncZusatz);
$('#fTeam').elements.rett.addEventListener('change', e => {
  const f = $('#fTeam'), cur = f.elements.auftrag.value.trim();
  if (e.target.checked) fillSel('aufSel', 'auftrag', auftraege(), RT_AUF, 'Freitext …', '– Auftrag wählen –');
  else if (cur === RT_AUF) fillSel('aufSel', 'auftrag', auftraege(), '', 'Freitext …', '– Auftrag wählen –');
  syncZusatz();
});
function renderChips() {}
const SV = (d, t) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${t}" role="img"><title>${t}</title>${d}</svg>`;
const EQUIP = [
  { k: 'wbk', l: 'Wärmebildkamera', s: 'WBK', d: '<rect x="4.5" y="2.5" width="15" height="11" rx="3"/><rect x="7.5" y="5" width="9" height="5" rx="1"/><path d="M10 13.5h4v6.5a2 2 0 0 1-4 0z"/>' },
  { k: 'haube', l: 'Fluchthaube', s: 'Haube', d: '<path d="M3.5 20v-8a6 6 0 0 1 12 0v8z"/><rect x="6" y="11" width="7" height="4" rx="1.3"/><path d="M17 12h5M19.5 9.5 22 12l-2.5 2.5"/>' },
  { k: 'leine', l: 'Leine', s: 'Leine', d: '<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="4"/><path d="M19 12h3.5"/>' }
];
const eqIcons = T => (T.equip || []).map(k => EQUIP.find(e => e.k === k)).filter(Boolean);
const eqHtml = T => { const l = eqIcons(T); return l.length ? `<span class="eqs">${l.map(e => SV(e.d, e.l)).join('')}</span>` : ''; };
let eqSel = [];
function renderEq() { $('#eqPick').innerHTML = EQUIP.map(e => `<button type="button" data-eq="${e.k}" class="${eqSel.includes(e.k) ? 'on' : ''}">${SV(e.d, e.l)}${e.l}</button>`).join(''); }
$('#eqPick').addEventListener('click', e => { const b = e.target.closest('[data-eq]'); if (!b) return; const k = b.dataset.eq; eqSel = eqSel.includes(k) ? eqSel.filter(x => x !== k) : [...eqSel, k]; renderEq(); });
const AXE = '<i class="axe" aria-hidden="true"></i>';
const STL = { bereit: 'Bereit', innen: 'Im Einsatz', rueckzug: 'Rückzug', draussen: 'Draussen' };
function card(T) {
  const mem = T.members.map((m, i) => `<tr id="m-${T.id}-${i}"><td>${esc(m.name)}</td><td class="n">${p0t(m)}</td><td class="n"><b id="p-${T.id}-${i}">${p0t(m)}</b></td><td class="n" id="r-${T.id}-${i}">–</td><td class="n" id="z-${T.id}-${i}">${rzOf(m)}</td></tr>`).join('');
  const B = {
    bereit: `<button data-a="in" class="pri" data-s="Eingang">Eingang – Trupp geht rein</button><button data-a="edit">Bearbeiten</button><button data-a="del" class="ghost">Entfernen</button>`,
    innen: `<button data-a="druck" class="pri" data-s="Druck">Druck erfassen</button><button data-a="rz" class="warnb">Rückzug</button><button data-a="out">Draussen</button><button data-a="edit">Bearbeiten</button>`,
    rueckzug: `<button data-a="druck" class="pri" data-s="Druck">Druck erfassen</button><button data-a="out">Draussen</button><button data-a="edit">Bearbeiten</button>`,
    draussen: `<button data-a="hide" class="ghost">Von der Tafel nehmen</button>`
  }[T.status];
  return `<article class="card${T.rett ? ' rett' : ''}" id="c-${T.id}" data-id="${T.id}">
  <header><div class="nr">${esc(T.nr)}</div><div class="hd">
    <div class="row">${T.rett ? `<span class="rtag" title="Rettungstrupp">${AXE}<span>Rettungstrupp</span></span>` : ''}<span class="kanal"><span class="fw">Funk </span>${esc(T.kanal || '–')}</span>${T.stock && T.status !== 'draussen' ? `<button type="button" class="stk" data-a="stock">${esc(T.stock)}</button>` : ''}${eqHtml(T)}<span class="st st-${T.status}">${STL[T.status]}</span><span class="lbl d">Druckkontrolle fällig</span><span class="lbl a">RÜCKZUG!</span></div>
    <div class="auftrag">${esc(aufText(T) || 'Kein Auftrag erfasst')}</div></div></header>
  <table class="mt"><thead><tr><th>Name</th><th>Start</th><th>Druck</th><th>bar/Min.</th><th>RZ-Druck</th></tr></thead><tbody>${mem}</tbody></table>
  <div class="kpis"><div><span data-s="Einsatz">Im Einsatz</span><b id="k1-${T.id}">–</b></div><div><span data-s="Kontrolle">Nächste Kontrolle</span><b id="k2-${T.id}">–</b></div><div><span id="k3l-${T.id}" data-s="${T.status === 'draussen' ? 'Raus' : 'Rückzug'}">${T.status === 'draussen' ? 'Raus um' : 'Rückzug spätestens'}</span><b><i class="k3t" id="k3t-${T.id}"></i><em id="k3-${T.id}">–</em></b></div></div>
  <div class="btns">${B}</div></article>`;
}
function render() {
  const vis = S.teams.filter(t => !t.hidden);
  set('sub', [S.settings.org, S.meta.ereignis].filter(Boolean).join(' · '));
  renderFw(); if (isDash()) renderDash(); publishLage();
  for (const i of document.querySelectorAll('[data-m]')) if (document.activeElement !== i) i.value = S.meta[i.dataset.m] || '';
  const g = $('#grid');
  if (!vis.length) g.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Noch kein Trupp auf der Tafel</h2><p>Erfasse Trupp-Nummer, Funkkanal, Auftrag und die Namen mit Anfangsdruck. Beim Eingang startet die Überwachung.</p><div class="row"><button class="pri" data-g="add">+ Trupp erfassen</button></div></div>`;
  else { const o = { innen: 0, rueckzug: 1, bereit: 2, draussen: 3 };
    g.innerHTML = [...vis].sort((a, b) => o[a.status] - o[b.status] || String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true })).map(card).join(''); }
  $('#personen').innerHTML = personal().map(p => `<option value="${esc(pName(p))}">${esc([p.rang, p.nr ? 'Nr. ' + p.nr : ''].filter(Boolean).join(' · '))}</option>`).join('');
  $('#kanaele').innerHTML = [...new Set([...presets(), ...S.teams.map(t => t.kanal).filter(Boolean)])].map(k => `<option value="${esc(k)}">`).join('');
  const SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
  { const mi = $('#muteInd'); mi.hidden = !LP.get('mute'); mi.innerHTML = SPK + '<path d="M17 9l5 6M22 9l-5 6"/></svg>Ton aus'; }
  const cmp = LP.get('view') !== 'gross'; document.body.classList.toggle('compact', cmp);
  const st = $('#eState'); st.textContent = S.eid ? (S.meta.closed ? 'Abgeschlossen' : 'Laufend') : 'Kein Einsatz'; st.className = 'tag' + (S.eid && !S.meta.closed ? ' on' : '');
  $('#bClose').hidden = !S.eid || !!S.meta.closed;
  $('#log').innerHTML = S.log.length ? [...S.log].reverse().map(l => `<li><time>${hms(l.t)}</time><span>${esc(l.text)}</span>${l.dev ? `<em>${esc(l.dev)}</em>` : ''}</li>`).join('') : '<li><span style="color:var(--mute)">Noch keine Einträge.</span></li>';
  document.body.classList.toggle('nobau', LP.get('bau') === 'aus');
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
      set('k3t-' + T.id, T.status === 'rueckzug' ? '' : hm(k.tRz) + ' · '); set('k3-' + T.id, T.status === 'rueckzug' ? 'läuft' : dur(k.tRz - now));
      { const l = document.getElementById('k3l-' + T.id), ds = T.status === 'rueckzug' ? 'Rückzug' : 'Rückzug ' + hm(k.tRz); if (l && l.dataset.s !== ds) l.dataset.s = ds; }
      if (T.status === 'innen' && now >= k.tRz) cls = 'alarm'; else if (now >= k.nextCheck) cls = 'due'; else if (T.status === 'innen' && k.tRz - now < 180000) cls = 'soon';
      const a = AL[T.id] || (AL[T.id] = {});
      const nRead = T.members.reduce((s, m) => s + m.readings.length, 0);
      if (cls === 'alarm' && a.rz !== nRead) { a.rz = nRead; beep(3); log(`Trupp ${T.nr}: berechneter Rückzugsdruck erreicht`, `rz-${T.id}-${nRead}`); }
      if (cls === 'due' && a.check !== k.nextCheck) { a.check = k.nextCheck; beep(1); }
    } else if (T.status === 'draussen' && T.tIn) {
      T.members.forEach((m, i) => set(`p-${T.id}-${i}`, m.readings.length > 1 ? m.readings[m.readings.length - 1].p : p0t(m)));
      set('k1-' + T.id, dur(T.tOut - T.tIn)); set('k2-' + T.id, '–'); set('k3-' + T.id, hm(T.tOut));
    }
    const nc = 'card' + (T.rett ? ' rett' : '') + (cls ? ' ' + cls : ''); if (c.className !== nc) c.className = nc;
    const bd = document.getElementById('b-' + T.id); if (bd) { const bc = 'tbg ' + T.status + (T.rett ? ' rett' : '') + (cls ? ' ' + cls : ''); if (bd.className !== bc) bd.className = bc; }
  }
}

/* ---------- Einsätze-Liste ---------- */
function renderList() {
  renderAdList(); renderPers(); renderDash();
  const ul = $('#elist'); if (!ul) return;
  ul.innerHTML = S.list.length ? S.list.map(e => `<li><div><b>${esc(e.ereignis || 'Ohne Bezeichnung')}</b><span>${dt(e.start || e.created)}${e.ort ? ' · ' + esc(e.ort) : ''}</span></div>
    <span class="tag${e.id === S.eid ? ' on' : ''}">${e.id === S.eid ? 'Geöffnet' : e.closed ? 'Abgeschlossen' : 'Laufend'}</span>
    ${e.id === S.eid ? '' : `<button data-open="${esc(e.id)}">Öffnen</button>`}</li>`).join('') : '<li><span>Noch keine Einsätze.</span></li>';
}
$('#elist').addEventListener('click', e => {
  const b = e.target.closest('[data-open]'); if (b) { openE(b.dataset.open); $('#dE').close(); return; }
});
$('#adList').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (!d) return;
  const ein = S.list.find(x => x.id === d.dataset.del); if (!ein) return;
  confirmBox('Einsatz löschen?', `«${ein.ereignis || 'Ohne Bezeichnung'}» vom ${dt(ein.start || ein.created)} wird mit allen Trupps und dem Protokoll endgültig gelöscht${SY.mode === 'cloud' ? ' – auf allen Geräten' : ''}. Exportiere das Protokoll vorher, falls du es brauchst.`, async () => {
    try { await BE.delEinsatz(ein.id); $('#adMsg').textContent = ''; } catch (err) { $('#adMsg').textContent = 'Löschen fehlgeschlagen' + (navigator.onLine ? '.' : ' – dafür braucht es Internet.'); }
    renderAdList();
  });
});
$('#bList').onclick = () => showDash();
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
$('#bClose').onclick = () => { $('#dE').close();
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
  f.elements.stock.value = (T && T.stock) || ''; f.elements.rett.checked = !!(T && T.rett); eqSel = [...((T && T.equip) || [])]; renderEq();
  if (T) { f.elements.nr.value = T.nr; f.elements.kanal.value = T.kanal || ''; f.elements.auftrag.value = T.auftrag || ''; f.elements.zusatz.value = T.zusatz || ''; T.members.forEach((m, i) => { f.elements['n' + i].value = m.name; f.elements['p' + i].value = m.full === false ? m.p0 : ''; }); }
  else { const max = S.teams.reduce((a, t) => Math.max(a, parseInt(t.nr) || 0), 0); f.elements.nr.value = max + 1; const last = S.teams[S.teams.length - 1]; f.elements.kanal.value = kanalStd() || presets()[0] || ''; f.elements.auftrag.value = ''; }
  for (let i = 0; i < 3; i++) { f.elements['p' + i].placeholder = S.settings.defP0 + '+'; const locked = T && T.status !== 'bereit'; f.elements['p' + i].disabled = !!locked; f.elements['n' + i].disabled = !!(locked && !T.members[i]); const qb = document.querySelector(`[data-qr="n${i}"]`); if (qb) qb.disabled = f.elements['n' + i].disabled; }
  f.elements.kanal.hidden = true; renderPick('kChips', 'kanal', presets(), 'Anderer …');
  fillSel('aufSel', 'auftrag', auftraege(), f.elements.auftrag.value.trim(), 'Freitext …', '– Auftrag wählen –'); syncZusatz();
  f.elements.stock.hidden = true; renderPick('sChips', 'stock', [...floors()].reverse(), 'Anderer Ort …', 'Bereit');
  $('#dTeam').showModal();
}
$('#fTeam').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const f = e.target, mem = [];
  for (let i = 0; i < 3; i++) { const inp = f.elements['n' + i], byNr = personal().find(p => p.nr && p.nr === inp.value.trim()); if (byNr) inp.value = pName(byNr); }
  for (let i = 0; i < 3; i++) { const n = f.elements['n' + i].value.trim(); if (n) { const v = parseInt(f.elements['p' + i].value), full = isNaN(v) || v >= S.settings.defP0; mem.push({ name: n, p0: full ? S.settings.defP0 : v, full, readings: [], pArr: null }); } }
  if (!mem.length) { e.preventDefault(); $('#tErr').textContent = 'Mindestens einen Namen erfassen.'; return; }
  { const nr = f.elements.nr.value.trim(), act = S.teams.filter(t => t.id !== editId && !t.hidden && t.status !== 'draussen');
    const norm = x => String(x || '').trim().toLowerCase();
    const dupT = act.find(t => norm(t.nr) === norm(nr));
    if (dupT) { e.preventDefault(); $('#tErr').textContent = `Trupp ${nr} ist bereits aktiv (${STL[dupT.status]}). Bitte eine andere Nummer wählen.`; return; }
    const names = mem.map(m => norm(m.name)), dupN = names.find((n, i) => names.indexOf(n) !== i);
    if (dupN) { e.preventDefault(); $('#tErr').textContent = `${mem.find(m => norm(m.name) === dupN).name} ist zweimal im Trupp erfasst.`; return; }
    for (const m of mem) { const t = act.find(t => t.members.some(x => norm(x.name) === norm(m.name)));
      if (t) { e.preventDefault(); $('#tErr').textContent = `${m.name} ist bereits in Trupp ${t.nr} (${STL[t.status]}).`; return; } } }
  const T = editId && team(editId), kanal = f.elements.kanal.value.trim(), auftrag = f.elements.auftrag.value.trim(), zusatz = f.elements.zusatz.hidden ? '' : f.elements.zusatz.value.trim(), stock = f.elements.stock.value.trim(), rett = f.elements.rett.checked;
  if (T) {
    const ch = []; if ((T.kanal || '') !== kanal) ch.push('Funk ' + (kanal || '–')); if ((T.auftrag || '') !== auftrag || (T.zusatz || '') !== zusatz) ch.push('Auftrag: ' + (aufText({ auftrag, zusatz }) || '–')); if ((T.stock || '') !== stock) ch.push('Stockwerk ' + (stock || '–')); if (!!T.rett !== rett) ch.push(rett ? 'als Rettungstrupp markiert' : 'nicht mehr Rettungstrupp'); { const a = (T.equip || []).slice().sort().join(), b = eqSel.slice().sort().join(); if (a !== b) ch.push('Ausrüstung: ' + (eqSel.map(k => EQUIP.find(e => e.k === k).l).join(', ') || 'keine')); }
    T.nr = f.elements.nr.value.trim(); T.kanal = kanal; T.auftrag = auftrag; T.zusatz = zusatz; T.stock = stock; T.rett = rett; T.equip = [...eqSel];
    if (T.status === 'bereit') T.members = mem; else T.members.forEach((m, i) => { const n = f.elements['n' + i].value.trim(); if (n) m.name = n; });
    saveTeam(T); if (ch.length && (T.status !== 'bereit' || !!T.rett !== !!rett || ch.some(c => c.includes('Rettungstrupp')))) log(`Trupp ${T.nr}: ${ch.join(', ')}`);
  } else {
    const N = { id: uid(), nr: f.elements.nr.value.trim(), kanal, auftrag, zusatz, stock, rett, equip: [...eqSel], status: 'bereit', members: mem, tIn: null, tOut: null, hidden: false };
    saveTeam(N); log(`${rett ? 'Rettungstrupp' : 'Trupp'} ${N.nr} erfasst (Funk ${kanal || '–'}${N.equip.length ? ', ' + N.equip.map(k => EQUIP.find(e => e.k === k).s).join('/') : ''}): ${mem.map(m => m.name + ' ' + p0t(m) + ' bar').join(', ')}`);
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
  const bad = vals.find((v, i) => !isNaN(v) && (v < 0 || v > T.members[i].p0 + (T.members[i].full !== false ? 40 : 20)));
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
  for (const k of ['org', 'kanaele', 'kanalStd', 'auftraege', 'interval', 'defP0', 'rzMode', 'rzFixed', 'pfeife', 'defRate']) f.elements[k].value = st[k];
  { const dv = LP.get('dev') || '', opts = ['Atemschutzüberwacher', 'Atemschutzoffizier'];
    f.elements.dev.value = dv; f.elements.devSel.value = !dv ? '' : opts.includes(dv) ? dv : '__other'; f.elements.dev.hidden = f.elements.devSel.value !== '__other'; }
  $('#sAdmin').hidden = true; $('#bAdmin').hidden = false;
  f.elements.ton.value = LP.get('mute') ? 'aus' : 'an'; f.elements.view.value = LP.get('view') === 'gross' ? 'gross' : 'kompakt'; f.elements.bau.value = LP.get('bau') === 'aus' ? 'aus' : 'an';
  $('#bLogout').hidden = SY.mode !== 'cloud' || !SY.user;
  $('#sInfo').textContent = `Version ${VERSION} · ${SY.mode === 'cloud' ? 'Synchronisation über Firebase' + (SY.user ? ' · angemeldet als ' + SY.user.email : '') : 'Nur lokal (keine Firebase-Konfiguration)'}`;
  $('#dS').showModal();
}
$('#fS').addEventListener('submit', e => {
  const f = e.target;
  if (e.submitter && e.submitter.value === 'logout') { confirmBox('Abmelden?', 'Danach braucht dieses Gerät Internet, um sich wieder anzumelden.', () => BE.logout()); return; }
  if (e.submitter && e.submitter.value !== 'ok') return;
  LP.set('dev', f.elements.dev.value.trim());
  if ($('#sAdmin').hidden) { render(); return; }
  const s = { ...S.settings };
  for (const k of ['interval', 'defP0', 'rzFixed', 'pfeife', 'defRate']) { const v = parseFloat(f.elements[k].value); if (v > 0 || (k === 'reserve' && v >= 0)) s[k] = v; }
  s.rzMode = f.elements.rzMode.value; s.org = f.elements.org.value.trim(); s.kanaele = f.elements.kanaele.value.trim(); s.kanalStd = f.elements.kanalStd.value.trim(); s.auftraege = f.elements.auftraege.value.trim();
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
    const name = txt && (persByCode(txt) || qrText(txt));
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
const genFloors = (og, ug) => [...Array(ug)].map((_, i) => 'UG -' + (ug - i)).concat(['EG'], [...Array(og)].map((_, i) => (i + 1) + '. OG'), ['Dach']);
const countOG = fl => fl.filter(f => /^\d+\. ?OG$/i.test(f)).length, countUG = fl => fl.filter(f => /^UG/i.test(f)).length;
const isEG = f => /^(eg|erdgeschoss|parterre)$/i.test(f.replace(/\s+/g, ''));
function badge(T, extra) { return `<button type="button" class="tbg ${T.status}${T.rett ? ' rett' : ''}" id="b-${T.id}" data-st="${esc(T.id)}" title="${T.rett ? 'Rettungstrupp' : 'Trupp'} ${esc(T.nr)}${T.stock ? ' · ' + esc(T.stock) : ''}">${T.rett ? AXE : ''}${esc(T.nr)}${extra ? `<small>${esc(extra)}</small>` : ''}</button>`; }
function renderBau() {
  const el = $('#bau'); if (!el) return;
  const fl = floors(), vis = S.teams.filter(t => !t.hidden), inside = vis.filter(t => t.status === 'innen' || t.status === 'rueckzug');
  const byNr = (a, b) => String(a.nr).localeCompare(String(b.nr), 'de', { numeric: true });
  const egI = fl.findIndex(isEG);
  const og = countOG(fl), ug = countUG(fl), opt = (n, sel, sign) => [...Array(n + 1)].map((_, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i ? sign + i : '0'}</option>`).join('');
  const other = inside.filter(t => t.stock && !fl.includes(t.stock)).sort(byNr), none = inside.filter(t => !t.stock).sort(byNr), ready = vis.filter(t => t.status === 'bereit' && !t.rett).sort(byNr), rready = vis.filter(t => t.status === 'bereit' && t.rett).sort(byNr);
  let h = `<div class="bau-h"><b>Gebäude</b></div><div class="bau-sel"><label>OG<select id="selOG">${opt(20, og, '+')}</select></label><label>UG<select id="selUG">${opt(5, ug, '-')}</select></label></div>`;
  el.classList.toggle('many', fl.length > 10);
  h += '<div class="roof"></div>';
  for (let i = fl.length - 1; i >= 0; i--) {
    const ts = inside.filter(t => t.stock === fl[i]).sort(byNr);
    h += `<div class="fl${egI >= 0 && i < egI ? ' ug' : ''}${i === fl.length - 1 ? ' ftop' : ''}"><div class="fn">${esc(fl[i])}</div><div class="tm">${ts.map(t => badge(t)).join('')}</div></div>`;
    if (i === egI) h += '<div class="ground"></div>';
  }
  if (egI < 0) h += '<div class="ground"></div>';
  if (rready.length) h += `<div class="zone rz">${AXE} Rettungstrupp bereit<div class="tm">${rready.map(t => badge(t)).join('')}</div></div>`;
  if (other.length) h += `<div class="zone">Anderer Ort<div class="tm">${other.map(t => badge(t, t.stock)).join('')}</div></div>`;
  if (none.length) h += `<div class="zone">Ohne Stockwerk<div class="tm">${none.map(t => badge(t)).join('')}</div></div>`;
  if (ready.length) h += `<div class="zone">Bereit<div class="tm">${ready.map(t => badge(t)).join('')}</div></div>`;
  if (!inside.length && !ready.length && !rready.length) h += '<div class="zone">Noch kein Trupp im Gebäude.</div>';
  el.innerHTML = h;
}
$('#bau').addEventListener('change', e => {
  if (e.target.id !== 'selOG' && e.target.id !== 'selUG') return;
  S.meta.floors = genFloors(+$('#selOG').value, +$('#selUG').value).join(', '); saveMeta(); render();
});
$('#bau').addEventListener('click', e => {
  if (e.target.closest('#bFl')) return openFloors();
  const b = e.target.closest('[data-st]'); if (!b) return;
  const T = team(b.dataset.st); if (!T) return;
  const c = document.getElementById('c-' + T.id); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1500); }
  if (T.status === 'bereit') return;
  openStock(T.id, 'move');
});
function renderSChips() {}

function enter(T, stock) {
  const now = Date.now();
  T.status = 'innen'; T.tIn = now; T.stock = stock || ''; T.members.forEach(m => { m.readings = [{ t: now, p: m.p0 }]; m.pArr = null; });
  if (!S.meta.start) { S.meta.start = now; saveMeta(); }
  saveTeam(T);
  log(`Trupp ${T.nr} Eingang (Funk ${T.kanal || '–'}${T.stock ? ', ' + T.stock : ''}${aufText(T) ? ', ' + aufText(T) : ''}): ${T.members.map(m => m.name + ' ' + p0t(m)).join(', ')} bar`);
}
let stCtx = null;
function openStock(id, mode) {
  const T = team(id); if (!T) return; stCtx = { id, mode };
  $('#stTitle').textContent = mode === 'in' ? `Trupp ${T.nr}: Wohin geht der Trupp?` : `Trupp ${T.nr}: Stockwerk wechseln`;
  const fl = floors(), egI = fl.findIndex(isEG);
  const many = fl.length > 10; $('#stPick').classList.toggle('many', many);
  $('#stPick').innerHTML = fl.map((f, i) => `<button type="button" data-f="${esc(f)}" class="${f === T.stock ? 'on' : ''}">${esc(f)}</button>` + (!many && i === egI - 1 ? '<div class="gl"></div>' : '')).reverse().join('');
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


/* ---------- Adminbereich (PIN) ---------- */
async function hashPin(p) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('asue:' + p)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { let h = 0; for (const c of 'asue:' + p) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h; }
}
let pinMode = null;
function openPin(mode) {
  pinMode = mode; const f = $('#fPin'); f.reset(); $('#pinErr').textContent = '';
  $('#pinTitle').textContent = mode === 'set' ? (S.settings.adminPin ? 'Admin-PIN ändern' : 'Admin-PIN festlegen') : 'Adminbereich';
  $('#pinHint').textContent = mode === 'set' ? 'Mindestens 4 Ziffern. Die PIN gilt für alle Geräte – gut aufbewahren.' : 'PIN eingeben, um Grunddaten zu ändern und Einsätze zu löschen.';
  $('#pinL2').hidden = mode !== 'set';
  $('#dPin').showModal(); setTimeout(() => f.elements.p1.focus(), 50);
}
function unlockAdmin() { $('#sAdmin').hidden = false; $('#bAdmin').hidden = true; renderAdList(); renderPers(); }
/* ---------- Personalstamm ---------- */
let pEdit = null;
function renderPers() {
  const ul = $('#pList'); if (!ul || $('#sAdmin').hidden) return;
  const l = personal(); $('#pCount').textContent = `(${l.length})`;
  $('#pHint').textContent = l.some(p => p.muster) ? 'Musterdaten – bitte durch eure Leute ersetzen. Die Liste gilt für alle Geräte.' : 'Gilt für alle Geräte. Beim Trupp erfassen werden die Namen vorgeschlagen; der QR-Code kann Name oder Nummer enthalten.';
  ul.innerHTML = l.length ? l.map(p => `<li><span class="pn"><span class="pr">${esc(p.rang || '')}</span>${esc(p.name)} ${esc(p.vorname)}<span class="pnr">${p.nr ? 'Nr. ' + esc(p.nr) : ''}</span></span><button type="button" class="ghost" data-pe="${esc(p.id)}">Bearbeiten</button><button type="button" class="ghost" data-pd="${esc(p.id)}">Löschen</button></li>`).join('') : '<li><span>Noch keine Personen erfasst.</span></li>';
  $('#pfAdd').textContent = pEdit ? 'Speichern' : 'Hinzufügen';
}
function savePers(list) { BE.putSettings({ ...S.settings, personal: list }); }
$('#pfAdd').onclick = () => {
  const v = $('#pfV').value.trim(), n = $('#pfN').value.trim(), r = $('#pfR').value.trim(), nr = $('#pfNr').value.trim();
  if (!v || !n) { $('#pHint').textContent = 'Vorname und Name sind nötig.'; return; }
  const l = personal().map(p => ({ ...p }));
  if (nr && l.some(p => p.nr === nr && p.id !== pEdit)) { $('#pHint').textContent = `Die Nummer ${nr} ist schon vergeben.`; return; }
  if (pEdit) { const p = l.find(x => x.id === pEdit); Object.assign(p, { vorname: v, name: n, rang: r, nr, muster: false }); }
  else l.push({ id: uid(), vorname: v, name: n, rang: r, nr });
  l.sort((a, b) => (a.name + a.vorname).localeCompare(b.name + b.vorname, 'de'));
  pEdit = null; ['#pfV', '#pfN', '#pfR', '#pfNr'].forEach(x => $(x).value = ''); savePers(l); setTimeout(renderPers, 50);
};
$('#pList').addEventListener('click', e => {
  const ed = e.target.closest('[data-pe]'), dl = e.target.closest('[data-pd]');
  if (ed) { const p = personal().find(x => x.id === ed.dataset.pe); if (!p) return; pEdit = p.id; $('#pfV').value = p.vorname; $('#pfN').value = p.name; $('#pfR').value = p.rang || ''; $('#pfNr').value = p.nr || ''; $('#pfV').focus(); renderPers(); }
  if (dl) { const p = personal().find(x => x.id === dl.dataset.pd); if (!p) return; confirmBox('Person löschen?', `${p.rang || ''} ${p.name} ${p.vorname} wird aus dem Personalstamm entfernt.`, () => { savePers(personal().filter(x => x.id !== p.id)); setTimeout(renderPers, 50); }); }
});
function renderAdList() {
  const ul = $('#adList'); if (!ul || $('#sAdmin').hidden) return;
  const l = S.list.filter(e => e.id !== S.eid);
  ul.innerHTML = l.length ? l.map(e => `<li><div><b>${esc(e.ereignis || 'Ohne Bezeichnung')}</b><span>${dt(e.start || e.created)}${e.ort ? ' · ' + esc(e.ort) : ''}${e.closed ? ' · abgeschlossen' : ''}</span></div><button type="button" class="ghost" data-del="${esc(e.id)}">Löschen</button></li>`).join('')
    : '<li><span>Keine weiteren Einsätze. Der geöffnete Einsatz kann nicht gelöscht werden.</span></li>';
}
const ADMIN_PIN = false; /* auf true setzen, um den Adminbereich mit PIN zu schützen */
$('#fS').elements.devSel.addEventListener('change', e => { const f = $('#fS'), v = e.target.value;
  if (v === '__other') { f.elements.dev.hidden = false; f.elements.dev.value = ''; f.elements.dev.focus(); } else { f.elements.dev.hidden = true; f.elements.dev.value = v; } });
$('#bAdmin').onclick = () => ADMIN_PIN ? openPin(S.settings.adminPin ? 'unlock' : 'set') : unlockAdmin();
$('#bPinChg').hidden = !ADMIN_PIN;
$('#bPinChg').onclick = () => openPin('set');
$('#pinCancel').onclick = () => $('#dPin').close();
$('#fPin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, p1 = f.elements.p1.value.trim();
  if (pinMode === 'set') {
    if (!/^\d{4,}$/.test(p1)) { $('#pinErr').textContent = 'Bitte mindestens 4 Ziffern.'; return; }
    if (p1 !== f.elements.p2.value.trim()) { $('#pinErr').textContent = 'Die beiden PIN stimmen nicht überein.'; return; }
    BE.putSettings({ ...S.settings, adminPin: await hashPin(p1) }); $('#dPin').close(); unlockAdmin(); return;
  }
  if (await hashPin(p1) === S.settings.adminPin) { $('#dPin').close(); unlockAdmin(); }
  else { $('#pinErr').textContent = 'PIN falsch.'; f.elements.p1.value = ''; }
});


/* ---------- Namensvorschläge aus dem Personalstamm ---------- */
function persMatches(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const words = q.split(/\s+/);
  return personal().map(p => {
    const nr = String(p.nr || '').toLowerCase(), hay = `${p.vorname} ${p.name} ${p.vorname}`.toLowerCase();
    let score = -1;
    if (nr && nr === q) score = 100; else if (nr && nr.startsWith(q)) score = 80;
    else if (words.every(w => hay.split(' ').some(x => x.startsWith(w)))) score = 60;
    else if (words.every(w => hay.includes(w))) score = 40;
    return { p, score };
  }).filter(x => x.score >= 0).sort((a, b) => b.score - a.score || (b.score === 80 ? String(a.p.nr).localeCompare(String(b.p.nr), 'de', { numeric: true }) : pName(a.p).localeCompare(pName(b.p), 'de'))).slice(0, 6).map(x => x.p);
}
function showSugg(inp) {
  const box = inp.parentElement.querySelector('.sugg'); if (!box) return;
  const m = persMatches(inp.value);
  if (!m.length || m.some(p => pName(p) === inp.value.trim()) && m.length === 1) { box.hidden = true; return; }
  const busy = p => { const t = S.teams.find(t => t.id !== editId && !t.hidden && t.status !== 'draussen' && t.members.some(x => x.name.trim().toLowerCase() === pName(p).toLowerCase())); return t ? t.nr : null; };
  box.innerHTML = m.map((p, i) => { const b = busy(p); return `<button type="button" class="${i ? '' : 'first'}${b ? ' busy' : ''}" data-pn="${esc(pName(p))}"><span class="sr">${esc(p.rang || '')}</span>${esc(p.name)} ${esc(p.vorname)}${b ? `<small class="sb">in Trupp ${esc(b)}</small>` : ''}<span class="snr">${p.nr ? 'Nr. ' + esc(p.nr) : ''}</span></button>`; }).join('');
  box.hidden = false;
}
function pickSugg(inp, name) {
  inp.value = name; const box = inp.parentElement.querySelector('.sugg'); if (box) box.hidden = true;
  const idx = +inp.name.slice(1), nxt = $('#fTeam').elements['n' + (idx + 1)];
  if (nxt && !nxt.value) nxt.focus(); else inp.blur();
}
for (let i = 0; i < 3; i++) {
  const inp = $('#fTeam').elements['n' + i], box = inp.parentElement.querySelector('.sugg');
  inp.addEventListener('input', () => showSugg(inp));
  inp.addEventListener('focus', () => showSugg(inp));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !box.hidden) { const b = box.querySelector('button'); if (b) { e.preventDefault(); pickSugg(inp, b.dataset.pn); } } if (e.key === 'Escape') box.hidden = true; });
  inp.addEventListener('blur', () => setTimeout(() => {
    box.hidden = true;
    const v = inp.value.trim(), byNr = personal().find(p => p.nr && p.nr === v); if (byNr) inp.value = pName(byNr);
  }, 180));
  box.addEventListener('pointerdown', e => { const b = e.target.closest('[data-pn]'); if (b) { e.preventDefault(); pickSugg(inp, b.dataset.pn); } });
  box.addEventListener('click', e => { const b = e.target.closest('[data-pn]'); if (b) pickSugg(inp, b.dataset.pn); });
}

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
/* Teilen: nur noch Lage per QR-Code (Gebäude mit Trupps und ihren Standorten, ohne Namen) */
const shareUrl = k => new URL('lage.html?k=' + encodeURIComponent(k), location.href).href;
const qrSvg = (t, c) => { const q = window.qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag(c || 7, 2); };
$('#bExp').onclick = () => {
  if (!S.eid) return msg2('Zuerst einen Einsatz öffnen.');
  if (!BE.putPublic) return msg2('Teilen per QR-Code geht nur mit Synchronisation.');
  if (!S.meta.shareK) { S.meta.shareK = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 20); saveMeta(); log('Lage per QR-Code geteilt'); }
  lastPub = ''; publishLage();
  const u = shareUrl(S.meta.shareK);
  $('#shQR').innerHTML = window.qrcode ? qrSvg(u) : '<p class="err">QR-Modul nicht geladen.</p>';
  $('#shUrl').textContent = u; $('#dShare').showModal();
};
const msg2 = t => { const m = $('#banner'); m.textContent = t; m.hidden = false; setTimeout(() => m.hidden = true, 4000); };
$('#shX').onclick = () => $('#dShare').close();
$('#shCopy').onclick = async () => { try { await navigator.clipboard.writeText(shareUrl(S.meta.shareK)); $('#shCopy').textContent = 'Kopiert ✓'; setTimeout(() => $('#shCopy').textContent = 'Link kopieren', 2000); } catch (e) {} };
$('#shStop').onclick = () => { const k = S.meta.shareK; if (!k) return $('#dShare').close(); BE.delPublic(k); delete S.meta.shareK; saveMeta(); log('Teilen der Lage beendet'); $('#dShare').close(); };
/* öffentliche Lage nachführen, solange geteilt wird */
let lastPub = '', pubT = null;
function publishLage() {
  const k = S.meta.shareK; if (!k || !BE.putPublic || !S.eid) return;
  const d = { title: S.meta.ereignis || '', ort: S.meta.ort || '', floors: floors(), closed: !!S.meta.closed,
    teams: S.teams.filter(t => !t.hidden && t.status !== 'draussen').map(t => ({ nr: String(t.nr || ''), stock: t.stock || '', status: t.status, rett: !!t.rett, tIn: t.tIn || null })) };
  const js = JSON.stringify(d); if (js === lastPub) return; lastPub = js;
  clearTimeout(pubT); pubT = setTimeout(() => BE.putPublic(k, { ...d, upd: Date.now() }), 400);
}
$('#bXClose').onclick = () => $('#dX').close();
for (const k of ['view', 'bau']) $('#fS').elements[k].addEventListener('change', e => { LP.set(k, e.target.value); render(); });
$('#bSet').onclick = openSettings;
/* Logo: im Tableau → Dashboard, im Dashboard → Startseite */
$('#bHome').onclick = () => {
  if (!isDash()) return showDash();
  const inside = S.teams.filter(t => t.status === 'innen' || t.status === 'rueckzug').length;
  if (!inside) { location.href = '../start/'; return; }
  confirmBox('Zur Startseite wechseln?', `Achtung: ${inside} Trupp(s) sind noch drin. Die Daten bleiben gespeichert, aber solange die Atemschutzüberwachung nicht offen ist, gibt es keine Alarme für Druckkontrolle und Rückzug.`, () => { location.href = '../start/'; });
};
$('#muteInd').onclick = () => confirmBox('Ton wieder einschalten?', 'Alarme für Druckkontrolle und Rückzug sind dann wieder hörbar.', () => { LP.set('mute', false); render(); initAudio(); beep(1); });
$('#fS').elements.ton.addEventListener('change', e => {
  if (e.target.value === 'an') { LP.set('mute', false); render(); initAudio(); beep(1); return; }
  e.target.value = 'an';
  confirmBox('Ton wirklich ausschalten?', 'Alarme für fällige Druckkontrollen und den Rückzug sind dann NICHT mehr hörbar – nur noch sichtbar. Oben erscheint der Hinweis «Ton aus».', () => { LP.set('mute', true); $('#fS').elements.ton.value = 'aus'; render(); });
});
let metaT = null;
$('#meta').addEventListener('input', e => { const i = e.target.closest('[data-m]'); if (!i) return; i.classList.remove('miss'); S.meta[i.dataset.m] = i.value; clearTimeout(metaT); metaT = setTimeout(saveMeta, 700); });

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
  const meta = [['Ereignis', S.meta.ereignis], ['Einsatzort', S.meta.ort], ['Atemschutzüberwacher', S.meta.asue], ...(S.meta.aso ? [['Atemschutzoffizier', S.meta.aso]] : []), ['Einsatzleiter', S.meta.el], ['Erster Eingang', dt(S.meta.start)], ['Letzter Trupp draussen', tEnd ? dt(tEnd) : '-']];
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
    const auf = wrap(R, (T.rett && !/rettungstrupp/i.test(T.auftrag || '') ? 'Rettungstrupp' + (T.auftrag ? ' - ' : '') : '') + (aufText(T) || (T.rett ? '' : '-')) + (eqIcons(T).length ? ' [' + eqIcons(T).map(e => e.s).join(', ') + ']' : ''), cols[2][1] - 8, 9, 0);
    const rh = 13, h = Math.max(T.members.length, auf.length) * rh + 6;
    if (need(h)) head();
    const v = [clean(T.nr), clean(T.kanal || '-'), 0, wrap(R, T.stock || '-', cols[3][1] - 8, 9, 0)[0], 0, 0, 0, hm(T.tIn), T.tOut ? hm(T.tOut) : 'drin', T.tOut ? dur(T.tOut - T.tIn) : '-'];
    let x = M;
    cols.forEach((c, ci) => {
      if (ci === 2) auf.forEach((l, li) => R.t(x + 4, y + 4 + li * rh, l, 9, 0, INK));
      else if (ci === 4) T.members.forEach((m, mi) => R.t(x + 4, y + 4 + mi * rh, clean(m.name), 9, 0, INK));
      else if (ci === 5 || ci === 6) T.members.forEach((m, mi) => { const s = String(ci === 5 ? p0t(m) : (m.readings.length > 1 ? last[mi] : p0t(m))); R.t(x + c[1] - 4 - R.w(s, 9, ci === 6), y + 4 + mi * rh, s, 9, ci === 6, INK); });
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
  { const req = [['ereignis', 'Ereignis'], ['ort', 'Einsatzort'], ['asue', 'Atemschutzüberwacher'], ['el', 'Einsatzleiter']];
    const miss = req.filter(([k]) => !String(S.meta[k] || '').trim());
    document.querySelectorAll('#meta [data-m]').forEach(i => i.classList.toggle('miss', miss.some(([k]) => k === i.dataset.m)));
    if (miss.length) { const first = document.querySelector(`#meta [data-m="${miss[0][0]}"]`); if (first) first.focus();
      const m = $('#msg'); m.style.color = ''; m.textContent = 'Bitte ausfüllen: ' + miss.map(x => x[1]).join(', '); return; } }
  try {
    let blob;
    if (kind === 'pdf') { if (!window.jspdf) return msg('PDF-Modul nicht geladen. App einmal mit Internet öffnen, dann klappt es auch offline.'); blob = makePdf(); }
    else blob = await makePng();
    const r = await deliver(blob, fname(kind));
    if (r !== 'abgebrochen') { msg((kind === 'pdf' ? 'PDF ' : 'Foto ') + r + '.', true); log('Protokoll als ' + (kind === 'pdf' ? 'PDF' : 'Foto') + ' exportiert'); }
  } catch (e) { msg('Export fehlgeschlagen: ' + (e && e.message || e)); }
}
$('#bPdf').onclick = () => exportAs('pdf');



/* ================= Dashboard ================= */
const isDash = () => document.body.classList.contains('dashmode');
function showDash() { document.body.classList.add('dashmode'); renderDash(); scrollTo(0, 0); }
function showBoard() { document.body.classList.remove('dashmode'); scrollTo(0, 0); render(); }
function renderDash() {
  const FW = fwRead(), fwKey = FW && 'fw-' + FW.t;
  const run = S.list.filter(e => !e.closed).sort((a, b) => (b.fw === fwKey) - (a.fw === fwKey) || (b.start || b.created) - (a.start || a.created));
  const done = S.list.filter(e => e.closed);
  const inside = S.teams.filter(t => t.status === 'innen' || t.status === 'rueckzug').length;
  $('#dRun').innerHTML = run.length ? run.map(e => `<div class="rc${fwKey && e.fw === fwKey ? ' fwe' : ''}" data-open="${esc(e.id)}">
      <small>Laufender Einsatz${fwKey && e.fw === fwKey ? ' · aktiver Einsatz' : ''}</small><b>${esc(e.ereignis || 'Ohne Bezeichnung')}</b>
      <div class="info">${[e.ort && esc(e.ort), e.el && 'EL ' + esc(e.el), 'seit ' + dt(e.start || e.created), e.id === S.eid ? (inside ? inside + ' Trupp(s) drin' : 'kein Trupp drin') : ''].filter(Boolean).join(' · ')}</div>
      <div class="bb"><button data-open="${esc(e.id)}">Zum Einsatztableau →</button><button class="sec" data-pdf="${esc(e.id)}">Einsatzdaten &amp; PDF</button><button class="sec" data-close="${esc(e.id)}">Abschliessen</button></div></div>`).join('')
    : '<div class="rcempty">Kein laufender Einsatz. Links einen neuen Einsatz eröffnen oder auf der Startseite einen Einsatz generieren.</div>';
  $('#dBackup').hidden = !(BE && BE.exportAll); $('#dImport').hidden = !(BE && BE.importAll);
  $('#dList').innerHTML = done.length ? done.map(e => `<li><div><b>${esc(e.ereignis || 'Ohne Bezeichnung')}</b><span>${dt(e.start || e.created)}${e.ort ? ' · ' + esc(e.ort) : ''}</span></div>
    <span class="tag">Abgeschlossen</span><button data-pdf="${esc(e.id)}">PDF</button><button data-open="${esc(e.id)}">Öffnen</button></li>`).join('') : '<li><span>Noch keine abgeschlossenen Einsätze.</span></li>';
}
$('#dRun').addEventListener('click', e => dashClick(e));
$('#dList').addEventListener('click', e => dashClick(e));
function dashClick(e) {
  const pd = e.target.closest('[data-pdf]');
  if (pd) { e.stopPropagation(); if (pd.dataset.pdf !== S.eid) openE(pd.dataset.pdf); $('#msg').textContent = ''; setTimeout(() => $('#dX').showModal(), 150); return; }
  const c = e.target.closest('[data-close]');
  if (c) {
    if (c.dataset.close === S.eid) return $('#bClose').click();
    const ein = S.list.find(x => x.id === c.dataset.close); if (!ein) return;
    const { id, ...meta } = ein;
    confirmBox('Einsatz abschliessen?', `«${ein.ereignis || 'Ohne Bezeichnung'}» vom ${dt(ein.start || ein.created)} wird archiviert. Du kannst ihn jederzeit wieder öffnen und das Protokoll exportieren.`, () => {
      BE.putMeta(id, { ...newMeta(), ...meta, closed: true, end: meta.end || Date.now() });
      BE.addLog(id, uid(), { t: Date.now(), text: 'Einsatz abgeschlossen', dev: LP.get('dev') || '' });
    });
    return;
  }
  const b = e.target.closest('[data-open]'); if (!b) return; if (b.dataset.open !== S.eid) openE(b.dataset.open); showBoard(); }
/* Neuer Einsatz: gemeinsames Fenster wie auf der Startseite (Bezeichnung, Adresse, Einsatzleiter) */
$('#dNew').onclick = async () => {
  const r = await window.FWForm.open({ app: 'ASÜ' }); if (!r) return;
  const hit = r.fw && S.list.find(e => e.fw === r.fw && !e.closed);
  if (hit) { openE(hit.id); showBoard(); return; }
  const meta = { ...newMeta(), ereignis: r.bez, ort: r.adr, el: r.el, ...(r.fw ? { fw: r.fw } : {}) };
  const go = () => { openE(BE.create(meta)); log('Einsatz eröffnet: ' + meta.ereignis); showBoard(); };
  if (S.teams.some(t => t.status === 'innen' || t.status === 'rueckzug')) confirmBox('Neuen Einsatz starten?', 'Im geöffneten Einsatz sind noch Trupps drin. Der Einsatz bleibt gespeichert und ist im Dashboard weiter erreichbar.', go);
  else go();
};
$('#dBackup').onclick = async () => { $('#eMsg').textContent = ''; await $('#bBackup').onclick(); $('#dMsg').textContent = $('#eMsg').textContent; };
$('#dImport').onclick = () => $('#fImport').click();
$('#fImport').addEventListener('change', () => setTimeout(() => { $('#dMsg').textContent = $('#eMsg').textContent; }, 300));

/* ================= Einsatz von der Startseite ================= */
function fwRead() { try { const e = JSON.parse(localStorage.getItem('fw-einsatz')); return e && e.bez ? e : null; } catch (e) { return null; } }
let fwSynced = false;
function renderFw() {
  const el = $('#fwbar'), FW = fwRead(), on = FW && S.meta.fw === 'fw-' + FW.t;
  el.hidden = !on; if (!on) return;
  el.innerHTML = `<b>${esc(FW.bez)}</b> · ${esc(FW.adr)} · EL ${esc(FW.el)}`;
  // Änderungen auf der Startseite übernehmen (einmal pro Start)
  if (!fwSynced && S.meta.created) { fwSynced = true;
    if (S.meta.ereignis !== FW.bez || S.meta.ort !== FW.adr || S.meta.el !== FW.el) { S.meta.ereignis = FW.bez; S.meta.ort = FW.adr; S.meta.el = FW.el; saveMeta(); } }
}

/* ================= Start ================= */
let started = false;
function start() {
  if (started) return; started = true;
  BE.watchSettings(s => { S.settings = { ...DEF, ...s }; render(); });
  const FW = fwRead(), key = FW && 'fw-' + FW.t;
  let linked = !FW;
  if (FW) showBoard(); else showDash();
  // Einsatz von der Startseite: passenden ASÜ-Einsatz öffnen oder einmalig anlegen
  const link = (l, final) => {
    if (linked) return;
    const hit = l.find(e => e.fw === key);
    if (hit) { linked = true; if (S.eid !== hit.id) openE(hit.id); return; }
    if (final) { linked = true; openE(BE.create({ ...newMeta(), ereignis: FW.bez, ort: FW.adr, el: FW.el, fw: key })); log('Einsatz von der Startseite übernommen'); }
  };
  BE.watchList(l => {
    S.list = l; renderList();
    if (FW) { link(l, SY.mode === 'local'); return; }
    if (!S.eid) { const want = LP.get('eid'); const hit = l.find(e => e.id === want && !e.closed) || l.find(e => !e.closed); if (hit) openE(hit.id); }

  });
  if (FW) setTimeout(() => link(S.list || [], true), 2500);
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
