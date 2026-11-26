/* Einsatzdaten teilen – Feuerwehr RTL.
   Erstellt Freigaben (Firestore «sh_freigaben», ID = geheimer Schlüssel) mit ausgewählten Feldern.
   Live: Dieses Gerät liest laufend Einsatz (Startseite), ASÜ, Journal und Sperren und schreibt eine Kopie
   der gewählten Felder in die Freigabe. Momentaufnahme: einmalige Kopie. Empfänger: ansicht.html?k=… */
const VERSION = '1.0.0';
const CFG = window.SH_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dhm = t => { const d = new Date(t), n = new Date(); return (d.toDateString() === n.toDateString() ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. `) + hm(t); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 28); };
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => m.textContent = '', 4000); }
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);
const fwRead = () => { try { const e = JSON.parse(localStorage.getItem('fw-einsatz')); return e && e.bez ? e : null; } catch (e) { return null; } };
const SAFE_MAX = 24 * 3600000; // «bis Einsatzende» läuft spätestens nach 24 h ab

const FIELDS = [
  ['einsatz', 'Einsatz & Alarmzeit', true], ['adresse', 'Adresse', true], ['karte', 'Standort auf Karte', true], ['el', 'Einsatzleiter', true],
  ['tel', 'Telefon EL / KP', false], ['lage', 'Lagemeldung', true], ['treff', 'Treffpunkt / Zufahrt', false], ['jprio', 'Journal: Prio-Meldungen', false],
  ['jalle', 'Journal: alle Einträge', false], ['asue', 'Atemschutz: Übersicht', false], ['sperren', 'Aktive Strassensperren', false]
];
const EMP = ['Kantonspolizei', 'Rettungsdienst', 'Nachbarfeuerwehr', 'Gemeinde', 'Chemiewehr'];
const BIS = [['ende', 'Einsatzende'], ['1', '1 Std.'], ['3', '3 Std.'], ['12', '12 Std.'], ['zeit', 'Uhrzeit …']];
let mode = 'live', bisSel = 'ende', fsel = new Set(FIELDS.filter(f => f[2]).map(f => f[0]));

/* ---------- Formular ---------- */
function renderForm() {
  $('#cEmp').innerHTML = EMP.map(e => `<button type="button" data-e="${esc(e)}" class="${$('#emp').value === e ? 'on' : ''}">${esc(e)}</button>`).join('');
  document.querySelectorAll('#cMode button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  $('#cF').innerHTML = FIELDS.map(([k, l]) => `<label><input type="checkbox" data-f="${k}"${fsel.has(k) ? ' checked' : ''}>${esc(l)}</label>`).join('');
  $('#cBis').innerHTML = BIS.map(([k, l]) => `<button type="button" data-b="${k}" class="${bisSel === k ? 'on' : ''}">${esc(l)}</button>`).join('');
  $('#bisZeit').hidden = bisSel !== 'zeit';
  $('#lLage').hidden = !fsel.has('lage'); $('#lTreff').hidden = !fsel.has('treff'); $('#lTel').hidden = !fsel.has('tel');
}
$('#cEmp').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (b) { $('#emp').value = b.dataset.e; renderForm(); } });
$('#emp').addEventListener('input', renderForm);
$('#cMode').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { mode = b.dataset.m; renderForm(); } });
$('#cF').addEventListener('change', e => { const k = e.target.dataset.f; if (!k) return; e.target.checked ? fsel.add(k) : fsel.delete(k); if (k === 'jalle' && e.target.checked) fsel.delete('jprio'); if (k === 'jprio' && e.target.checked) fsel.delete('jalle'); renderForm(); });
$('#cBis').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) { bisSel = b.dataset.b; renderForm(); } });

/* ---------- Firebase ---------- */
let F, fs, A, auth, SH, appM, Au;
const S = { user: null, err: '', list: [], src: { asue: null, journal: [], sperren: [] } };
function sync() { const el = $('#sync'); let c = 'ok', t = 'Synchronisiert'; if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline'; } else if (!S.user) { c = 'warn'; t = 'Nicht angemeldet'; } el.className = 'sync ' + c; el.textContent = t; }
addEventListener('online', sync); addEventListener('offline', sync);
$('#sync').addEventListener('click', () => { if (F && fs && S.user && window.FWSync) FWSync.open({ F, fs, user: S.user.email, onDone: () => { S.err = ''; sync(); } }); });
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Regeln «Einsatzdaten teilen» veröffentlichen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); sync(); msg(S.err); };
async function boot() {
  try {
    [appM, Au, F] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase);
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    SH = F.collection(fs, 'sh_freigaben');
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; msg('Zum Teilen braucht es Internet.'); return; }
  A.onAuthStateChanged(auth, u => { S.user = u && !u.isAnonymous ? u : null; $('#login').hidden = !!S.user; sync(); if (S.user) start(); });
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.pw.value); f.pw.value = ''; }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung.' : 'E-Mail oder Passwort falsch.'; }
});

/* ---------- Quellen (nur für Live und für die Momentaufnahme) ---------- */
let srcFw = null, unsub = [];
async function watchSources() {
  const FW = fwRead(); const k = FW ? 'fw-' + FW.t : null;
  if (k === srcFw) return; srcFw = k; unsub.forEach(u => u()); unsub = []; S.src = { asue: null, journal: [], sperren: S.src.sperren };
  if (!FW) return;
  // ASÜ: Einsatz mit gleichem Startseiten-Schlüssel
  try {
    const q = await F.getDocs(F.query(F.collection(fs, 'einsaetze'), F.where('fw', '==', k), F.limit(1)));
    if (!q.empty) { const eid = q.docs[0].id;
      unsub.push(F.onSnapshot(F.collection(fs, 'einsaetze', eid, 'teams'), s => { S.src.asue = s.docs.map(d => d.data()).filter(t => !t.hidden); pushLive(); }, () => {})); }
  } catch (e) {}
  // Journal (eigene Firebase-Instanz «journal», gleiche Anmeldung auf diesem Gerät)
  try {
    const japp = appM.getApps().find(x => x.name === 'journal') || appM.initializeApp(CFG.firebase, 'journal');
    const jauth = Au.getAuth(japp); await Au.setPersistence(jauth, Au.indexedDBLocalPersistence).catch(() => {});
    const ju = await new Promise(r => { const u = Au.onAuthStateChanged(jauth, x => { u(); r(x); }); });
    if (ju && !ju.isAnonymous) {
      let jfs; try { jfs = F.initializeFirestore(japp, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { jfs = F.getFirestore(japp); }
      unsub.push(F.onSnapshot(F.collection(jfs, 'journale', 'fw' + FW.t, 'eintraege'), s => { S.src.journal = s.docs.map(d => d.data()).sort((a, b) => a.t - b.t); pushLive(); }, () => {}));
    } else S.src.journalHinweis = 'Journal auf diesem Gerät nicht angemeldet';
  } catch (e) {}
}
let sperrUnsub = null;
function watchSperren() {
  if (sperrUnsub) return;
  sperrUnsub = (F.onSnapshot(F.doc(fs, 'config', 'routing'), d => {
    const v = d.exists() ? d.data() : {}, now = Date.now();
    S.src.sperren = (v.sperren || []).filter(s => { const a = s.von ? +new Date(s.von) : 0, b = s.bis ? +new Date(s.bis) : Infinity; return now >= a && now <= b; })
      .map(s => ({ name: s.name, grund: s.grund || '', bis: s.bis || '', pts: (s.pts || []).map(p => Array.isArray(p) ? { la: p[0], lo: p[1] } : p), uml: s.uml ? s.uml.map(p => Array.isArray(p) ? { la: p[0], lo: p[1] } : p) : null }));
    pushLive();
  }, () => {}));
}

/* ---------- Daten für eine Freigabe zusammenstellen (nur gewählte Felder) ---------- */
function build(sh) {
  const FW = fwRead(), f = new Set(sh.felder), d = {};
  if (FW && (!sh.fw || sh.fw === 'fw-' + FW.t)) {
    if (f.has('einsatz')) { d.einsatz = FW.bez; d.alarm = FW.t; }
    if (f.has('adresse')) d.adresse = FW.adr || '';
    if (f.has('karte') && FW.lat != null) { d.lat = FW.lat; d.lng = FW.lng; }
    if (f.has('el')) d.el = FW.el || '';
  }
  if (f.has('tel')) d.tel = sh.tel || '';
  if (f.has('lage')) d.lage = sh.lage || '';
  if (f.has('treff')) d.treff = sh.treff || '';
  if (f.has('jprio') || f.has('jalle')) d.journal = (S.src.journal || []).filter(e => f.has('jalle') || e.prio).slice(-40).map(e => ({ t: e.t, text: e.text, prio: !!e.prio }));
  if (f.has('asue') && S.src.asue) {
    const T = S.src.asue, inn = T.filter(t => t.status === 'innen' || t.status === 'rueckzug');
    d.asue = { innen: inn.length, total: T.length, notfall: inn.some(t => t.inNot), trupps: inn.map(t => ({ nr: t.nr, status: t.status === 'rueckzug' ? 'Rückzug' : 'im Einsatz', auftrag: [t.auftrag, t.zusatz].filter(Boolean).join(' – '), not: !!t.inNot })) };
  }
  if (f.has('sperren')) d.sperren = S.src.sperren || [];
  return d;
}
let liveT = null;
function pushLive() {
  clearTimeout(liveT);
  liveT = setTimeout(() => {
    const FW = fwRead();
    for (const sh of S.list.filter(x => x.aktiv)) {
      // Einsatz auf der Startseite beendet oder gewechselt → Freigaben «bis Einsatzende» beenden
      if (sh.bisArt === 'ende' && sh.fw && (!FW || sh.fw !== 'fw-' + FW.t)) { F.updateDoc(F.doc(SH, sh.id), { aktiv: false, endGrund: 'Einsatz beendet', upd: Date.now() }).catch(fail); continue; }
      if (Date.now() > sh.bis || sh.mode !== 'live') continue;
      F.updateDoc(F.doc(SH, sh.id), { data: build(sh), upd: Date.now() }).catch(fail);
    }
  }, 2500);
}

/* ---------- Liste ---------- */
let started = false;
function start() {
  if (started) return; started = true;
  watchSources(); watchSperren();
  F.onSnapshot(F.query(SH, F.where('aktiv', '==', true)), q => {
    S.list = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.created - a.created); S.err = ''; sync(); renderList(); renderEin();
  }, fail);
  setInterval(() => { watchSources(); pushLive(); renderList(); }, 30000); // Einsatzwechsel erkennen, Live auffrischen
  addEventListener('storage', e => { if (e.key === 'fw-einsatz') { renderEin(); watchSources(); pushLive(); } });
}
const url = id => new URL('ansicht.html?k=' + id, location.href).href;
function renderEin() {
  const FW = fwRead();
  $('#ein').innerHTML = FW ? `<span class="mute small">LAUFENDER EINSATZ (Startseite)</span><b>${esc(FW.bez)}</b><span class="mute">${esc(FW.adr || '')} · EL ${esc(FW.el || '–')} · seit ${hm(FW.t)}</span>`
    : '<b>Kein Einsatz eröffnet</b><span class="mute">Ohne Einsatz auf der Startseite können nur Freitext-Felder (Lagemeldung, Treffpunkt, Telefon) geteilt werden.</span>';
  const live = S.list.filter(x => x.mode === 'live' && Date.now() < x.bis);
  $('#live').hidden = !live.length;
  $('#live').textContent = `Live-Übertragung läuft für ${live.length} Freigabe${live.length > 1 ? 'n' : ''}. Aktualisiert wird, solange diese Seite auf diesem Gerät geöffnet ist.`;
}
function renderList() {
  const now = Date.now();
  $('#list').innerHTML = S.list.length ? S.list.map(sh => { const abg = now > sh.bis;
    return `<li><div><span class="st${abg ? ' off' : ''}">${abg ? 'ABGELAUFEN' : sh.mode === 'live' ? 'LIVE' : 'MOMENTAUFNAHME'}</span><b>${esc(sh.emp)}</b></div>
      <span class="mute small">${sh.felder.map(k => (FIELDS.find(f => f[0] === k) || [, k])[1]).join(' · ')}</span>
      <span class="small">Gültig bis ${sh.bisArt === 'ende' ? 'Einsatzende (spätestens ' + dhm(sh.bis) + ')' : dhm(sh.bis)} · Stand ${sh.upd ? hm(sh.upd) : '–'}</span>
      ${fsLage(sh)}
      <div class="btns"><button type="button" data-q="${sh.id}">QR / Link</button>${sh.mode === 'live' ? `<button type="button" data-l="${sh.id}">Lagemeldung ändern</button>` : ''}<button type="button" class="danger" data-x="${sh.id}">Beenden</button></div></li>`; }).join('')
    : '<li class="mute">Keine aktiven Freigaben.</li>';
}
const fsLage = sh => sh.felder.includes('lage') && sh.lage ? `<span class="small">Lage: ${esc(sh.lage)}</span>` : '';
$('#list').addEventListener('click', async e => {
  const q = e.target.closest('[data-q]'), l = e.target.closest('[data-l]'), x = e.target.closest('[data-x]');
  if (q) { const sh = S.list.find(s => s.id === q.dataset.q); if (sh) showQr(sh); }
  if (l) { const sh = S.list.find(s => s.id === l.dataset.l); if (!sh) return; const t = prompt('Lagemeldung', sh.lage || ''); if (t == null) return; sh.lage = t.trim();
    F.updateDoc(F.doc(SH, sh.id), { lage: sh.lage, data: build(sh), upd: Date.now() }).then(() => msg('Lagemeldung geteilt')).catch(fail); }
  if (x) { const sh = S.list.find(s => s.id === x.dataset.x); if (sh && confirm(`Freigabe für «${sh.emp}» beenden? Der Link funktioniert danach nicht mehr.`)) F.updateDoc(F.doc(SH, sh.id), { aktiv: false, endGrund: 'Manuell beendet', upd: Date.now() }).catch(fail); }
});

/* ---------- Neue Freigabe ---------- */
$('#bNew').onclick = async () => {
  $('#fErr').textContent = '';
  if (!S.user) return msg('Zuerst anmelden');
  const emp = $('#emp').value.trim(); if (!emp) { $('#fErr').textContent = 'Empfänger fehlt.'; return; }
  if (!fsel.size) { $('#fErr').textContent = 'Mindestens ein Feld auswählen.'; return; }
  const FW = fwRead(), now = Date.now();
  if (bisSel === 'ende' && !FW) { $('#fErr').textContent = '«Einsatzende» geht nur mit einem eröffneten Einsatz auf der Startseite.'; return; }
  let bis;
  if (bisSel === 'ende') bis = now + SAFE_MAX;
  else if (bisSel === 'zeit') { const v = $('#bisZeit').value; if (!v) { $('#fErr').textContent = 'Uhrzeit wählen.'; return; } const [h, m] = v.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); if (+d <= now) d.setDate(d.getDate() + 1); bis = +d; }
  else bis = now + (+bisSel) * 3600000;
  const sh = { emp, mode, felder: [...fsel], bisArt: bisSel, bis, aktiv: true, created: now, upd: now, by: S.user.email, fw: FW ? 'fw-' + FW.t : null,
    lage: $('#lage').value.trim(), treff: $('#treff').value.trim(), tel: $('#tel').value.trim() };
  sh.data = build(sh);
  const id = key();
  try { $('#bNew').disabled = true; await F.setDoc(F.doc(SH, id), sh); showQr({ id, ...sh }); $('#lage').value = ''; }
  catch (e2) { fail(e2); $('#fErr').textContent = S.err; }
  $('#bNew').disabled = false;
};

/* ---------- QR ---------- */
let qrSh = null;
function showQr(sh) {
  qrSh = sh; const u = url(sh.id);
  $('#qT').textContent = 'Freigabe: ' + sh.emp;
  const q = window.qrcode(0, 'M'); q.addData(u); q.make(); $('#qr').innerHTML = q.createSvgTag(6, 2);
  $('#qL').textContent = u; $('#qShare').hidden = !navigator.share; $('#dQr').showModal();
}
$('#qClose').onclick = () => $('#dQr').close();
$('#qCopy').onclick = async () => { try { await navigator.clipboard.writeText(url(qrSh.id)); msg('Link kopiert'); } catch (e) { msg('Kopieren nicht möglich'); } };
$('#qShare').onclick = () => navigator.share({ title: 'Einsatzdaten Feuerwehr RTL', text: `Einsatzdaten für ${qrSh.emp}`, url: url(qrSh.id) }).catch(() => {});

renderForm(); renderEin(); renderList(); boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.SH_VERSION = VERSION;
