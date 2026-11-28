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
$('#org').textContent = CFG.feuerwehr || 'Feuerwehr';

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
  $('#evName').textContent = PUB.name || 'Ereignis'; greet();
  const inn = MY && MY.status === 'an';
  $('#inForm').hidden = inn; $('#inDone').hidden = !inn; $('#mErr').textContent = ''; $('#dErr').textContent = '';
  if (inn) { $('#since').textContent = 'seit ' + hm(MY.tIn || MY.t) + ' Uhr'; renderAl(); wachHalten(); watchInbox(); } else { stopInbox(); setTimeout(() => $('#code').focus(), 50); }
}

/* Begrüssung nach Uhrzeit */
function greet() {
  const h = new Date().getHours(), g = h >= 5 && h < 11 ? 'Guten Morgen' : h >= 11 && h < 17 ? 'Grüezi' : h >= 17 && h < 23 ? 'Guten Abend' : 'Hallo';
  const el = $('#greet'); if (el) el.textContent = `${g} ${P.vorname || ''}`.trim();
}
setInterval(greet, 60000);

/* ---------- Auftrag aufs Handy ---------- */
let inbox = null, unsub = null, lastAid = null, RM = null;
const localVor = {};
const seenSet = aid => { try { return new Set(JSON.parse(localStorage.getItem('mf-seen-' + aid)) || []); } catch (e) { return new Set(); } };
const markSeen = (aid, ids) => { try { localStorage.setItem('mf-seen-' + aid, JSON.stringify([...new Set([...seenSet(aid), ...ids])])); } catch (e) {} };
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
  $('#bOut').disabled = !!a; $('#bOut').textContent = a ? 'Abmelden erst nach Abschluss des Auftrags möglich' : 'Abmelden (ich gehe)';
  document.querySelector('#inDone .done').hidden = !!a;
  if (!a) { lastAid = null; return; }
  const reko = a.rolle === 'reko', last = sent();
  const team = (a.team || []).map(t => typeof t === 'string' ? { v: t, n: '', lead: false } : t);
  const dup = v => team.filter(t => t.v === v).length > 1;
  const teamHtml = team.map(t => { const nm = esc(t.v + (dup(t.v) && t.n ? ' ' + t.n[0] + '.' : '')); return t.lead ? `<b>${nm}</b>` : nm; }).join(', ');
  const rows = [['Beschreibung', esc(a.text)], ['Meldung von', esc([a.melder, a.tel].filter(Boolean).join(' · '))], ['Team', teamHtml],
    ['Mittel', esc((a.mittel || []).join(', '))], ['Lage (Reko)', !reko ? esc(a.lageReko) : '']].filter(r => r[1]);
  const files = Array.isArray(a.anh) ? a.anh : [], unseen = files.filter(f => !seenSet(a.aid).has(f.id)).length;
  const vor = a.vorOrt || localVor[a.aid];
  let btns = '';
  if (a.fuehrung) {
    if (!vor) btns += `<button class="blue" data-rm="vorort">Vor Ort</button>`;
    else if (reko) btns += !a.lageT ? `<button class="reko" data-rm="lage">Lagebeurteilung</button>`
      : `<button class="reko" data-rm="rekoEnd">Reko abgeschlossen</button><button type="button" data-rm="lage">Lagebeurteilung ändern</button>`;
    else btns += `<button class="blue" data-rm="zw">Zwischenmeldung</button><button class="ok" data-rm="erledigt">Auftrag erledigt</button>`;
  }
  btns += files.length ? `<button type="button" class="anhb" data-anh="1">📎 Anhänge (${files.length})${unseen ? `<span class="dot">${unseen} neu</span>` : ''}</button>` : `<button type="button" class="anhb" disabled>Keine Anhänge</button>`;
  if (a.fuehrung && vor) btns += `<button type="button" data-cam="1">📷 Foto machen</button>`;
  btns += `<a class="abtn" href="${navUrl(a)}" target="_blank" rel="noopener">Navigation öffnen</a>`;
  if (a.tel) btns += `<a class="abtn" href="tel:${esc(a.tel.replace(/\s/g, ''))}">Meldende Person anrufen</a>`;
  const drg = a.dringend ? (a.sosi ? `<div class="sosibar"><span class="beacon"><i></i></span><span>Fahrt mit Sondersignal<small>Dringlicher Einsatz</small></span><span class="beacon"><i></i></span></div>` : '<div class="drgbar">Dringlicher Einsatz</div>') : '';
  box.innerHTML = `<div class="auf ${reko ? 'reko' : ''}${a.dringend ? ' drg' : ''}${lastAid !== a.aid ? ' new' : ''}">${drg}<span class="rol">${reko ? 'Reko-Auftrag' : 'Einsatzauftrag'}</span>${vor ? ' <span class="mute">· vor Ort</span>' : ''}
    <h3>${a.nr} · ${esc(a.art)}</h3><p class="adr">${esc(a.adresse)}</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${a.anhLokal ? `<p class="mute">${a.anhLokal} weitere Anhänge nur im KP</p>` : ''}
    ${reko && a.lageT ? `<p class="mute" style="color:var(--ok);font-weight:600">✓ Lage gemeldet ${hm(a.lageT)}</p>` : ''}${!reko && a.zwN ? `<p class="mute">${a.zwN} Zwischenmeldung${a.zwN > 1 ? 'en' : ''} gesendet</p>` : ''}
    ${!a.fuehrung ? '<p class="mute">Rückmeldungen macht der Teamchef (fett).</p>' : ''}
    <div class="btns">${btns}</div></div>`;
  if (!$('#fl').hidden) renderFiles();
  if (lastAid !== a.aid) { lastAid = a.aid; neuerAuftrag(a); }
}
/* ---------- Ton, Vibration & Benachrichtigung bei neuem Auftrag ---------- */
let AC = null, wake = null;
const alOn = () => P.alarm === true;
function renderAl() {
  const n = 'Notification' in window ? Notification.permission : 'nein';
  $('#alarmBox').classList.toggle('on', alOn());
  $('#alSt').textContent = !alOn() ? 'Aus – du hörst neue Aufträge nicht' : 'Ton an' + (n === 'granted' ? ' · Mitteilung an' : n === 'denied' ? ' · Mitteilungen blockiert' : '') + (wake ? ' · Bildschirm bleibt an' : '');
  $('#bAl').textContent = alOn() ? 'Testen' : 'Einschalten';
}
function unlockAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }
function ton(dringend) {
  if (!AC) return; const t0 = AC.currentTime + .05, g = AC.createGain(); g.connect(AC.destination); g.gain.value = 0;
  const o = AC.createOscillator(); o.type = 'square'; o.connect(g); o.start(t0);
  if (dringend) { for (let i = 0; i < 6; i++) { const t = t0 + i * .5; o.frequency.setValueAtTime(i % 2 ? 660 : 990, t); g.gain.setValueAtTime(.35, t); } g.gain.setValueAtTime(0, t0 + 3); o.stop(t0 + 3.1); }
  else { o.frequency.value = 880; for (let i = 0; i < 3; i++) { const t = t0 + i * .45; g.gain.setValueAtTime(.3, t); g.gain.setValueAtTime(0, t + .25); } o.stop(t0 + 1.5); }
}
async function wachHalten() { try { if ('wakeLock' in navigator && !wake && alOn()) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; renderAl(); }); } } catch (e) {} renderAl(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { wachHalten(); unlockAudio(); } });
$('#bAl').onclick = async () => {
  unlockAudio();
  if (!alOn()) { P.alarm = true; saveP(); try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) {} await wachHalten(); }
  ton(false); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) {} renderAl();
};
async function mitteilung(a) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const title = (a.dringend ? 'DRINGEND – ' : '') + (a.rolle === 'reko' ? 'Reko-Auftrag ' : 'Neuer Auftrag ') + a.nr, body = [a.art, a.adresse].filter(Boolean).join(' · ');
  const opt = { body, tag: 'mf-auftrag', renotify: true, requireInteraction: !!a.dringend, vibrate: a.dringend ? [500, 150, 500, 150, 500] : [300, 150, 300], icon: 'icon-192.png', data: { url: location.href } };
  try { const r = await navigator.serviceWorker?.getRegistration(); if (r) return r.showNotification(title, opt); new Notification(title, opt); } catch (e) {}
}
function neuerAuftrag(a) {
  const k = 'mf-gemeldet'; let schon = ''; try { schon = localStorage.getItem(k) || ''; } catch (e) {}
  if (schon === a.aid) return; try { localStorage.setItem(k, a.aid); } catch (e) {}   // nach Neuladen nicht nochmals alarmieren
  try { navigator.vibrate && navigator.vibrate(a.dringend ? [500, 150, 500, 150, 500, 150, 500] : [300, 150, 300]); } catch (e) {}
  if (!alOn()) return;
  ton(!!a.dringend); mitteilung(a);
  $('#alT').textContent = (a.dringend ? 'DRINGEND · ' : '') + (a.rolle === 'reko' ? 'Reko-Auftrag ' : 'Neuer Auftrag ') + a.nr;
  $('#alS').textContent = [a.art, a.adresse].filter(Boolean).join(' · '); $('#alFlash').hidden = false;
  if (a.dringend) { let n = 0; const iv = setInterval(() => { if ($('#alFlash').hidden || ++n > 3) return clearInterval(iv); ton(true); }, 4000); }
}
$('#bAlOk').onclick = () => { $('#alFlash').hidden = true; window.scrollTo(0, 0); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('pointerdown', unlockAudio, { once: true });

const kbs = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function b64ToBlob(b64, type) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'application/octet-stream' }); }
let fvUrl = null;
async function openFile(f) {
  const v = $('#fv'); $('#fvName').textContent = f.name; $('#fvBody').innerHTML = '<p class="mute">Lädt …</p>'; $('#fvOpen').hidden = true; v.hidden = false; window.scrollTo(0, 0);
  try {
    const b = await loadBlob(f); if (fvUrl) URL.revokeObjectURL(fvUrl); fvUrl = URL.createObjectURL(b);
    $('#fvBody').innerHTML = (b.type || '').startsWith('image/') ? `<img src="${fvUrl}" alt="" style="max-width:100%;border-radius:10px">`
      : b.type === 'application/pdf' ? `<iframe src="${fvUrl}" title="${esc(f.name)}" style="width:100%;height:60vh;border:1px solid var(--line);border-radius:10px"></iframe>` : '<p class="mute">Keine Vorschau.</p>';
    $('#fvOpen').href = fvUrl; $('#fvOpen').hidden = false;
  } catch (e) { $('#fvBody').innerHTML = `<p class="err">${e && e.code === 'permission-denied' ? 'Kein Zugriff auf den Anhang.' : 'Anhang konnte nicht geladen werden. Bitte nochmals versuchen.'}</p>`; }
}
$('#fvClose').onclick = () => { $('#fv').hidden = true; };
/* Fenster mit allen Anhängen */
const thumbs = {};
async function loadBlob(f) {
  const m = await withTimeout(F.getDoc(F.doc(fs, 'mf_ereignisse', PUB.eid, 'files', f.id)), 20000); if (!m.exists()) throw new Error('fehlt');
  const q = await withTimeout(F.getDocs(F.collection(fs, 'mf_ereignisse', PUB.eid, 'files', f.id, 'chunks')), 30000);
  const parts = q.docs.sort((x, y) => x.id.localeCompare(y.id)).map(d => d.data().d); if (parts.length < m.data().n) throw new Error('unvollständig');
  return b64ToBlob(parts.join(''), m.data().type || f.type);
}
function renderFiles() {
  const files = (inbox && inbox.anh) || [];
  $('#flTitle').textContent = `Anhänge Auftrag ${inbox ? inbox.nr : ''}`;
  $('#flList').innerHTML = files.map((f, i) => { const img = (f.type || '').startsWith('image/');
    return `<button type="button" data-f="${i}"><span class="pv" ${img && thumbs[f.id] ? `style="background-image:url('${thumbs[f.id]}')"` : ''}>${img ? (thumbs[f.id] ? '' : '🖼️') : '📄'}</span>${esc(f.name)}<small>${kbs(f.size)}</small></button>`; }).join('') || '<p class="mute">Keine Anhänge.</p>';
  files.forEach(f => { if ((f.type || '').startsWith('image/') && !thumbs[f.id]) { thumbs[f.id] = 'lädt'; loadBlob(f).then(b => { thumbs[f.id] = URL.createObjectURL(b); renderFiles(); }).catch(() => { delete thumbs[f.id]; }); } });
}
function openFiles() { if (!inbox || !(inbox.anh || []).length) return; markSeen(inbox.aid, inbox.anh.map(f => f.id)); $('#fl').hidden = false; window.scrollTo(0, 0); renderFiles(); renderAuftrag(); }
$('#flList').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) openFile(inbox.anh[+b.dataset.f]); });
$('#flClose').onclick = () => { $('#fl').hidden = true; };
$('#auftrag').addEventListener('click', e => { if (e.target.closest('[data-anh]')) return openFiles(); if (e.target.closest('[data-cam]')) $('#qFoto').click(); });
$('#auftrag').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return;
  if (b.dataset.rm === 'vorort') { const aid = inbox.aid; return reply({ typ: 'vorort' }).then(ok => { if (ok) { localVor[aid] = true; renderAuftrag(); } }); }
  openRm(b.dataset.rm); });
async function reply(extra) {
  const rm = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), aid: inbox.aid, t: Date.now(), ...extra };
  try { await write('an', P.code, true, rm); renderAuftrag(); return true; } catch (e) { alert(errText(e)); return false; }
}
const TIT = { lage: 'Lagebeurteilung', zw: 'Zwischenmeldung', erledigt: 'Auftrag erledigt', rekoEnd: 'Reko abschliessen' };
function openRm(typ) {
  RM = { typ, adf: 0, mittel: {}, dauer: '', fotos: [], bel: new Set(), nach: false };
  $('#sMain').hidden = true; $('#sRm').hidden = false; window.scrollTo(0, 0);
  $('#rmTitle').textContent = `Auftrag ${inbox.nr}: ${TIT[typ]}`;
  $('#rmReko').hidden = !(typ === 'lage' || typ === 'zw'); $('#rmErl').hidden = typ !== 'erledigt'; $('#rmConf').hidden = typ !== 'rekoEnd'; $('#rmFotos').hidden = typ === 'rekoEnd';
  $('#rmNone').hidden = typ !== 'rekoEnd';
  const zw = typ === 'zw';
  $('#rmLageL').textContent = zw ? 'Meldung' : 'Lagebeurteilung'; $('#rmAdfL').textContent = zw ? 'Nachforderung AdF' : 'Benötigte AdF';
  $('#rmMitL').textContent = zw ? 'Nachforderung Mittel' : 'Benötigte Mittel'; $('#rmDauL').textContent = zw ? 'Voraussichtliche Restdauer' : 'Geschätzte Dauer';
  $('#rmLage').value = ''; $('#rmText').value = ''; $('#rmBelFrei').value = ''; $('#rmNachT').value = ''; $('#rmErr').textContent = '';
  if (typ === 'lage' && inbox.lage) { const l = inbox.lage; $('#rmLage').value = l.text || ''; RM.adf = l.adf || 0; RM.mittel = { ...(l.m || {}) }; RM.dauer = l.dauer || ''; }
  $('#rmConfT').textContent = `Lage gemeldet um ${inbox.lageT ? hm(inbox.lageT) : '–'}. Ist die Reko fertig? Der Auftrag geht danach im KP nach «Pendent».`;
  $('#rmSend').textContent = typ === 'rekoEnd' ? 'Reko abgeschlossen' : typ === 'erledigt' ? 'Auftrag erledigt' : 'Senden';
  renderRm(); renderThumbs();
}
function renderRm() {
  $('#rmAdf').textContent = RM.adf;
  $('#rmMittel').innerHTML = (inbox.gattungen || []).map(g => `<button type="button" data-g="${esc(g)}" class="${RM.mittel[g] ? 'on' : ''}">${RM.mittel[g] > 1 ? RM.mittel[g] + '× ' : ''}${esc(g)}</button>`).join('');
  $('#rmDauer').innerHTML = DAUER.map(d => `<button type="button" data-d="${d}" class="${RM.dauer === d ? 'on' : ''}">${d}</button>`).join('');
  const ml = inbox.mittelList || [];
  $('#rmBel').innerHTML = ml.length ? ml.map(m => `<button type="button" data-b="${esc(m.id)}" class="${RM.bel.has(m.id) ? 'on' : ''}">${esc(m.name)}</button>`).join('') : '<span class="mute">Keine Mittel zugewiesen.</span>';
  document.querySelectorAll('#rmNach button').forEach(b => b.classList.toggle('on', (b.dataset.n === '1') === RM.nach));
  $('#rmNachL').hidden = !RM.nach;
  $('#rmFolgeHint').hidden = !(RM.nach || RM.bel.size || $('#rmBelFrei').value.trim());
}
$('#rmBel').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (!b) return; RM.bel.has(b.dataset.b) ? RM.bel.delete(b.dataset.b) : RM.bel.add(b.dataset.b); renderRm(); });
$('#rmNach').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (!b) return; RM.nach = b.dataset.n === '1'; renderRm(); if (RM.nach) $('#rmNachT').focus(); });
$('#rmBelFrei').addEventListener('input', () => renderRm());
$('#rmMinus').onclick = () => { RM.adf = Math.max(0, RM.adf - 1); renderRm(); };
$('#rmPlus').onclick = () => { RM.adf++; renderRm(); };
$('#rmMittel').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; const g = b.dataset.g, n = RM.mittel[g] || 0; RM.mittel[g] = n >= 3 ? 0 : n + 1; if (!RM.mittel[g]) delete RM.mittel[g]; renderRm(); });
$('#rmDauer').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { RM.dauer = RM.dauer === b.dataset.d ? '' : b.dataset.d; renderRm(); } });
/* Foto verkleinern (max. ~250 KB, damit bis 3 Fotos in eine Meldung passen) */
async function shrink(f) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
  const sc = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); let q = .65, d = c.toDataURL('image/jpeg', q);
  while (d.length > 330000 && q > .2) { q -= .08; d = c.toDataURL('image/jpeg', q); }
  if (d.length > 330000) { const c2 = document.createElement('canvas'); c2.width = c.width / 2; c2.height = c.height / 2; c2.getContext('2d').drawImage(c, 0, 0, c2.width, c2.height); d = c2.toDataURL('image/jpeg', .6); }
  return d;
}
const MAXF = 3;
function renderThumbs() {
  $('#rmThumbs').innerHTML = RM.fotos.map((d, i) => `<span class="thumb"><img src="${d}" alt="Foto ${i + 1}"><button type="button" data-x="${i}" aria-label="Foto entfernen">×</button></span>`).join('');
  $('#rmFotoB').hidden = RM.fotos.length >= MAXF; $('#rmFotoB').textContent = RM.fotos.length ? '📷 Weiteres Foto' : '📷 Foto aufnehmen';
}
$('#rmThumbs').addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) { RM.fotos.splice(+b.dataset.x, 1); renderThumbs(); } });
$('#rmFotoB').onclick = () => $('#rmFoto').click();
$('#rmFoto').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { RM.fotos.push(await shrink(f)); renderThumbs(); } catch (err) { $('#rmErr').textContent = 'Foto konnte nicht gelesen werden.'; }
});
/* Foto jederzeit zum Auftrag (alle im Team) */
$('#qFoto').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !inbox || !inbox.aid) return;
  toast('Foto wird gesendet …');
  try { const d = await shrink(f); if (await reply({ typ: 'foto', fotos: [d] })) toast('✓ Foto beim Auftrag gespeichert'); } catch (err) { toast('Foto konnte nicht gesendet werden.'); }
});
let tT = null;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => el.hidden = true, 3500); }
const closeRm = () => { $('#sRm').hidden = true; showMain(); };
$('#rmCancel').onclick = closeRm;
async function sendRm(keinEinsatz) {
  let x;
  if (RM.typ === 'lage') x = { typ: 'lage', lage: $('#rmLage').value.trim(), adf: RM.adf, mittel: RM.mittel, dauer: RM.dauer };
  else if (RM.typ === 'zw') { x = { typ: 'zw', text: $('#rmLage').value.trim(), adf: RM.adf, mittel: RM.mittel, dauer: RM.dauer };
    if (!x.text && !x.adf && !Object.keys(x.mittel).length && !x.dauer) { $('#rmErr').textContent = 'Bitte eine Meldung, Nachforderung oder Restdauer angeben.'; return; } }
  else if (RM.typ === 'rekoEnd') x = { typ: 'rekoEnd', keinEinsatz: !!keinEinsatz };
  else { x = { typ: 'erledigt', text: $('#rmText').value.trim(), belassen: [...RM.bel], belassenFrei: $('#rmBelFrei').value.trim(), nach: RM.nach, nachText: $('#rmNachT').value.trim() };
    if (RM.nach && !x.nachText) { $('#rmErr').textContent = 'Bitte kurz beschreiben, was noch zu tun ist.'; return; } }
  if (RM.fotos.length && RM.typ !== 'rekoEnd') x.fotos = RM.fotos;
  $('#rmSend').disabled = true; if (await reply(x)) { if (RM.typ === 'lage') inbox.lageT = inbox.lageT || Date.now(); closeRm(); toast('✓ An das KP gesendet'); } $('#rmSend').disabled = false;
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
window.MF_TEST = { neuerAuftrag, renderAl, ton };
