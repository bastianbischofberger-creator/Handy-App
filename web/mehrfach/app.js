/* Mehrfachereignisse – Feuerwehr RTL
   Offline-fähige Web-App (Vorbild: Atemschutzüberwachung) mit optionaler Synchronisation über Firebase. */
(function () {
'use strict';
const VERSION = '0.6.0';
const CFG = window.MF_CONFIG || {};
const FB_VERSION = '10.12.2';

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const hm = t => { if (!t) return '–'; const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hms = t => { const d = new Date(t); return hm(t) + ':' + pad(d.getSeconds()); };
const dmy = t => { const d = new Date(t); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); };
const dt = t => t ? dmy(t) + ' ' + hm(t) : '–';
const durH = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
const since = t => { const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return Math.floor(m / 60) + ':' + pad(m % 60); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== String(v)) e.textContent = v; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const SVGX = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" style="width:16px;height:16px"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SVGF = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="#c8102e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>';

/* Geräte-Einstellungen (nur dieses Gerät) */
const LP = (() => {
  let o = {}; try { o = JSON.parse(localStorage.getItem('mf-prefs')) || {}; } catch (e) {}
  return { get: k => o[k], set: (k, v) => { o[k] = v; try { localStorage.setItem('mf-prefs', JSON.stringify(o)); } catch (e) {} } };
})();

/* ---------- Grunddaten ---------- */
const RAENGE = ['Soldat', 'Uof', 'Of'];
const MUSTER_P = [['Peter', 'Muster', 'Of', 'Einsatzleiter'], ['Anna', 'Beispiel', 'Of', 'Führungsunterstützung'], ['Lukas', 'Keller', 'Uof', 'Gruppenführer'], ['Sandra', 'Huber', 'Soldat', 'Maschinistin'],
  ['Reto', 'Brunner', 'Uof', 'Gruppenführer'], ['Marco', 'Graf', 'Soldat', ''], ['Nadine', 'Frei', 'Soldat', ''], ['Daniel', 'Lenz', 'Soldat', 'Motorsäge'], ['Patrick', 'Koch', 'Uof', ''], ['Simon', 'Weber', 'Soldat', ''],
  ['Michael', 'Schmid', 'Soldat', ''], ['Laura', 'Baumann', 'Soldat', '']];
const MUSTER_M = [['TLF', 'TLF', 'Tanklöschfahrzeug'], ['Pionier', 'Pionier', 'Pionierfahrzeug'], ['MTF 1', 'MTF', 'Mannschaftstransport'], ['MTF 2', 'MTF', 'Mannschaftstransport'], ['Kdo-Fz', 'Kdo-Fz', 'Kommandofahrzeug'],
  ['Wassersauger 1', 'Wassersauger', ''], ['Wassersauger 2', 'Wassersauger', ''], ['Tauchpumpe 1', 'Tauchpumpe', ''], ['Tauchpumpe 2', 'Tauchpumpe', ''], ['Motorsäge 1', 'Motorsäge', ''], ['Motorsäge 2', 'Motorsäge', ''], ['Notstromaggregat', 'Notstromaggregat', '']];
const DEF = {
  org: CFG.feuerwehr || 'Feuerwehr Rheineck-Thal-Lutzenberg',
  arten: 'Baum / Äste, Wasser im Gebäude, Dach / Fassade, Strasse blockiert, Ölspur, Technische Hilfe',
  personal: MUSTER_P.map(([v, n, r, f], i) => ({ id: 'mp' + i, vorname: v, name: n, rang: r, fkt: f, muster: true })),
  mittel: MUSTER_M.map(([n, g, info], i) => ({ id: 'mm' + i, name: n, gattung: g, info, muster: true }))
};
const QUELLEN = ['Anruf', 'E-Mail', 'Alarm', 'Andere'];
const PRIOS = [['P1', 'P1 · sofort'], ['P2', 'P2 · dringend'], ['P3', 'P3 · später']];
const DAUER = ['< 30 Min.', '1 h', '2 h', '> 2 h'];
const COLS = [['offen', 'Offen', '#c8102e'], ['reko', 'Reko', '#7a3db8'], ['pendent', 'Pendent', '#f2b705'], ['bew', 'In Bewältigung', '#1557c0'], ['abg', 'Abgeschlossen', '#8f969c']];
const STL = { offen: 'Offen', reko: 'Reko', pendent: 'Pendent', bew: 'In Bewältigung', abg: 'Abgeschlossen' };
const PINC = { offen: '#c8102e', reko: '#7a3db8', pendent: '#f2b705', disp: '#16181a', vorort: '#1557c0', abg: '#8f969c' };

const S = { settings: { ...DEF }, eid: null, meta: {}, A: [], res: {}, ci: {}, log: [], list: [], view: 'start', sel: null, filt: 'alle' };
const SY = { mode: 'local', pending: false, error: '', user: null };
let BE = null;
const COLLS = ['auftraege', 'res', 'log', 'checkin'];

/* ================= Speicher: nur lokal ================= */
function LocalBackend() {
  const KEY = 'mf-db-v1';
  let db = null; try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  if (!db || !db.ereignisse) db = { ereignisse: {}, settings: {} };
  let cur = null, curCb = null, listCb = null, setCb = null;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { SY.error = 'Speicher voll'; banner('Speicher auf diesem Gerät ist voll. Bitte Daten sichern und alte Ereignisse löschen.'); } };
  const emitList = () => listCb && listCb(Object.entries(db.ereignisse).map(([id, e]) => ({ id, ...clone(e.meta), n: Object.keys(e.auftraege || {}).length })).sort((a, b) => b.created - a.created));
  const emitCur = () => { if (!curCb) return; const e = db.ereignisse[cur]; if (!e) return curCb({ meta: {}, auftraege: [], res: [], log: [] });
    curCb({ meta: clone(e.meta), auftraege: clone(Object.values(e.auftraege)), res: clone(Object.values(e.res)), checkin: clone(Object.values(e.checkin || {})), log: clone(Object.values(e.log)).sort((a, b) => a.t - b.t) }); };
  const ch = () => { persist(); emitCur(); emitList(); };
  return {
    mode: 'local',
    has: id => !!db.ereignisse[id],
    watchSettings(cb) { setCb = cb; cb(clone(db.settings || {})); },
    putSettings(s) { db.settings = clone(s); persist(); setCb && setCb(clone(s)); },
    watchList(cb) { listCb = cb; emitList(); },
    open(id, cb) { cur = id; curCb = cb; emitCur(); },
    create(meta) { const id = uid(); db.ereignisse[id] = { meta: clone(meta), auftraege: {}, res: {}, log: {} }; persist(); emitList(); return id; },
    putMeta(id, meta) { if (!db.ereignisse[id]) return; db.ereignisse[id].meta = clone(meta); ch(); },
    put(id, coll, did, o) { const e = db.ereignisse[id]; if (!e) return; (e[coll] = e[coll] || {})[did] = clone(o); ch(); },
    putPublic() {},
    del(id, coll, did) { const e = db.ereignisse[id]; if (!e) return; delete e[coll][did]; ch(); },
    delEreignis(id) { delete db.ereignisse[id]; persist(); emitList(); },
    exportAll() { return clone(db); },
    importAll(o) { let n = 0;
      for (const [id, e] of Object.entries(o.ereignisse || {})) { if (!e || !e.meta) continue; const c = db.ereignisse[id];
        if (!c) db.ereignisse[id] = e; else { for (const k of COLLS) Object.assign(c[k], e[k] || {}); c.meta = { ...e.meta, ...c.meta }; } n++; }
      if (o.settings && !Object.keys(db.settings || {}).length) db.settings = o.settings;
      persist(); emitCur(); emitList(); setCb && setCb(clone(db.settings)); return n; }
  };
}

/* ================= Speicher: Firebase (offline + Sync) ================= */
async function CloudBackend(fbConfig) {
  const B = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appM, Au, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
  const app = appM.initializeApp(fbConfig, 'mehrfach');
  const auth = Au.getAuth(app);
  await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
  let fs;
  try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
  const E = F.collection(fs, 'mf_ereignisse');
  const fail = e => { SY.error = (e && e.code === 'permission-denied') ? 'Kein Zugriff (Firestore-Regeln prüfen)' : 'Sync-Fehler: ' + (e && (e.code || e.message)); renderSync(); };
  const w = p => p.catch(fail);
  let subs = [];
  return {
    mode: 'cloud',
    onUser: cb => Au.onAuthStateChanged(auth, cb),
    login: (e, p) => Au.signInWithEmailAndPassword(auth, e, p),
    logout: () => Au.signOut(auth),
    watchSettings(cb) { F.onSnapshot(F.doc(fs, 'config', 'mf_settings'), d => cb(d.exists() ? d.data() : {}), fail); },
    putSettings(s) { w(F.setDoc(F.doc(fs, 'config', 'mf_settings'), clone(s))); },
    putPublic(o) { w(F.setDoc(F.doc(fs, 'mf_public', 'aktuell'), clone(o))); },
    async putFile(eid, fid, meta, parts) {
      await Promise.all(parts.map((d, i) => F.setDoc(F.doc(E, eid, 'files', fid, 'chunks', String(i).padStart(3, '0')), { d })));
      await F.setDoc(F.doc(E, eid, 'files', fid), { ...meta, n: parts.length });
    },
    async getFile(eid, fid) {
      const m = await F.getDoc(F.doc(E, eid, 'files', fid)); if (!m.exists()) return null;
      const q = await F.getDocs(F.collection(E, eid, 'files', fid, 'chunks'));
      const parts = q.docs.sort((a, b) => a.id.localeCompare(b.id)).map(d => d.data().d); if (parts.length < m.data().n) return null;
      return b64ToBlob(parts.join(''), m.data().type);
    },
    watchList(cb) { F.onSnapshot(F.query(E, F.orderBy('created', 'desc'), F.limit(60)), q => cb(q.docs.map(d => ({ id: d.id, ...d.data() }))), fail); },
    open(id, cb) {
      subs.forEach(u => u()); subs = [];
      const st = { meta: {}, auftraege: [], res: [], log: [], checkin: [] }, p = {};
      const emit = () => { SY.pending = Object.values(p).some(Boolean); SY.error = ''; cb(st); renderSync(); };
      const o = { includeMetadataChanges: true };
      subs.push(F.onSnapshot(F.doc(E, id), o, d => { st.meta = d.exists() ? d.data() : {}; p.m = d.metadata.hasPendingWrites; emit(); }, fail));
      for (const c of COLLS) subs.push(F.onSnapshot(F.collection(E, id, c), o, q => { st[c] = q.docs.map(d => c === 'checkin' ? { ...d.data(), id: d.id } : d.data()); if (c === 'log') st.log.sort((a, b) => a.t - b.t); p[c] = q.metadata.hasPendingWrites; emit(); }, fail));
    },
    create(meta) { const id = uid(); w(F.setDoc(F.doc(E, id), clone(meta))); return id; },
    putMeta(id, meta) { w(F.setDoc(F.doc(E, id), clone(meta))); },
    put(id, coll, did, o) { w(F.setDoc(F.doc(E, id, coll, did), clone(o))); },
    del(id, coll, did) { w(F.deleteDoc(F.doc(E, id, coll, did))); },
    async delEreignis(id) { for (const c of COLLS) { const q = await F.getDocs(F.collection(E, id, c)); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); } await F.deleteDoc(F.doc(E, id)); }
  };
}

/* ---------- Anhänge: nur auf diesem Gerät (IndexedDB) ---------- */
const FILES = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('mf-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('f', mode); const r = fn(t.objectStore('f')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  return { put: (id, blob) => tx('readwrite', s => s.put(blob, id)), get: id => tx('readonly', s => s.get(id)), del: id => tx('readwrite', s => s.delete(id)) };
})();
/* Anhänge über die Datenbank (Stücke à ~500 KB) – max. 5 MB pro Datei */
const FILE_MAX = 5 * 1048576, CHUNK = 700000;
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(b); });
function b64ToBlob(b64, type) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'application/octet-stream' }); }
async function uploadFile(f, aid) {
  try { const b = await FILES.get(f.id); if (!b) return; const s64 = await blobToB64(b), parts = [];
    for (let i = 0; i < s64.length; i += CHUNK) parts.push(s64.slice(i, i + CHUNK));
    await BE.putFile(S.eid, f.id, { name: f.name, type: f.type || b.type, size: f.size, aid }, parts); }
  catch (e) { banner(`Anhang «${f.name}» konnte nicht hochgeladen werden – er bleibt nur auf diesem Gerät.`); }
}
let viewUrl = null;
async function openFile(f) {
  const d = $('#dFile'); $('#fvTitle').textContent = f.name; $('#fvBody').innerHTML = '<p class="hint">Lädt …</p>'; $('#fvLinks').innerHTML = ''; d.showModal();
  try {
    let b = await FILES.get(f.id).catch(() => null);
    if (!b && f.cloud && BE.getFile) { b = await BE.getFile(S.eid, f.id); if (b) FILES.put(f.id, b).catch(() => {}); }
    if (!b) { $('#fvBody').innerHTML = `<p class="err">${f.cloud ? 'Anhang ist noch nicht übertragen. Später nochmals versuchen.' : 'Dieser Anhang liegt nur auf dem Gerät, auf dem er erfasst wurde.'}</p>`; return; }
    if (viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = URL.createObjectURL(b);
    const t = b.type || f.type || '';
    $('#fvBody').innerHTML = t.startsWith('image/') ? `<img src="${viewUrl}" alt="${esc(f.name)}" style="max-width:100%;border-radius:8px">`
      : t === 'application/pdf' ? `<iframe src="${viewUrl}" title="${esc(f.name)}" style="width:100%;height:65vh;border:1px solid var(--line);border-radius:8px"></iframe>` : `<p class="hint">Vorschau nicht möglich (${esc(t || 'Datei')}).</p>`;
    $('#fvLinks').innerHTML = `<a class="btn" href="${viewUrl}" target="_blank" rel="noopener">In neuem Fenster öffnen</a><a class="btn" href="${viewUrl}" download="${esc(f.name)}">Herunterladen</a>`;
  } catch (e) { $('#fvBody').innerHTML = '<p class="err">Anhang konnte nicht geladen werden.</p>'; }
}

/* ---------- Ereignis & Daten ---------- */
function openE(id) {
  S.eid = id; LP.set('eid', id);
  BE.open(id, st => { S.meta = st.meta || {}; S.A = st.auftraege || []; S.res = {}; (st.res || []).forEach(r => S.res[r.id] = r);
    S.ci = {}; (st.checkin || []).forEach(c => S.ci[c.id] = c); S.log = st.log || [];
    if (S.meta.created && !S.meta.closed && !S.meta.code) { S.meta.code = newCode(); saveMeta(); }
    processCheckins(); render(); publish(); syncInbox(); });
}
const newCode = () => String(1000 + Math.floor(Math.random() * 9000));
/* Öffentliche Angaben für die Anmeldeseite (nur mit Synchronisation) */
let pubKey = '';
function publish() {
  if (SY.mode !== 'cloud' || !S.eid || !S.meta.created) return;
  const o = S.meta.closed ? { eid: null, t: Date.now() } : { eid: S.eid, name: S.meta.name || '', start: S.meta.start || null, org: S.settings.org || '',
  };
  const k = JSON.stringify(o); if (k === pubKey) return; pubKey = k; BE.putPublic({ ...o, t: Date.now() });
}
/* Anmeldungen per QR-Code verarbeiten */
const norm = s => String(s || '').trim().toLowerCase();
/* Anmeldung der Stammliste zuordnen (Name + Vorname), sonst als zusätzliche Person führen */
const ciPid = c => { const p = (S.settings.personal || []).find(p => norm(p.name) === norm(c.nachname) && norm(p.vorname) === norm(c.vorname)); return p ? p.id : 'g_' + c.id; };
function processCheckins() {
  for (const c of Object.values(S.ci)) {
    if (!c.t || !c.status) continue;
    const pid = ciPid(c), r = resOf(pid, 'p'); if (r.ciT === c.t) continue;
    const who = c.name || 'Unbekannt';
    if (c.status === 'an') {
      setRes(pid, 'p', { ciT: c.t, ...(['abwesend', 'abgetreten'].includes(r.status) ? { status: 'verfuegbar', auftrag: null } : {}) });
      log(`${who} im Depot angemeldet (QR)${c.masch ? ', Maschinist' : ''}${c.tel ? ', Tel. ' + c.tel : ''}`, 'ci-' + c.id + '-' + c.t);
    } else {
      const a = r.auftrag && A(r.auftrag);
      setRes(pid, 'p', { ciT: c.t, ...(r.status === 'verfuegbar' ? { status: 'abgetreten', auftrag: null } : {}) });
      log(`${who} hat sich abgemeldet (QR)${a ? ` – ist noch bei Auftrag ${a.nr} eingeteilt!` : ''}`, 'ci-' + c.id + '-' + c.t);
    }
  }
  for (const c of Object.values(S.ci)) if (c.rm && c.rm.id) applyReply(c);
}
/* Rückmeldungen vom Handy (Vor Ort, Reko abgeschlossen, erledigt) */
const rmSeen = new Set();
function applyReply(c) {
  const m = c.rm; if (rmSeen.has(m.id)) return; const a = A(m.aid); if (!a) return;
  if ((a.rms || []).includes(m.id)) { rmSeen.add(m.id); return; }
  rmSeen.add(m.id);
  const who = c.name || 'Unbekannt', pid = ciPid(c);
  a.rms = [...(a.rms || []), m.id];
  /* Fotos vom Handy als Anhang beim Auftrag speichern – damit sieht sie auch der nächste Trupp */
  const fotos = (m.fotos || (m.foto ? [m.foto] : [])).filter(Boolean);
  fotos.forEach((d, i) => {
    const fid = 'r' + m.id + '_' + i; if ((a.anh || []).some(f => f.id === fid)) return;
    const b64 = String(d).split(',')[1] || '', size = Math.round(b64.length * .75), name = `Foto ${hm(m.t)} ${who}${fotos.length > 1 ? ' ' + (i + 1) : ''}.jpg`;
    a.anh = [...(a.anh || []), { id: fid, name, type: 'image/jpeg', size, cloud: true, von: who, t: m.t }];
    const parts = []; for (let k = 0; k < b64.length; k += CHUNK) parts.push(b64.slice(k, k + CHUNK));
    if (BE.putFile) BE.putFile(S.eid, fid, { name, type: 'image/jpeg', size, aid: a.id }, parts).catch(() => {});
    FILES.put(fid, b64ToBlob(b64, 'image/jpeg')).catch(() => {});
  });
  if (fotos.length && m.typ !== 'foto') log(`Auftrag ${a.nr}: ${fotos.length} Foto${fotos.length > 1 ? 's' : ''} von ${who}`);
  if (m.typ === 'vorort') {
    if (a.status === 'reko') { if (a.reko) a.reko.vorOrt = m.t; log(`Auftrag ${a.nr}: Reko vor Ort (${who}, Handy)`); }
    else if (a.status === 'bew' && a.sub !== 'vorort') { a.sub = 'vorort'; a.tVorOrt = m.t; log(`Auftrag ${a.nr}: vor Ort tätig (${who}, Handy)`); }
  } else if (m.typ === 'rekoEnd' && a.status === 'reko') {
    release(a, a.reko ? a.reko.ids : []); if (a.reko) a.reko.tEnd = m.t;
    a.rekoDone = true; a.lageReko = m.lage || ''; a.bedarf = { adf: m.adf || 0, m: m.mittel || {} }; a.dauer = m.dauer || '';
    if (m.keinEinsatz) { a.status = 'abg'; a.tAbg = m.t; a.abschluss = 'Kein Einsatz nötig' + (m.lage ? ': ' + m.lage : ''); log(`Auftrag ${a.nr}: Reko (${who}, Handy) – kein Einsatz nötig, abgeschlossen`); }
    else { a.status = 'pendent'; log(`Auftrag ${a.nr}: Reko abgeschlossen (${who}, Handy) → Pendent. Benötigt: ${bedarfText(a.bedarf) || '–'}${a.dauer ? ', ca. ' + a.dauer : ''}${m.lage ? ' – ' + m.lage : ''}`); }
  } else if (m.typ === 'erledigt' && a.status === 'bew') {
    release(a); a.status = 'abg'; a.tAbg = m.t; a.abschluss = m.text || ''; log(`Auftrag ${a.nr} erledigt gemeldet (${who}, Handy)${m.text ? ': ' + m.text : ''}`);
  } else if (m.typ === 'text') { log(`Auftrag ${a.nr}: Meldung von ${who}: ${m.text}`); }
  else if (m.typ === 'foto') { log(`Auftrag ${a.nr}: ${fotos.length} Foto${fotos.length > 1 ? 's' : ''} von ${who}`); }
  else log(`Auftrag ${a.nr}: Meldung «${m.typ}» von ${who} nicht übernommen (Auftrag ist ${STL[a.status]})`);
  saveA(a);
}
/* Auftrag aufs Handy der eingeteilten Person schicken */
const inboxSent = {};
function syncInbox() {
  if (SY.mode !== 'cloud' || !S.eid) return;
  for (const c of Object.values(S.ci)) {
    if (c.status !== 'an') continue;
    const pid = ciPid(c), r = resOf(pid, 'p'), a = r.status === 'einsatz' && r.auftrag && A(r.auftrag);
    let doc = { aid: null };
    if (a && a.status !== 'abg') {
      const rolle = a.status === 'reko' ? 'reko' : 'disp', ids = rolle === 'reko' ? (a.reko ? a.reko.ids : []) : (a.assigned || []).filter(i => personal().some(p => p.id === i));
      const lead = rolle === 'reko' ? (a.reko && a.reko.lead) || ids[0] : a.lead || ids[0];
      const leadP = personal().find(p => p.id === lead);
      doc = { aid: a.id, nr: a.nr, art: a.art, adresse: a.adresse, lat: a.lat ?? null, lng: a.lng ?? null, prio: a.prio, text: a.text || '', melder: a.melder || '', tel: a.tel || '',
        rolle, fuehrung: lead === pid, fuehrungName: leadP ? pName(leadP) : '', team: [...ids].sort((x, y) => (y === lead) - (x === lead)).map(i => { const p = personal().find(x => x.id === i); return { v: p ? p.vorname : '?', n: p ? p.name : '', lead: i === lead }; }),
        mittel: rolle === 'disp' ? (a.assigned || []).filter(i => mittel().some(m => m.id === i)).map(resName).concat(a.extra ? [a.extra] : []) : [],
        bedarf: a.bedarf ? bedarfText(a.bedarf) : '', lageReko: a.lageReko || '', vorOrt: rolle === 'reko' ? !!(a.reko && a.reko.vorOrt) : a.sub === 'vorort',
        gattungen: gattungen(), anh: (a.anh || []).filter(f => f.cloud).map(f => ({ id: f.id, name: f.name, type: f.type || '', size: f.size || 0 })),
        anhLokal: (a.anh || []).filter(f => !f.cloud).length };
    }
    const k = JSON.stringify(doc); if (inboxSent[c.id] === k) continue; inboxSent[c.id] = k;
    BE.put(S.eid, 'inbox', c.id, { ...doc, t: Date.now() });
  }
}
const ciOf = pid => Object.values(S.ci).find(c => ciPid(c) === pid);
const A = id => S.A.find(a => a.id === id);
function saveA(a) { BE.put(S.eid, 'auftraege', a.id, a); }
function saveMeta() { BE.putMeta(S.eid, S.meta); }
function log(text, id) { if (S.eid) BE.put(S.eid, 'log', id || uid(), { t: Date.now(), text, dev: LP.get('dev') || '' }); }
const personal = () => {
  const l = Array.isArray(S.settings.personal) ? S.settings.personal : [];
  const g = Object.values(S.ci).filter(c => ciPid(c).startsWith('g_')).map(c => ({ id: 'g_' + c.id, vorname: c.vorname || '', name: c.nachname || c.name || 'Unbekannt', rang: c.rang || '', fkt: c.masch ? 'Maschinist' : '', gast: true }));
  return g.length ? [...l, ...g] : l;
};
const mittel = () => Array.isArray(S.settings.mittel) ? S.settings.mittel : [];
const arten = () => String(S.settings.arten || '').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
const gattungen = () => [...new Set(mittel().map(m => m.gattung || m.name))];
const pName = p => `${p.rang ? p.rang + ' ' : ''}${p.name} ${p.vorname}`;
const pFull = p => `${p.name} ${p.vorname}`;
/* Führung: höchster Rang (Of vor Uof vor Soldat), bei Gleichstand wer zuerst gewählt wurde */
const RW = { of: 3, lt: 3, oblt: 3, hptm: 3, maj: 3, uof: 2, kpl: 2, wm: 2, fw: 2, four: 2, adj: 2 };
const rankOf = id => { const p = personal().find(x => x.id === id); const c = ciOf(id); return RW[norm((c && c.rang) || (p && p.rang))] || 1; };
const pickLead = ids => { const ps = ids.filter(i => personal().some(p => p.id === i)); return ps.reduce((b, i) => b == null || rankOf(i) > rankOf(b) ? i : b, null); };
const pShort = p => `${p.name}${p.vorname ? ' ' + p.vorname[0] + '.' : ''}`;
const resOf = (id, kind) => S.res[id] || { id, kind, status: kind === 'p' ? 'abwesend' : 'verfuegbar', auftrag: null };
function setRes(id, kind, patch) { const r = { ...resOf(id, kind), ...patch, kind, t: Date.now() }; S.res[id] = r; BE.put(S.eid, 'res', id, r); }
const freeP = () => personal().filter(p => resOf(p.id, 'p').status === 'verfuegbar');
const freeM = () => mittel().filter(m => resOf(m.id, 'm').status === 'verfuegbar');
const resName = id => { const p = personal().find(x => x.id === id); if (p) return pShort(p); const m = mittel().find(x => x.id === id); return m ? m.name : '?'; };
function assignedText(a) {
  const ids = a.assigned || [], ps = ids.filter(i => personal().some(p => p.id === i)), ms = ids.filter(i => mittel().some(m => m.id === i));
  return [...ms.map(resName), ps.length ? ps.length + ' AdF' : '', a.extra || ''].filter(Boolean).join(' · ');
}
function bedarfText(b) { if (!b) return ''; const parts = []; if (b.adf) parts.push(b.adf + ' AdF'); Object.entries(b.m || {}).forEach(([g, n]) => n && parts.push((n > 1 ? n + '× ' : '') + g)); return parts.join(', '); }
function isReady(a) {
  if (a.status !== 'pendent' || !a.bedarf) return false;
  const b = a.bedarf; if (!b.adf && !Object.values(b.m || {}).some(Boolean)) return false;
  if ((b.adf || 0) > freeP().length) return false;
  const fm = freeM(); return Object.entries(b.m || {}).every(([g, n]) => fm.filter(m => (m.gattung || m.name) === g).length >= n);
}
function release(a, ids) { (ids || a.assigned || []).forEach(id => { const k = personal().some(p => p.id === id) ? 'p' : 'm'; const r = resOf(id, k); if (r.auftrag === a.id) setRes(id, k, { status: 'verfuegbar', auftrag: null }); }); }
function nextNr() { return S.A.reduce((m, a) => Math.max(m, a.nr || 0), 0) + 1; }
const subOf = a => a.status === 'bew' ? (a.sub === 'vorort' ? 'vorort' : 'disp') : a.status;
const prioCls = p => ({ P1: 'p1', P2: 'p2', P3: 'p3' }[p] || 'p3');
const sortA = (x, y) => (x.prio || 'P3').localeCompare(y.prio || 'P3') || x.tEin - y.tEin;

/* ---------- Navigation ---------- */
const VIEWS = { start: 'vStart', dash: 'vDash', erfassen: 'vErf', lage: 'vLage', karte: 'vKarte', mittel: 'vMittel' };
const TITLES = { dash: 'Mehrfachereignisse', erfassen: 'Auftragserfassung', lage: 'Ereignisbewältigung', karte: 'Ereignisbewältigung', mittel: 'Personal & Mittel' };
function go(v, opt) {
  if (v !== 'start' && !S.eid) v = 'start';
  if (v === 'erfassen' && !(opt && opt.keep)) erfReset(opt && opt.edit);
  S.view = v; if (v !== 'start') LP.set('view', v);
  for (const [k, id] of Object.entries(VIEWS)) document.getElementById(id).classList.toggle('on', k === v);
  document.body.classList.toggle('startmode', v === 'start');
  window.scrollTo(0, 0); render();
  if (v === 'karte') setTimeout(initLageMap, 30);
  if (v === 'erfassen') setTimeout(initErfMap, 30);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
$('#bHome').onclick = () => go(S.eid ? 'dash' : 'start');
$('#bBack').onclick = () => go('dash');
$('#bNewA').onclick = () => go('erfassen');

/* ---------- Darstellung ---------- */
function render() {
  const v = S.view;
  $('#bBack').hidden = v === 'dash' || v === 'start';
  $('#segLage').hidden = !(v === 'lage' || v === 'karte');
  $$('#segLage button').forEach(b => b.classList.toggle('on', b.dataset.go === v));
  $('#bNewA').hidden = !(v === 'lage' || v === 'karte' || v === 'mittel');
  $('#title').firstChild.textContent = TITLES[v] || 'Mehrfachereignisse';
  set('sub', [S.meta.name, S.meta.el ? 'Einsatzleiter: ' + S.meta.el : '', S.meta.closed ? 'abgeschlossen' : ''].filter(Boolean).join(' · '));
  if (v === 'start') renderStart(); else if (v === 'dash') renderDash(); else if (v === 'erfassen') renderErf();
  else if (v === 'lage') renderBoard(); else if (v === 'karte') renderKarte(); else if (v === 'mittel') renderMittel();
  if ($('#dA').open && S.sel) renderDetail();
  renderSync(); tick(); topH();
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
const topH = () => document.documentElement.style.setProperty('--toph', $('.top').offsetHeight + 'px');
addEventListener('resize', () => { topH(); if (lageMap) lageMap.invalidateSize(); });
addEventListener('online', renderSync); addEventListener('offline', renderSync);
function banner(t) { const b = $('#banner'); b.hidden = !t; b.textContent = t || ''; }
function tick() {
  const now = Date.now(); set('clock', hms(now));
  set('dauer', S.meta.start ? durH((S.meta.closed && S.meta.end ? S.meta.end : now) - S.meta.start) : '00:00:00');
  $$('[data-since]').forEach(e => { const v = 'seit ' + since(+e.dataset.since); if (e.textContent !== v) e.textContent = v; });
}

/* ---------- 0 Start ---------- */
function renderStart() {
  $('#startOrg').textContent = 'Mehrfachereignisse · ' + (S.settings.org || '');
  const f = $('#fStart');
  if (!f.dataset.init) { const n = Date.now(); f.elements.name.value = 'Mehrfachereignis ' + dmy(n); f.elements.datum.value = dmy(n); f.elements.beginn.value = hm(n); f.dataset.init = '1'; }
  $('#eList').innerHTML = S.list.length ? S.list.map(e => `<li><div><b>${esc(e.name || 'Ohne Bezeichnung')}</b><span>${e.el ? 'EL: ' + esc(e.el) + ' · ' : ''}${dt(e.start || e.created)}${e.n != null ? ' · ' + e.n + ' Aufträge' : ''}</span></div>
    <span class="tag ${e.closed ? 's-abg' : 's-offen'}">${e.closed ? 'Abgeschlossen' : 'Laufend'}</span><button data-open="${esc(e.id)}">Öffnen</button></li>`).join('') : '<li><span>Noch keine Ereignisse.</span></li>';
  $('#bBackup').hidden = !BE.exportAll; $('#lImport').hidden = !BE.importAll;
}
$('#eList').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) { openE(b.dataset.open); go('dash'); } });
function parseStart(datum, zeit) {
  const d = String(datum || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/), z = String(zeit || '').match(/(\d{1,2})[:.](\d{2})/);
  const r = d ? new Date(+d[3], +d[2] - 1, +d[1]) : new Date(); if (z) r.setHours(+z[1], +z[2], 0, 0); return r.getTime();
}
$('#fStart').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, el = f.elements.el.value.trim();
  if (!el) { $('#startErr').textContent = 'Bitte den Einsatzleiter eintragen.'; return; }
  const meta = { created: Date.now(), start: parseStart(f.elements.datum.value, f.elements.beginn.value), end: null, closed: false,
    name: f.elements.name.value.trim() || 'Mehrfachereignis ' + dmy(Date.now()), el, code: newCode(), fu: f.elements.fu.value.trim(), kp: f.elements.kp.value.trim(), lage: f.elements.lage.value.trim() };
  const id = BE.create(meta); openE(id);
  log(`Ereignis eröffnet: ${meta.name}, Einsatzleiter ${el}${meta.kp ? ', KP ' + meta.kp : ''}${meta.lage ? ' – ' + meta.lage : ''}`);
  f.reset(); delete f.dataset.init; $('#startErr').textContent = ''; go('dash');
});

/* ---------- 1 Dashboard ---------- */
function renderDash() {
  const c = s => S.A.filter(a => a.status === s).length;
  const ein = personal().filter(p => ['verfuegbar', 'einsatz'].includes(resOf(p.id, 'p').status)).length;
  const k = [['Offen', c('offen'), '#c8102e'], ['Reko', c('reko'), '#7a3db8'], ['Pendent', c('pendent'), '#f2b705'], ['In Bewältigung', c('bew'), '#1557c0'], ['Abgeschlossen', c('abg'), '#8f969c'], ['AdF verfügbar', freeP().length + ' / ' + ein, '#1d7a46']];
  $('#kpis').innerHTML = k.map(([l, v, col]) => `<div class="kpi" style="--c:${col}"><span>${l}</span><b>${v}</b></div>`).join('');
  const u = S.A.filter(a => a.status === 'offen' || a.status === 'pendent').sort(sortA).slice(0, 8);
  $('#urg').innerHTML = u.length ? u.map(a => `<li data-a="${a.id}"><span class="nr">${a.nr}</span><span class="tag ${prioCls(a.prio)}">${esc(a.prio)}</span><span><b>${esc(a.art)}</b> · ${esc(a.adresse)} <span class="tag s-${a.status}">${STL[a.status]}</span></span><span class="since" data-since="${a.tEin}"></span></li>`).join('')
    : '<li class="empty" style="display:block;cursor:default">Keine offenen oder pendenten Aufträge.</li>';
  const nci = Object.values(S.ci).filter(c => c.status === 'an').length;
  $('#ciBox').innerHTML = `<div><span class="flab">Anmeldung im Depot · Code</span><b class="bc" style="display:block;font-size:42px;line-height:1;letter-spacing:4px">${esc(S.meta.code || '----')}</b>
    <span class="hint" style="margin:0">${SY.mode === 'cloud' ? nci + ' per QR angemeldet' : 'QR-Anmeldung braucht die Synchronisation (config.js)'}</span></div><button id="bQR" class="dark" style="white-space:nowrap">QR-Code</button>`;
  $('#log').innerHTML = S.log.length ? [...S.log].reverse().map(l => `<li><time>${hm(l.t)}</time><span>${esc(l.text)}</span>${l.dev ? `<em>${esc(l.dev)}</em>` : ''}</li>`).join('') : '<li class="empty">Noch keine Einträge.</li>';
}
$('#urg').addEventListener('click', e => { const li = e.target.closest('[data-a]'); if (li) openDetail(li.dataset.a); });
$('#fJournal').addEventListener('submit', e => { e.preventDefault(); const i = e.target.elements.t, v = i.value.trim(); if (!v) return; log(v); i.value = ''; });

/* ---------- 2 Auftragserfassung ---------- */
const ERF = { quelle: 'Anruf', art: '', prio: 'P2', lat: null, lng: null, anh: [], edit: null, adrPicked: '' };
function erfReset(editId) {
  const f = $('#fErf'); f.reset(); $('#erfErr').textContent = ''; $('#sugg').hidden = true;
  const a = editId && A(editId);
  Object.assign(ERF, { quelle: 'Anruf', art: '', prio: 'P2', lat: null, lng: null, anh: [], edit: a ? a.id : null, adrPicked: '' });
  f.elements.tEin.value = hm(Date.now()); f.elements.artFrei.hidden = true;
  if (a) {
    Object.assign(ERF, { quelle: a.quelle, prio: a.prio, lat: a.lat, lng: a.lng, anh: clone(a.anh || []) });
    if (arten().includes(a.art)) ERF.art = a.art; else { ERF.art = '__other'; f.elements.artFrei.hidden = false; f.elements.artFrei.value = a.art; }
    f.elements.tEin.value = hm(a.tEin); f.elements.adresse.value = a.adresse; f.elements.melder.value = a.melder || ''; f.elements.tel.value = a.tel || ''; f.elements.text.value = a.text || '';
  }
  renderErf(); placeErfMarker(true);
}
function chipRow(id, list, cur) { $(id).innerHTML = list.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'on' : ''}">${esc(l)}</button>`).join(''); }
function renderErf() {
  chipRow('#cQuelle', QUELLEN.map(q => [q, q]), ERF.quelle);
  chipRow('#cArt', [...arten().map(a => [a, a]), ['__other', 'Andere …']], ERF.art);
  chipRow('#cPrio', PRIOS, ERF.prio);
  $('#erfTitle').textContent = ERF.edit ? 'Auftrag bearbeiten' : 'Neuer Auftrag';
  $('#erfNr').textContent = 'Auftrag Nr. ' + (ERF.edit ? A(ERF.edit).nr : nextNr());
  $('#erfNext').hidden = !!ERF.edit;
  $('#erfAnh').innerHTML = ERF.anh.map((f, i) => `<span class="file">${SVGF}<a href="#" data-of="${i}">${esc(f.name)}</a> <small>${kb(f.size)}${SY.mode === 'cloud' && !f.cloud ? ' · nur dieses Gerät' : ''}</small><button type="button" data-rm="${i}" aria-label="Anhang entfernen">${SVGX}</button></span>`).join('') +
    `<button type="button" class="add" id="bAnh"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>Datei / PDF</button>
     <button type="button" class="add" id="bFoto"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Foto aufnehmen</button>`;
  const r = [...S.A].sort((x, y) => y.tEin - x.tEin).slice(0, 6);
  $('#recent').innerHTML = r.length ? r.map(a => `<li data-a="${a.id}"><b>${a.nr}</b><span style="flex:1">${esc(a.art)} · ${esc(a.adresse)}</span><span class="bc" style="color:var(--mute)">${hm(a.tEin)}</span></li>`).join('') : '<li class="empty">Noch keine Aufträge.</li>';
}
$('#recent').addEventListener('click', e => { const li = e.target.closest('[data-a]'); if (li) openDetail(li.dataset.a); });
for (const [id, key] of [['#cQuelle', 'quelle'], ['#cArt', 'art'], ['#cPrio', 'prio']]) $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (!b) return; ERF[key] = b.dataset.v;
  if (key === 'art') { const i = $('#fErf').elements.artFrei; i.hidden = ERF.art !== '__other'; if (!i.hidden) i.focus(); }
  renderErf();
});
$('#erfAnh').addEventListener('click', e => {
  if (e.target.closest('#bAnh')) return $('#fileAnh').click();
  if (e.target.closest('#bFoto')) return $('#fileFoto').click();
  const o = e.target.closest('[data-of]'); if (o) { e.preventDefault(); return openFile(ERF.anh[+o.dataset.of]); }
  const r = e.target.closest('[data-rm]'); if (r) { const f = ERF.anh.splice(+r.dataset.rm, 1)[0]; if (f && f.neu) FILES.del(f.id).catch(() => {}); renderErf(); }
});
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|heic|heif|webp)/.test(file.type) || file.size < 1200000) return file;
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const sc = Math.min(1, 1800 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
    return b ? new File([b], (file.name || 'Foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file; } catch (e) { return file; }
}
async function addFiles(list) {
  for (let file of list) {
    file = await shrinkImage(file);
    if (file.size > 25 * 1048576) { $('#erfErr').textContent = `${file.name} ist zu gross (max. 25 MB).`; continue; }
    if (SY.mode === 'cloud' && file.size > FILE_MAX) $('#erfErr').textContent = `${file.name} ist grösser als 5 MB – bleibt nur auf diesem Gerät (nicht auf dem Handy sichtbar).`;
    const id = 'f' + uid(); try { await FILES.put(id, file); ERF.anh.push({ id, name: file.name || 'Foto.jpg', type: file.type, size: file.size, neu: true, cloud: SY.mode === 'cloud' && file.size <= FILE_MAX }); }
    catch (e) { $('#erfErr').textContent = 'Anhang konnte nicht gespeichert werden.'; }
  }
  renderErf();
}
for (const id of ['#fileAnh', '#fileFoto']) $(id).addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('#erfCancel').onclick = () => { ERF.anh.filter(f => f.neu).forEach(f => FILES.del(f.id).catch(() => {})); go(ERF.edit ? 'lage' : 'dash'); };
function parseTime(s, base) { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); if (!m) return base; const d = new Date(base); d.setHours(+m[1], +m[2], 0, 0); let t = d.getTime(); if (t - Date.now() > 3600000) t -= 86400000; return t; }
$('#fErf').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, mode = e.submitter ? e.submitter.value : 'save';
  const art = ERF.art === '__other' ? f.elements.artFrei.value.trim() : ERF.art, adresse = f.elements.adresse.value.trim();
  if (!art) { $('#erfErr').textContent = 'Bitte die Art des Auftrags wählen.'; return; }
  if (!adresse) { $('#erfErr').textContent = 'Bitte Adresse oder Ort eintragen.'; f.elements.adresse.focus(); return; }
  const anh = ERF.anh.map(({ neu, ...x }) => x), upl = ERF.anh.filter(x => x.neu && x.cloud);
  const fields = { quelle: ERF.quelle, art, prio: ERF.prio, adresse, lat: ERF.lat, lng: ERF.lng, melder: f.elements.melder.value.trim(), tel: f.elements.tel.value.trim(), text: f.elements.text.value.trim(), anh };
  if (ERF.edit) { const a = A(ERF.edit); Object.assign(a, fields, { tEin: parseTime(f.elements.tEin.value, a.tEin) }); saveA(a); upl.forEach(x => uploadFile(x, a.id)); log(`Auftrag ${a.nr} geändert`); ERF.anh.forEach(x => x.neu = false); go('lage'); return; }
  const a = { id: uid(), nr: nextNr(), tEin: parseTime(f.elements.tEin.value, Date.now()), ...fields, status: 'offen', sub: null, assigned: [] };
  saveA(a); upl.forEach(x => uploadFile(x, a.id));
  log(`Auftrag ${a.nr} erfasst (${a.quelle}, ${a.prio}): ${a.art} · ${a.adresse}${anh.length ? ` · ${anh.length} Anhang` + (anh.length > 1 ? 'e' : '') : ''}`);
  ERF.anh = [];
  if (mode === 'next') { erfReset(); f.elements.adresse.focus(); $('#erfErr').style.color = 'var(--ok)'; $('#erfErr').textContent = `Auftrag ${a.nr} gespeichert.`; setTimeout(() => { $('#erfErr').textContent = ''; $('#erfErr').style.color = ''; }, 3000); }
  else go('dash');
});

/* Adresssuche (geo.admin.ch) */
let sT = null, sQ = 0;
const adrIn = $('#fErf').elements.adresse;
adrIn.addEventListener('input', () => {
  clearTimeout(sT); const q = adrIn.value.trim(); if (q.length < 3 || !navigator.onLine) { $('#sugg').hidden = true; return; }
  sT = setTimeout(async () => {
    const my = ++sQ;
    try {
      const r = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(q)}&type=locations&origins=address,gg25,gazetteer&limit=6&sr=4326`);
      const j = await r.json(); if (my !== sQ) return;
      const res = (j.results || []).map(x => ({ label: String(x.attrs.label || '').replace(/<[^>]+>/g, '').trim(), lat: x.attrs.lat, lng: x.attrs.lon })).filter(x => x.label);
      const box = $('#sugg');
      if (!res.length) { box.hidden = true; return; }
      box.innerHTML = res.map((x, i) => `<button type="button" class="${i ? '' : 'first'}" data-i="${i}">${esc(x.label)}</button>`).join('') + '<div class="sh">Vorschläge von geo.admin.ch</div>';
      box._res = res; box.hidden = false;
    } catch (e) { $('#sugg').hidden = true; }
  }, 300);
});
adrIn.addEventListener('keydown', e => { const box = $('#sugg'); if (e.key === 'Enter' && !box.hidden && box._res) { e.preventDefault(); pickAdr(box._res[0]); } if (e.key === 'Escape') box.hidden = true; });
adrIn.addEventListener('blur', () => setTimeout(() => $('#sugg').hidden = true, 200));
$('#sugg').addEventListener('pointerdown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pickAdr($('#sugg')._res[+b.dataset.i]); } });
function pickAdr(x) { adrIn.value = x.label; ERF.lat = x.lat; ERF.lng = x.lng; $('#sugg').hidden = true; placeErfMarker(true); }

/* ---------- Karten ---------- */
const KS = CFG.karte || { lat: 47.4655, lng: 9.5905, zoom: 13 };
const TILES = {
  karte: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  luft: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'
};
const ATTR = '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const mkTiles = k => L.tileLayer(TILES[k], { maxZoom: 19, maxNativeZoom: k === 'karte' ? 18 : 19, attribution: ATTR });
let erfMap = null, erfMk = null;
function initErfMap() {
  if (!window.L) { $('#erfMap').innerHTML = '<p class="empty">Karte nicht geladen (App einmal mit Internet öffnen).</p>'; return; }
  if (!erfMap) {
    erfMap = L.map('erfMap', { zoomControl: true, attributionControl: true }).setView([KS.lat, KS.lng], KS.zoom);
    mkTiles('karte').addTo(erfMap);
    erfMap.on('click', ev => { ERF.lat = +ev.latlng.lat.toFixed(6); ERF.lng = +ev.latlng.lng.toFixed(6); placeErfMarker(false); });
  }
  erfMap.invalidateSize(); placeErfMarker(true);
}
function placeErfMarker(center) {
  if (!erfMap) return;
  if (erfMk) { erfMk.remove(); erfMk = null; }
  if (ERF.lat != null) { erfMk = L.marker([ERF.lat, ERF.lng], { icon: pinIcon('offen', '!', false) }).addTo(erfMap); if (center) erfMap.setView([ERF.lat, ERF.lng], 17); }
  else if (center) erfMap.setView([KS.lat, KS.lng], KS.zoom);
  $('#erfMapHint').textContent = ERF.lat != null ? 'Punkt gesetzt. Zum Korrigieren auf die Karte tippen.' : 'Noch kein Punkt: Adresse aus den Vorschlägen wählen oder auf die Karte tippen.';
}
function pinIcon(st, nr, sel) { return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="pin${sel ? ' sel' : ''}" style="background:${PINC[st]};${st === 'pendent' ? 'color:#1a1a1a' : ''}">${esc(nr)}</div>` }); }
let lageMap = null, lageLayer = null, baseK = null, baseL = null;
function initLageMap() {
  if (!window.L) { $('#lageMap').innerHTML = '<p class="empty">Karte nicht geladen (App einmal mit Internet öffnen).</p>'; return; }
  if (!lageMap) {
    lageMap = L.map('lageMap').setView([KS.lat, KS.lng], KS.zoom);
    baseK = mkTiles('karte').addTo(lageMap); baseL = mkTiles('luft');
    lageLayer = L.layerGroup().addTo(lageMap);
    const leg = L.control({ position: 'bottomleft' });
    leg.onAdd = () => { const d = L.DomUtil.create('div', 'legend'); d.innerHTML = [['offen', 'Offen'], ['reko', 'Reko'], ['pendent', 'Pendent'], ['disp', 'Disponiert'], ['vorort', 'Vor Ort tätig'], ['abg', 'Abgeschlossen']].map(([k, l]) => `<div><i style="background:${PINC[k]}"></i>${l}</div>`).join(''); return d; };
    leg.addTo(lageMap);
    const sw = L.control({ position: 'topright' });
    sw.onAdd = () => { const d = L.DomUtil.create('div', 'mapsw'); d.innerHTML = '<button class="on" data-b="k">Karte</button><button data-b="l">Luftbild</button>'; L.DomEvent.disableClickPropagation(d);
      d.onclick = e => { const b = e.target.closest('[data-b]'); if (!b) return; d.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        if (b.dataset.b === 'l') { lageMap.removeLayer(baseK); baseL.addTo(lageMap); } else { lageMap.removeLayer(baseL); baseK.addTo(lageMap); } }; return d; };
    sw.addTo(lageMap);
    lageMap._fitted = false;
  }
  lageMap.invalidateSize(); drawPins();
}
function drawPins() {
  if (!lageMap) return; lageLayer.clearLayers();
  const pts = [];
  for (const a of filtA()) { if (a.lat == null) continue; pts.push([a.lat, a.lng]);
    L.marker([a.lat, a.lng], { icon: pinIcon(subOf(a), a.nr, a.id === S.sel), zIndexOffset: a.id === S.sel ? 1000 : 0, title: `${a.nr} ${a.art}` }).on('click', () => openDetail(a.id)).addTo(lageLayer); }
  if (!lageMap._fitted && pts.length) { lageMap.fitBounds(pts, { padding: [40, 40], maxZoom: 16 }); lageMap._fitted = true; }
}

/* ---------- 3 Spalten ---------- */
function cardHtml(a) {
  const st = subOf(a); let extra = '';
  if (a.status === 'reko' && a.reko) extra += `<span class="tag s-reko">Reko: ${esc(a.reko.wer.join(', '))}</span>${a.reko.vorOrt ? `<span class="tag s-vorort">vor Ort ${hm(a.reko.vorOrt)}</span>` : ''}`;
  if (a.status === 'pendent') extra += a.rekoDone ? `<span class="tag s-reko">Reko erfolgt${a.reko ? ' · ' + esc(a.reko.wer.join(', ')) : ''}</span>` : '<span class="tag s-ohne">Ohne Reko</span>';
  if (a.status === 'bew') extra += st === 'vorort' ? `<span class="tag s-vorort">Vor Ort tätig · seit ${hm(a.tVorOrt)}</span>` : '<span class="tag s-disp">Disponiert</span>';
  let inf = '';
  if (a.status === 'offen') inf = [a.quelle + (a.melder ? ' · ' + a.melder : '')].join('');
  const nA = (a.anh || []).length; if (nA) inf = [inf, '📎 ' + nA].filter(Boolean).join(' · ');
  if (a.status === 'pendent' && a.bedarf) inf = 'Benötigt: ' + (bedarfText(a.bedarf) || '–') + (a.dauer ? ' · ca. ' + a.dauer : '');
  if (a.status === 'bew') inf = assignedText(a);
  if (a.status === 'abg' && a.abschluss) inf = a.abschluss;
  const ready = isReady(a);
  return `<button type="button" class="acard${ready ? ' ready' : ''}${a.id === S.sel ? ' sel' : ''}" data-a="${a.id}" id="c-${a.id}">
    <span class="h"><span class="nr">${a.nr}</span><span class="tag ${prioCls(a.prio)}">${esc(a.prio)}</span><time>${hm(a.tEin)}</time></span>
    <b>${esc(a.art)}</b><span class="ad">${esc(a.adresse)}</span>${extra ? `<span class="row" style="gap:4px">${extra}</span>` : ''}
    ${inf ? `<span class="inf">${esc(inf)}</span>` : ''}${ready ? '<span class="go">Mittel verfügbar – disponieren</span>' : ''}</button>`;
}
function renderBoard() {
  $('#board').innerHTML = COLS.map(([k, t, c]) => {
    let l = S.A.filter(a => a.status === k);
    l = k === 'abg' ? l.sort((x, y) => (y.tAbg || 0) - (x.tAbg || 0)) : l.sort(sortA);
    return `<section class="col" style="--c:${c}"><h3><span>${t}</span><i>${l.length}</i></h3><div class="cards">${l.map(cardHtml).join('') || '<p class="hint" style="padding:0 6px">–</p>'}</div></section>`;
  }).join('');
}
$('#board').addEventListener('click', e => { const c = e.target.closest('[data-a]'); if (c) openDetail(c.dataset.a); });

/* ---------- 3b Karte ---------- */
function filtA() { return S.A.filter(a => S.filt === 'alle' ? a.status !== 'abg' : a.status === S.filt).sort(sortA); }
function renderKarte() {
  const n = s => S.A.filter(a => a.status === s).length;
  $('#filt').innerHTML = [['alle', 'Aktive ' + S.A.filter(a => a.status !== 'abg').length], ...COLS.map(([k, t]) => [k, (k === 'bew' ? 'In Bew.' : t) + ' ' + n(k)])]
    .map(([k, l]) => `<button data-f="${k}" class="${S.filt === k ? 'on' : ''}">${l}</button>`).join('');
  const l = filtA();
  $('#mlist').innerHTML = l.map(cardHtml).join('') || '<p class="hint">Keine Aufträge.</p>';
  drawPins();
}
$('#filt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.filt = b.dataset.f; if (lageMap) lageMap._fitted = false; renderKarte(); });
$('#mlist').addEventListener('click', e => { const c = e.target.closest('[data-a]'); if (!c) return; const a = A(c.dataset.a); S.sel = a.id;
  if (a.lat != null && lageMap) lageMap.setView([a.lat, a.lng], Math.max(lageMap.getZoom(), 16)); openDetail(a.id); });

/* ---------- 4 Personal & Mittel ---------- */
const PST = { abwesend: 'Nicht eingerückt', verfuegbar: 'Verfügbar', einsatz: 'Im Einsatz', abgetreten: 'Abgetreten', ausser: 'Ausser Betrieb' };
function renderMittel() {
  const ps = personal(), cnt = s => ps.filter(p => resOf(p.id, 'p').status === s).length;
  $('#pSums').innerHTML = [['Eingerückt', cnt('verfuegbar') + cnt('einsatz'), ''], ['Verfügbar', cnt('verfuegbar'), 'var(--ok)'], ['Im Einsatz', cnt('einsatz'), 'var(--blue)'], ['Abgetreten', cnt('abgetreten'), 'var(--mute)']]
    .map(([l, v, c]) => `<div><span>${l}</span><b style="color:${c || 'inherit'}">${v}</b></div>`).join('');
  const ord = { einsatz: 0, verfuegbar: 1, abgetreten: 2, abwesend: 3 };
  $('#pList').innerHTML = ps.length ? [...ps].sort((x, y) => ord[resOf(x.id, 'p').status] - ord[resOf(y.id, 'p').status] || x.name.localeCompare(y.name, 'de')).map(p => {
    const r = resOf(p.id, 'p'), a = r.auftrag && A(r.auftrag);
    const b = { abwesend: '<button data-pa="in">Einrücken</button>', verfuegbar: '<button data-pa="out" class="ghost">Abtreten</button>', abgetreten: '<button data-pa="in">Wieder einrücken</button>',
      einsatz: a ? `<button data-a="${a.id}" class="ghost">Auftrag ${a.nr}${a.status === 'reko' ? ' (Reko)' : ''}</button>` : '<button data-pa="in">Freigeben</button>' }[r.status]
      + (r.status === 'verfuegbar' ? '<button data-pa="zu" class="blue">Zuweisen</button>' : '');
    const ci = ciOf(p.id), det = ci ? [ci.masch && !p.gast ? 'Maschinist' : '', ci.tel ? 'Tel. ' + ci.tel : '', p.gast ? 'nicht in Stammliste' : ''].filter(Boolean).join(' · ') : '';
    return `<li data-p="${p.id}"><span class="rg">${esc(p.rang || '')}</span><span><b style="font-weight:600">${esc(p.name)} ${esc(p.vorname)}</b> <span class="fk">${esc(p.fkt || '')}</span>${ci ? `<br><span class="fk"><span class="tag" title="per QR-Code">QR ${ci.status === 'an' ? hm(ci.t) : 'ab ' + hm(ci.t)}</span> ${esc(det)}</span>` : ''}</span><span class="acts"><span class="tag st-${r.status}">${PST[r.status]}</span>${b}</span></li>`;
  }).join('') : '<li class="empty">Noch kein Personal erfasst (Einstellungen → Stammdaten).</li>';
  $('#mGrid').innerHTML = mittel().map(m => {
    const r = resOf(m.id, 'm'), a = r.auftrag && A(r.auftrag);
    const b = r.status === 'verfuegbar' ? '<button data-ma="aus" class="ghost">Ausser Betrieb</button>' : r.status === 'ausser' ? '<button data-ma="ok">Wieder verfügbar</button>' : (a ? `<button data-a="${a.id}" class="ghost">Auftrag ${a.nr}</button>` : '<button data-ma="ok">Freigeben</button>');
    const inf = r.status === 'einsatz' && a ? `Auftrag ${a.nr} · ${a.adresse}` : (m.info || m.gattung || '');
    return `<div class="mcard${r.status === 'verfuegbar' ? ' av' : ''}" data-m="${m.id}"><div class="h"><b>${esc(m.name)}</b><span class="tag st-${r.status}">${PST[r.status]}</span></div><span class="inf">${esc(inf)}</span><div class="acts">${b}</div></div>`;
  }).join('') || '<p class="empty">Noch keine Fahrzeuge erfasst.</p>';
}
$('#pList').addEventListener('click', e => {
  const ab = e.target.closest('[data-a]'); if (ab) return openDetail(ab.dataset.a);
  const b = e.target.closest('[data-pa]'); if (!b) return; const id = b.closest('[data-p]').dataset.p, p = personal().find(x => x.id === id);
  if (b.dataset.pa === 'zu') return openZu(id);
  if (b.dataset.pa === 'in') { setRes(id, 'p', { status: 'verfuegbar', auftrag: null }); log(`${pName(p)} eingerückt`); }
  else { setRes(id, 'p', { status: 'abgetreten', auftrag: null }); log(`${pName(p)} abgetreten`); }
  render();
});
$('#mGrid').addEventListener('click', e => {
  const ab = e.target.closest('[data-a]'); if (ab) return openDetail(ab.dataset.a);
  const b = e.target.closest('[data-ma]'); if (!b) return; const id = b.closest('[data-m]').dataset.m, m = mittel().find(x => x.id === id);
  if (b.dataset.ma === 'aus') { setRes(id, 'm', { status: 'ausser', auftrag: null }); log(`${m.name} ausser Betrieb`); } else { setRes(id, 'm', { status: 'verfuegbar', auftrag: null }); log(`${m.name} wieder verfügbar`); }
  render();
});
$('#bAllIn').onclick = () => { const l = personal().filter(p => resOf(p.id, 'p').status === 'abwesend'); if (!l.length) return;
  confirmBox('Alle einrücken?', `${l.length} Personen werden als eingerückt und verfügbar gemeldet.`, () => { l.forEach(p => setRes(p.id, 'p', { status: 'verfuegbar', auftrag: null })); log(`${l.length} AdF eingerückt`); render(); }); };

/* ---------- Auftrag: Detail & Aktionen ---------- */
function openDetail(id) { S.sel = id; renderDetail(); if (!$('#dA').open) $('#dA').showModal(); if (S.view === 'karte') drawPins(); }
$('#dA').addEventListener('close', () => { if (S.view === 'karte') drawPins(); });
function renderDetail() {
  const a = A(S.sel); if (!a) { $('#dA').close(); return; }
  const st = subOf(a), stTxt = a.status === 'bew' ? (st === 'vorort' ? 'Vor Ort tätig' : 'Disponiert') : STL[a.status];
  const rows = [['Eingang', `${hm(a.tEin)} · ${a.quelle}`], ['Meldende Person', [a.melder, a.tel].filter(Boolean).join(' · ')], ['Beschreibung', a.text],
    ['Reko', a.reko ? `${a.reko.wer.join(', ')} · ${hm(a.reko.t)}${a.reko.vorOrt ? ' · vor Ort ' + hm(a.reko.vorOrt) : ''}${a.reko.tEnd ? ' · fertig ' + hm(a.reko.tEnd) : ''}` : ''], ['Lagebeurteilung', a.lageReko],
    ['Benötigt', a.bedarf ? bedarfText(a.bedarf) + (a.dauer ? ' · ca. ' + a.dauer : '') : ''], ['Zugewiesen', a.status === 'bew' ? assignedText(a) : ''],
    ['Disponiert', a.tDisp && a.status !== 'pendent' && a.status !== 'offen' ? hm(a.tDisp) : ''], ['Vor Ort', a.tVorOrt ? hm(a.tVorOrt) : ''], ['Abgeschlossen', a.tAbg && a.status === 'abg' ? hm(a.tAbg) + (a.abschluss ? ' · ' + a.abschluss : '') : '']]
    .filter(r => r[1]);
  const B = (act, label, cls) => `<button data-act="${act}" class="${cls || ''}">${label}</button>`;
  const acts = {
    offen: [B('reko', 'Reko schicken', 'rekob'), B('ohne', 'Ohne Reko → Pendent', 'warnb'), B('disp', 'Direkt disponieren', 'blue')],
    reko: [B('rekoEnd', 'Reko abschliessen', 'rekob'), B('rekoCancel', 'Reko abbrechen', 'ghost')],
    pendent: [B('disp', 'Disponieren', isReady(a) ? 'okb' : 'blue'), B('bedarf', 'Benötigte Mittel ändern'), B('abg', 'Ohne Einsatz abschliessen', 'ghost')],
    bew: [...(st === 'disp' ? [B('vorort', 'Vor Ort', 'blue')] : []), B('disp', 'Mittel ändern'), B('abg', 'Abschliessen', 'okb'), B('back', 'Zurück nach Pendent', 'ghost')],
    abg: [B('reopen', 'Wieder öffnen')]
  }[a.status];
  $('#dABody').innerHTML = `<div class="dh"><span class="nr">${a.nr}</span><div style="flex:1"><h3>${esc(a.art)}</h3><p>${esc(a.adresse)}</p></div><span class="tag ${prioCls(a.prio)}">${esc(a.prio)}</span><span class="tag s-${st}">${stTxt}</span></div>
    <dl class="dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${(a.anh || []).length ? `<span class="flab">Anhänge</span><div class="anh">${a.anh.map((f, i) => `<button class="file" data-file="${i}">${SVGF}${esc(f.name)} <small>${kb(f.size)}</small></button>`).join('')}</div>` : ''}
    ${(a.fotos || []).length ? `<span class="flab">Fotos vom Handy</span><div class="anh">${a.fotos.map((f, i) => `<button class="file" data-foto="${i}" style="padding:4px"><img src="${f.data}" alt="Foto ${i + 1}" style="height:70px;border-radius:6px"> <small>${hm(f.t)} ${esc(f.von || '')}</small></button>`).join('')}</div>` : ''}
    ${isReady(a) ? '<div class="note ok"><b>Die benötigten Mittel sind verfügbar.</b></div>' : ''}
    <div class="acts2">${acts.join('')}</div>
    <div class="dbtn"><button data-act="edit" class="ghost">Bearbeiten</button>${a.lat != null ? '<button data-act="map" class="ghost">Auf Karte zeigen</button>' : ''}<button data-act="close" class="dark">Schliessen</button></div>`;
}
$('#dABody').addEventListener('click', e => {
  const fb = e.target.closest('[data-file]'); if (fb) return openFile(A(S.sel).anh[+fb.dataset.file]);
  const fo = e.target.closest('[data-foto]'); if (fo) { const w = window.open(); if (w) w.document.write(`<img src="${A(S.sel).fotos[+fo.dataset.foto].data}" style="max-width:100%">`); return; }
  const b = e.target.closest('[data-act]'); if (!b) return; const a = A(S.sel), act = b.dataset.act, now = Date.now();
  if (act === 'close') return $('#dA').close();
  if (act === 'edit') { $('#dA').close(); return go('erfassen', { edit: a.id }); }
  if (act === 'map') { $('#dA').close(); go('karte'); setTimeout(() => lageMap && lageMap.setView([a.lat, a.lng], 17), 80); return; }
  if (act === 'reko') return openPick(a, 'reko');
  if (act === 'ohne') return openBed(a, 'ohne');
  if (act === 'rekoEnd') return openBed(a, 'reko');
  if (act === 'bedarf') return openBed(a, 'edit');
  if (act === 'disp') return openPick(a, 'disp');
  if (act === 'abg') return openAbg(a);
  if (act === 'rekoCancel') return confirmBox('Reko abbrechen?', 'Der Auftrag geht zurück nach «Offen», die Reko-Leute werden wieder verfügbar.', () => {
    release(a, a.reko ? a.reko.ids : []); a.status = 'offen'; a.reko = null; saveA(a); log(`Auftrag ${a.nr}: Reko abgebrochen`); });
  if (act === 'vorort') { a.sub = 'vorort'; a.tVorOrt = now; saveA(a); log(`Auftrag ${a.nr}: vor Ort tätig`); return; }
  if (act === 'back') return confirmBox('Zurück nach «Pendent»?', 'Alle zugewiesenen Leute und Mittel werden wieder verfügbar.', () => {
    release(a); a.assigned = []; a.extra = ''; a.status = 'pendent'; a.sub = null; a.tVorOrt = null; saveA(a); log(`Auftrag ${a.nr}: zurück nach Pendent, Mittel freigegeben`); });
  if (act === 'reopen') { a.status = 'offen'; a.tAbg = null; saveA(a); log(`Auftrag ${a.nr} wieder geöffnet`); }
});

/* Zuweisen von der Person aus */
let ZU = null;
function openZu(pid) {
  const p = personal().find(x => x.id === pid); ZU = pid;
  $('#zuTitle').textContent = pName(p) + ' zuweisen';
  const l = S.A.filter(a => a.status !== 'abg').sort((x, y) => ['offen', 'reko', 'pendent', 'bew'].indexOf(x.status) - ['offen', 'reko', 'pendent', 'bew'].indexOf(y.status) || sortA(x, y));
  $('#zuList').innerHTML = l.map(a => {
    const st = subOf(a), lab = a.status === 'bew' ? (st === 'vorort' ? 'Vor Ort tätig' : 'Disponiert') : STL[a.status];
    const btns = a.status === 'offen' ? `<button data-zu="reko" data-a="${a.id}" class="rekob">Als Reko</button><button data-zu="disp" data-a="${a.id}" class="blue">Disponieren</button>`
      : a.status === 'reko' ? `<button data-zu="reko" data-a="${a.id}" class="rekob">Zur Reko dazu</button>` : `<button data-zu="disp" data-a="${a.id}" class="blue">${a.status === 'bew' ? 'Dazu disponieren' : 'Disponieren'}</button>`;
    return `<li><div><b>${a.nr} · ${esc(a.art)}</b> <span class="tag ${prioCls(a.prio)}">${esc(a.prio)}</span> <span class="tag s-${st}">${lab}</span><br><span>${esc(a.adresse)}${a.bedarf ? ' · Benötigt: ' + esc(bedarfText(a.bedarf)) : ''}</span></div><span class="row">${btns}</span></li>`;
  }).join('') || '<li><span>Keine offenen Aufträge.</span></li>';
  $('#dZu').showModal();
}
$('#zuList').addEventListener('click', e => {
  const b = e.target.closest('[data-zu]'); if (!b) return; const a = A(b.dataset.a), pid = ZU, p = personal().find(x => x.id === pid), now = Date.now();
  $('#dZu').close();
  if (resOf(pid, 'p').status !== 'verfuegbar') return;
  setRes(pid, 'p', { status: 'einsatz', auftrag: a.id });
  if (b.dataset.zu === 'reko') {
    if (a.status === 'reko' && a.reko) { a.reko.ids = [...a.reko.ids, pid]; a.reko.wer = [...a.reko.wer, resName(pid)]; a.reko.lead = pickLead(a.reko.ids); log(`Auftrag ${a.nr}: ${pName(p)} zur Reko dazu`); }
    else { a.status = 'reko'; a.reko = { ids: [pid], wer: [resName(pid)], t: now, lead: pid }; log(`Auftrag ${a.nr}: Reko durch ${pName(p)}`); }
  } else {
    a.assigned = [...(a.assigned || []), pid]; a.lead = pickLead(a.assigned);
    if (a.status !== 'bew') { a.status = 'bew'; a.sub = 'disp'; a.tDisp = now; }
    log(`Auftrag ${a.nr}: ${pName(p)} disponiert`);
  }
  saveA(a); render();
});

/* Reko schicken / Disponieren */
let PK = null;
function openPick(a, mode) {
  const cur = new Set(mode === 'disp' ? (a.assigned || []) : []);
  const ordered = mode === 'disp' && a.lead && cur.has(a.lead) ? [a.lead, ...[...cur].filter(i => i !== a.lead)] : [...cur];
  PK = { id: a.id, mode, sel: new Set(ordered) };
  $('#pkTitle').textContent = `Auftrag ${a.nr}: ${mode === 'reko' ? 'Reko schicken' : a.status === 'bew' ? 'Mittel ändern' : 'Disponieren'}`;
  $('#pkMW').hidden = mode === 'reko'; $('#pkExtraL').hidden = mode === 'reko'; $('#pkPL').textContent = mode === 'reko' ? 'Wer macht die Reko?' : 'Personal';
  $('#fPick').elements.extra.value = mode === 'disp' ? (a.extra || '') : '';
  const bd = $('#pkBedarf'); bd.hidden = !(mode === 'disp' && a.bedarf); if (!bd.hidden) bd.textContent = 'Benötigt: ' + (bedarfText(a.bedarf) || '–') + (a.dauer ? ' · ca. ' + a.dauer : '');
  $('#pkErr').textContent = ''; renderPick(); $('#dPick').showModal();
}
function renderPick() {
  const a = A(PK.id), mine = id => (a.assigned || []).includes(id);
  const ps = personal().filter(p => resOf(p.id, 'p').status === 'verfuegbar' || (PK.mode === 'disp' && mine(p.id)));
  const ms = mittel().filter(m => resOf(m.id, 'm').status === 'verfuegbar' || (PK.mode === 'disp' && mine(m.id)));
  const lead = pickLead([...PK.sel]);
  $('#pkP').innerHTML = ps.map(p => `<button type="button" data-id="${p.id}" class="${PK.sel.has(p.id) ? 'on' : ''}">${p.id === lead ? '★ ' : ''}${esc(pName(p))}${ciOf(p.id) && ciOf(p.id).status === 'an' ? ' <span class="x">📱</span>' : ''}${(p.fkt || (ciOf(p.id) || {}).masch) ? ` <span class="x">${esc(p.fkt || 'Maschinist')}</span>` : ''}</button>`).join('') || '<span class="hint">Niemand verfügbar. Personal unter «Personal & Mittel» einrücken.</span>';
  $('#pkM').innerHTML = ms.map(m => `<button type="button" data-id="${m.id}" class="${PK.sel.has(m.id) ? 'on' : ''}">${esc(m.name)}</button>`).join('') || '<span class="hint">Keine Mittel verfügbar.</span>';
  $('#pkLead').textContent = lead ? '★ Führung: ' + pName(personal().find(p => p.id === lead)) + ' – macht die Rückmeldungen auf dem Handy. Es führt der höchste Rang (Of vor Uof vor Soldat), bei gleichem Rang wer zuerst gewählt wurde.' : 'Es führt der höchste Rang (★).';
  const np = ps.filter(p => PK.sel.has(p.id)).length; $('#pkOk').textContent = PK.mode === 'reko' ? 'Reko schicken' : `Disponieren${np ? ' (' + np + ' AdF)' : ''}`;
}
for (const id of ['#pkP', '#pkM']) $(id).addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (!b) return; const i = b.dataset.id; PK.sel.has(i) ? PK.sel.delete(i) : PK.sel.add(i); renderPick(); });
$('#fPick').addEventListener('submit', e => {
  if (!e.submitter || e.submitter.value !== 'ok') return;
  const a = A(PK.id), ids = [...PK.sel], extra = e.target.elements.extra.value.trim(), now = Date.now();
  if (!ids.length && !(PK.mode === 'disp' && extra)) { e.preventDefault(); $('#pkErr').textContent = 'Bitte mindestens eine Person oder ein Mittel wählen.'; return; }
  if (PK.mode === 'reko') {
    ids.forEach(id => setRes(id, 'p', { status: 'einsatz', auftrag: a.id }));
    const wer = ids.map(resName); a.status = 'reko'; a.reko = { ids, wer, t: now, lead: pickLead(ids) }; saveA(a); log(`Auftrag ${a.nr}: Reko durch ${wer.join(', ')}`); return;
  }
  const before = a.assigned || [], removed = before.filter(i => !ids.includes(i));
  release(a, removed);
  ids.forEach(id => setRes(id, personal().some(p => p.id === id) ? 'p' : 'm', { status: 'einsatz', auftrag: a.id }));
  const wasBew = a.status === 'bew'; a.assigned = ids; a.extra = extra; a.lead = pickLead(ids);
  if (!wasBew) { a.status = 'bew'; a.sub = 'disp'; a.tDisp = now; }
  saveA(a); log(`Auftrag ${a.nr} ${wasBew ? 'Mittel geändert' : 'disponiert'}: ${assignedText(a) || '–'}`);
});

/* Reko-Ergebnis / Benötigte Mittel */
let BD = null;
function openBed(a, mode) {
  const b = a.bedarf || { adf: 0, m: {} };
  BD = { id: a.id, mode, adf: b.adf || 0, m: { ...(b.m || {}) }, dauer: a.dauer || '', prio: a.prio };
  $('#bdTitle').textContent = `Auftrag ${a.nr}: ${mode === 'reko' ? 'Reko abschliessen' : mode === 'ohne' ? 'Ohne Reko nach «Pendent»' : 'Benötigte Mittel'}`;
  $('#bdLageL').firstChild.textContent = mode === 'reko' ? 'Lagebeurteilung' : 'Bemerkung';
  $('#fBed').elements.lage.value = a.lageReko || '';
  $('#bdNone').hidden = mode !== 'reko'; $('#bdDisp').hidden = mode === 'edit';
  $('#bdPend').textContent = mode === 'edit' ? 'Speichern' : 'In «Pendent» setzen';
  renderBed(); $('#dBed').showModal();
}
function renderBed() {
  $('#adfN').textContent = BD.adf;
  $('#bdM').innerHTML = gattungen().map(g => { const n = BD.m[g] || 0, tot = mittel().filter(m => (m.gattung || m.name) === g).length;
    return `<button type="button" data-g="${esc(g)}" class="${n ? 'on' : ''}">${n > 1 ? n + '× ' : ''}${esc(g)}</button>`; }).join('');
  chipRow('#bdD', DAUER.map(d => [d, d]), BD.dauer); chipRow('#bdP', PRIOS.map(([p]) => [p, p]), BD.prio);
  const fake = { status: 'pendent', bedarf: { adf: BD.adf, m: BD.m } }, note = $('#bdNote');
  const hasNeed = BD.adf || Object.values(BD.m).some(Boolean);
  note.hidden = !hasNeed || BD.mode === 'edit';
  if (!note.hidden) { const ok = isReady(fake); note.className = 'note' + (ok ? ' ok' : '');
    note.textContent = ok ? 'Die benötigten Mittel sind im Moment verfügbar – du kannst sofort disponieren.' : 'Nicht alle benötigten Mittel sind im Moment verfügbar. Der Auftrag kommt in «Pendent», bis sie frei sind.'; }
}
$('#adfMinus').onclick = () => { BD.adf = Math.max(0, BD.adf - 1); renderBed(); };
$('#adfPlus').onclick = () => { BD.adf++; renderBed(); };
$('#bdM').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; const g = b.dataset.g, tot = mittel().filter(m => (m.gattung || m.name) === g).length;
  const n = BD.m[g] || 0; BD.m[g] = n >= Math.max(1, tot) ? 0 : n + 1; renderBed(); });
$('#bdD').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { BD.dauer = BD.dauer === b.dataset.v ? '' : b.dataset.v; renderBed(); } });
$('#bdP').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { BD.prio = b.dataset.v; renderBed(); } });
$('#fBed').addEventListener('submit', e => {
  const v = e.submitter && e.submitter.value; if (!v || v === 'cancel') return;
  const a = A(BD.id), now = Date.now(), lage = e.target.elements.lage.value.trim();
  Object.keys(BD.m).forEach(k => { if (!BD.m[k]) delete BD.m[k]; });
  a.bedarf = { adf: BD.adf, m: BD.m }; a.dauer = BD.dauer; if (a.prio !== BD.prio) log(`Auftrag ${a.nr}: Dringlichkeit ${a.prio} → ${BD.prio}`); a.prio = BD.prio; a.lageReko = lage;
  if (BD.mode === 'reko') { release(a, a.reko ? a.reko.ids : []); a.rekoDone = true; if (a.reko) a.reko.tEnd = now; }
  if (BD.mode === 'edit') { saveA(a); log(`Auftrag ${a.nr}: benötigte Mittel ${bedarfText(a.bedarf) || '–'}`); return; }
  if (v === 'none') { a.status = 'abg'; a.tAbg = now; a.abschluss = 'Kein Einsatz nötig' + (lage ? ': ' + lage : ''); saveA(a); log(`Auftrag ${a.nr}: Reko – kein Einsatz nötig, abgeschlossen`); return; }
  a.status = 'pendent'; a.ohneReko = BD.mode === 'ohne'; saveA(a);
  log(`Auftrag ${a.nr}: ${BD.mode === 'reko' ? 'Reko abgeschlossen' : 'ohne Reko'} → Pendent. Benötigt: ${bedarfText(a.bedarf) || '–'}${a.dauer ? ', ca. ' + a.dauer : ''}${lage ? ' – ' + lage : ''}`);
  if (v === 'disp') setTimeout(() => openPick(a, 'disp'), 50);
});

/* Abschliessen */
let ABG = null;
function openAbg(a) { ABG = a.id; $('#abgTitle').textContent = `Auftrag ${a.nr} abschliessen`; $('#fAbg').reset(); $('#dAbg').showModal(); }
$('#fAbg').addEventListener('submit', e => {
  if (!e.submitter || e.submitter.value !== 'ok') return;
  const a = A(ABG), t = e.target.elements.txt.value.trim(); release(a);
  a.status = 'abg'; a.tAbg = Date.now(); a.abschluss = t; saveA(a); log(`Auftrag ${a.nr} abgeschlossen${t ? ': ' + t : ''}`);
});

function confirmBox(title, text, ok) { $('#cTitle').textContent = title; $('#cText').textContent = text; const d = $('#dC'); d.returnValue = ''; d.onclose = () => { if (d.returnValue === 'ok') ok(); }; d.showModal(); }

/* ---------- Einstellungen & Stammdaten ---------- */
let ST = null;
function openSettings() {
  const f = $('#fS'); ST = { personal: clone(personal()), mittel: clone(mittel()) };
  f.elements.dev.value = LP.get('dev') || ''; f.elements.org.value = S.settings.org || ''; f.elements.arten.value = S.settings.arten || '';
  $('#sEreignis').hidden = !S.eid; if (S.eid) { f.elements.eName.value = S.meta.name || ''; f.elements.eEl.value = S.meta.el || ''; $('#bCloseE').hidden = !!S.meta.closed; }
  $('#sAdm').hidden = true; $('#bAdm').hidden = false; $('#bLogout').hidden = SY.mode !== 'cloud' || !SY.user;
  $('#sInfo').textContent = `Version ${VERSION} · ${SY.mode === 'cloud' ? 'Synchronisation über Firebase' + (SY.user ? ' · ' + SY.user.email : '') : 'Nur lokal auf diesem Gerät (keine Synchronisation)'}`;
  renderStamm(); $('#dS').showModal();
}
function renderStamm() {
  $('#spCount').textContent = `(${ST.personal.length})${ST.personal.some(p => p.muster) ? ' – Musterdaten, bitte durch eure Leute ersetzen' : ''}`;
  $('#spList').innerHTML = ST.personal.map((p, i) => `<li><span><b>${esc(p.rang || '')}</b> ${esc(p.name)} ${esc(p.vorname)} <small class="hint">${esc(p.fkt || '')}</small></span><button type="button" class="ghost" data-dp="${i}">Löschen</button></li>`).join('') || '<li>Leer</li>';
  $('#smList').innerHTML = ST.mittel.map((m, i) => `<li><span><b>${esc(m.name)}</b> <small class="hint">${esc(m.gattung || '')}${m.info ? ' · ' + esc(m.info) : ''}</small></span><button type="button" class="ghost" data-dm="${i}">Löschen</button></li>`).join('') || '<li>Leer</li>';
}
$('#bSet').onclick = openSettings;
$('#bAdm').onclick = () => { $('#sAdm').hidden = false; $('#bAdm').hidden = true; };
$('#spAdd').onclick = () => { const v = $('#spV').value.trim(), n = $('#spN').value.trim(); if (!v || !n) return;
  ST.personal.push({ id: uid(), vorname: v, name: n, rang: $('#spR').value, fkt: $('#spF').value.trim() }); ST.personal.sort((a, b) => (a.name + a.vorname).localeCompare(b.name + b.vorname, 'de'));
  ['#spV', '#spN', '#spF'].forEach(x => $(x).value = ''); $('#spV').focus(); renderStamm(); };
$('#smAdd').onclick = () => { const n = $('#smN').value.trim(); if (!n) return; ST.mittel.push({ id: uid(), name: n, gattung: $('#smG').value.trim() || n.replace(/\s*\d+$/, ''), info: $('#smI').value.trim() });
  ['#smN', '#smG', '#smI'].forEach(x => $(x).value = ''); $('#smN').focus(); renderStamm(); };
$('#spList').addEventListener('click', e => { const b = e.target.closest('[data-dp]'); if (b) { ST.personal.splice(+b.dataset.dp, 1); renderStamm(); } });
$('#smList').addEventListener('click', e => { const b = e.target.closest('[data-dm]'); if (b) { ST.mittel.splice(+b.dataset.dm, 1); renderStamm(); } });
$('#fS').addEventListener('submit', e => {
  const v = e.submitter && e.submitter.value, f = e.target;
  if (v === 'logout') { confirmBox('Abmelden?', 'Danach braucht dieses Gerät Internet, um sich wieder anzumelden.', () => BE.logout()); return; }
  if (v !== 'ok') return;
  LP.set('dev', f.elements.dev.value.trim());
  if (S.eid && (f.elements.eName.value.trim() !== (S.meta.name || '') || f.elements.eEl.value.trim() !== (S.meta.el || ''))) {
    S.meta.name = f.elements.eName.value.trim() || S.meta.name; S.meta.el = f.elements.eEl.value.trim() || S.meta.el; saveMeta(); log(`Ereignis: ${S.meta.name}, Einsatzleiter ${S.meta.el}`); }
  if (!$('#sAdm').hidden) {
    BE.putSettings({ ...S.settings, org: f.elements.org.value.trim(), arten: f.elements.arten.value.trim(), personal: ST.personal, mittel: ST.mittel });
  }
  render();
});
$('#bSwitch').onclick = () => { $('#dS').close(); go('start'); };
$('#bCloseE').onclick = () => {
  const open = S.A.filter(a => a.status !== 'abg').length; $('#dS').close();
  confirmBox('Ereignis abschliessen?', open ? `Achtung: ${open} Aufträge sind noch nicht abgeschlossen. Das Ereignis bleibt gespeichert und kann wieder geöffnet werden.` : 'Das Ereignis wird abgeschlossen und bleibt für den Rapport gespeichert.', () => {
    S.meta.closed = true; S.meta.end = Date.now(); saveMeta(); log('Ereignis abgeschlossen'); publish(); });
};

/* ---------- QR-Code für die Anmeldung ---------- */
const ciUrl = () => new URL('checkin.html', location.href).href;
function qrSvg(text, cell) { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(cell || 8, 2); }
document.addEventListener('click', e => { if (e.target.closest('#bQR')) openQR(); });
function openQR() {
  const u = ciUrl();
  $('#qrBody').innerHTML = (window.qrcode ? qrSvg(u, 7) : '<p class="err">QR-Modul nicht geladen.</p>') + `<p class="hint" style="word-break:break-all">${esc(u)}</p>
    <p>Aktueller Code: <b class="bc" style="font-size:32px;letter-spacing:3px">${esc(S.meta.code || '----')}</b></p>`;
  $('#dQR').showModal();
}
$('#bQrPrint').onclick = () => {
  const u = ciUrl(), w = window.open('', '_blank'); if (!w || !window.qrcode) return;
  w.document.write(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Anmeldung im Depot</title><style>body{font-family:Helvetica,Arial,sans-serif;text-align:center;margin:40px}
    h1{font-size:34px;margin:10px 0}p{font-size:18px}svg{width:340px;height:340px}img{width:110px}</style></head><body>
    <img src="${new URL('logo.png', location.href).href}" alt=""><h1>Anmeldung im Depot</h1><p>${esc(S.settings.org || '')}</p>${qrSvg(u, 10)}
    <p><b>1.</b> QR-Code mit dem Handy scannen &nbsp; <b>2.</b> Angaben erfassen (nur beim ersten Mal) &nbsp; <b>3.</b> Code vom Bildschirm im KP eingeben</p><p style="font-size:13px;color:#555">${esc(u)}</p>
    <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};
$('#bQrClose').onclick = () => $('#dQR').close();

/* ---------- Datensicherung & Demo ---------- */
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
    try { await navigator.share({ files: [file], title: name }); return 'geteilt'; } catch (e) { if (e && e.name === 'AbortError') return 'abgebrochen'; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return 'gespeichert';
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
$('#bBackup').onclick = async () => { const r = await deliver(new Blob([JSON.stringify({ app: 'mehrfach', version: VERSION, exported: Date.now(), ...BE.exportAll() })], { type: 'application/json' }), `Mehrfach-Datensicherung_${stamp()}.json`);
  $('#eMsg').textContent = r === 'abgebrochen' ? '' : 'Datensicherung ' + r + '. Anhänge sind darin nicht enthalten.'; };
$('#fImport').addEventListener('change', async e => { const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try { const o = JSON.parse(await file.text()); if (o.app !== 'mehrfach') throw new Error('keine Datensicherung dieser App'); $('#eMsg').textContent = BE.importAll(o) + ' Ereignis(se) eingelesen.'; }
  catch (err) { $('#eMsg').textContent = 'Einlesen fehlgeschlagen: ' + err.message; } });
$('#bDemo').onclick = () => demo();
function demo() {
  const now = Date.now(), m = 60000;
  const id = BE.create({ created: now, start: now - 95 * m, end: null, closed: false, code: newCode(), name: 'Demo Mehrfachereignis', el: 'Hptm Muster', fu: 'Oblt Beispiel', kp: 'Depot Rheineck', lage: 'Übung / Demo' });
  openE(id);
  const P = personal(), M = mittel(), pid = i => P[i] && P[i].id, mid = n => (M.find(x => x.name === n) || {}).id;
  P.slice(0, 10).forEach(p => setRes(p.id, 'p', { status: 'verfuegbar', auftrag: null }));
  const mk = (nr, ago, art, adresse, lat, lng, prio, status, x) => ({ id: uid(), nr, tEin: now - ago * m, quelle: ['Anruf', 'E-Mail', 'Alarm'][nr % 3], art, adresse, lat, lng, prio, melder: '', tel: '', text: '', anh: [], status, sub: null, assigned: [], ...(x || {}) });
  const list = [
    mk(1, 90, 'Wasser im Gebäude', 'Demo: Rheineck Zentrum', 47.4668, 9.5899, 'P2', 'abg', { tAbg: now - 40 * m, abschluss: 'Keller ausgepumpt' }),
    mk(2, 70, 'Baum / Äste', 'Demo: Thal', 47.4672, 9.5668, 'P2', 'pendent', { rekoDone: false, ohneReko: true, bedarf: { adf: 4, m: { Pionier: 1, Motorsäge: 1 } }, dauer: '1 h' }),
    mk(3, 60, 'Strasse blockiert', 'Demo: Rheineck Rheinstrasse', 47.4642, 9.5948, 'P2', 'bew', { sub: 'vorort', tDisp: now - 50 * m, tVorOrt: now - 42 * m, assigned: [mid('Wassersauger 1'), mid('MTF 1'), pid(4), pid(5)] }),
    mk(4, 45, 'Baum / Äste', 'Demo: Lutzenberg', 47.4612, 9.5795, 'P1', 'bew', { sub: 'disp', tDisp: now - 10 * m, assigned: [mid('Pionier'), mid('Motorsäge 1'), pid(2), pid(3)] }),
    mk(5, 35, 'Wasser im Gebäude', 'Demo: Staad', 47.4795, 9.5462, 'P1', 'pendent', { rekoDone: true, reko: { ids: [], wer: ['Kpl Brunner'], t: now - 30 * m, tEnd: now - 20 * m }, bedarf: { adf: 2, m: { Wassersauger: 1 } }, dauer: '2 h' }),
    mk(6, 20, 'Dach / Fassade', 'Demo: Thal Dorf', 47.4688, 9.5702, 'P2', 'reko', { reko: { ids: [pid(6)], wer: [P[6] ? pShort(P[6]) : 'Reko'], t: now - 15 * m } }),
    mk(7, 8, 'Wasser im Gebäude', 'Demo: Rheineck Bahnhof', 47.4677, 9.5937, 'P1', 'offen'),
    mk(8, 3, 'Ölspur', 'Demo: Thal Hauptstrasse', 47.4661, 9.5751, 'P3', 'offen')
  ];
  list.forEach(a => { saveA(a); (a.assigned || []).forEach(rid => rid && setRes(rid, P.some(p => p.id === rid) ? 'p' : 'm', { status: 'einsatz', auftrag: a.id })); if (a.status === 'reko') a.reko.ids.forEach(rid => rid && setRes(rid, 'p', { status: 'einsatz', auftrag: a.id })); });
  log('Demo-Ereignis erstellt'); go('dash');
}

/* ================= Rapport (PDF) ================= */
const clean = s => String(s ?? '').replace(/[–—−]/g, '-').replace(/[«»]/g, '"').replace(/·/g, '-').replace(/→/g, '->').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const RED = '#c8102e', INK = '#16181a', MUTE = '#5b6166', LINE = '#cfcac3';
function makePdf() {
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, CW = W - 2 * M; let y = M;
  const font = (s, b, c) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); doc.setTextColor(c || INK); };
  const t = (x, yy, s, size, b, c) => { font(size, b, c); doc.text(clean(s), x, yy, { baseline: 'top' }); };
  const wrap = (s, w, size, b) => { font(size, b); return doc.splitTextToSize(clean(s || '-'), w); };
  const need = h => { if (y + h > H - M - 16) { doc.addPage(); y = M; return true; } return false; };
  try { const img = $('#logo'), c = document.createElement('canvas'); c.width = img.naturalWidth || 220; c.height = img.naturalHeight || 229; c.getContext('2d').drawImage(img, 0, 0); doc.addImage(c.toDataURL('image/png'), 'PNG', M, y, 46, 48); } catch (e) {}
  t(M + 60, y + 2, 'Ereignisrapport Mehrfachereignis', 17, 1); t(M + 60, y + 24, S.settings.org || '', 10, 0, MUTE); t(M + 60, y + 37, 'Erstellt ' + dt(Date.now()) + (LP.get('dev') ? ' auf ' + LP.get('dev') : ''), 8.5, 0, MUTE);
  y += 58; doc.setFillColor(RED); doc.rect(M, y, CW, 2, 'F'); y += 10;
  const c = s => S.A.filter(a => a.status === s).length;
  const meta = [['Ereignis', S.meta.name], ['Einsatzleiter', S.meta.el], ['Führungsunterstützung', S.meta.fu || '-'], ['Standort KP', S.meta.kp || '-'], ['Beginn', dt(S.meta.start)], ['Ende', S.meta.closed ? dt(S.meta.end) : 'laufend'],
    ['Aufträge', `${S.A.length} total - ${c('abg')} abgeschlossen, ${S.A.length - c('abg')} offen`], ['Lage', S.meta.lage || '-']];
  meta.forEach((m, i) => { const x = M + (i % 4) * CW / 4, yy = y + Math.floor(i / 4) * 28; t(x, yy, m[0], 7.5, 0, MUTE); t(x, yy + 9, wrap(m[1] || '-', CW / 4 - 10, 9.5, 1)[0], 9.5, 1); });
  y += 64; t(M, y, 'Aufträge', 13, 1, RED); y += 18;
  const cols = [['Nr', 24], ['Eingang', 48], ['Art / Adresse', 170], ['Prio', 30], ['Status', 70], ['Reko / Lage', 150], ['Mittel', 150], ['Abschluss', 128]];
  const sc = CW / cols.reduce((s, x) => s + x[1], 0); cols.forEach(x => x[1] *= sc);
  const head = () => { doc.setFillColor('#f1efec'); doc.rect(M, y, CW, 15, 'F'); let x = M; cols.forEach(cl => { t(x + 3, y + 4, cl[0], 7.5, 1, MUTE); x += cl[1]; }); y += 17; };
  head();
  for (const a of [...S.A].sort((p, q) => p.nr - q.nr)) {
    const st = a.status === 'bew' ? (a.sub === 'vorort' ? 'Vor Ort tätig' : 'Disponiert') : STL[a.status];
    const cells = [[String(a.nr)], [hm(a.tEin) + ' ' + (a.quelle || '')], [a.art + ' - ' + a.adresse + (a.text ? ' - ' + a.text : '')], [a.prio], [st],
      [[a.reko ? 'Reko ' + a.reko.wer.join(', ') : (a.ohneReko ? 'ohne Reko' : ''), a.lageReko, a.bedarf ? 'Benötigt: ' + bedarfText(a.bedarf) : ''].filter(Boolean).join(' - ') || '-'],
      [assignedText(a) || '-'], [a.status === 'abg' ? hm(a.tAbg) + (a.abschluss ? ' ' + a.abschluss : '') : '-']].map((v, i) => wrap(v[0], cols[i][1] - 6, 8.5, i === 0));
    const h = Math.max(...cells.map(l => l.length)) * 10.5 + 6; if (need(h)) head();
    let x = M; cells.forEach((l, i) => { l.forEach((ln, j) => t(x + 3, y + 3 + j * 10.5, ln, 8.5, i === 0)); x += cols[i][1]; });
    y += h; doc.setFillColor(LINE); doc.rect(M, y, CW, .6, 'F'); y += 2;
  }
  if (!S.A.length) { t(M, y, 'Keine Aufträge.', 9, 0, MUTE); y += 14; }
  y += 14; need(40); t(M, y, 'Journal', 13, 1, RED); y += 18;
  for (const l of S.log) { const ls = wrap(l.text + (l.dev ? ' (' + l.dev + ')' : ''), CW - 50, 8.5); need(ls.length * 10.5 + 3); t(M, y, hm(l.t), 8.5, 1, MUTE); ls.forEach((ln, i) => t(M + 50, y + i * 10.5, ln, 8.5)); y += ls.length * 10.5 + 3; }
  const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); font(7.5, 0, MUTE); doc.text(clean(`${S.meta.name || ''} - ${S.settings.org || ''}`), M, H - 22); doc.text(`Seite ${i} / ${n}`, W - M, H - 22, { align: 'right' }); }
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}
$('#bExp').onclick = async () => {
  if (!S.eid) return alert('Zuerst ein Ereignis öffnen.');
  if (!window.jspdf) return alert('PDF-Modul nicht geladen. App einmal mit Internet öffnen.');
  try { const slug = clean(S.meta.name || '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40); const r = await deliver(makePdf(), `Ereignisrapport_${stamp()}_${slug}.pdf`); if (r !== 'abgebrochen') log('Rapport als PDF exportiert'); }
  catch (e) { alert('PDF fehlgeschlagen: ' + (e && e.message || e)); }
};

/* ================= Start ================= */
let started = false;
function start() {
  if (started) return; started = true;
  BE.watchSettings(s => { S.settings = { ...DEF, ...s }; processCheckins(); render(); publish(); });
  BE.watchList(l => { S.list = l; if (S.view === 'start') renderStart(); });
  const last = LP.get('eid');
  if (last && (!BE.has || BE.has(last))) { openE(last); go(LP.get('view') || 'dash'); } else go('start');
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await BE.login(f.elements.email.value.trim(), f.elements.pw.value); }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung – für die erste Anmeldung braucht es Internet.' : 'Anmeldung fehlgeschlagen.'; }
});
async function boot() {
  setInterval(tick, 1000);
  const fb = CFG.firebase;
  if (fb && fb.apiKey) {
    try { BE = await CloudBackend(fb); SY.mode = 'cloud';
      BE.onUser(u => { SY.user = u; $('#login').hidden = !!u; renderSync(); if (u) start(); else if (started) location.reload(); }); return; }
    catch (e) { banner('Synchronisation nicht verfügbar (App wurde auf diesem Gerät noch nie mit Internet geöffnet). Es wird nur lokal gespeichert.'); }
  }
  BE = LocalBackend(); SY.mode = 'local'; start();
}
boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
window.__MF = { S, A, go, put: (c, id, o) => BE.put(S.eid, c, id, o) };
})();
