/* Schadenmeldung – Feuerwehr RTL
   Fahrzeug-, allgemeine und persönliche Schäden/Mängel melden, mit Fotos.
   Versand vorerst über die Mail-App des Geräts; später optional direkt an einen Server (config.js: sendUrl). */
(function () {
'use strict';
const CFG = window.SM_CONFIG || {};
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 4000); }
const TO = CFG.empfaenger || '';
const KAT = { fz: { t: 'Fahrzeug', c: '#c8102e' }, al: { t: 'Allgemein', c: '#0f7b8a' }, pa: { t: 'Persönliche Ausrüstung', c: '#1557c0' } };
const URG = ['Normal', 'Dringend', 'Sofort – nicht einsatzbereit'];
const TEILE = ['Helm', 'Brandschutzjacke', 'Brandschutzhose', 'Stiefel', 'Handschuhe', 'Flammschutzhaube', 'Atemschutzmaske', 'Lampe', 'Funkgerät', 'Andere'];

/* Gerät: Name, Telefon, Verlauf */
const LP = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem('schaden-prefs')) || {}; } catch (e) {} return { o, save: () => { try { localStorage.setItem('schaden-prefs', JSON.stringify(o)); } catch (e) {} } }; })();
if (!LP.o.hist) LP.o.hist = [];

/* Uhr */
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);

/* ---------- Ansichten ---------- */
function show(v) { for (const id of ['vDash', 'vForm', 'vDone']) $('#' + id).hidden = id !== v; scrollTo(0, 0); }
function home() { show('vDash'); renderHist(); }
function renderHist() {
  const h = LP.o.hist;
  $('#hist').innerHTML = h.length ? h.slice(0, 30).map(x => `<li><span class="d">${dmy(x.t)}<small>${hm(x.t)}</small></span><div><b>${esc(x.title)}</b>${x.urg ? `<span class="tag u${x.urg}">${esc(URG[x.urg])}</span>` : ''}<small>${esc(KAT[x.k].t)} · ${x.n} Foto${x.n === 1 ? '' : 's'} · ${x.via === 'server' ? 'gesendet' : 'über Mail-App'}</small></div></li>`).join('')
    : '<li class="mute">Noch keine Meldungen.</li>';
}
document.querySelector('.dash').addEventListener('click', e => { const t = e.target.closest('[data-k]'); if (t) openForm(t.dataset.k); });

/* ---------- Formular ---------- */
let K = null, sel = {}, photos = [], last = null;
function openForm(k) {
  K = k; sel = {}; photos.forEach(p => URL.revokeObjectURL(p.url)); photos = [];
  $('#fCard').style.setProperty('--tc', KAT[k].c);
  $('#fTitle').textContent = 'Schaden / Mangel: ' + KAT[k].t;
  $('#gFz').hidden = k !== 'fz'; $('#gAl').hidden = k !== 'al'; $('#gPa').hidden = k !== 'pa';
  for (const id of ['fzName', 'fzKm', 'alWas', 'alWo', 'paAnder', 'paGr', 'besch']) $('#' + id).value = '';
  $('#paAnder').hidden = true;
  $('#fzList').innerHTML = (CFG.fahrzeuge || []).map(f => `<option value="${esc(f)}">`).join('');
  $('#paTeil').innerHTML = TEILE.map(t => `<button type="button" data-v="${t}">${t}</button>`).join('');
  $('#who').value = LP.o.who || ''; $('#tel').value = LP.o.tel || '';
  $('#toAddr').textContent = CFG.sendUrl ? TO + ' (direkt)' : TO;
  $('#fErr').textContent = ''; sel.urg = '0'; renderChips(); renderPhotos(); show('vForm');
}
function renderChips() { document.querySelectorAll('#vForm .chips').forEach(c => c.querySelectorAll('button').forEach(b => b.classList.toggle('on', sel[c.dataset.name] === b.dataset.v))); }
$('#vForm').addEventListener('click', e => {
  const b = e.target.closest('.chips button'); if (!b) return;
  sel[b.parentElement.dataset.name] = b.dataset.v; renderChips();
  if (b.parentElement.id === 'paTeil') { $('#paAnder').hidden = b.dataset.v !== 'Andere'; if (b.dataset.v === 'Andere') $('#paAnder').focus(); }
});
$('#bCancel').onclick = home;

/* ---------- Fotos (verkleinert auf max. 1600 px, damit die Mail nicht zu gross wird) ---------- */
function renderPhotos() {
  $('#photos').innerHTML = photos.map((p, i) => `<div class="ph"><img src="${p.url}" alt="Foto ${i + 1}"><button type="button" data-rm="${i}" aria-label="Foto entfernen">×</button></div>`).join('') +
    (photos.length < 8 ? `<button type="button" class="addph" id="bPh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Foto</button>` : '');
}
$('#photos').addEventListener('click', e => {
  if (e.target.closest('#bPh')) return $('#file').click();
  const r = e.target.closest('[data-rm]'); if (r) { const [p] = photos.splice(+r.dataset.rm, 1); URL.revokeObjectURL(p.url); renderPhotos(); }
});
$('#file').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, 8 - photos.length); e.target.value = '';
  for (const f of files) { try { const blob = await shrink(f); photos.push({ blob, url: URL.createObjectURL(blob) }); } catch (err) { msg('Foto konnte nicht gelesen werden.'); } }
  renderPhotos();
});
async function shrink(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
  return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
}

/* ---------- Meldung zusammenstellen ---------- */
function build() {
  const v = id => $('#' + id).value.trim(), t = Date.now();
  const who = v('who'), tel = v('tel'), besch = v('besch'), urg = +sel.urg;
  let obj, lines = [], miss = [];
  if (K === 'fz') { obj = v('fzName'); if (!obj) miss.push('Fahrzeug'); if (!sel.bereit) miss.push('Einsatzbereit');
    lines = [['Fahrzeug', obj], ['Kilometerstand', v('fzKm')], ['Einsatzbereit', sel.bereit]]; }
  if (K === 'al') { obj = v('alWas'); if (!obj) miss.push('Gegenstand'); lines = [['Gegenstand / Gerät', obj], ['Standort', v('alWo')]]; }
  if (K === 'pa') { obj = sel.teil === 'Andere' ? v('paAnder') : sel.teil; if (!obj) miss.push('Ausrüstungsteil');
    lines = [['Ausrüstungsteil', obj], ['Grösse', v('paGr')], ['Ersatz nötig', sel.ersatz]]; }
  if (!besch) miss.push('Beschreibung'); if (!who) miss.push('Gemeldet von');
  if (miss.length) return { err: 'Bitte ausfüllen: ' + miss.join(', ') };
  const subject = `Schadenmeldung ${KAT[K].t}: ${obj}${urg ? ' – ' + URG[urg].toUpperCase() : ''}`;
  const all = [['Art', KAT[K].t], ...lines, ['Dringlichkeit', URG[urg]], ['Gemeldet von', who], ['Telefon', tel], ['Datum / Zeit', `${dmy(t)} ${hm(t)}`], ['Fotos', photos.length ? `${photos.length} (im Anhang)` : 'keine']].filter(x => x[1]);
  const text = `SCHADENMELDUNG – ${(CFG.feuerwehr || 'Feuerwehr').toUpperCase()}\n\n` + all.map(([a, b]) => `${a}: ${b}`).join('\n') + `\n\nBeschreibung:\n${besch}\n`;
  const stamp = `${new Date(t).getFullYear()}${pad(new Date(t).getMonth() + 1)}${pad(new Date(t).getDate())}-${pad(new Date(t).getHours())}${pad(new Date(t).getMinutes())}`;
  const files = photos.map((p, i) => new File([p.blob], `Schaden_${stamp}_${i + 1}.jpg`, { type: 'image/jpeg' }));
  return { t, k: K, obj, urg, who, tel, subject, text, files, fields: Object.fromEntries(all), besch };
}

/* ---------- Senden ---------- */
const mailto = r => `mailto:${TO}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.text)}`;
const canShareFiles = r => r.files.length && navigator.canShare && navigator.canShare({ files: r.files });
$('#bSend').onclick = async () => {
  const r = build(); $('#fErr').textContent = r.err || ''; if (r.err) return;
  LP.o.who = r.who; LP.o.tel = r.tel; LP.save(); last = r;
  if (CFG.sendUrl) return sendServer(r);
  openMail(r);
};
/* Mit Fotos: Teilen-Menü (Fotos werden angehängt, Empfänger einfügen). Ohne Fotos: Mail-App mit allem ausgefüllt. */
async function openMail(r) {
  let via;
  if (canShareFiles(r)) {
    try { navigator.clipboard && navigator.clipboard.writeText(TO).catch(() => {}); } catch (e) {}
    try { await navigator.share({ files: r.files, title: r.subject, text: r.subject + '\n\n' + r.text }); via = 'share'; }
    catch (e) { if (e && e.name === 'AbortError') return msg('Abgebrochen – die Meldung ist noch nicht gesendet.'); via = 'mailto'; location.href = mailto(r); }
  } else {
    location.href = mailto(r); via = 'mailto';
    if (r.files.length) r.files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); }, 400 * (i + 1)));
  }
  done(r, 'mail', via);
}
async function sendServer(r) {
  const b = $('#bSend'); b.disabled = true; b.lastChild.textContent = 'Wird gesendet …';
  try {
    const toData = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res({ name: f.name, type: f.type, data: String(fr.result).split(',')[1] }); fr.onerror = rej; fr.readAsDataURL(f); });
    const body = { to: TO, subject: r.subject, text: r.text, kategorie: KAT[r.k].t, felder: r.fields, beschreibung: r.besch, fotos: await Promise.all(r.files.map(toData)) };
    const res = await fetch(CFG.sendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(res.status);
    done(r, 'server');
  } catch (e) { $('#fErr').textContent = navigator.onLine ? 'Senden fehlgeschlagen – nochmals versuchen oder über die Mail-App senden.' : 'Keine Internetverbindung.'; }
  b.disabled = false; b.lastChild.textContent = 'Meldung senden';
}
function done(r, via, how) {
  LP.o.hist.unshift({ t: r.t, k: r.k, title: r.obj, urg: r.urg, n: r.files.length, via }); LP.o.hist = LP.o.hist.slice(0, 50); LP.save();
  $('#bAgain').hidden = via === 'server';
  if (via === 'server') { $('#dTitle').textContent = 'Meldung gesendet'; $('#dText').innerHTML = `<p>Die Meldung ging an <b>${esc(TO)}</b>.</p>`; }
  else if (how === 'share') {
    $('#dTitle').textContent = 'Fast fertig';
    $('#dText').innerHTML = `<ol class="steps"><li>Im Teilen-Menü <b>Mail</b> wählen.</li><li>Bei «An» die Adresse einfügen: <b>${esc(TO)}</b> (ist schon kopiert).</li><li>In der Mail auf <b>Senden</b> tippen.</li></ol><button id="bCopy">Adresse kopieren</button>`;
  } else {
    $('#dTitle').textContent = 'Fast fertig';
    $('#dText').innerHTML = `<p>Die Mail-App ist mit Empfänger, Betreff und Text vorbereitet – dort nur noch auf <b>Senden</b> tippen.</p>` +
      (r.files.length ? `<p class="mute">Die Fotos wurden heruntergeladen – bitte in der Mail anhängen.</p>` : '');
  }
  show('vDone');
}
$('#vDone').addEventListener('click', async e => { if (e.target.closest('#bCopy')) { try { await navigator.clipboard.writeText(TO); msg('Adresse kopiert.'); } catch (err) { msg(TO); } } });
$('#bAgain').onclick = () => { if (last) { LP.o.hist.shift(); openMail(last); } };
$('#bHome').onclick = () => { photos.forEach(p => URL.revokeObjectURL(p.url)); photos = []; home(); };

home();
/* Logo: in einer Unterseite → Dashboard, im Dashboard → Startseite */
$('#aHome').onclick = e => {
  if (!$('#vDash').hidden) return; e.preventDefault();
  if (!$('#vForm').hidden && ($('#besch').value.trim() || photos.length) && !confirm('Meldung verwerfen und zum Dashboard?')) return;
  photos.forEach(p => URL.revokeObjectURL(p.url)); photos = []; home();
};
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
