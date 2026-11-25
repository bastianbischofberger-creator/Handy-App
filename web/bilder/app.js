/* Einsatzbilder – Feuerwehr RTL (KP/iPad). Fotos pro Einsatz, Upload durch AdF per QR-Code (upload.html). */
const CFG = window.BI_CONFIG || {}, BI = window.BI;
const { esc, hm, dmy, uid } = BI;
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 4000); }
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);

/* ---------- gemeinsamer Einsatz (Startseite / andere Apps) ---------- */
const fwRead = () => { try { const e = JSON.parse(localStorage.getItem('fw-einsatz')); return e && e.bez ? e : null; } catch (e) { return null; } };
const fwWrite = e => { try { localStorage.setItem('fw-einsatz', JSON.stringify(e)); } catch (x) {} };

/* ---------- Firebase ---------- */
let F, fs, A, auth, E, S = { list: [], eid: null, fotos: [], user: null, err: '' }, unsub = null;
const sync = () => {
  const el = $('#sync'); let c = 'ok', t = 'Synchronisiert';
  if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline – wird nachgeladen'; } else if (S.pending) { c = 'warn'; t = 'Wird hochgeladen …'; }
  el.className = 'sync ' + c; el.textContent = t;
};
addEventListener('online', sync); addEventListener('offline', sync);
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Regeln prüfen' : 'Sync-Fehler'; sync(); };

async function boot() {
  try {
    const [appM, Au, Fm] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    F = Fm; A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase); // gleiche Anmeldung wie ASÜ/Journal
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    E = F.collection(fs, 'bi_einsaetze');
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; msg('Einsatzbilder brauchen beim ersten Öffnen Internet.'); return; }
  A.onAuthStateChanged(auth, u => {
    S.user = u && !u.isAnonymous ? u : null;
    $('#login').hidden = !!S.user;
    if (S.user) start();
  });
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.pw.value); f.pw.value = ''; }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung.' : 'E-Mail oder Passwort falsch.'; }
});

let started = false;
function start() {
  if (started) return; started = true; sync();
  let first = true;
  F.onSnapshot(F.query(E, F.orderBy('created', 'desc'), F.limit(80)), q => {
    S.list = q.docs.map(d => ({ id: d.id, ...d.data() })); S.err = ''; sync();
    if (first) { first = false;
      const FW = fwRead();
      if (FW) { const id = 'fw' + FW.t, hit = S.list.find(x => x.id === id);
        if (!hit) F.setDoc(F.doc(E, id), { title: FW.bez, ort: FW.adr || '', el: FW.el || '', fw: 'fw-' + FW.t, created: FW.t || Date.now(), closed: false, offen: false }).catch(fail);
        if (!hit || !hit.closed) return openE(id); }
      showDash(); return; }
    if (!$('#vDash').hidden) renderDash(); else if (S.eid) renderHead();
  }, fail);
}

/* ---------- Ansichten ---------- */
function show(v) { $('#vDash').hidden = v !== 'dash'; $('#vE').hidden = v !== 'e'; scrollTo(0, 0); }
function showDash() { if (unsub) { unsub(); unsub = null; } S.eid = null; $('#hSub').textContent = 'Fotos zum Einsatz'; show('dash'); renderDash(); }
$('#aHome').onclick = e => { if (!$('#vE').hidden) { e.preventDefault(); showDash(); } };

function renderDash() {
  const FW = fwRead(), key = FW && 'fw-' + FW.t;
  const run = S.list.filter(e => !e.closed).sort((a, b) => (b.fw === key) - (a.fw === key) || b.created - a.created);
  const done = S.list.filter(e => e.closed);
  $('#dRun').innerHTML = run.length ? run.map(e => `<div class="rc${key && e.fw === key ? ' fwe' : ''}" data-open="${esc(e.id)}">
      <small>Laufender Einsatz${key && e.fw === key ? ' · aktiver Einsatz' : ''}${e.offen ? ' · QR-Hochladen offen' : ''}</small><b>${esc(e.title)}</b>
      <div class="info">${[e.ort && esc(e.ort), e.el && 'EL ' + esc(e.el), 'seit ' + dmy(e.created) + ' ' + hm(e.created)].filter(Boolean).join(' · ')}</div>
      <div class="bb"><button data-open="${esc(e.id)}">Bilder öffnen →</button><button class="sec" data-close="${esc(e.id)}">Abschliessen</button></div></div>`).join('')
    : '<div class="rcempty">Kein laufender Einsatz. Links einen neuen Einsatz eröffnen oder auf der Startseite einen Einsatz generieren.</div>';
  $('#dDone').innerHTML = done.length ? done.map(e => `<li><div><b>${esc(e.title)}</b><span>${dmy(e.created)}${e.ort ? ' · ' + esc(e.ort) : ''}</span></div>
    <button data-open="${esc(e.id)}">Öffnen</button><button class="ghost" data-del="${esc(e.id)}">Löschen</button></li>`).join('') : '<li><span class="mute">Noch keine.</span></li>';
}
document.querySelector('#vDash').addEventListener('click', e => {
  const c = e.target.closest('[data-close]'), d = e.target.closest('[data-del]'), o = e.target.closest('[data-open]');
  if (c) { e.stopPropagation(); const x = S.list.find(y => y.id === c.dataset.close); if (x && confirm(`«${x.title}» abschliessen? Das QR-Hochladen wird beendet, die Bilder bleiben.`)) F.updateDoc(F.doc(E, x.id), { closed: true, offen: false, end: Date.now() }).catch(fail); return; }
  if (d) { const x = S.list.find(y => y.id === d.dataset.del); if (x && confirm(`«${x.title}» mit allen Bildern endgültig löschen?`)) delEinsatz(x.id); return; }
  if (o) openE(o.dataset.open);
});
async function delEinsatz(id) {
  try {
    const q = await F.getDocs(F.collection(E, id, 'fotos'));
    for (const d of q.docs) await delFoto(id, d.id);
    await F.deleteDoc(F.doc(E, id)); msg('Gelöscht.');
  } catch (e) { msg('Löschen fehlgeschlagen' + (navigator.onLine ? '.' : ' – dafür braucht es Internet.')); }
}

/* ---------- Neuer Einsatz (gemeinsames Fenster wie auf der Startseite) ---------- */
$('#bNew').onclick = async () => {
  const r = await window.FWForm.open({ app: 'Einsatzbilder' }); if (!r) return;
  const id = r.fw ? 'fw' + r.t : uid(), hit = S.list.find(x => x.id === id);
  if (!hit) F.setDoc(F.doc(E, id), { title: r.bez, ort: r.adr, el: r.el, ...(r.fw ? { fw: r.fw } : {}), created: r.fw ? r.t : Date.now(), closed: false, offen: false }).catch(fail);
  openE(id);
};

/* ---------- Ordner ---------- */
const cur = () => S.list.find(x => x.id === S.eid) || {};
function openE(id) {
  S.eid = id; S.fotos = []; show('e'); renderHead(); renderGal();
  if (unsub) unsub();
  unsub = F.onSnapshot(F.query(F.collection(E, id, 'fotos'), F.orderBy('t', 'desc')), { includeMetadataChanges: true }, q => {
    S.fotos = q.docs.map(d => ({ id: d.id, ...d.data() })); S.pending = q.metadata.hasPendingWrites; sync(); renderGal(); if (LB.open) lbRender();
  }, fail);
}
function renderHead() {
  const e = cur(), FW = fwRead(), isFw = FW && e.fw === 'fw-' + FW.t;
  $('#hSub').textContent = e.title || '';
  $('#oHead').classList.toggle('fwe', !!isFw);
  $('#oState').textContent = (e.closed ? 'Abgeschlossen' : 'Laufender Einsatz') + (isFw ? ' · aktiver Einsatz' : '');
  $('#oTitle').textContent = e.title || '…';
  $('#oInfo').textContent = [e.ort, e.el && 'EL ' + e.el, e.created && 'eröffnet ' + dmy(e.created) + ' ' + hm(e.created)].filter(Boolean).join(' · ');
  $('#oActs').hidden = !!e.closed; $('#bCloseE').textContent = e.closed ? 'Wieder öffnen' : 'Einsatz abschliessen';
  $('#qrState').hidden = !e.offen || !!e.closed;
  $('#qrState').innerHTML = '<b>●</b> QR-Hochladen ist offen – AdF können Fotos senden.';
  $('#qrSmall').textContent = e.offen ? 'offen – QR anzeigen' : 'AdF laden per Handy hoch';
}
function renderGal() {
  $('#cnt').textContent = S.fotos.length ? `(${S.fotos.length})` : '';
  $('#gal').innerHTML = S.fotos.length ? S.fotos.map((p, i) => `<div class="ph" data-i="${i}"><img src="${p.thumb}" alt="${esc(p.name)}" data-a="open" loading="lazy">
      <div class="nm" data-a="ren" title="Umbenennen">${esc(p.name)}</div><div class="mt">${p.src === 'qr' ? '<span class="qr">QR</span>' : ''}${hm(p.t)} · ${esc(p.by || '')}</div></div>`).join('')
    : '<p class="empty" style="grid-column:1/-1">Noch keine Bilder. Foto aufnehmen, aus der Galerie wählen oder per QR-Code von den Handys der AdF.</p>';
}
$('#gal').addEventListener('click', e => {
  const t = e.target.closest('[data-a]'), ph = e.target.closest('.ph'); if (!t || !ph) return;
  const p = S.fotos[+ph.dataset.i]; if (!p) return;
  if (t.dataset.a === 'open') lbOpen(+ph.dataset.i);
  if (t.dataset.a === 'ren') rename(p);
});
function rename(p) {
  const n = prompt('Neuer Name für das Bild', p.name); if (n == null) return;
  const v = n.trim(); if (!v || v === p.name) return;
  F.updateDoc(F.doc(E, S.eid, 'fotos', p.id), { name: v.slice(0, 80) }).catch(fail);
}
$('#bCloseE').onclick = () => {
  const e = cur();
  if (e.closed) { F.updateDoc(F.doc(E, S.eid), { closed: false, end: null }).catch(fail); return; }
  if (confirm(`«${e.title}» abschliessen? Das QR-Hochladen wird beendet, die Bilder bleiben.`)) F.updateDoc(F.doc(E, S.eid), { closed: true, offen: false, end: Date.now() }).catch(fail);
};

/* ---------- Aufnehmen / hochladen ---------- */
$('#bCam').onclick = () => $('#fCam').click();
$('#bPick').onclick = () => $('#fPick').click();
for (const id of ['#fCam', '#fPick']) $(id).addEventListener('change', async e => { const fl = [...e.target.files]; e.target.value = ''; upload(fl); });
const myName = () => (S.user && S.user.email ? S.user.email.split('@')[0] : 'KP');
async function upload(files) {
  if (!files.length || !S.eid) return;
  const eid = S.eid, pr = $('#prog'); pr.hidden = false; let ok = 0;
  for (let i = 0; i < files.length; i++) {
    pr.textContent = `Bild ${i + 1} von ${files.length} wird verarbeitet …`;
    try {
      const im = await BI.prepare(files[i]), parts = BI.parts(im.full), fid = uid(), t = files[i].lastModified && Math.abs(Date.now() - files[i].lastModified) < 864e5 * 3 ? files[i].lastModified : Date.now();
      const b = F.writeBatch(fs);
      b.set(F.doc(E, eid, 'fotos', fid), { name: 'Bild ' + BI.stamp(t).replace('_', ' '), t, by: myName(), w: im.w, h: im.h, n: parts.length, size: im.full.length, thumb: im.thumb, src: 'kp', uid: S.user.uid });
      parts.forEach((d, k) => b.set(F.doc(E, eid, 'fotos', fid, 'chunks', String(k).padStart(3, '0')), { d }));
      b.commit().catch(fail); ok++;
    } catch (err) { msg('Ein Bild konnte nicht gelesen werden.'); }
  }
  pr.textContent = `${ok} Bild${ok === 1 ? '' : 'er'} gespeichert${navigator.onLine ? '' : ' – wird hochgeladen, sobald Internet da ist'}.`;
  setTimeout(() => pr.hidden = true, 4000);
}

/* ---------- Grossansicht ---------- */
const LB = { open: false, i: 0 }, CACHE = new Map();
async function full(p) {
  if (CACHE.has(p.id)) return CACHE.get(p.id);
  const q = await F.getDocs(F.collection(E, S.eid, 'fotos', p.id, 'chunks'));
  const b64 = q.docs.sort((a, b) => a.id.localeCompare(b.id)).map(d => d.data().d).join('');
  if (!b64) throw new Error('leer');
  const url = 'data:image/jpeg;base64,' + b64; CACHE.set(p.id, url); return url;
}
function lbOpen(i) { LB.open = true; LB.i = i; $('#lb').hidden = false; lbRender(); }
async function lbRender() {
  const p = S.fotos[LB.i]; if (!p) return lbClose();
  $('#lbName').innerHTML = `${esc(p.name)}<small>${dmy(p.t)} ${hm(p.t)} · ${esc(p.by || '')}${p.src === 'qr' ? ' · per QR' : ''} · ${LB.i + 1} / ${S.fotos.length}</small>`;
  $('#lbImg').src = p.thumb; $('#lbLd').hidden = false; $('#lbLd').textContent = 'Lädt …';
  $('#lbP').disabled = LB.i <= 0; $('#lbN').disabled = LB.i >= S.fotos.length - 1;
  try { const u = await full(p); if (S.fotos[LB.i] === p) { $('#lbImg').src = u; $('#lbLd').hidden = true; } }
  catch (e) { $('#lbLd').textContent = navigator.onLine ? 'Bild wird noch hochgeladen …' : 'Offline – nur Vorschau'; }
}
function lbClose() { LB.open = false; $('#lb').hidden = true; }
$('#lbX').onclick = lbClose;
$('#lbP').onclick = () => { if (LB.i > 0) { LB.i--; lbRender(); } };
$('#lbN').onclick = () => { if (LB.i < S.fotos.length - 1) { LB.i++; lbRender(); } };
addEventListener('keydown', e => { if (!LB.open) return; if (e.key === 'Escape') lbClose(); if (e.key === 'ArrowLeft') $('#lbP').click(); if (e.key === 'ArrowRight') $('#lbN').click(); });
$('#lbRen').onclick = () => rename(S.fotos[LB.i]);
const fileName = p => `${BI.stamp(p.t)}_${p.name.replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50)}.jpg`;
async function blobOf(p) { return await (await fetch(await full(p))).blob(); }
$('#lbDl').onclick = async () => { const p = S.fotos[LB.i]; try { const a = document.createElement('a'); a.href = URL.createObjectURL(await blobOf(p)); a.download = fileName(p); a.click(); } catch (e) { msg('Bild noch nicht verfügbar.'); } };
$('#lbShare').onclick = async () => {
  const p = S.fotos[LB.i];
  try { const file = new File([await blobOf(p)], fileName(p), { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: p.name }); else $('#lbDl').click(); }
  catch (e) { if (!(e && e.name === 'AbortError')) msg('Teilen nicht möglich.'); }
};
$('#lbDel').onclick = () => { const p = S.fotos[LB.i]; if (confirm(`«${p.name}» löschen?`)) { delFoto(S.eid, p.id).catch(fail); if (LB.i >= S.fotos.length - 1) LB.i = Math.max(0, LB.i - 1); } };
async function delFoto(eid, fid) {
  const q = await F.getDocs(F.collection(E, eid, 'fotos', fid, 'chunks'));
  await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); await F.deleteDoc(F.doc(E, eid, 'fotos', fid));
}
$('#bAll').onclick = async () => {
  if (!S.fotos.length) return;
  if (!confirm(`${S.fotos.length} Bilder einzeln herunterladen?`)) return;
  for (const p of [...S.fotos].reverse()) { try { const a = document.createElement('a'); a.href = URL.createObjectURL(await blobOf(p)); a.download = fileName(p); a.click(); await new Promise(r => setTimeout(r, 400)); } catch (e) {} }
};

/* ---------- QR-Code für AdF ---------- */
const upUrl = () => new URL('upload.html?e=' + encodeURIComponent(S.eid), location.href).href;
const qrSvg = (t, c) => { const q = window.qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag(c || 7, 2); };
$('#bQR').onclick = () => {
  const e = cur(); if (!e.offen) F.updateDoc(F.doc(E, S.eid), { offen: true }).catch(fail);
  $('#qrBody').innerHTML = (window.qrcode ? qrSvg(upUrl()) : '<p class="err">QR-Modul nicht geladen.</p>') +
    `<p class="mute" style="margin:8px 0 0">AdF scannen den Code mit dem Handy, geben einmal ihren Namen ein und können dann direkt fotografieren oder Bilder aus der Galerie hochladen – alles landet in diesem Einsatz.</p>`;
  $('#dQR').showModal();
};
$('#qrX').onclick = () => $('#dQR').close();
$('#qrStop').onclick = () => { F.updateDoc(F.doc(E, S.eid), { offen: false }).catch(fail); $('#dQR').close(); msg('QR-Hochladen beendet.'); };
$('#qrCopy').onclick = async () => { try { await navigator.clipboard.writeText(upUrl()); msg('Link kopiert.'); } catch (e) { msg(upUrl()); } };
$('#qrPrint').onclick = () => {
  const e = cur(), w = window.open('', '_blank'); if (!w) return;
  w.document.write(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Einsatzbilder</title><style>body{font-family:Helvetica,Arial,sans-serif;text-align:center;margin:40px}h1{font-size:30px}svg{width:340px;height:340px}img{width:100px}</style></head><body>
    <img src="${new URL('logo.png', location.href).href}" alt=""><h1>Einsatzbilder: ${esc(e.title)}</h1><p style="font-size:18px">Fotos vom Einsatz hier hochladen</p>${qrSvg(upUrl(), 10)}
    <p style="font-size:18px"><b>1.</b> QR-Code scannen &nbsp; <b>2.</b> Name eingeben &nbsp; <b>3.</b> Fotografieren oder Bilder wählen</p><script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};

boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
