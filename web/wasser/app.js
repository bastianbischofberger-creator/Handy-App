/* Wassertransport – Feuerwehr RTL
   Relaisleitung mit Höhenprofil (swisstopo), Schnellrechnung, Pendelverkehr, Parameter. */
(function () {
'use strict';
const WT = window.WT;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const m0 = v => Math.round(v).toLocaleString('de-CH');
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => m.textContent = '', 4000); }
const tick = () => $('#clock').textContent = hm(Date.now()); tick(); setInterval(tick, 10000);

/* ---------- Speicher ---------- */
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { msg('Speicher auf diesem Gerät ist voll.'); } };
let P = Object.assign(clone(WT.DEFAULTS), load('wasser-param', {}));
let SAVED = load('wasser-strecken', []);

/* ---------- Ansichten ---------- */
let view = 'dash';
function go(v) {
  view = v;
  for (const [id, name] of [['vDash', 'dash'], ['vMap', 'map'], ['vQuick', 'quick'], ['vPendel', 'pendel'], ['vParam', 'param']]) $('#' + id).hidden = name !== v;
  $('#backRow').hidden = v === 'dash';
  const slot = v === 'map' ? $('#slotMap') : v === 'quick' ? $('#slotQuick') : null;
  if (slot) { slot.append($('#inp'), $('#res')); $('#inp').hidden = false; fillInputs(); } else { $('#inp').hidden = true; $('#res').hidden = true; }
  if (v !== 'map' && v !== 'quick') $('#res').hidden = true;
  if (v === 'map') initMap();
  if (v === 'pendel') initPendel();
  if (v === 'param') fillParam();
  if (v === 'dash') renderSaved();
  scrollTo(0, 0);
}
document.querySelector('.dash').addEventListener('click', e => { const t = e.target.closest('[data-go]'); if (t) { if (t.dataset.go === 'map') { cur = null; RES = null; } go(t.dataset.go); } });
$('#bBack').onclick = () => go('dash');

/* ---------- Eingaben Leitung ---------- */
const QS = [400, 600, 800, 1000, 1200, 1600];
let I = { q: 800, qOther: false, leitungen: 1, zielDruck: null, quelle: null, relais: null };
function fillInputs() {
  if (I.zielDruck == null) I.zielDruck = P.zielDruck;
  if (!P.pumpen.some(p => p.id === I.quelle)) I.quelle = (P.pumpen.find(p => p.id === 'tlf') || P.pumpen[0]).id;
  if (!P.pumpen.some(p => p.id === I.relais)) I.relais = (P.pumpen.find(p => p.id === 'ms') || P.pumpen[0]).id;
  const opts = P.pumpen.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${p.druck} bar, ${p.leistung} l/min)</option>`).join('');
  $('#iSrc').innerHTML = opts; $('#iRel').innerHTML = opts; $('#iSrc').value = I.quelle; $('#iRel').value = I.relais;
  $('#iZ').value = I.zielDruck; renderInChips();
}
function renderInChips() {
  $('#cQ').innerHTML = QS.map(q => `<button type="button" data-v="${q}" class="${!I.qOther && I.q === q ? 'on' : ''}">${q}</button>`).join('') + `<button type="button" data-v="x" class="${I.qOther ? 'on' : ''}">Andere …</button>`;
  $('#iQ').hidden = !I.qOther; if (I.qOther) $('#iQ').value = I.q;
  document.querySelectorAll('#cL button').forEach(b => b.classList.toggle('on', +b.dataset.v === I.leitungen));
  const ql = I.q / I.leitungen, fr = P.schlauch.refVerlust * Math.pow(ql / P.schlauch.refQ, 2);
  $('#iInfo').textContent = `${P.schlauch.name}: ${m0(ql)} l/min pro Leitung → Reibungsverlust ca. ${(Math.round(fr * 100) / 100).toFixed(2)} bar pro 100 m. Höhe: ${P.hoehe} bar pro Meter.`;
}
$('#cQ').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v === 'x') I.qOther = true; else { I.qOther = false; I.q = +b.dataset.v; } renderInChips(); });
$('#iQ').addEventListener('input', () => { I.q = Math.max(0, +$('#iQ').value || 0); renderInChips(); $('#iQ').focus(); });
$('#cL').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { I.leitungen = +b.dataset.v; renderInChips(); } });
$('#iZ').addEventListener('input', () => I.zielDruck = +$('#iZ').value || 0);
$('#iSrc').onchange = () => I.quelle = $('#iSrc').value;
$('#iRel').onchange = () => I.relais = $('#iRel').value;

/* ================= Karte ================= */
const TILES = {
  karte: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  luft: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'
};
let map, layer, layerKey = 'karte', line, pumpLayer, markers = [], PTS = [], cur = null, RES = null, PROF = null;
const icon = (cls, txt, s) => L.divIcon({ className: '', html: `<div class="pin ${cls}" style="width:${s}px;height:${s}px">${txt}</div>`, iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
function initMap() {
  if (!map) {
    L.Control.Attribution.prototype.options.prefix = false; // nur «© swisstopo» anzeigen
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([47.4655, 9.5905], 14);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    setLayer('karte');
    line = L.polyline([], { color: '#1565c0', weight: 5, opacity: .85 }).addTo(map);
    pumpLayer = L.layerGroup().addTo(map);
    map.on('click', e => { PTS.push(e.latlng); changed(); });
  }
  setTimeout(() => map.invalidateSize(), 50);
  drawPts();
}
function setLayer(k) {
  layerKey = k; if (layer) map.removeLayer(layer);
  layer = L.tileLayer(TILES[k], { maxZoom: 19, maxNativeZoom: k === 'karte' ? 18 : 19, attribution: '© swisstopo' }).addTo(map);
  $('#bLayer').textContent = k === 'karte' ? 'Luftbild' : 'Karte';
}
$('#bLayer').onclick = () => setLayer(layerKey === 'karte' ? 'luft' : 'karte');
function changed() { RES = null; PROF = null; $('#res').hidden = true; pumpLayer && pumpLayer.clearLayers(); drawPts(); }
function drawPts() {
  if (!map) return;
  markers.forEach(m => map.removeLayer(m)); markers = [];
  PTS.forEach((p, i) => {
    const first = i === 0, lastP = i === PTS.length - 1 && PTS.length > 1;
    const m = L.marker(p, { draggable: true, icon: first ? icon('w', 'W', 30) : lastP ? icon('z', 'Z', 30) : icon('v', '', 16), zIndexOffset: first || lastP ? 500 : 0 }).addTo(map);
    m.on('dragend', () => { PTS[i] = m.getLatLng(); changed(); });
    m.on('click', () => { if (!first && !lastP) { PTS.splice(i, 1); changed(); } });
    markers.push(m);
  });
  line.setLatLngs(PTS);
  const n = PTS.length;
  $('#mHint').textContent = n === 0 ? 'Auf die Karte tippen: zuerst den Wasserbezug setzen' : n === 1 ? 'Jetzt das Ziel setzen' :
    'Weitere Punkte setzen, damit die Leitung dem Weg folgt. Punkte lassen sich verschieben.';
  $('#mHint').hidden = !!RES;
  $('#bUndo').disabled = !n; $('#bClear').disabled = !n;
}
$('#bUndo').onclick = () => { PTS.pop(); changed(); };
$('#bClear').onclick = () => { PTS = []; cur = null; changed(); };
$('#bLoc').onclick = () => {
  if (!navigator.geolocation) return msg('Standort nicht verfügbar.');
  navigator.geolocation.getCurrentPosition(p => map.setView([p.coords.latitude, p.coords.longitude], 16), () => msg('Standort nicht verfügbar.'), { enableHighAccuracy: true, timeout: 10000 });
};
/* Suche (swisstopo) */
let sT;
$('#q').addEventListener('input', () => {
  clearTimeout(sT); const q = $('#q').value.trim(); if (q.length < 3) { $('#sres').hidden = true; return; }
  sT = setTimeout(async () => {
    try {
      const r = await fetch('https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&sr=4326&limit=8&searchText=' + encodeURIComponent(q)).then(r => r.json());
      const res = (r.results || []).map(x => x.attrs);
      $('#sres').innerHTML = res.map((a, i) => `<button data-i="${i}">${a.label.replace(/<[^>]+>/g, '')}</button>`).join('') || '<button disabled>Nichts gefunden</button>';
      $('#sres').hidden = false; $('#sres').onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const a = res[+b.dataset.i]; map.setView([a.lat, a.lon], 17); $('#sres').hidden = true; $('#q').blur(); };
    } catch (e) { $('#sres').hidden = true; }
  }, 300);
});

/* Höhenprofil von swisstopo holen */
async function fetchProfile(pts) {
  const lv = pts.map(p => WT.toLV95(p.lat, p.lng)), coords = lv.map(c => [Math.round(c.e * 10) / 10, Math.round(c.n * 10) / 10]);
  let len = 0; for (let i = 1; i < lv.length; i++) len += Math.hypot(lv[i].e - lv[i - 1].e, lv[i].n - lv[i - 1].n);
  const nb = Math.max(50, Math.min(1000, Math.round(len / 5)));
  const url = 'https://api3.geo.admin.ch/rest/services/profile.json?sr=2056&nb_points=' + nb + '&geom=' + encodeURIComponent(JSON.stringify({ type: 'LineString', coordinates: coords }));
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const prof = j.map(p => ({ d: p.dist, h: p.alts && (p.alts.COMB ?? p.alts.DTM2 ?? p.alts.DTM25), e: p.easting, n: p.northing })).filter(p => p.h != null);
  if (prof.length < 2) throw new Error('leer');
  return prof;
}

/* ---------- Berechnen ---------- */
$('#bCalc').onclick = async () => {
  if (view === 'quick') {
    const L0 = +$('#qL').value, h1 = +$('#qH1').value, h2 = +$('#qH2').value;
    if (!(L0 > 0) || isNaN(h1) || isNaN(h2)) return msg('Länge und Höhen eingeben.');
    PROF = [{ d: 0, h: h1, e: 0, n: 0 }, { d: Math.sqrt(Math.max(1, L0 * L0 - (h2 - h1) ** 2)), h: h2, e: 0, n: 0 }];
    return run();
  }
  if (PTS.length < 2) return msg('Zuerst Wasserbezug und Ziel auf der Karte setzen.');
  const b = $('#bCalc'); b.disabled = true; b.textContent = 'Höhenprofil wird geladen …';
  try { if (!PROF) PROF = await fetchProfile(PTS); run(); }
  catch (e) { msg(navigator.onLine ? 'Höhenprofil konnte nicht geladen werden. Später nochmals versuchen oder Schnellrechnung verwenden.' : 'Keine Internetverbindung – für das Höhenprofil braucht es Internet. Alternative: Schnellrechnung.'); }
  b.disabled = false; b.textContent = 'Berechnen';
};
function run() {
  if (!(I.q > 0)) return msg('Fördermenge eingeben.');
  const pts = WT.resample(PROF, 5);
  RES = WT.compute(pts, P, { q: I.q, leitungen: I.leitungen, quelle: I.quelle, relais: I.relais, zielDruck: I.zielDruck });
  RES.pts = pts; RES.inp = { ...I }; RES.mode = view;
  renderRes(); drawPumps();
  $('#res').hidden = false; $('#mHint').hidden = true;
  setTimeout(() => $('#res').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}
function drawPumps() {
  if (!map || RES.mode !== 'map') return;
  pumpLayer.clearLayers();
  RES.pumps.forEach((p, n) => {
    if (n === 0) return;
    const w = WT.toWGS(p.e, p.n);
    L.marker([w.lat, w.lng], { icon: icon('p', 'P' + (n + 1), 30), zIndexOffset: 800 }).bindPopup(`<b>Pumpe ${n + 1}</b><br>${esc(p.pump.name)}<br>nach ${m0(p.d)} m · ${m0(p.h)} m ü. M.`).addTo(pumpLayer);
  });
}

/* ---------- Ergebnis anzeigen ---------- */
function renderRes() {
  const r = RES, nP = r.pumps.length;
  $('#rWarn').innerHTML = r.warn.length ? `<div class="warn">${r.warn.map(w => `<p>⚠ ${esc(w)}</p>`).join('')}</div>` : '';
  $('#rStats').innerHTML = [
    ['Pumpen total', nP, 1], ['Davon Verstärker', nP - 1, 1], ['Schläuche', `${r.schlaeuche} × ${P.schlauch.laenge} m`, 1],
    ['Länge (Gelände)', m0(r.laenge) + ' m'], ['Höhe Bezug → Ziel', `${m0(r.hStart)} → ${m0(r.hZiel)} m`], ['Höhendifferenz', (r.hZiel >= r.hStart ? '+' : '') + m0(r.hZiel - r.hStart) + ' m'],
    ['Höchster Punkt', m0(r.hMax) + ' m'], ['Druck am Ziel', f1(r.pZiel) + ' bar'], ['Verlust / 100 m', (Math.round(r.fr * 100) / 100).toFixed(2) + ' bar']
  ].map(([a, b, big]) => `<div class="stat${big ? ' big' : ''}"><small>${a}</small><b>${b}</b></div>`).join('');
  $('#rProf').innerHTML = profSvg(r);
  $('#rTbl').innerHTML = `<thead><tr><th>Pumpe</th><th>Standort</th><th>Teilstrecke</th><th>Druck Ende</th><th>Schläuche</th></tr></thead><tbody>` +
    r.segs.map((s, n) => { const p = r.pumps[n];
      return `<tr><td class="n">P${n + 1}</td><td>${n === 0 ? 'Wasserbezug' : `nach ${m0(p.d)} m`}<br><small class="mute">${esc(s.pumpe)} · ${m0(p.h)} m ü. M.${r.mode === 'map' ? `<br>${m0(p.e)} / ${m0(p.n)}` : ''}</small></td>
      <td>${m0(s.laenge)} m<br><small class="mute">${s.dh >= 0 ? '+' : ''}${m0(s.dh)} m Höhe</small></td><td class="n">${f1(s.pEnde)} bar<br><small class="mute" style="font:500 12px Barlow">${n === r.segs.length - 1 ? 'am Ziel' : 'ins Becken'}</small></td><td class="n">${s.schlaeuche}</td></tr>`; }).join('') + '</tbody>';
  $('#rNote').textContent = `Gerechnet mit ${m0(r.inp.q)} l/min in ${r.inp.leitungen} Leitung${r.inp.leitungen > 1 ? 'en' : ''}, Mindestdruck ${P.minDruck} bar pro Teilstrecke, ${P.reserve} % Schlauchreserve. Pumpenstandorte sind rechnerisch am weitesten möglichen Punkt – im Gelände lieber etwas früher aufstellen. Richtwerte, ersetzen keine Beurteilung vor Ort.`;
  $('#bSave').textContent = cur ? 'Änderungen speichern' : 'Strecke speichern';
  $('#bSave').hidden = r.mode !== 'map';
}
function profSvg(r) {
  const W = 640, H = 240, l = 46, rr = 44, t = 14, b = 30, pts = r.pts, L0 = r.laenge || 1;
  const hMin = Math.floor((r.hMin - 5) / 10) * 10, hMax = Math.ceil((r.hMax + 5) / 10) * 10, hr = Math.max(10, hMax - hMin);
  const pMax = Math.max(10, Math.ceil(Math.max(...r.druck.filter(v => v != null)))), X = d => l + d / L0 * (W - l - rr);
  const Y = h => t + (1 - (h - hMin) / hr) * (H - t - b), YP = p => t + (1 - Math.max(0, p) / pMax) * (H - t - b);
  const step = Math.max(1, Math.floor(pts.length / 300)), sp = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  const area = `M${X(0)},${H - b} ` + sp.map(p => `L${X(p.d).toFixed(1)},${Y(p.h).toFixed(1)}`).join(' ') + ` L${X(L0)},${H - b} Z`;
  let pl = ''; r.segs.forEach(s => { let d = ''; for (let i = s.von; i <= s.bis; i += Math.max(1, Math.floor((s.bis - s.von) / 80))) d += (d ? 'L' : 'M') + X(pts[i].d).toFixed(1) + ',' + YP(r.druck[i] ?? 0).toFixed(1);
    d += 'L' + X(pts[s.bis].d).toFixed(1) + ',' + YP(s.pEnde).toFixed(1); pl += `<path d="${d}" fill="none" stroke="#d96c00" stroke-width="2.5"/>`; });
  const yt = []; for (let h = hMin; h <= hMax; h += Math.max(10, Math.ceil(hr / 4 / 10) * 10)) yt.push(h);
  const xt = []; const xs = [100, 200, 250, 500, 1000, 2000, 5000].find(s => L0 / s <= 6) || 10000; for (let d = 0; d <= L0; d += xs) xt.push(d);
  return `<svg class="prof" viewBox="0 0 ${W} ${H}" role="img" aria-label="Höhenprofil mit Druckverlauf">
    ${yt.map(h => `<line x1="${l}" x2="${W - rr}" y1="${Y(h)}" y2="${Y(h)}" stroke="currentColor" stroke-opacity=".12"/><text x="${l - 6}" y="${Y(h) + 4}" text-anchor="end">${h}</text>`).join('')}
    ${xt.map(d => `<text x="${X(d)}" y="${H - 10}" text-anchor="middle">${d >= 1000 ? (d / 1000) + ' km' : d + ' m'}</text>`).join('')}
    ${[0, pMax / 2, pMax].map(p => `<text x="${W - rr + 6}" y="${YP(p) + 4}" style="fill:#d96c00">${p} bar</text>`).join('')}
    <path d="${area}" fill="#1565c0" fill-opacity=".22" stroke="#1565c0" stroke-width="2"/>
    <line x1="${l}" x2="${W - rr}" y1="${YP(P.minDruck)}" y2="${YP(P.minDruck)}" stroke="#d96c00" stroke-dasharray="4 4" stroke-opacity=".6"/>
    ${pl}
    ${r.pumps.map((p, n) => `<line x1="${X(p.d)}" x2="${X(p.d)}" y1="${t}" y2="${H - b}" stroke="#d96c00" stroke-opacity=".5"/><rect x="${X(p.d) - 13}" y="${t - 2}" width="26" height="17" rx="4" fill="#d96c00"/><text x="${X(p.d)}" y="${t + 11}" text-anchor="middle" style="fill:#fff;font-weight:700">P${n + 1}</text>`).join('')}
  </svg><div class="legend"><span><i style="background:#1565c0"></i>Gelände (m ü. M.)</span><span><i style="background:#d96c00"></i>Druck in der Leitung (bar)</span><span><i style="background:repeating-linear-gradient(90deg,#d96c00 0 4px,transparent 4px 8px)"></i>Mindestdruck</span></div>`;
}

/* ---------- Speichern ---------- */
$('#bSave').onclick = () => {
  const name = prompt('Name der Strecke', cur ? (SAVED.find(s => s.id === cur) || {}).name : 'Wassertransport ' + dmy(Date.now()));
  if (name == null) return;
  const rec = { id: cur || Date.now().toString(36), name: name.trim() || 'Strecke', t: Date.now(), pts: PTS.map(p => [p.lat, p.lng]), inp: { ...I }, prof: PROF, z: map.getZoom(), c: map.getCenter() };
  SAVED = [rec, ...SAVED.filter(s => s.id !== rec.id)].slice(0, 40); store('wasser-strecken', SAVED); cur = rec.id; renderRes(); msg('Strecke gespeichert.');
};
function renderSaved() {
  $('#saved').innerHTML = SAVED.length ? SAVED.map(s => `<li><div data-open="${s.id}"><b>${esc(s.name)}</b><small>${dmy(s.t)} · ${m0(s.inp.q)} l/min · ${s.inp.leitungen} Leitung${s.inp.leitungen > 1 ? 'en' : ''}</small></div><button class="ghost" data-del="${s.id}">Löschen</button></li>`).join('')
    : '<li class="mute">Noch keine gespeicherten Strecken.</li>';
}
$('#saved').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
  if (d && confirm('Strecke löschen?')) { SAVED = SAVED.filter(s => s.id !== d.dataset.del); store('wasser-strecken', SAVED); renderSaved(); }
  if (o) { const s = SAVED.find(x => x.id === o.dataset.open); cur = s.id; I = { ...I, ...s.inp }; PTS = s.pts.map(([a, b]) => L.latLng(a, b)); go('map'); changed(); PROF = s.prof;
    map.setView(s.c, s.z); if (PROF) run(); }
});

/* ---------- Drucken ---------- */
$('#bPrint').onclick = () => {
  const r = RES, w = window.open('', '_blank'); if (!w) return msg('Pop-up wurde blockiert.');
  const name = cur ? (SAVED.find(s => s.id === cur) || {}).name : 'Wassertransport';
  w.document.write(`<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><title>${esc(name)}</title><style>
    @page{size:A4;margin:14mm}body{font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#111;margin:0}
    header{display:flex;gap:14px;align-items:center;border-bottom:3px solid #c8102e;padding-bottom:8px;margin-bottom:10px}header img{width:56px}h1{font-size:21px;margin:0}
    .st{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}.st div{border:1px solid #bbb;border-radius:6px;padding:5px 8px}.st small{display:block;color:#555}.st b{font-size:16px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eee}
    svg{width:100%;height:auto;border:1px solid #bbb;border-radius:6px}svg text{font:11px Helvetica,Arial;fill:#555}.w{background:#fff4d6;border:1px solid #f2b705;padding:6px 8px;margin-bottom:8px}.lg{font-size:10px;color:#555}</style></head><body>
    <header><img src="${new URL('logo.png', location.href).href}" alt=""><div><h1>${esc(name)}</h1><p style="margin:2px 0">${dmy(Date.now())} ${hm(Date.now())} · ${m0(r.inp.q)} l/min · ${r.inp.leitungen} Leitung(en) · ${esc(P.schlauch.name)}</p></div></header>
    ${r.warn.length ? `<div class="w">${r.warn.map(esc).join('<br>')}</div>` : ''}
    <div class="st">${[['Pumpen total', r.pumps.length], ['Schläuche', `${r.schlaeuche} × ${P.schlauch.laenge} m`], ['Länge', m0(r.laenge) + ' m'], ['Höhe Bezug → Ziel', `${m0(r.hStart)} → ${m0(r.hZiel)} m`], ['Höchster Punkt', m0(r.hMax) + ' m'], ['Druck am Ziel', f1(r.pZiel) + ' bar']].map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join('')}</div>
    ${profSvg(r).replace(/var\(--[a-z]+\)/g, '#555')}
    <table><tr><th>Pumpe</th><th>Standort</th><th>Koordinaten LV95</th><th>Teilstrecke</th><th>Druck Ende</th><th>Schläuche</th></tr>
    ${r.segs.map((s, n) => { const p = r.pumps[n]; return `<tr><td><b>P${n + 1}</b> ${esc(s.pumpe)}</td><td>${n === 0 ? 'Wasserbezug' : 'nach ' + m0(p.d) + ' m'}, ${m0(p.h)} m ü. M.</td><td>${r.mode === 'map' ? m0(p.e) + ' / ' + m0(p.n) : '–'}</td><td>${m0(s.laenge)} m (${s.dh >= 0 ? '+' : ''}${m0(s.dh)} m)</td><td>${f1(s.pEnde)} bar</td><td>${s.schlaeuche}</td></tr>`; }).join('')}</table>
    <p class="lg">Mindestdruck ${P.minDruck} bar, Reibungsverlust ${(Math.round(r.fr * 100) / 100).toFixed(2)} bar/100 m, Höhe ${P.hoehe} bar/m, Reserve ${P.reserve} %. Richtwerte – ersetzen keine Beurteilung vor Ort. Höhendaten © swisstopo.</p>
    <script>onload=()=>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};

/* ================= Pendelverkehr ================= */
function initPendel() {
  const d = P.pendel;
  for (const [id, v] of [['pV', d.tempo], ['pT', d.tank], ['pF', d.fuellen], ['pE', d.entleeren], ['pR', d.ruest]]) if (!$('#' + id).value) $('#' + id).value = v;
  calcPendel();
}
function calcPendel() {
  const g = id => +$('#' + id).value || 0;
  const inp = { bedarf: g('pB'), km: g('pKm'), tempo: g('pV'), tank: g('pT'), fuellen: g('pF'), entleeren: g('pE'), ruest: g('pR'), fahrzeuge: g('pN') };
  if (!(inp.tempo > 0 && inp.tank > 0 && inp.fuellen > 0 && inp.entleeren > 0 && inp.bedarf > 0)) { $('#pRes').innerHTML = ''; $('#pNote').textContent = 'Bitte alle Werte eingeben.'; return; }
  const r = WT.pendel(inp), ok = r.total >= inp.bedarf;
  $('#pRes').innerHTML = [['Fahrzeuge nötig', r.noetig, 1], ['Umlaufzeit', f1(r.umlauf) + ' min'], ['Pro Fahrzeug', m0(r.proFz) + ' l/min'],
    ['Mit ' + inp.fahrzeuge + ' Fahrzeugen', m0(r.total) + ' l/min', 1]].map(([a, b, big]) => `<div class="stat${big ? ' big' : ''}"><small>${a}</small><b>${b}</b></div>`).join('');
  $('#pNote').innerHTML = `Umlauf: Fahrt hin und zurück ${f1(r.fahrt)} min + Füllen ${f1(r.fuell)} min + Entleeren ${f1(r.leer)} min + Rüstzeit 2 × ${inp.ruest} min.<br>` +
    (inp.fahrzeuge ? (ok ? `<b style="color:var(--ok)">Mit ${inp.fahrzeuge} Fahrzeugen reicht es.</b>` : `<b style="color:var(--red)">Mit ${inp.fahrzeuge} Fahrzeugen fehlen ca. ${m0(inp.bedarf - r.total)} l/min.</b>`) : '') +
    ' Tipp: Am Ziel ein Ausgleichsbecken als Puffer stellen.';
}
$('#vPendel').addEventListener('input', calcPendel);

/* ================= Parameter ================= */
function fillParam() {
  const s = P.schlauch;
  $('#sN').value = s.name; $('#sLen').value = s.laenge; $('#sV').value = s.refVerlust; $('#sQ').value = s.refQ;
  $('#sMin').value = P.minDruck; $('#sZ').value = P.zielDruck; $('#sMax').value = P.maxDruck; $('#sH').value = P.hoehe; $('#sRes').value = P.reserve;
  $('#sPT').value = P.pendel.tank; $('#sPF').value = P.pendel.fuellen; $('#sPE').value = P.pendel.entleeren; $('#sPV').value = P.pendel.tempo; $('#sPR').value = P.pendel.ruest;
  renderPumps(P.pumpen); sTab();
}
let EP = [];
function renderPumps(list) {
  EP = clone(list);
  $('#pList').innerHTML = EP.map((p, i) => `<div class="pp" data-i="${i}"><input data-k="name" value="${esc(p.name)}" aria-label="Name"><input data-k="druck" type="number" inputmode="decimal" step="0.5" value="${p.druck}" aria-label="Druck"><input data-k="leistung" type="number" inputmode="numeric" step="50" value="${p.leistung}" aria-label="Leistung"><button data-rm="${i}" title="Entfernen" aria-label="Entfernen">×</button></div>`).join('');
}
$('#pList').addEventListener('input', e => { const r = e.target.closest('[data-i]'); if (!r) return; const p = EP[+r.dataset.i], k = e.target.dataset.k; p[k] = k === 'name' ? e.target.value : +e.target.value; });
$('#pList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { if (EP.length <= 1) return msg('Mindestens eine Pumpe.'); EP.splice(+b.dataset.rm, 1); renderPumps(EP); } });
$('#bPAdd').onclick = () => { EP.push({ id: 'p' + Date.now().toString(36), name: 'Neue Pumpe', druck: 8, leistung: 1000 }); renderPumps(EP); };
function sTab() {
  const v = +$('#sV').value, q = +$('#sQ').value; if (!(v > 0 && q > 0)) { $('#sTab').textContent = ''; return; }
  $('#sTab').textContent = 'Daraus gerechnet (Verlust steigt im Quadrat zur Menge): ' + [400, 600, 800, 1000, 1200].map(x => `${x} l/min ≈ ${(Math.round(v * (x / q) ** 2 * 100) / 100).toFixed(2)} bar`).join(' · ') + ' pro 100 m.';
}
$('#sV').addEventListener('input', sTab); $('#sQ').addEventListener('input', sTab);
$('#bPSave').onclick = () => {
  const n = id => +$('#' + id).value;
  if (!(n('sLen') > 0 && n('sV') > 0 && n('sQ') > 0 && n('sH') > 0)) return msg('Schlauchwerte und Höhenverlust prüfen.');
  if (EP.some(p => !p.name.trim() || !(p.druck > 0) || !(p.leistung > 0))) return msg('Bei jeder Pumpe Name, Druck und Leistung angeben.');
  P = { schlauch: { name: $('#sN').value.trim() || 'Schlauch', laenge: n('sLen'), refVerlust: n('sV'), refQ: n('sQ') }, pumpen: clone(EP),
    minDruck: n('sMin'), zielDruck: n('sZ'), maxDruck: n('sMax'), hoehe: n('sH'), reserve: n('sRes'),
    pendel: { tank: n('sPT'), fuellen: n('sPF'), entleeren: n('sPE'), tempo: n('sPV'), ruest: n('sPR') } };
  store('wasser-param', P); I.zielDruck = null; msg('Parameter gespeichert.'); go('dash');
};
$('#bPReset').onclick = () => { if (confirm('Alle Parameter auf die Standardwerte zurücksetzen?')) { P = clone(WT.DEFAULTS); store('wasser-param', P); fillParam(); msg('Standardwerte geladen.'); } };

go('dash');
/* Logo: in einer Unterseite → Dashboard, im Dashboard → Startseite */
$('#aHome').onclick = e => { if (view !== 'dash') { e.preventDefault(); go('dash'); } };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
