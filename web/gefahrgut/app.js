/* Gefahrgut – Feuerwehr RTL. Orange Tafel entschlüsseln (Gefahrnummer nach ADR), Absperr- und Gefahrenbereich mit Wind
   auf der swisstopo-Karte, Meldeschema für Chemiewehr / Einsatzzentrale. Keine Stoffdatenbank (Lizenz noch offen). */
(function () {
'use strict';
const VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 3500); }
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const fw = () => { try { const e = JSON.parse(localStorage.getItem('fw-einsatz')); return e && e.bez ? e : null; } catch (e) { return null; } };
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);

/* ---------- Gefahrnummer (ADR) ---------- */
const DIG = {
  '2': 'Entweichen von Gas durch Druck oder chemische Reaktion',
  '3': 'Entzündbarkeit von Flüssigkeiten (Dämpfen) und Gasen oder selbsterhitzungsfähiger flüssiger Stoff',
  '4': 'Entzündbarkeit fester Stoffe oder selbsterhitzungsfähiger fester Stoff',
  '5': 'Oxidierende (brandfördernde) Wirkung',
  '6': 'Giftigkeit oder Ansteckungsgefahr',
  '7': 'Radioaktivität',
  '8': 'Ätzwirkung',
  '9': 'Gefahr einer spontanen heftigen Reaktion'
};
const SPEC = {
  '20': 'Erstickendes Gas oder Gas ohne Zusatzgefahr',
  '22': 'Tiefgekühlt verflüssigtes Gas, erstickend',
  '23': 'Entzündbares Gas',
  '30': 'Entzündbarer flüssiger Stoff (Flammpunkt 23–60 °C)',
  '33': 'Leicht entzündbarer flüssiger Stoff (Flammpunkt unter 23 °C)',
  '333': 'Selbstentzündlicher (pyrophorer) flüssiger Stoff',
  '40': 'Entzündbarer fester Stoff oder selbsterhitzungsfähiger Stoff',
  '50': 'Oxidierender (brandfördernder) Stoff',
  '60': 'Giftiger oder schwach giftiger Stoff',
  '66': 'Sehr giftiger Stoff',
  '80': 'Ätzender oder schwach ätzender Stoff',
  '88': 'Stark ätzender Stoff',
  '90': 'Umweltgefährdender Stoff; verschiedene gefährliche Stoffe',
  '99': 'Verschiedene gefährliche Stoffe in erwärmtem Zustand'
};
let X = false;
function decode() {
  const gn = $('#iGn').value.replace(/\D/g, ''), un = $('#iUn').value.replace(/\D/g, '');
  const r = $('#res');
  if (!gn) { r.innerHTML = '<p class="mute">Gefahrnummer eingeben – die Bedeutung erscheint hier.</p>'; return; }
  const parts = [];
  if (X) parts.push('<div class="xwarn">X – reagiert gefährlich mit Wasser. Wasser nur nach Rücksprache mit Fachleuten einsetzen.</div>');
  const title = SPEC[gn] ? esc(SPEC[gn]) : 'Gefahrnummer ' + esc(gn);
  const seen = [], items = [];
  for (const d of gn) {
    if (d === '0' || !DIG[d] || seen.includes(d)) continue; seen.push(d);
    const n = gn.split(d).length - 1;
    items.push(`<li>${esc(DIG[d])}${n > 1 ? ' – <b>verstärkt</b> (Ziffer ' + d + ' mehrfach)' : ''}</li>`);
  }
  parts.push(`<h3>${X ? 'X' : ''}${esc(gn)}${un ? ' / UN ' + esc(un) : ''}: ${title}</h3>`);
  if (items.length) parts.push('<b>Gefahren:</b><ul>' + items.join('') + '</ul>');
  if (gn.length >= 2 && gn[1] === '0') parts.push('<p class="note">Eine 0 an zweiter Stelle bedeutet: keine Zusatzgefahr.</p>');
  r.innerHTML = parts.join('');
}
$('#iGn').addEventListener('input', decode); $('#iUn').addEventListener('input', decode);
$('#bX').onclick = () => { X = !X; $('#bX').classList.toggle('on', X); decode(); };
const tafelText = () => { const gn = $('#iGn').value.trim(), un = $('#iUn').value.trim(); return gn || un ? `${X ? 'X' : ''}${gn}${un ? ' / UN ' + un : ''}` : ''; };
$('#bUn').onclick = () => {
  const un = $('#iUn').value.replace(/\D/g, '');
  if (un.length !== 4) return msg('UN-Nummer hat 4 Ziffern');
  window.open('https://www.google.com/search?q=' + encodeURIComponent('UN ' + un + ' Gefahrgut Stoff ERICard'), '_blank', 'noopener');
};

/* ---------- Kontakte ---------- */
let K = load('gg-kontakte', { cw: '', tel: '' });
function renderK() {
  $('#sCw').value = K.cw; $('#sTel').value = K.tel;
  $('#bCall').hidden = !K.tel; $('#bCall').textContent = (K.cw || 'Chemiewehr') + ' anrufen';
}
$('#bSave').onclick = () => { K = { cw: $('#sCw').value.trim(), tel: $('#sTel').value.trim() }; save('gg-kontakte', K); renderK(); msg('Gespeichert'); };
$('#bCall').onclick = () => { if (K.tel) location.href = 'tel:' + K.tel.replace(/[^\d+]/g, ''); };

/* ---------- Meldung ---------- */
const MF = ['mEr', 'mOrt', 'mTafel', 'mStoff', 'mVer', 'mWind', 'mZu', 'mMa'];
let M = load('gg-meldung', {});
const AUS = ['Ja', 'Nein', 'Unklar'];
function renderM() {
  const F = fw();
  for (const k of MF) $('#' + k).value = M[k] ?? '';
  if (!M.mEr && F) $('#mEr').value = F.bez;
  if (!M.mOrt && F) $('#mOrt').value = F.adr || '';
  if (!M.mTafel) $('#mTafel').value = tafelText();
  if (!M.mWind && W.dir) $('#mWind').value = 'Wind aus ' + W.dir;
  $('#cA').innerHTML = AUS.map(a => `<button type="button" data-a="${a}" class="${M.aus === a ? 'on' : ''}">${a}</button>`).join('');
}
for (const k of MF) $('#' + k).addEventListener('input', e => { M[k] = e.target.value; save('gg-meldung', M); });
$('#cA').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b) return; M.aus = M.aus === b.dataset.a ? '' : b.dataset.a; save('gg-meldung', M); renderM(); });
$('#bClear').onclick = () => { if (!confirm('Meldung leeren?')) return; M = {}; save('gg-meldung', M); renderM(); };
$('#bCopy').onclick = async () => {
  const v = k => $('#' + k).value.trim();
  const L = [`Gefahrgut-Meldung ${hm(Date.now())}`, `Ereignis: ${v('mEr')}`, `Ort: ${v('mOrt')}`, `Gefahrnummer/UN: ${v('mTafel')}`, `Stoff/Menge/Behälter: ${v('mStoff')}`, `Austritt: ${M.aus || '–'}`, `Verletzte/Betroffene: ${v('mVer')}`, `Wind/Wetter: ${v('mWind')}`, `Zufahrt/Sammelplatz: ${v('mZu')}`, `Massnahmen: ${v('mMa')}`];
  try { await navigator.clipboard.writeText(L.join('\n')); msg('Meldung kopiert'); } catch (e) { msg('Kopieren nicht möglich'); }
};

/* ---------- Karte: Absperrung & Gefahrenbereich ---------- */
const RADII = [25, 50, 100, 200, 500, 1000], LENS = [100, 200, 500, 1000, 2000];
const DIRS = { N: 0, NO: 45, O: 90, SO: 135, S: 180, SW: 225, W: 270, NW: 315 };
let W = load('gg-karte', { lat: null, lng: null, r: null, dir: '', len: null });
let map = null, lay = null;
const fmtM = m => m >= 1000 ? (m / 1000) + ' km' : m + ' m';
function chips() {
  $('#cR').innerHTML = RADII.map(r => `<button type="button" data-r="${r}" class="${W.r === r ? 'on' : ''}">${fmtM(r)}</button>`).join('');
  $('#cW').innerHTML = '<button type="button" data-w="" class="' + (!W.dir ? 'on' : '') + '">Kein / unklar</button>' + Object.keys(DIRS).map(d => `<button type="button" data-w="${d}" class="${W.dir === d ? 'on' : ''}">${d}</button>`).join('');
  $('#cL').innerHTML = LENS.map(l => `<button type="button" data-l="${l}" class="${W.len === l ? 'on' : ''}"${W.dir ? '' : ' disabled'}>${fmtM(l)}</button>`).join('');
}
// Punkt in Distanz d (m) und Richtung b (Grad, 0 = Nord) – genügt für kurze Distanzen
const dest = (lat, lng, d, b) => { const R = 6371000, br = b * Math.PI / 180; return [lat + (d * Math.cos(br)) / R * 180 / Math.PI, lng + (d * Math.sin(br)) / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI]; };
function draw() {
  chips(); if (!map) return;
  lay.clearLayers();
  if (W.lat == null) { $('#lgInfo').textContent = 'Ereignisort auf der Karte antippen'; return; }
  L.circleMarker([W.lat, W.lng], { radius: 8, color: '#111', weight: 3, fillColor: '#f07d00', fillOpacity: 1 }).addTo(lay);
  if (W.dir && W.len) {
    const to = (DIRS[W.dir] + 180) % 360, pts = [[W.lat, W.lng]];
    for (let a = -30; a <= 30; a += 5) pts.push(dest(W.lat, W.lng, W.len, to + a));
    L.polygon(pts, { color: '#f07d00', weight: 3, fillOpacity: .3 }).addTo(lay);
  }
  if (W.r) L.circle([W.lat, W.lng], { radius: W.r, color: '#c8102e', weight: 3, fillOpacity: .25 }).addTo(lay);
  $('#lgInfo').textContent = [W.r ? 'Absperrung ' + fmtM(W.r) : '', W.dir ? 'Wind aus ' + W.dir : '', W.dir && W.len ? 'Gefahrenbereich ' + fmtM(W.len) : ''].filter(Boolean).join(' · ');
}
function initMap() {
  if (map || !window.L) return;
  const F = fw(), c = W.lat != null ? [W.lat, W.lng] : F && F.lat ? [F.lat, F.lng] : [47.467, 9.589];
  if (W.lat == null && F && F.lat) { W.lat = F.lat; W.lng = F.lng; save('gg-karte', W); }
  map = L.map('map').setView(c, 16);
  L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(map);
  lay = L.layerGroup().addTo(map);
  map.on('click', e => { W.lat = e.latlng.lat; W.lng = e.latlng.lng; save('gg-karte', W); draw(); });
  draw();
}
document.querySelector('#t-karte').addEventListener('click', e => {
  const r = e.target.closest('[data-r]'), w = e.target.closest('[data-w]'), l = e.target.closest('[data-l]');
  if (r) W.r = W.r === +r.dataset.r ? null : +r.dataset.r;
  else if (w) { W.dir = w.dataset.w; if (!W.dir) W.len = null; }
  else if (l) W.len = W.len === +l.dataset.l ? null : +l.dataset.l;
  else return;
  save('gg-karte', W); draw();
});

/* ---------- Tabs ---------- */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['tafel', 'karte', 'meldung', 'setup']) $('#t-' + t).hidden = t !== b.dataset.t;
  if (b.dataset.t === 'karte') { initMap(); setTimeout(() => map && map.invalidateSize(), 50); }
  if (b.dataset.t === 'meldung') renderM();
});

renderK(); chips(); decode();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.GG_VERSION = VERSION;
})();
