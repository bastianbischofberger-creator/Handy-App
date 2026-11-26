/* Schichtplanung (Brandwache) – Feuerwehr RTL
   Pläne werden auf diesem Gerät gespeichert. Optional: Plan per QR-Code freigeben,
   dann tragen sich AdF auf eintragen.html selbst in einen Slot ein (Firebase). */
(function () {
'use strict';
const CFG = window.SP_CONFIG || {};
const { esc, hm, dm, dmy, dayKey, dur, slots, key, pad } = window.SP;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 3500); }
function confirmBox(t, x, ok, okLbl) { $('#cT').textContent = t; $('#cX').textContent = x; $('#cOk').textContent = okLbl || 'OK'; $('#cOk').onclick = () => { $('#dC').close(); ok(); }; $('#dC').showModal(); }
$('#cNo').onclick = () => $('#dC').close();

/* ---------- Speicher (dieses Gerät) ---------- */
const KEY = 'schicht-db-v1';
let DB; try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
if (!DB || !DB.plaene) DB = { plaene: {}, names: [] };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { msg('Speicher auf diesem Gerät ist voll.'); } };
let cur = null; // aktive Plan-ID
const P = () => DB.plaene[cur];

/* ---------- Uhr ---------- */
const tick = () => { $('#clock').textContent = hm(Date.now()); };
tick(); setInterval(() => { tick(); if (cur && !$('#vPlan').hidden) renderSlots(); }, 30000);

/* ---------- Ansichten ---------- */
function show(v) { for (const id of ['vDash', 'vForm', 'vPlan']) $('#' + id).hidden = id !== v; scrollTo(0, 0); }
function go(v, id) {
  if (v === 'plan') { cur = id; location.hash = 'p=' + id; show('vPlan'); renderPlan(); if (P().published) cloudWatch(id); }
  else { cur = null; cloudUnwatch(); history.replaceState(null, '', location.pathname); show('vDash'); renderDash(); }
  renderSync();
}

/* ---------- Zählen ---------- */
function stats(p) {
  const sl = slots(p), tot = sl.length * p.adf, ents = Object.values(p.eintraege || {}).filter(e => fits(p, e));
  const min = ents.reduce((s, e) => { const x = sl.find(z => z.a === e.slot); return s + (x ? (x.b - x.a) / 60000 : 0); }, 0);
  return { sl, tot, n: ents.length, min, pers: new Set(ents.map(e => e.name.trim().toLowerCase())).size };
}
const fits = (p, e) => e.pos >= 1 && e.pos <= p.adf && slots(p).some(s => s.a === e.slot);

/* ---------- Dashboard ---------- */
function renderDash() {
  const list = Object.entries(DB.plaene).sort((a, b) => b[1].start - a[1].start);
  const now = Date.now();
  $('#dash').innerHTML = `<button class="tile new" id="bNew"><b>+ Neue Brandwache</b><span class="mute">Startzeit, Schichtlänge, Anzahl AdF und Endzeit festlegen</span></button>` +
    list.map(([id, p]) => {
      const s = stats(p), past = p.end < now, pc = s.tot ? Math.round(s.n / s.tot * 100) : 0;
      return `<button class="tile${past ? ' past' : ''}" data-id="${id}">
        <h3>${esc(p.title)}${p.published && p.offen ? '<span class="badge">QR offen</span>' : ''}${past ? '<span class="badge g">vorbei</span>' : p.start <= now ? '<span class="badge ok">läuft</span>' : ''}</h3>
        <span class="d">${dm(p.start)} ${hm(p.start)} – ${dayKey(p.start) === dayKey(p.end) ? '' : dm(p.end) + ' '}${hm(p.end)}${p.ort ? ' · ' + esc(p.ort) : ''}</span>
        <span class="d">${s.sl.length} Schichten à ${dur(p.len)} · ${p.adf} AdF</span>
        <span class="bar"><i style="width:${pc}%"></i></span>
        <span class="d"><b style="color:var(--ink)">${s.n} / ${s.tot}</b> besetzt${s.n < s.tot ? ` · <b style="color:var(--red)">${s.tot - s.n} offen</b>` : ' · komplett'}</span>
      </button>`;
    }).join('');
}
$('#dash').addEventListener('click', e => {
  if (e.target.closest('#bNew')) return openForm(null);
  const t = e.target.closest('[data-id]'); if (t) go('plan', t.dataset.id);
});

/* ---------- Formular ---------- */
const LENS = [60, 120, 180, 240, 360, 480, 720];
let fLen = 180, fLenOther = false, editId = null;
const toLocal = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = v => v ? new Date(v).getTime() : NaN;
function renderLenChips() {
  $('#fLenChips').innerHTML = LENS.map(m => `<button type="button" data-m="${m}" class="${!fLenOther && fLen === m ? 'on' : ''}">${dur(m)}</button>`).join('') +
    `<button type="button" data-m="x" class="${fLenOther ? 'on' : ''}">Andere …</button>`;
  $('#fLenMin').hidden = !fLenOther;
}
$('#fLenChips').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  if (b.dataset.m === 'x') { fLenOther = true; $('#fLenMin').value = fLen; setTimeout(() => $('#fLenMin').focus(), 30); }
  else { fLenOther = false; fLen = +b.dataset.m; }
  renderLenChips(); preview();
});
$('#fLenMin').addEventListener('input', () => { fLen = Math.round(+$('#fLenMin').value) || 0; preview(); });
$('#fAdfM').onclick = () => { $('#fAdf').value = Math.max(1, (+$('#fAdf').value || 1) - 1); preview(); };
$('#fAdfP').onclick = () => { $('#fAdf').value = Math.min(20, (+$('#fAdf').value || 0) + 1); preview(); };
for (const id of ['#fStart', '#fEnd', '#fAdf']) $(id).addEventListener('input', preview);
$('#fStart').addEventListener('change', () => { // Endzeit mitschieben, wenn sie davor liegt
  const a = fromLocal($('#fStart').value), b = fromLocal($('#fEnd').value);
  if (a && (!b || b <= a)) $('#fEnd').value = toLocal(a + 12 * 3600000); preview();
});

function readForm() {
  return { title: $('#fName').value.trim(), ort: $('#fOrt').value.trim(), ver: $('#fVer').value.trim(), note: $('#fNote').value.trim(),
    start: fromLocal($('#fStart').value), end: fromLocal($('#fEnd').value), len: fLen, adf: Math.round(+$('#fAdf').value) || 0 };
}
function check(f) {
  if (!f.start || isNaN(f.start)) return 'Startzeit fehlt.';
  if (!f.end || isNaN(f.end)) return 'Endzeit fehlt.';
  if (f.end <= f.start) return 'Die Endzeit muss nach der Startzeit liegen.';
  if (f.end - f.start > 14 * 86400000) return 'Maximal 14 Tage.';
  if (!(f.len >= 15)) return 'Schichtlänge mindestens 15 Minuten.';
  if (!(f.adf >= 1 && f.adf <= 20)) return 'Anzahl AdF zwischen 1 und 20.';
  if ((f.end - f.start) / (f.len * 60000) > SP.MAX_SLOTS) return `Zu viele Schichten (max. ${SP.MAX_SLOTS}).`;
  return '';
}
function preview() {
  const f = readForm(), err = check(f), el = $('#fPrev');
  el.classList.toggle('bad', !!err);
  if (err) { el.textContent = err; return; }
  const sl = slots(f), last = sl[sl.length - 1], short = (last.b - last.a) / 60000 < f.len;
  el.innerHTML = `${sl.length} Schichten à ${dur(f.len)} · ${f.adf} AdF pro Schicht = <b>${sl.length * f.adf} Einsätze</b> · total ${dur(Math.round((f.end - f.start) / 60000))}` +
    (short ? `<br><span class="mute" style="font-weight:500">Letzte Schicht ist kürzer: ${hm(last.a)}–${hm(last.b)} (${dur((last.b - last.a) / 60000)})</span>` : '');
}
function openForm(id) {
  editId = id; const p = id ? DB.plaene[id] : null;
  $('#fTitle').textContent = p ? 'Brandwache bearbeiten' : 'Neue Brandwache';
  $('#bFSave').textContent = p ? 'Speichern' : 'Plan erstellen';
  const nextHour = Math.ceil(Date.now() / 3600000) * 3600000;
  $('#fName').value = p ? p.title : ''; $('#fOrt').value = p ? p.ort : ''; $('#fVer').value = p ? p.ver : ''; $('#fNote').value = p ? p.note : '';
  $('#fStart').value = toLocal(p ? p.start : nextHour); $('#fEnd').value = toLocal(p ? p.end : nextHour + 12 * 3600000);
  fLen = p ? p.len : 180; fLenOther = !LENS.includes(fLen); $('#fAdf').value = p ? p.adf : 2; $('#fErr').textContent = '';
  renderLenChips(); preview(); show('vForm'); if (!p) setTimeout(() => $('#fName').focus(), 50);
}
$('#bFCancel').onclick = () => editId ? go('plan', editId) : go('dash');
$('#bFSave').onclick = () => {
  const f = readForm(); const err = !f.title ? 'Bezeichnung fehlt.' : check(f);
  $('#fErr').textContent = err; if (err) return;
  if (!editId) {
    const id = uid(); DB.plaene[id] = { ...f, created: Date.now(), eintraege: {}, published: false, offen: false }; save(); go('plan', id); return;
  }
  const p = DB.plaene[editId], test = { ...p, ...f };
  const lost = Object.entries(p.eintraege).filter(([, e]) => !fits(test, e));
  const apply = () => {
    Object.assign(p, f); for (const [k] of lost) { delete p.eintraege[k]; cloudDel(editId, k); }
    save(); cloudMeta(editId); go('plan', editId);
  };
  if (lost.length) confirmBox('Einträge fallen weg', `${lost.length} eingetragene AdF passen nicht mehr in die neuen Schichten (${lost.map(([, e]) => e.name).join(', ')}) und werden entfernt.`, apply, 'Trotzdem speichern');
  else apply();
};

/* ---------- Plan anzeigen ---------- */
function renderPlan() {
  const p = P(); if (!p) return go('dash');
  const s = stats(p);
  $('#pTitle').textContent = p.title;
  $('#pMeta').innerHTML = [
    `<span><b>${dm(p.start)} ${hm(p.start)}</b> bis <b>${dayKey(p.start) === dayKey(p.end) ? '' : dm(p.end) + ' '}${hm(p.end)}</b></span>`,
    p.ort && `<span>Ort: <b>${esc(p.ort)}</b></span>`, p.ver && `<span>Verantwortlich: <b>${esc(p.ver)}</b></span>`,
    p.note && `<span style="flex-basis:100%">Hinweis: <b>${esc(p.note)}</b></span>`].filter(Boolean).join('');
  $('#pStats').innerHTML = [['Schichten', `${s.sl.length} × ${dur(p.len)}`], ['AdF pro Schicht', p.adf], ['Besetzt', `${s.n} / ${s.tot}`],
    ['Noch offen', s.tot - s.n], ['Personen', s.pers], ['Personenstunden', (Math.round(s.min / 6) / 10).toString().replace('.0', '')]]
    .map(([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`).join('');
  renderQrBox(); renderSlots();
}
function renderQrBox() {
  const p = P(), el = $('#pQr');
  if (!CFG.firebase) { el.hidden = true; return; } el.hidden = false;
  el.classList.toggle('off', !(p.published && p.offen));
  if (!p.published) el.innerHTML = `<div><b>Optional: AdF tragen sich selbst ein</b><br><span class="mute">QR-Code erstellen – AdF scannen und wählen einen freien Slot.</span></div><button class="ok" id="bPub">QR-Code erstellen</button>`;
  else if (p.offen) el.innerHTML = `<div><b>Eintragen per QR ist offen</b><br><span class="mute">Neue Einträge erscheinen hier automatisch.</span></div><button class="ok" id="bQR">QR-Code zeigen</button><button id="bLock">Eintragen schliessen</button>`;
  else el.innerHTML = `<div><b>Eintragen per QR ist geschlossen</b><br><span class="mute">Der QR-Code zeigt den Plan nicht mehr an.</span></div><button id="bUnlock">Wieder öffnen</button>`;
}
function renderSlots() {
  const p = P(); if (!p) return;
  const now = Date.now(), byKey = p.eintraege; let lastDay = null, h = '';
  for (const s of slots(p)) {
    const dk = dayKey(s.a); if (dk !== lastDay) { h += `<div class="day">${dm(s.a)} ${new Date(s.a).getFullYear()}</div>`; lastDay = dk; }
    const cls = s.b <= now ? ' past' : s.a <= now ? ' now' : '';
    let pos = '';
    for (let i = 1; i <= p.adf; i++) {
      const e = byKey[key(s.a, i)];
      pos += e ? `<span class="p">${esc(e.name)}${e.tel ? ` <small>${esc(e.tel)}</small>` : ''}${e.src === 'qr' ? '<span class="src" title="Selbst eingetragen per QR">QR</span>' : ''}<button data-del="${key(s.a, i)}" title="Entfernen" aria-label="Entfernen">×</button></span>`
        : `<button class="p free" data-add="${s.a}" data-pos="${i}">+ frei</button>`;
    }
    h += `<div class="slot${cls}"><div class="t">${hm(s.a)}–${hm(s.b)}<small>${dur((s.b - s.a) / 60000)}</small></div><div class="pos">${pos}</div></div>`;
  }
  $('#pSlots').innerHTML = h || '<p class="empty">Keine Schichten.</p>';
}
$('#pSlots').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'), d = e.target.closest('[data-del]'), p = P();
  if (a) openAssign(+a.dataset.add, +a.dataset.pos);
  if (d) { const en = p.eintraege[d.dataset.del]; confirmBox('Eintrag entfernen?', `${en.name} aus dieser Schicht entfernen?`, () => {
    if (p.published && !cloud.user) return needLogin(() => { delete p.eintraege[d.dataset.del]; save(); cloudDel(cur, d.dataset.del); renderPlan(); });
    delete p.eintraege[d.dataset.del]; save(); cloudDel(cur, d.dataset.del); renderPlan(); }, 'Entfernen'); }
});

/* ---------- Von Hand eintragen ---------- */
let asTarget = null;
function openAssign(slotA, pos) {
  const p = P(), s = slots(p).find(x => x.a === slotA);
  asTarget = { slotA, pos };
  $('#asSlot').textContent = `${dm(s.a)} ${hm(s.a)}–${hm(s.b)} · Position ${pos} von ${p.adf}`;
  $('#asName').value = ''; $('#asTel').value = ''; $('#asErr').textContent = '';
  $('#names').innerHTML = (DB.names || []).map(n => `<option value="${esc(n.name)}">`).join('');
  $('#dAs').showModal(); setTimeout(() => $('#asName').focus(), 50);
}
$('#asName').addEventListener('change', () => { const n = (DB.names || []).find(x => x.name === $('#asName').value); if (n && n.tel && !$('#asTel').value) $('#asTel').value = n.tel; });
$('#fAs').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value !== 'ok') return;
  const name = $('#asName').value.trim(), tel = $('#asTel').value.trim(), p = P();
  if (!name) { e.preventDefault(); $('#asErr').textContent = 'Name fehlt.'; return; }
  const k = key(asTarget.slotA, asTarget.pos);
  if (Object.values(p.eintraege).some(x => x.slot === asTarget.slotA && x.name.trim().toLowerCase() === name.toLowerCase())) { e.preventDefault(); $('#asErr').textContent = `${name} ist in dieser Schicht schon eingetragen.`; return; }
  const ent = { slot: asTarget.slotA, pos: asTarget.pos, name, tel, src: 'manuell', t: Date.now() };
  const doIt = () => {
    p.eintraege[k] = ent; DB.names = [{ name, tel }, ...(DB.names || []).filter(n => n.name !== name)].slice(0, 80);
    save(); cloudPut(cur, k, ent); renderPlan();
  };
  if (p.published && !cloud.user) needLogin(doIt); else doIt();
});

/* ---------- Teilen als Text ---------- */
function planText(p) {
  const L = [`BRANDWACHE: ${p.title}`, p.ort && `Ort: ${p.ort}`, `${dm(p.start)} ${hm(p.start)} – ${dm(p.end)} ${hm(p.end)}`, p.ver && `Verantwortlich: ${p.ver}`, p.note && `Hinweis: ${p.note}`].filter(Boolean);
  L.push('');
  let lastDay = null;
  for (const s of slots(p)) {
    if (dayKey(s.a) !== lastDay) { L.push(`— ${dm(s.a)} —`); lastDay = dayKey(s.a); }
    const n = []; for (let i = 1; i <= p.adf; i++) { const e = p.eintraege[key(s.a, i)]; n.push(e ? e.name : 'FREI'); }
    L.push(`${hm(s.a)}–${hm(s.b)}: ${n.join(', ')}`);
  }
  if (p.published && p.offen) L.push('', 'Selbst eintragen: ' + adfUrl(cur));
  return L.join('\n');
}
$('#bShare').onclick = async () => {
  const t = planText(P());
  if (navigator.share) { try { await navigator.share({ title: 'Brandwache', text: t }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(t); msg('Plan als Text kopiert – z. B. in WhatsApp einfügen.'); } catch (e) { msg('Kopieren nicht möglich.'); }
};

/* ---------- Drucken / PDF ---------- */
$('#bPrint').onclick = () => {
  const p = P(), w = window.open('', '_blank'); if (!w) return msg('Pop-up wurde blockiert.');
  const s = stats(p); let lastDay = null, rows = '';
  for (const x of s.sl) {
    if (dayKey(x.a) !== lastDay) { rows += `<tr class="d"><td colspan="${p.adf + 1}">${dm(x.a)} ${new Date(x.a).getFullYear()}</td></tr>`; lastDay = dayKey(x.a); }
    rows += `<tr><td class="t">${hm(x.a)}–${hm(x.b)}</td>`;
    for (let i = 1; i <= p.adf; i++) { const e = p.eintraege[key(x.a, i)]; rows += `<td>${e ? `<b>${esc(e.name)}</b>${e.tel ? `<br><small>${esc(e.tel)}</small>` : ''}` : ''}</td>`; }
    rows += '</tr>';
  }
  const qr = p.published && p.offen && window.qrcode ? `<div class="qr">${qrSvg(adfUrl(cur), 4)}<p>Selbst eintragen:<br>QR-Code scannen</p></div>` : '';
  w.document.write(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Schichtplan ${esc(p.title)}</title><style>
    @page{size:A4 ${p.adf > 3 ? 'landscape' : 'portrait'};margin:14mm}body{font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:0}
    header{display:flex;gap:14px;align-items:center;border-bottom:3px solid #c8102e;padding-bottom:8px;margin-bottom:10px}header img{width:60px}header div{flex:1}
    h1{font-size:22px;margin:0}p{margin:2px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px 7px;text-align:left;vertical-align:top;height:30px}
    th{background:#eee}td.t{white-space:nowrap;font-weight:bold;width:95px}tr.d td{background:#c8102e;color:#fff;font-weight:bold;height:auto}small{color:#444}
    .qr{text-align:center;font-size:11px}.qr svg{width:90px;height:90px}tr{page-break-inside:avoid}</style></head><body>
    <header><img src="${new URL('logo.png', location.href).href}" alt=""><div><h1>Brandwache: ${esc(p.title)}</h1>
    <p>${dm(p.start)} ${dmy(p.start)} ${hm(p.start)} – ${dmy(p.end)} ${hm(p.end)} · ${s.sl.length} Schichten à ${dur(p.len)} · ${p.adf} AdF</p>
    ${p.ort ? `<p>Ort: <b>${esc(p.ort)}</b></p>` : ''}${p.ver ? `<p>Verantwortlich: <b>${esc(p.ver)}</b></p>` : ''}${p.note ? `<p>Hinweis: ${esc(p.note)}</p>` : ''}</div>${qr}</header>
    <table><thead><tr><th>Zeit</th>${Array.from({ length: p.adf }, (_, i) => `<th>AdF ${i + 1}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:8px;color:#666;font-size:10px">${esc(CFG.feuerwehr || '')} · Stand ${dmy(Date.now())} ${hm(Date.now())} · Besetzt ${s.n}/${s.tot}</p>
    <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};

/* ---------- Löschen ---------- */
$('#bDel').onclick = () => confirmBox('Plan löschen?', `«${P().title}» mit allen Einträgen löschen? Das kann nicht rückgängig gemacht werden.`, async () => {
  const id = cur, p = P();
  if (p.published) { if (!cloud.user) return needLogin(() => $('#bDel').click()); try { await cloudDelPlan(id); } catch (e) { return msg('Löschen in der Synchronisation fehlgeschlagen.'); } }
  delete DB.plaene[id]; save(); go('dash'); msg('Plan gelöscht.');
}, 'Löschen');
$('#bEdit').onclick = () => openForm(cur);
$('#bBack').onclick = () => go('dash');

/* ================= QR / Firebase (optional) ================= */
const cloud = { ready: null, user: null, F: null, fs: null, Au: null, auth: null, unsubs: [], err: '', pending: false };
const adfUrl = id => new URL('eintragen.html?p=' + encodeURIComponent(id), location.href).href;
function qrSvg(text, cell) { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(cell || 8, 2); }

function initCloud() {
  if (!CFG.firebase) return Promise.reject(new Error('nofb'));
  if (cloud.ready) return cloud.ready;
  cloud.ready = (async () => {
    const [appM, Au, F] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    const app = appM.initializeApp(CFG.firebase, 'schicht');
    const auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    let fs; try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    Object.assign(cloud, { F, fs, Au, auth });
    await new Promise(res => { let first = true; Au.onAuthStateChanged(auth, u => { cloud.user = u && !u.isAnonymous ? u : null; renderSync(); if (first) { first = false; res(); } }); });
  })();
  cloud.ready.catch(() => { cloud.ready = null; });
  return cloud.ready;
}
let afterLogin = null;
async function needLogin(then) {
  try { await initCloud(); } catch (e) { return msg(navigator.onLine ? 'Synchronisation nicht verfügbar.' : 'Keine Internetverbindung.'); }
  if (cloud.user) return then && then();
  afterLogin = then; $('#lErr').textContent = ''; $('#dLogin').showModal();
}
$('#bLoginX').onclick = () => { afterLogin = null; $('#dLogin').close(); };
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await cloud.Au.signInWithEmailAndPassword(cloud.auth, f.email.value.trim(), f.pw.value); f.pw.value = ''; $('#dLogin').close();
    const t = afterLogin; afterLogin = null; if (cur && P() && P().published) cloudWatch(cur); t && t(); }
  catch (err) { $('#lErr').textContent = /invalid|wrong|user-not-found/.test(err.code || '') ? 'E-Mail oder Passwort falsch.' : 'Anmeldung fehlgeschlagen (' + (err.code || err.message) + ').'; }
});

const fail = e => { cloud.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Firestore-Regeln prüfen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); renderSync(); };
const PD = id => cloud.F.doc(cloud.fs, 'sp_plaene', id);
const pubMeta = p => ({ title: p.title, ort: p.ort || '', ver: p.ver || '', note: p.note || '', start: p.start, end: p.end, len: p.len, adf: p.adf, offen: !!p.offen, org: CFG.feuerwehr || '', upd: Date.now() });

/* Plan freigeben: Plan + bisherige Einträge hochladen */
async function publish() {
  const id = cur, p = P();
  await needLogin(async () => {
    const { F } = cloud; p.offen = true;
    try {
      await F.setDoc(PD(id), pubMeta(p));
      await Promise.all(Object.entries(p.eintraege).map(([k, e]) => F.setDoc(F.doc(PD(id), 'eintraege', k), { slot: e.slot, pos: e.pos, name: e.name, src: e.src || 'manuell', t: e.t || Date.now() })));
    } catch (e) { p.offen = false; fail(e); return msg(cloud.err); }
    p.published = true; save(); cloudWatch(id); renderPlan(); openQR();
  });
}
function cloudMeta(id) { const p = DB.plaene[id]; if (!p || !p.published || !cloud.user) return; cloud.F.setDoc(PD(id), pubMeta(p)).catch(fail); }
function cloudPut(id, k, e) { const p = DB.plaene[id]; if (!p || !p.published || !cloud.user) return; cloud.F.setDoc(cloud.F.doc(PD(id), 'eintraege', k), { slot: e.slot, pos: e.pos, name: e.name, src: 'manuell', t: e.t }).catch(fail); }
function cloudDel(id, k) { const p = DB.plaene[id]; if (!p || !p.published || !cloud.user) return; cloud.F.deleteDoc(cloud.F.doc(PD(id), 'eintraege', k)).catch(fail); }
async function cloudDelPlan(id) {
  await initCloud(); const { F } = cloud;
  for (const sub of ['eintraege', 'kontakte']) { const q = await F.getDocs(F.collection(PD(id), sub)); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); }
  await F.deleteDoc(PD(id));
}
function cloudUnwatch() { cloud.unsubs.forEach(u => u()); cloud.unsubs = []; }
async function cloudWatch(id) {
  cloudUnwatch(); try { await initCloud(); } catch (e) { renderSync(); return; }
  if (!cloud.user || cur !== id) { renderSync(); return; }
  const { F } = cloud, tels = {}; let ents = null;
  const merge = () => {
    const p = DB.plaene[id]; if (!p || !ents) return;
    const next = {};
    for (const d of ents) { const e = d.data(), old = p.eintraege[d.id]; next[d.id] = { ...e, tel: (e.uid && tels[e.uid]) || (old && old.tel) || '' }; }
    p.eintraege = next; save(); cloud.err = ''; if (cur === id) renderPlan(); renderSync();
  };
  const o = { includeMetadataChanges: true };
  cloud.unsubs.push(F.onSnapshot(F.collection(PD(id), 'eintraege'), o, q => { ents = q.docs; cloud.pending = q.metadata.hasPendingWrites; merge(); }, fail));
  cloud.unsubs.push(F.onSnapshot(F.collection(PD(id), 'kontakte'), q => { q.docs.forEach(d => tels[d.id] = d.data().tel || ''); merge(); }, fail));
}
document.addEventListener('click', e => {
  if (e.target.closest('#bPub')) publish();
  if (e.target.closest('#bQR')) openQR();
  if (e.target.closest('#bLock')) setOffen(false);
  if (e.target.closest('#bUnlock')) setOffen(true);
});
function setOffen(v) { needLogin(() => { P().offen = v; save(); cloudMeta(cur); renderPlan(); msg(v ? 'Eintragen per QR wieder offen.' : 'Eintragen per QR geschlossen.'); }); }
function openQR() {
  const u = adfUrl(cur);
  $('#qrBody').innerHTML = (window.qrcode ? qrSvg(u, 7) : '<p class="err">QR-Modul nicht geladen.</p>') +
    `<p class="mute" style="margin:8px 0 0">AdF scannen den Code, geben einmal Name und Telefon ein und tippen auf einen freien Slot.</p><p class="mute" style="word-break:break-all;font-size:13px">${esc(u)}</p>`;
  $('#dQR').showModal();
}
$('#bQrClose').onclick = () => $('#dQR').close();
$('#bQrCopy').onclick = async () => { try { await navigator.clipboard.writeText(adfUrl(cur)); msg('Link kopiert.'); } catch (e) { msg('Kopieren nicht möglich.'); } };
$('#bQrPrint').onclick = () => {
  const p = P(), u = adfUrl(cur), w = window.open('', '_blank'); if (!w || !window.qrcode) return;
  w.document.write(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>Brandwache eintragen</title><style>body{font-family:Helvetica,Arial,sans-serif;text-align:center;margin:40px}
    h1{font-size:32px;margin:10px 0}p{font-size:18px}svg{width:340px;height:340px}img{width:110px}</style></head><body>
    <img src="${new URL('logo.png', location.href).href}" alt=""><h1>Brandwache: ${esc(p.title)}</h1><p>${dm(p.start)} ${hm(p.start)} – ${dm(p.end)} ${hm(p.end)}${p.ort ? ' · ' + esc(p.ort) : ''}</p>${qrSvg(u, 10)}
    <p><b>1.</b> QR-Code mit dem Handy scannen &nbsp; <b>2.</b> Name und Telefon eingeben &nbsp; <b>3.</b> Freien Slot antippen</p><p style="font-size:13px;color:#555">${esc(u)}</p>
    <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};

/* ---------- Sync-Anzeige ---------- */
function renderSync() {
  const el = $('#sync'), p = cur && P();
  if (!p || !p.published) { el.hidden = true; return; }
  el.hidden = false; let cls, t;
  if (!cloud.user) { cls = 'warn'; t = 'Anmelden für Live-Einträge'; }
  else if (cloud.err) { cls = 'err'; t = cloud.err; }
  else if (!navigator.onLine) { cls = 'warn'; t = 'Offline'; }
  else if (cloud.pending) { cls = 'warn'; t = 'Wird gesendet …'; }
  else { cls = 'ok'; t = 'Live'; }
  el.className = 'sync ' + cls; el.textContent = t; el.title = t;
  el.style.cursor = cloud.user ? '' : 'pointer';
}
$('#sync').onclick = () => { if (!cloud.user) return needLogin(); if (window.FWSync) FWSync.open({ F: cloud.F, fs: cloud.fs, user: cloud.user.email, onDone: () => { cloud.err = ''; renderSync(); } }); };
addEventListener('online', renderSync); addEventListener('offline', renderSync);

/* ---------- Start ---------- */
const m = location.hash.match(/p=([\w-]+)/);
if (m && DB.plaene[m[1]]) go('plan', m[1]); else go('dash');
/* Logo: in einer Unterseite → Dashboard, im Dashboard → Startseite */
$('#aHome').onclick = e => { if ($('#vDash').hidden) { e.preventDefault(); go('dash'); } };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
