/* Brandwache: AdF tragen sich per QR-Code selbst in einen Slot ein (anonyme Anmeldung bei Firebase) */
const CFG = window.SP_CONFIG || {};
const { esc, hm, dm, dayKey, dur, slots, key } = window.SP;
const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const LK = 'schicht-adf';
let ME = {}; try { ME = JSON.parse(localStorage.getItem(LK)) || {}; } catch (e) {}
const saveMe = () => { try { localStorage.setItem(LK, JSON.stringify(ME)); } catch (e) {} };
const msg = t => { $('#msg').textContent = t || ''; };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const pid = new URLSearchParams(location.search).get('p');

let F, fs, uid, PLAN = null, ENTS = {}, busy = false;
$('#org').textContent = CFG.feuerwehr || 'Feuerwehr';

async function boot() {
  if (!pid) return msg('Ungültiger Link – bitte den QR-Code nochmals scannen.');
  if (!CFG.firebase || !CFG.firebase.apiKey) return msg('Eintragen per QR ist noch nicht eingerichtet.');
  try {
    const [appM, Au, Fm] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    F = Fm; const app = appM.initializeApp(CFG.firebase, 'schicht-adf'); const auth = Au.getAuth(app);
    await Au.setPersistence(auth, Au.browserLocalPersistence).catch(() => {});
    await new Promise(r => { const u = Au.onAuthStateChanged(auth, () => { u(); r(); }); });
    const cred = auth.currentUser ? { user: auth.currentUser } : await withTimeout(Au.signInAnonymously(auth), 15000);
    uid = cred.user.uid; fs = F.getFirestore(app);
  } catch (e) {
    return msg(!navigator.onLine ? 'Keine Internetverbindung.' : (e && e.code === 'auth/operation-not-allowed') ? 'Anonyme Anmeldung ist in Firebase noch nicht eingeschaltet.' : 'Verbindung fehlgeschlagen. Bitte nochmals versuchen.');
  }
  const PD = F.doc(fs, 'sp_plaene', pid);
  F.onSnapshot(PD, d => {
    PLAN = d.exists() ? d.data() : null;
    if (!PLAN || !PLAN.offen) { $('#sMain').hidden = true; $('#sProfile').hidden = true; return msg('Dieser Schichtplan ist nicht (mehr) zum Eintragen offen. Bitte beim Verantwortlichen melden.'); }
    msg(''); if (PLAN.org) $('#org').textContent = PLAN.org;
    (ME.name ? showMain : showProfile)();
  }, e => msg(e && e.code === 'permission-denied' ? 'Dieser Schichtplan ist nicht (mehr) zum Eintragen offen.' : 'Verbindung unterbrochen.'));
  F.onSnapshot(F.collection(PD, 'eintraege'), q => { ENTS = {}; q.docs.forEach(d => ENTS[d.id] = d.data()); if (!$('#sMain').hidden) render(); }, () => {});
}

/* ---------- Angaben ---------- */
function showProfile() {
  $('#sMain').hidden = true; $('#sProfile').hidden = false;
  $('#nm').value = ME.name || ''; $('#tel').value = ME.tel || ''; if (!ME.name) setTimeout(() => $('#nm').focus(), 50);
}
$('#bSave').onclick = async () => {
  const name = $('#nm').value.trim(), tel = $('#tel').value.trim();
  if (name.length < 2) { $('#pErr').textContent = 'Bitte Grad und Name eingeben.'; return; }
  $('#pErr').textContent = ''; ME = { name, tel }; saveMe();
  // Name in bestehenden eigenen Einträgen nachführen
  const mine = Object.entries(ENTS).filter(([, e]) => e.uid === uid);
  try {
    await putContact();
    for (const [k, e] of mine) if (e.name !== name) { await F.deleteDoc(F.doc(fs, 'sp_plaene', pid, 'eintraege', k)); await F.setDoc(F.doc(fs, 'sp_plaene', pid, 'eintraege', k), { ...e, name, t: Date.now() }); }
  } catch (e) {}
  showMain();
};
$('#bEdit').onclick = showProfile;
const putContact = () => F.setDoc(F.doc(fs, 'sp_plaene', pid, 'kontakte', uid), { name: ME.name, tel: ME.tel || '', t: Date.now() });

/* ---------- Slots ---------- */
function showMain() {
  $('#sProfile').hidden = true; $('#sMain').hidden = false;
  $('#evT').textContent = PLAN.title;
  $('#evD').textContent = `${dm(PLAN.start)} ${hm(PLAN.start)} – ${dm(PLAN.end)} ${hm(PLAN.end)}${PLAN.ort ? ' · ' + PLAN.ort : ''}${PLAN.ver ? ' · Verantwortlich: ' + PLAN.ver : ''}`;
  $('#evN').hidden = !PLAN.note; $('#evN').textContent = PLAN.note ? 'Hinweis: ' + PLAN.note : '';
  $('#meN').textContent = ME.name; render();
}
function render() {
  if (!PLAN) return;
  const now = Date.now(), sl = slots(PLAN); let h = '', lastDay = null; const mine = [];
  for (const s of sl) {
    if (dayKey(s.a) !== lastDay) { h += `<div class="day">${dm(s.a)}</div>`; lastDay = dayKey(s.a); }
    const ins = []; let meIn = false;
    for (let i = 1; i <= PLAN.adf; i++) { const e = ENTS[key(s.a, i)]; if (e) { ins.push(e.name); if (e.uid === uid) meIn = true; } }
    const free = PLAN.adf - ins.length, past = s.b <= now;
    if (meIn) mine.push(`${dm(s.a)} ${hm(s.a)}–${hm(s.b)}`);
    const btn = past ? '' : meIn ? `<button data-out="${s.a}">Austragen</button>` : free > 0 ? `<button class="ok" data-in="${s.a}"${busy ? ' disabled' : ''}>Eintragen</button>` : '';
    h += `<div class="slot${meIn ? ' me' : ''}${past ? ' past' : ''}"><div class="t">${hm(s.a)}–${hm(s.b)}<small>${dur((s.b - s.a) / 60000)}</small></div>
      <div class="n">${free > 0 ? `<span class="free">${free} von ${PLAN.adf} frei</span>` : '<span class="full">voll</span>'}${ins.length ? '<br>' + ins.map(n => `<b>${esc(n)}</b>`).join(', ') : ''}</div>${btn}</div>`;
  }
  $('#slots').innerHTML = h;
  $('#mine').hidden = !mine.length; $('#mine').innerHTML = mine.length ? `<b>Du bist eingetragen:</b> ${mine.map(esc).join(' · ')}` : '';
}
$('#slots').addEventListener('click', async e => {
  const bi = e.target.closest('[data-in]'), bo = e.target.closest('[data-out]');
  if (bi) signIn(+bi.dataset.in);
  if (bo) signOut(+bo.dataset.out);
});
async function signIn(a) {
  if (busy) return; if (!navigator.onLine) return $('#mErr').textContent = 'Keine Internetverbindung.';
  busy = true; $('#mErr').textContent = ''; render();
  try {
    await putContact();
    // Erste freie Position nehmen; ist sie inzwischen besetzt, die nächste versuchen
    let ok = false;
    for (let i = 1; i <= PLAN.adf && !ok; i++) {
      const k = key(a, i); if (ENTS[k]) continue;
      try { await F.setDoc(F.doc(fs, 'sp_plaene', pid, 'eintraege', k), { slot: a, pos: i, name: ME.name, uid, src: 'qr', t: Date.now() }); ok = true; }
      catch (err) { if (!(err && err.code === 'permission-denied')) throw err; }
    }
    if (!ok) $('#mErr').textContent = 'Leider ist diese Schicht inzwischen voll.';
  } catch (err) { $('#mErr').textContent = 'Eintragen fehlgeschlagen. Bitte nochmals versuchen.'; }
  busy = false; render();
}
async function signOut(a) {
  const k = Object.keys(ENTS).find(k => ENTS[k].slot === a && ENTS[k].uid === uid); if (!k) return;
  if (!confirm('Aus dieser Schicht austragen?')) return;
  try { await F.deleteDoc(F.doc(fs, 'sp_plaene', pid, 'eintraege', k)); } catch (err) { $('#mErr').textContent = 'Austragen fehlgeschlagen.'; }
}
setInterval(render, 60000);
boot();
