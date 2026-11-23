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
  if (inn) { $('#since').textContent = 'seit ' + hm(MY.tIn || MY.t) + ' Uhr'; watchInbox(); } else { stopInbox(); setTimeout(() => $('#code').focus(), 50); }
}

/* ---------- Auftrag aufs Handy ---------- */
let inbox = null, unsub = null, lastAid = null, RM = null;
const DAUER = ['< 30 Min.', '1 h', '2 h', '> 2 h'];
function watchInbox() {
  if (unsub) return;
  unsub = F.onSnapshot(F.doc(fs, 'mf_ereignisse', PUB.eid, 'inbox', uid), d => { inbox = d.exists() ? d.data() : null; renderAuftrag(); }, () => {});
}
function stopInbox() { if (unsub) { unsub(); unsub = null; } inbox = null; renderAuftrag(); }
const navUrl = a => a.lat != null ? (/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? `https://maps.apple.com/?daddr=${a.lat},${a.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`)
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.adresse)}`;
const sent = () => (MY && MY.rm && inbox && MY.rm.aid === inbox.aid) ? MY.rm : null;
function renderAuftrag() {
  const a = inbox && inbox.aid ? inbox : null, box = $('#auftrag');
  $('#noAuftrag').hidden = !!a || !(MY && MY.status === 'an'); box.hidden = !a;
  document.querySelector('#inDone .done').hidden = !!a;
  if (!a) { lastAid = null; return; }
  const reko = a.rolle === 'reko', last = sent();
  const rows = [['Priorität', a.prio], ['Beschreibung', a.text], ['Meldung von', [a.melder, a.tel].filter(Boolean).join(' · ')], ['Führung', a.fuehrungName], ['Team', (a.team || []).join(', ')],
    ['Mittel', (a.mittel || []).join(', ')], ['Lage (Reko)', !reko ? a.lageReko : ''], ['Anhänge', a.anh ? a.anh + ' im KP (nur auf dem iPad)' : '']].filter(r => r[1]);
  let btns = '';
  if (a.fuehrung) {
    if (!a.vorOrt) btns += `<button class="blue" data-rm="vorort">Vor Ort</button>`;
    btns += reko ? `<button class="reko" data-rm="rekoEnd">Reko abschliessen</button>` : `<button class="ok" data-rm="erledigt">Auftrag erledigt</button>`;
  }
  btns += `<a class="abtn" href="${navUrl(a)}" target="_blank" rel="noopener">Navigation öffnen</a>`;
  if (a.tel) btns += `<a class="abtn" href="tel:${esc(a.tel.replace(/\s/g, ''))}">Meldende Person anrufen</a>`;
  box.innerHTML = `<div class="auf ${reko ? 'reko' : ''}${lastAid !== a.aid ? ' new' : ''}"><span class="rol">${reko ? 'Reko-Auftrag' : 'Einsatzauftrag'}</span>${a.vorOrt ? ' <span class="mute">· vor Ort</span>' : ''}
    <h3>${a.nr} · ${esc(a.art)}</h3><p class="adr">${esc(a.adresse)}</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${!a.fuehrung ? '<p class="mute">Rückmeldungen macht die Führung (★).</p>' : ''}${last && last.typ !== 'vorort' ? '<p class="mute" style="color:var(--ok);font-weight:600">✓ Rückmeldung gesendet</p>' : ''}
    <div class="btns">${btns}</div></div>`;
  if (lastAid !== a.aid) { lastAid = a.aid; try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) {} }
}
$('#auftrag').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return;
  if (b.dataset.rm === 'vorort') return reply({ typ: 'vorort' });
  openRm(b.dataset.rm); });
async function reply(extra) {
  const rm = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), aid: inbox.aid, t: Date.now(), ...extra };
  try { await write('an', P.code, true, rm); renderAuftrag(); return true; } catch (e) { alert(errText(e)); return false; }
}
function openRm(typ) {
  RM = { typ, adf: 0, mittel: {}, dauer: '', foto: null };
  $('#sMain').hidden = true; $('#sRm').hidden = false; window.scrollTo(0, 0);
  $('#rmTitle').textContent = `Auftrag ${inbox.nr}: ${typ === 'rekoEnd' ? 'Reko abschliessen' : 'Auftrag erledigt'}`;
  $('#rmReko').hidden = typ !== 'rekoEnd'; $('#rmErl').hidden = typ === 'rekoEnd'; $('#rmNone').hidden = typ !== 'rekoEnd';
  $('#rmLage').value = ''; $('#rmText').value = ''; $('#rmImg').hidden = true; $('#rmErr').textContent = ''; renderRm();
}
function renderRm() {
  $('#rmAdf').textContent = RM.adf;
  $('#rmMittel').innerHTML = (inbox.gattungen || []).map(g => `<button type="button" data-g="${esc(g)}" class="${RM.mittel[g] ? 'on' : ''}">${RM.mittel[g] > 1 ? RM.mittel[g] + '× ' : ''}${esc(g)}</button>`).join('');
  $('#rmDauer').innerHTML = DAUER.map(d => `<button type="button" data-d="${d}" class="${RM.dauer === d ? 'on' : ''}">${d}</button>`).join('');
}
$('#rmMinus').onclick = () => { RM.adf = Math.max(0, RM.adf - 1); renderRm(); };
$('#rmPlus').onclick = () => { RM.adf++; renderRm(); };
$('#rmMittel').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; const g = b.dataset.g, n = RM.mittel[g] || 0; RM.mittel[g] = n >= 3 ? 0 : n + 1; if (!RM.mittel[g]) delete RM.mittel[g]; renderRm(); });
$('#rmDauer').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { RM.dauer = RM.dauer === b.dataset.d ? '' : b.dataset.d; renderRm(); } });
$('#rmFotoB').onclick = () => $('#rmFoto').click();
$('#rmFoto').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
    const sc = Math.min(1, 1024 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); let q = .6, d = c.toDataURL('image/jpeg', q); while (d.length > 600000 && q > .25) { q -= .1; d = c.toDataURL('image/jpeg', q); }
    RM.foto = d; $('#rmImg').src = d; $('#rmImg').hidden = false; $('#rmFotoB').textContent = 'Anderes Foto';
  } catch (err) { $('#rmErr').textContent = 'Foto konnte nicht gelesen werden.'; }
});
const closeRm = () => { $('#sRm').hidden = true; showMain(); };
$('#rmCancel').onclick = closeRm;
async function sendRm(keinEinsatz) {
  const x = RM.typ === 'rekoEnd' ? { typ: 'rekoEnd', lage: $('#rmLage').value.trim(), adf: RM.adf, mittel: RM.mittel, dauer: RM.dauer, keinEinsatz: !!keinEinsatz } : { typ: 'erledigt', text: $('#rmText').value.trim() };
  if (RM.foto) x.foto = RM.foto;
  $('#rmSend').disabled = true; if (await reply(x)) closeRm(); $('#rmSend').disabled = false;
}
$('#rmSend').onclick = () => sendRm(false);
$('#rmNone').onclick = () => { if (confirm('Kein Einsatz nötig – Auftrag abschliessen?')) sendRm(true); };
async function write(status, code, keepTime, rm) {
  const now = Date.now();
  const doc = { name: P.name, vorname: P.vorname, nachname: P.nachname, rang: P.rang, masch: !!P.masch, tel: P.tel,
    status, code, t: rm && MY ? MY.t : now, tIn: status === 'an' ? (keepTime && MY && MY.tIn ? MY.tIn : now) : (MY && MY.tIn) || null, rm: rm || (MY && MY.rm) || null };
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
