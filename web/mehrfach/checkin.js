/* Anmeldung im Depot per QR-Code – anonyme Anmeldung bei Firebase */
const CFG = window.MF_CONFIG || {};
const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const KEY = 'mf-checkin';
let P = {}; try { P = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
const saveP = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };
const msg = t => { $('#msg').hidden = !t; $('#msg').textContent = t || ''; };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

let F, fs, uid, PUB = null, MY = null;
$('#org').textContent = CFG.feuerwehr || '';

async function boot() {
  if (!CFG.firebase || !CFG.firebase.apiKey) { msg('Die Anmeldung per QR-Code ist noch nicht eingerichtet (Synchronisation fehlt).'); return; }
  try {
    const [appM, Au, Fm] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    F = Fm; const app = appM.initializeApp(CFG.firebase, 'mf-checkin'); const auth = Au.getAuth(app);
    await Au.setPersistence(auth, Au.browserLocalPersistence).catch(() => {});
    const cred = auth.currentUser ? { user: auth.currentUser } : await withTimeout(Au.signInAnonymously(auth), 15000);
    uid = cred.user.uid; fs = F.getFirestore(app);
    const d = await withTimeout(F.getDoc(F.doc(fs, 'mf_public', 'aktuell')), 15000);
    PUB = d.exists() ? d.data() : null;
  } catch (e) {
    msg(!navigator.onLine ? 'Keine Internetverbindung.' : (e && e.code === 'auth/operation-not-allowed') ? 'Anonyme Anmeldung ist in Firebase noch nicht eingeschaltet.'
      : (e && e.code === 'permission-denied') ? 'Kein Zugriff – Firestore-Regeln prüfen.' : 'Verbindung fehlgeschlagen. Bitte nochmals versuchen.'); return;
  }
  if (PUB && PUB.org) $('#org').textContent = PUB.org;
  if (!PUB || !PUB.eid) { msg('Zurzeit ist kein Ereignis eröffnet. Bitte später nochmals scannen.'); return; }
  try { const m = await F.getDoc(F.doc(fs, 'mf_ereignisse', PUB.eid, 'checkin', uid)); MY = m.exists() ? m.data() : null; } catch (e) { MY = null; }
  msg(''); (P.nachname && RAENGE.includes(P.rang) && P.tel ? showMain : showProfile)();
}

/* ---------- Angaben ---------- */
const RAENGE = ['Soldat', 'Uof', 'Of'];
function showProfile() {
  $('#sMain').hidden = true; $('#sProfile').hidden = false;
  $('#nn').value = P.nachname || ''; $('#vn').value = P.vorname || ''; $('#tel').value = P.tel || '';
  renderChips(); if (!P.nachname) setTimeout(() => $('#nn').focus(), 50);
}
function renderChips() {
  $('#rang').innerHTML = RAENGE.map(r => `<button type="button" data-r="${r}" class="${P.rang === r ? 'on' : ''}" style="min-width:90px">${r}</button>`).join('');
  document.querySelectorAll('#masch button').forEach(b => b.classList.toggle('on', P.masch != null && String(+P.masch) === b.dataset.m));
}
$('#rang').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { P.rang = b.dataset.r; renderChips(); } });
$('#masch').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { P.masch = b.dataset.m === '1'; renderChips(); } });
$('#bSaveProfile').onclick = async () => {
  const n = $('#nn').value.trim(), v = $('#vn').value.trim(), tel = $('#tel').value.trim();
  const miss = [!n && 'Name', !v && 'Vorname', !P.rang && 'Rang', P.masch == null && 'Maschinist', !tel && 'Telefonnummer'].filter(Boolean);
  if (miss.length) { $('#pErr').textContent = 'Bitte ausfüllen: ' + miss.join(', '); return; }
  $('#pErr').textContent = '';
  Object.assign(P, { nachname: n, vorname: v, tel, name: `${P.rang} ${n} ${v}` }); saveP();
  if (MY && MY.status === 'an' && P.code) { try { await write('an', P.code, true); } catch (e) {} }
  showMain();
};
$('#bEdit').onclick = showProfile;

/* ---------- Anmelden / Abmelden ---------- */
function showMain() {
  $('#sProfile').hidden = true; $('#sMain').hidden = false;
  $('#evName').textContent = PUB.name || 'Ereignis'; $('#who').textContent = P.name;
  const inn = MY && MY.status === 'an';
  $('#inForm').hidden = inn; $('#inDone').hidden = !inn; $('#mErr').textContent = ''; $('#dErr').textContent = '';
  if (inn) $('#since').textContent = 'seit ' + hm(MY.tIn || MY.t) + ' Uhr'; else setTimeout(() => $('#code').focus(), 50);
}
async function write(status, code, keepTime) {
  const now = Date.now();
  const doc = { name: P.name, vorname: P.vorname, nachname: P.nachname, rang: P.rang, masch: !!P.masch, tel: P.tel,
    status, code, t: now, tIn: status === 'an' ? (keepTime && MY && MY.tIn ? MY.tIn : now) : (MY && MY.tIn) || null };
  await withTimeout(F.setDoc(F.doc(fs, 'mf_ereignisse', PUB.eid, 'checkin', uid), doc), 12000);
  MY = doc;
}
function errText(e) { return e && e.code === 'permission-denied' ? 'Code falsch – bitte den Code vom Bildschirm im KP eingeben.' : e && e.message === 'timeout' ? 'Keine Verbindung. Bitte nochmals versuchen.' : 'Hat nicht geklappt. Bitte nochmals versuchen.'; }
$('#bIn').onclick = async () => {
  const code = $('#code').value.trim(); if (!/^\d{4}$/.test(code)) { $('#mErr').textContent = 'Bitte den 4-stelligen Code eingeben.'; return; }
  $('#bIn').disabled = true;
  try { await write('an', code); P.code = code; saveP(); showMain(); } catch (e) { $('#mErr').textContent = errText(e); }
  $('#bIn').disabled = false;
};
$('#bOut').onclick = async () => {
  if (!confirm('Wirklich abmelden?')) return;
  $('#bOut').disabled = true;
  try { await write('ab', P.code || ''); showMain(); } catch (e) { $('#dErr').textContent = errText(e); }
  $('#bOut').disabled = false;
};
boot();
