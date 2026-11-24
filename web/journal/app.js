/* Einsatzjournal – Feuerwehr RTL
   Offline-fähige Web-App. Mehrere Personen/Geräte arbeiten über Firebase am selben Journal
   (gleiches Projekt und gleiche Konten wie ASÜ und Mehrfachereignisse). */
(function () {
'use strict';
const VERSION = '1.1.0';
const CFG = window.JR_CONFIG || {};
const FB_VERSION = '10.12.2';

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hms = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const ICO_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const ICO_KEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>';
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 3500); }

/* Geräte-Einstellungen (nur dieses Gerät): Name, offenes Journal, Geräte-ID */
const LP = (() => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('journal-prefs')) || {}; } catch (e) {}
  if (!o.dev) o.dev = uid();
  const persist = () => { try { localStorage.setItem('journal-prefs', JSON.stringify(o)); } catch (e) {} };
  persist();
  return { get: k => o[k], set: (k, v) => { o[k] = v; persist(); } };
})();

/* ---------- Zustand ---------- */
const S = { list: [], jid: null, meta: null, entries: [], view: null, missing: false };
const SY = { mode: 'local', pending: false, error: '', user: null };
let BE = null;

/* ================= Speicher: nur lokal ================= */
function LocalBackend() {
  const KEY = 'journal-db-v2';
  let db = null; try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!db || !db.journale) db = { journale: {} };
  let cur = null, curCb = null, listCb = null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { msg('Speicher auf diesem Gerät ist voll.'); } };
  const emitList = () => listCb && listCb(Object.entries(db.journale).map(([id, j]) => ({ id, ...clone(j.meta), n: Object.keys(j.eintraege).length })));
  const emitCur = () => { if (!curCb) return; const j = db.journale[cur];
    curCb(j ? { meta: clone(j.meta), entries: clone(Object.values(j.eintraege)), missing: false } : { meta: null, entries: [], missing: true }); };
  const ch = () => { persist(); emitCur(); emitList(); };
  return {
    mode: 'local',
    watchList(cb) { listCb = cb; emitList(); },
    open(id, cb) { cur = id; curCb = cb; emitCur(); },
    close() { cur = null; curCb = null; },
    create(id, meta) { db.journale[id] = { meta: clone(meta), eintraege: {} }; ch(); },
    putMeta(id, patch) { const j = db.journale[id]; if (!j) return; j.meta = { ...j.meta, ...clone(patch) }; ch(); },
    putEntry(id, e) { const j = db.journale[id]; if (!j) return; j.eintraege[e.id] = clone(e); ch(); },
    delEntry(id, eid) { const j = db.journale[id]; if (!j) return; delete j.eintraege[eid]; ch(); },
    delJournal(id) { delete db.journale[id]; ch(); }
  };
}

/* ================= Speicher: Firebase (offline + Sync) ================= */
async function CloudBackend(fbConfig) {
  const B = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, Au, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
  const app = appM.initializeApp(fbConfig, 'journal');
  const auth = Au.getAuth(app);
  await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
  const J = F.collection(fs, 'journale');
  const fail = e => { SY.error = (e && e.code === 'permission-denied') ? 'Kein Zugriff – Firestore-Regeln prüfen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); renderSync(); };
  const w = p => p.catch(fail);
  let subs = [];
  return {
    mode: 'cloud',
    onUser: cb => Au.onAuthStateChanged(auth, cb),
    login: (e, p) => Au.signInWithEmailAndPassword(auth, e, p),
    logout: () => Au.signOut(auth),
    watchList(cb) { F.onSnapshot(F.query(J, F.orderBy('start', 'desc'), F.limit(60)), q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), fail); },
    open(id, cb) {
      subs.forEach(u => u()); subs = [];
      const st = { meta: null, entries: [], missing: false }, p = {};
      const emit = () => { SY.pending = Object.values(p).some(Boolean); SY.error = ''; cb(st); renderSync(); };
      const o = { includeMetadataChanges: true };
      subs.push(F.onSnapshot(F.doc(J, id), o, d => { st.meta = d.exists() ? d.data() : null; st.missing = !d.exists() && !d.metadata.fromCache; p.m = d.metadata.hasPendingWrites; emit(); }, fail));
      subs.push(F.onSnapshot(F.collection(J, id, 'eintraege'), o, q => { st.entries = q.docs.map(d => d.data()); p.e = q.metadata.hasPendingWrites; emit(); }, fail));
    },
    close() { subs.forEach(u => u()); subs = []; },
    create(id, meta) { w(F.setDoc(F.doc(J, id), clone(meta))); },
    putMeta(id, patch) { w(F.setDoc(F.doc(J, id), clone(patch), { merge: true })); },
    putEntry(id, e) { w(F.setDoc(F.doc(J, id, 'eintraege', e.id), clone(e))); },
    delEntry(id, eid) { w(F.deleteDoc(F.doc(J, id, 'eintraege', eid))); },
    async delJournal(id) { const q = await F.getDocs(F.collection(J, id, 'eintraege')); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); await F.deleteDoc(F.doc(J, id)); }
  };
}

/* Daten aus der ersten Testversion (nur dieses Gerät) einmalig übernehmen */
function migrateV1() {
  let old = null; try { old = JSON.parse(localStorage.getItem('fwrtl-journal-v1')); } catch (e) {}
  if (!old || !Array.isArray(old.journals) || !old.journals.length) return;
  for (const j of old.journals) {
    BE.create(j.id, { title: j.title, ort: j.ort || '', el: j.el || '', fu: j.who || '', start: j.start, end: j.end || null, closed: !!j.closed, createdBy: j.who || '' });
    for (const e of j.entries) BE.putEntry(j.id, { id: e.id, t: e.t, text: e.text, src: e.src, who: j.who || '', dev: LP.get('dev'), created: e.t });
  }
  if (old.who && !LP.get('name')) LP.set('name', old.who);
  try { localStorage.setItem('fwrtl-journal-v1-uebernommen', JSON.stringify(old)); localStorage.removeItem('fwrtl-journal-v1'); } catch (e) {}
}

/* ---------- Sync-Anzeige ---------- */
function renderSync() {
  const el = $('#sync'); let cls = '', t = '';
  if (SY.mode === 'local') { cls = 'warn'; t = 'Nur dieses Gerät'; }
  else if (SY.error) { cls = 'err'; t = SY.error; }
  else if (!navigator.onLine) { cls = 'warn'; t = SY.pending ? 'Offline – wird später gesendet' : 'Offline'; }
  else if (SY.pending) { cls = 'warn'; t = 'Wird gesendet …'; }
  else { cls = 'ok'; t = 'Synchronisiert'; }
  el.className = 'sync ' + cls; el.textContent = t; el.title = t;
}
addEventListener('online', renderSync); addEventListener('offline', renderSync);

/* ---------- Uhr ---------- */
let draftT = null, timeManual = false;
function tick() {
  $('#clock').textContent = hm(Date.now());
  if (!draftT) $('#tBadge').textContent = hms(Date.now());
}
function setDraftTime(t) {
  draftT = t;
  $('#tBadge').textContent = hms(t || Date.now());
  $('#tBadge').classList.toggle('live', !t);
  $('#tNote').textContent = t ? (timeManual ? 'Zeit manuell gesetzt' : 'Zeit festgehalten') : 'Zeit wird beim ersten Wort festgehalten';
}
function resetDraft() {
  $('#txt').value = ''; $('#interim').textContent = ''; timeManual = false; usedVoice = false;
  $('#tEdit').hidden = true; $('#tBadge').hidden = false;
  setDraftTime(null); tick();
}

/* ---------- Ansichten ---------- */
const VIEWS = ['vName', 'vNew', 'vList', 'vJ', 'vEdit'];
function show(v) { S.view = v; VIEWS.forEach(id => $('#' + id).hidden = id !== v); scrollTo(0, 0); }
const myName = () => LP.get('name') || '';

function openJ(id) {
  if (S.jid !== id) resetDraft();
  S.jid = id; LP.set('cur', id);
  BE.open(id, st => {
    S.meta = st.meta; S.entries = st.entries; S.missing = st.missing;
    if (S.jid !== id) return;
    if (!S.meta && S.missing) { S.jid = null; LP.set('cur', null); renderList(); show('vList'); return msg('Dieses Journal gibt es nicht mehr.'); }
    if (S.view === 'vJ' || S.view === null) renderJ();
  });
  renderJ();
}
function leaveJ() { stopRec(); if (BE && BE.close) BE.close(); S.jid = null; S.meta = null; S.entries = []; LP.set('cur', null); }

function renderJ() {
  const j = S.meta;
  if (!j) { $('#hTitle').textContent = 'Wird geladen …'; show('vJ'); return; }
  $('#hTitle').textContent = j.title + (j.closed ? ' (abgeschlossen)' : '');
  $('#jfName').textContent = j.fu || '–';
  $('#meta').innerHTML = [
    ['Eröffnet', `${dmy(j.start)} ${hm(j.start)}`], ['Abgeschlossen', j.end && j.closed ? `${dmy(j.end)} ${hm(j.end)}` : ''],
    ['Ort', j.ort], ['Einsatzleiter', j.el]
  ].filter(x => x[1]).map(([k, v]) => `<span>${k}: <b>${esc(v)}</b></span>`).join('');
  $('#cWho').textContent = myName() || '–';
  $('#comp').hidden = !!j.closed;
  $('#bClose').textContent = j.closed ? 'Wieder öffnen' : 'Journal abschliessen';
  renderEntries();
  show('vJ');
}
function renderEntries() {
  const es = [...S.entries].sort((a, b) => b.t - a.t), me = myName();
  $('#cnt').textContent = es.length ? `(${es.length})` : '';
  $('#list').innerHTML = es.length ? es.map(e => `
    <li class="e${e.who && e.who === me ? ' mine' : ''}" data-id="${esc(e.id)}">
      <div class="t">${hm(e.t)}<small>${pad(new Date(e.t).getSeconds())} s</small></div>
      <div class="x">${esc(e.text)}</div>
      <div class="act">
        <span class="src">${e.src === 'voice' ? ICO_MIC : ICO_KEY}<span class="by">${esc(e.who || 'unbekannt')}</span>${e.edited ? ` · bearbeitet${e.editedBy && e.editedBy !== e.who ? ' von ' + esc(e.editedBy) : ''}` : ''}</span>
        ${S.meta && S.meta.closed ? '' : '<button class="ghost" data-a="edit">Bearbeiten</button><button class="ghost" data-a="del">Löschen</button>'}
      </div>
    </li>`).join('') : '<li class="empty">Noch keine Einträge. Schreib oder sprich den ersten Eintrag.</li>';
}
function renderList() {
  const js = [...S.list].sort((a, b) => b.start - a.start);
  $('#jList').innerHTML = js.length ? js.map(j => `
    <div class="jl" data-id="${esc(j.id)}">
      <div><b>${esc(j.title)}</b>${j.closed ? '<span class="tag c">abgeschlossen</span>' : '<span class="tag">offen</span>'}
        <small>${dmy(j.start)} ${hm(j.start)}${j.fu ? ' · Journalführer: ' + esc(j.fu) : ''}${j.ort ? ' · ' + esc(j.ort) : ''}</small></div>
      <button data-a="open">${j.closed ? 'Ansehen' : 'Öffnen'}</button>
      <button class="ghost" data-a="del">Löschen</button>
    </div>`).join('') : '<div class="empty">Noch keine Journale.</div>';
  $('#bBack').hidden = !S.jid;
  $('#lName').textContent = myName() || '–';
  $('#lUser').textContent = SY.user && SY.user.email ? ` · angemeldet als ${SY.user.email}` : (SY.mode === 'local' ? ' · nur lokal gespeichert' : '');
  $('#bLogout').hidden = SY.mode !== 'cloud';
}
function goHome() {
  if (!myName()) { $('#myName').value = ''; show('vName'); return; }
  const cur = LP.get('cur');
  if (cur) return openJ(cur);
  const open = S.list.filter(j => !j.closed);
  if (open.length === 1) return openJ(open[0].id);
  if (!S.list.length) { prepNew(); return; }
  renderList(); show('vList');
}
function prepNew() { $('#nFu').value = myName(); show('vNew'); $('#nTitle').focus(); }

/* ---------- Name dieses Geräts ---------- */
let afterName = null;
$('#bName').onclick = () => {
  const n = $('#myName').value.trim(); if (!n) { $('#myName').focus(); return msg('Bitte deinen Namen eintragen.'); }
  LP.set('name', n); const f = afterName; afterName = null;
  if (f) f(); else goHome();
};
$('#myName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#bName').click(); });
const askName = back => { afterName = back; $('#myName').value = myName(); show('vName'); $('#myName').focus(); };
$('#bChName').onclick = () => askName(() => { renderList(); show('vList'); });
$('#aChName').onclick = e => { e.preventDefault(); askName(() => renderJ()); };

/* ---------- Journale ---------- */
$('#bOpen').onclick = () => {
  const title = $('#nTitle').value.trim(), fu = $('#nFu').value.trim();
  if (!title) { $('#nTitle').focus(); return msg('Bitte ein Ereignis eintragen.'); }
  if (!fu) { $('#nFu').focus(); return msg('Bitte den Journalführer eintragen.'); }
  const id = uid();
  BE.create(id, { title, ort: $('#nOrt').value.trim(), el: $('#nEl').value.trim(), fu, start: Date.now(), end: null, closed: false, createdBy: myName() });
  ['#nTitle', '#nOrt', '#nEl'].forEach(s => $(s).value = '');
  S.view = null; openJ(id); setTimeout(() => $('#txt').focus(), 50);
};
$('#bNew').onclick = prepNew;
$('#bBack').onclick = () => renderJ();
$('#bJournals').onclick = () => { stopRec(); renderList(); show('vList'); };
$('#bClose').onclick = () => {
  const j = S.meta; if (!j) return;
  if (j.closed) { if (!confirm('Journal wieder öffnen, um weiterzuschreiben?')) return; BE.putMeta(S.jid, { closed: false, end: null }); return; }
  if (!confirm(`Journal «${j.title}» abschliessen? Es bleibt gespeichert und kann als PDF exportiert werden. Danach kann niemand mehr Einträge hinzufügen.`)) return;
  stopRec(); BE.putMeta(S.jid, { closed: true, end: Date.now(), closedBy: myName() });
};
$('#jList').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.closest('.jl').dataset.id, j = S.list.find(x => x.id === id); if (!j) return;
  if (b.dataset.a === 'open') { S.view = null; openJ(id); }
  if (b.dataset.a === 'del') {
    if (!confirm(`Journal «${j.title}» mit allen Einträgen endgültig löschen? Es wird auf allen Geräten gelöscht.`)) return;
    if (S.jid === id) leaveJ();
    Promise.resolve(BE.delJournal(id)).catch(() => msg('Löschen fehlgeschlagen.'));
  }
};

/* Journal bearbeiten (z. B. Wechsel des Journalführers) */
$('#bEdit').onclick = () => {
  const j = S.meta; if (!j) return;
  $('#eTitle').value = j.title || ''; $('#eOrt').value = j.ort || ''; $('#eEl').value = j.el || ''; $('#eFu').value = j.fu || '';
  stopRec(); show('vEdit');
};
$('#bEditCancel').onclick = () => renderJ();
$('#bEditSave').onclick = () => {
  const j = S.meta; if (!j) return;
  const p = { title: $('#eTitle').value.trim(), ort: $('#eOrt').value.trim(), el: $('#eEl').value.trim(), fu: $('#eFu').value.trim() };
  if (!p.title) return msg('Ereignis darf nicht leer sein.');
  if (!p.fu) return msg('Bitte den Journalführer eintragen.');
  const t = Date.now();
  BE.putMeta(S.jid, p);
  // Wechsel des Journalführers automatisch im Journal festhalten
  if (p.fu !== (j.fu || '')) BE.putEntry(S.jid, { id: uid(), t, text: `Journalführung übergeben: ${j.fu || '–'} → ${p.fu}`, src: 'auto', who: myName(), dev: LP.get('dev'), created: t });
  S.meta = { ...j, ...p }; renderJ();
};

/* ---------- Eintrag erfassen ---------- */
let usedVoice = false;
$('#txt').addEventListener('input', () => {
  if (!draftT && $('#txt').value.trim()) setDraftTime(Date.now());
  if (!$('#txt').value.trim() && !timeManual && !recOn) setDraftTime(null);
});
function addEntry() {
  if (!S.jid || !S.meta || S.meta.closed) return;
  stopRec();
  const text = ($('#txt').value + ' ' + $('#interim').textContent).trim();
  if (!text) return msg('Der Eintrag ist leer.');
  const now = Date.now();
  BE.putEntry(S.jid, { id: uid(), t: draftT || now, text, src: usedVoice ? 'voice' : 'text', who: myName(), dev: LP.get('dev'), created: now });
  resetDraft(); msg('Eingetragen ✓');
}
$('#bAdd').onclick = addEntry;
$('#txt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addEntry(); } });

$('#bTime').onclick = () => {
  const ed = $('#tEdit'); ed.value = hms(draftT || Date.now()); ed.hidden = false; $('#tBadge').hidden = true; ed.focus();
};
$('#tEdit').addEventListener('change', () => {
  const v = $('#tEdit').value; if (!v) return;
  const [h, m, s] = v.split(':').map(Number); const d = new Date(draftT || Date.now());
  d.setHours(h, m, s || 0, 0); timeManual = true; setDraftTime(d.getTime());
});
$('#tEdit').addEventListener('blur', () => { $('#tEdit').hidden = true; $('#tBadge').hidden = false; });

$('#list').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const li = b.closest('.e'), en = S.entries.find(x => x.id === li.dataset.id); if (!en) return;
  if (b.dataset.a === 'del') {
    if (!confirm(`Eintrag von ${hms(en.t)} (${en.who || 'unbekannt'}) löschen?`)) return;
    BE.delEntry(S.jid, en.id);
  }
  if (b.dataset.a === 'edit') {
    li.querySelector('.x').innerHTML = `<input type="time" step="1" value="${hms(en.t)}" style="width:auto;margin-bottom:6px"><textarea>${esc(en.text)}</textarea>`;
    li.querySelector('.act').innerHTML = '<span class="src"></span><button class="ghost" data-a="cancel">Abbrechen</button><button class="pri" data-a="save" style="min-height:36px">Speichern</button>';
    li.querySelector('textarea').focus();
  }
  if (b.dataset.a === 'cancel') renderEntries();
  if (b.dataset.a === 'save') {
    const txt = li.querySelector('textarea').value.trim(); if (!txt) return msg('Text darf nicht leer sein.');
    const [h, m, s] = li.querySelector('input').value.split(':').map(Number); const d = new Date(en.t);
    if (!isNaN(h)) d.setHours(h, m, s || 0, 0);
    if (txt !== en.text || d.getTime() !== en.t) BE.putEntry(S.jid, { ...en, text: txt, t: d.getTime(), edited: Date.now(), editedBy: myName() });
    else renderEntries();
  }
};

/* ---------- Spracherkennung (Diktat) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false, finalBase = '';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function micHint(t) { const h = $('#micHint'); h.textContent = t; h.hidden = !t; }
function micUi() { $('#bMic').classList.toggle('rec', recOn); $('#micLbl').textContent = recOn ? 'Stopp' : 'Sprechen'; }
function startRec() {
  if (!SR) { micHint('Die Spracherkennung wird hier nicht unterstützt. Tipp ins Textfeld und benutze das Mikrofon auf der Tastatur (Diktieren).'); $('#txt').focus(); return; }
  micHint(navigator.onLine ? '' : 'Offline: Die Spracherkennung braucht je nach Gerät Internet. Sonst das Mikrofon der Tastatur benutzen.');
  if (!draftT) setDraftTime(Date.now());
  usedVoice = true; recOn = true; finalBase = $('#txt').value.trim();
  rec = new SR(); rec.lang = 'de-CH'; rec.continuous = true; rec.interimResults = true;
  rec.onresult = ev => {
    let fin = '', intr = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) fin += r[0].transcript; else intr += r[0].transcript; }
    if (fin) { finalBase = (finalBase + ' ' + fin.trim()).trim(); $('#txt').value = cap(finalBase); }
    $('#interim').textContent = intr;
  };
  rec.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { micHint('Mikrofon nicht erlaubt. Bitte in den Einstellungen den Mikrofon-Zugriff für den Browser erlauben.'); recOn = false; }
    else if (ev.error === 'network') { micHint('Keine Verbindung zur Spracherkennung. Mikrofon der Tastatur benutzen.'); recOn = false; }
    else if (ev.error === 'language-not-supported') rec.lang = 'de-DE';
  };
  rec.onend = () => {
    if ($('#interim').textContent) { finalBase = (finalBase + ' ' + $('#interim').textContent.trim()).trim(); $('#txt').value = cap(finalBase); $('#interim').textContent = ''; }
    if (recOn) { try { rec.start(); return; } catch (e) {} }
    recOn = false; micUi();
  };
  try { rec.start(); } catch (e) { recOn = false; }
  micUi();
}
function stopRec() { if (!recOn) return; recOn = false; try { rec.stop(); } catch (e) {} micUi(); }
$('#bMic').onclick = () => recOn ? stopRec() : startRec();

/* ---------- PDF ---------- */
const clean = s => String(s ?? '').replace(/[–—−]/g, '-').replace(/→/g, '->').replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'").replace(/…/g, '...').replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, '');
function logoData() {
  const img = $('#logo'); const c = document.createElement('canvas'); c.width = img.naturalWidth || 220; c.height = img.naturalHeight || 229;
  c.getContext('2d').drawImage(img, 0, 0); return c.toDataURL('image/png');
}
async function exportPdf() {
  const j = S.meta; if (!j) return;
  if (!window.jspdf) return msg('PDF-Modul nicht geladen. App einmal mit Internet öffnen.');
  if (!S.entries.length) return msg('Noch keine Einträge.');
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40, TX = M + 78;
  let y = M;
  try { doc.addImage(logoData(), 'PNG', W - M - 48, M - 6, 48, 50); } catch (e) {}
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor('#c8102e'); doc.text('Einsatzjournal', M, y, { baseline: 'top' });
  y += 24; doc.setFontSize(13); doc.setTextColor('#16181a');
  const tl = doc.splitTextToSize(clean(j.title), W - 2 * M - 60); doc.text(tl, M, y, { baseline: 'top' }); y += tl.length * 16 + 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor('#5b6166');
  const meta = [['Eröffnet', `${dmy(j.start)} ${hm(j.start)}`], ['Abgeschlossen', j.closed && j.end ? `${dmy(j.end)} ${hm(j.end)}` : ''], ['Einsatzort', j.ort], ['Einsatzleiter', j.el], ['Journalführer', j.fu]].filter(x => x[1]);
  meta.forEach(([k, v]) => { doc.text(clean(`${k}: ${v}`), M, y, { baseline: 'top' }); y += 14; });
  y += 8; doc.setDrawColor('#c8102e'); doc.setLineWidth(1.5); doc.line(M, y, W - M, y); y += 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor('#5b6166');
  doc.text('ZEIT / VON', M, y, { baseline: 'top' }); doc.text('EINTRAG', TX, y, { baseline: 'top' }); y += 16;
  const es = [...S.entries].sort((a, b) => a.t - b.t);
  let lastDay = dmy(j.start);
  for (const e of es) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    const lines = doc.splitTextToSize(clean(e.text), W - M - TX);
    doc.setFontSize(8); const wl = doc.splitTextToSize(clean(e.who || ''), TX - M - 6).slice(0, 2);
    const day = dmy(e.t), dayRow = day !== lastDay;
    const rowH = Math.max(lines.length * 13.5, 14 + wl.length * 10);
    if (y + rowH + 10 + (dayRow ? 18 : 0) > H - M - 20) { doc.addPage(); y = M; }
    if (dayRow) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor('#c8102e'); doc.text(day, M, y, { baseline: 'top' }); y += 18; lastDay = day; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor('#16181a'); doc.text(hms(e.t), M, y, { baseline: 'top' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#5b6166'); if (wl.length) doc.text(wl, M, y + 14, { baseline: 'top' });
    doc.setFontSize(10.5); doc.setTextColor(e.src === 'auto' ? '#5b6166' : '#16181a');
    doc.setFont('helvetica', e.src === 'auto' ? 'italic' : 'normal'); doc.text(lines, TX, y, { baseline: 'top', lineHeightFactor: 1.29 });
    y += rowH + 4;
    doc.setDrawColor('#d8d4ce'); doc.setLineWidth(.5); doc.line(M, y, W - M, y); y += 6;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#5b6166');
    doc.text(clean(`Einsatzjournal - ${j.title} - ${CFG.feuerwehr || 'Feuerwehr RTL'}`), M, H - 26); doc.text(`Seite ${i} / ${n}`, W - M, H - 26, { align: 'right' }); }
  const d = new Date(j.start);
  const slug = clean(j.title).replace(/[^A-Za-z0-9äöüÄÖÜ]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  const name = `Einsatzjournal_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${slug ? '_' + slug : ''}.pdf`;
  const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && 'ontouchend' in document) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  msg('PDF gespeichert.');
}
$('#bPdf').onclick = () => { if (S.jid && S.meta) exportPdf(); else { renderList(); show('vList'); msg('Bitte zuerst ein Journal öffnen.'); } };

/* ---------- Start ---------- */
let started = false;
function start() {
  if (started) return; started = true;
  migrateV1();
  let first = true;
  BE.watchList(l => {
    S.list = l;
    if (first) { first = false; goHome(); }
    else if (S.view === 'vList') renderList();
  });
}
$('#bLogout').onclick = () => { if (confirm('Abmelden? Danach braucht dieses Gerät Internet, um sich wieder anzumelden.')) BE.logout(); };
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await BE.login(f.elements.email.value.trim(), f.elements.pw.value); }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung – für die erste Anmeldung braucht es Internet.' : 'Anmeldung fehlgeschlagen.'; }
});
async function boot() {
  tick(); setInterval(tick, 1000); renderSync();
  const fb = CFG.firebase;
  if (fb && fb.apiKey) {
    try {
      BE = await CloudBackend(fb); SY.mode = 'cloud';
      BE.onUser(u => { SY.user = u; $('#login').hidden = !!u; renderSync(); if (u) start(); else if (started) location.reload(); });
      return;
    } catch (e) { msg('Synchronisation nicht verfügbar – es wird nur auf diesem Gerät gespeichert.'); }
  }
  BE = LocalBackend(); SY.mode = 'local'; renderSync(); start();
}
boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__JR = { S, VERSION };
})();
