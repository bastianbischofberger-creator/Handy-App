/* Einsatzbilder: AdF laden per QR-Code Fotos direkt in den Einsatz hoch (anonyme Anmeldung) */
const CFG = window.BI_CONFIG || {}, BI = window.BI;
const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const msg = t => { $('#msg').textContent = t || ''; };
const eid = new URLSearchParams(location.search).get('e');
let ME = {}; try { ME = JSON.parse(localStorage.getItem('bi-adf')) || {}; } catch (e) {}
const saveMe = () => { try { localStorage.setItem('bi-adf', JSON.stringify(ME)); } catch (e) {} };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
let F, fs, uid, EV = null;
$('#org').textContent = CFG.feuerwehr || 'Feuerwehr';

async function boot() {
  if (!eid) return msg('Ungültiger Link – bitte den QR-Code nochmals scannen.');
  try {
    const [appM, Au, Fm] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    F = Fm; const app = appM.initializeApp(CFG.firebase, 'bi-upload'); const auth = Au.getAuth(app);
    await Au.setPersistence(auth, Au.browserLocalPersistence).catch(() => {});
    await new Promise(r => { const u = Au.onAuthStateChanged(auth, () => { u(); r(); }); });
    const cred = auth.currentUser ? { user: auth.currentUser } : await withTimeout(Au.signInAnonymously(auth), 15000);
    uid = cred.user.uid; fs = F.getFirestore(app);
  } catch (e) {
    return msg(!navigator.onLine ? 'Keine Internetverbindung.' : e && e.code === 'auth/operation-not-allowed' ? 'Anonyme Anmeldung ist in Firebase nicht eingeschaltet.' : 'Verbindung fehlgeschlagen. Bitte nochmals versuchen.');
  }
  F.onSnapshot(F.doc(fs, 'bi_einsaetze', eid), d => {
    EV = d.exists() ? d.data() : null;
    if (!EV || !EV.offen || EV.closed) { $('#sMain').hidden = true; $('#sName').hidden = true; return msg('Das Hochladen für diesen Einsatz ist nicht (mehr) offen. Bitte beim KP melden.'); }
    msg(''); (ME.name ? showMain : showName)();
  }, () => { $('#sMain').hidden = true; msg('Das Hochladen für diesen Einsatz ist nicht (mehr) offen.'); });
  F.onSnapshot(F.query(F.collection(fs, 'bi_einsaetze', eid, 'fotos'), F.where('uid', '==', uid)), q => {
    const l = q.docs.map(d => d.data()).sort((a, b) => b.t - a.t);
    $('#cnt').textContent = l.length ? `(${l.length})` : '';
    $('#mine').innerHTML = l.map(p => `<img src="${p.thumb}" alt="">`).join('') || '<span class="mute" style="grid-column:1/-1">Noch keine.</span>';
  }, () => {});
}
function showName() { $('#sMain').hidden = true; $('#sName').hidden = false; $('#nm').value = ME.name || ''; }
function showMain() {
  $('#sName').hidden = true; $('#sMain').hidden = false;
  $('#evT').textContent = EV.title; $('#evD').textContent = [EV.ort, EV.el && 'EL ' + EV.el].filter(Boolean).join(' · ');
  $('#meN').textContent = ME.name;
}
$('#bName').onclick = () => { const n = $('#nm').value.trim(); if (n.length < 2) return $('#nm').focus(); ME.name = n.slice(0, 60); saveMe(); showMain(); };
$('#bEdit').onclick = showName;
$('#bCam').onclick = () => $('#fCam').click();
$('#bPick').onclick = () => $('#fPick').click();
for (const id of ['#fCam', '#fPick']) $(id).addEventListener('change', e => { const fl = [...e.target.files]; e.target.value = ''; upload(fl); });

async function upload(files) {
  if (!files.length) return;
  const pr = $('#prog'); pr.hidden = false; $('#mErr').textContent = ''; let ok = 0;
  for (let i = 0; i < files.length; i++) {
    pr.textContent = `Bild ${i + 1} von ${files.length} wird hochgeladen …`;
    try {
      const im = await BI.prepare(files[i]), parts = BI.parts(im.full), fid = BI.uid(), t = Date.now();
      // zuerst die Bildangaben, dann die Bildteile (die Regeln prüfen, dass das Bild dir gehört)
      await withTimeout(F.setDoc(F.doc(fs, 'bi_einsaetze', eid, 'fotos', fid), { name: 'Bild ' + BI.stamp(t).replace('_', ' '), t, by: ME.name, w: im.w, h: im.h, n: parts.length, size: im.full.length, thumb: im.thumb, src: 'qr', uid }), 60000);
      for (let k = 0; k < parts.length; k++) await withTimeout(F.setDoc(F.doc(fs, 'bi_einsaetze', eid, 'fotos', fid, 'chunks', String(k).padStart(3, '0')), { d: parts[k] }), 90000);
      ok++;
    } catch (e) { $('#mErr').textContent = e && e.code === 'permission-denied' ? 'Hochladen nicht erlaubt – ist das Hochladen noch offen?' : !navigator.onLine ? 'Keine Internetverbindung – bitte später nochmals.' : 'Ein Bild konnte nicht hochgeladen werden.'; }
  }
  pr.textContent = ok ? `✓ ${ok} Bild${ok === 1 ? '' : 'er'} hochgeladen.` : 'Nichts hochgeladen.';
  setTimeout(() => pr.hidden = true, 5000);
}
boot();
