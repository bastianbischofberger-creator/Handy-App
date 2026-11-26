/* Ansicht für Empfänger einer Freigabe (Polizei, Rettungsdienst …). Anonyme Anmeldung, liest nur die
   eine Freigabe aus dem Link – live, solange sie aktiv und gültig ist. */
const CFG = window.SH_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dhm = t => { const d = new Date(t), n = new Date(); return (d.toDateString() === n.toDateString() ? '' : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. `) + hm(t); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const k = new URLSearchParams(location.search).get('k') || '';
function ende(t, s) { $('#badge').textContent = 'Nicht verfügbar'; $('#main').innerHTML = `<div class="card end"><b>${esc(t)}</b><span class="mute">${esc(s)}</span></div>`; }
if (!/^[a-z0-9]{20,40}$/.test(k)) ende('Ungültiger Link', 'Bitte den Link bzw. QR-Code der Feuerwehr erneut verwenden.');
else boot();

let map = null, lay = null, sh = null;
async function boot() {
  try {
    const [appM, Au, F] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    const app = appM.initializeApp(CFG.firebase, 'teilen-ansicht');
    const auth = Au.getAuth(app);
    if (!auth.currentUser) await Au.signInAnonymously(auth);
    const fs = F.getFirestore(app);
    F.onSnapshot(F.doc(fs, 'sh_freigaben', k), d => {
      if (!d.exists()) return ende('Freigabe nicht gefunden', 'Der Link ist ungültig oder wurde gelöscht.');
      sh = d.data(); render();
    }, () => ende('Freigabe beendet oder abgelaufen', 'Die Feuerwehr hat diese Freigabe beendet oder sie ist nicht mehr gültig.'));
  } catch (e) { ende('Keine Verbindung', 'Bitte Internetverbindung prüfen und die Seite neu laden.'); }
}
setInterval(() => { if (sh) { if (Date.now() > sh.bis) ende('Freigabe abgelaufen', 'Die Gültigkeit dieser Freigabe ist abgelaufen.'); else renderBadge(); } }, 30000);
function renderBadge() {
  const min = Math.round((Date.now() - sh.upd) / 60000);
  $('#badge').textContent = sh.mode === 'live' ? (min <= 1 ? 'LIVE · aktuell' : `LIVE · Stand vor ${min} Min`) : 'Stand ' + hm(sh.upd);
  $('#sub').textContent = 'Einsatzdaten für ' + sh.emp;
}
function render() {
  if (!sh.aktiv || Date.now() > sh.bis) return ende('Freigabe beendet', sh.endGrund || 'Die Gültigkeit dieser Freigabe ist abgelaufen.');
  const d = sh.data || {}, out = [];
  renderBadge();
  if (d.einsatz || d.adresse) out.push(`<div class="card head">${d.einsatz ? `<b>${esc(d.einsatz)}</b>` : ''}${d.adresse ? `<div class="small">${esc(d.adresse)}</div>` : ''}${d.alarm ? `<div class="mute small">Alarm ${dhm(d.alarm)}</div>` : ''}${d.el ? `<div class="small">Einsatzleiter: <b style="font:inherit;display:inline">${esc(d.el)}</b></div>` : ''}</div>`);
  else if (d.el) out.push(`<div class="card">Einsatzleiter: <b>${esc(d.el)}</b></div>`);
  if (d.asue && d.asue.notfall) out.push('<div class="not">ATEMSCHUTZ-NOTFALL</div>');
  if (d.lage) out.push(`<div class="card"><h2>LAGE</h2><div class="lage">${esc(d.lage)}</div></div>`);
  if (d.tel) out.push(`<div class="card"><h2>KONTAKT EINSATZLEITUNG</h2><a class="tel" href="tel:${esc(d.tel.replace(/[^\d+]/g, ''))}">${esc(d.tel)} anrufen</a></div>`);
  if (d.treff) out.push(`<div class="card"><h2>TREFFPUNKT / ZUFAHRT</h2><div style="font-weight:600">${esc(d.treff)}</div></div>`);
  if (d.lat != null || (d.sperren && d.sperren.length)) out.push('<div class="card"><h2>KARTE</h2><div id="map"></div></div>');
  if (d.sperren) out.push(`<div class="card"><h2>STRASSENSPERREN</h2>${d.sperren.length ? d.sperren.map(s => `<div class="tr"><span><b>${esc(s.name)}</b>${s.grund ? ' · ' + esc(s.grund) : ''}${s.uml ? ' · Umleitung signalisiert' : ''}</span><span class="mute">${s.bis ? 'bis ' + dhm(+new Date(s.bis)) : ''}</span></div>`).join('') : '<span class="mute">Keine aktiven Sperren.</span>'}</div>`);
  if (d.asue) out.push(`<div class="card"><h2>ATEMSCHUTZ</h2><div><span class="big">${d.asue.innen}</span> Trupp${d.asue.innen === 1 ? '' : 's'} im Einsatz</div>${d.asue.trupps.map(t => `<div class="tr"><span><b>Trupp ${esc(t.nr)}</b> ${esc(t.auftrag || '')}</span><span${t.not ? ' style="color:var(--red);font-weight:800"' : ' class="mute"'}>${t.not ? 'NOTFALL' : esc(t.status)}</span></div>`).join('')}</div>`);
  if (d.journal) out.push(`<div class="card"><h2>${sh.felder.includes('jalle') ? 'EINSATZJOURNAL' : 'WICHTIGE MELDUNGEN'}</h2>${d.journal.length ? `<ul class="j">${[...d.journal].reverse().map(e => `<li class="${e.prio ? 'p' : ''}"><time>${hm(e.t)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>` : '<span class="mute">Noch keine Einträge.</span>'}</div>`);
  out.push(`<footer>Gültig bis ${sh.bisArt === 'ende' ? 'Einsatzende' : dhm(sh.bis)} · Vertraulich – nur für den Einsatz verwenden</footer>`);
  if (map) { map.remove(); map = null; }
  $('#main').innerHTML = out.join('');
  if ($('#map') && window.L) {
    L.Control.Attribution.prototype.options.prefix = false;
    map = L.map('map'); L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(map);
    const pts = [];
    if (d.lat != null) { L.circleMarker([d.lat, d.lng], { radius: 11, color: '#fff', weight: 3, fillColor: '#c8102e', fillOpacity: 1 }).bindTooltip('Einsatzort').addTo(map); pts.push([d.lat, d.lng]); }
    for (const s of d.sperren || []) { const P = (s.pts || []).map(p => [p.la, p.lo]); if (P.length > 1) { L.polyline(P, { color: '#c8102e', weight: 8 }).bindTooltip('Sperre: ' + s.name).addTo(map); pts.push(...P); }
      const U = (s.uml || []).map(p => [p.la, p.lo]); if (U.length > 1) L.polyline(U, { color: '#1d7a46', weight: 6, dashArray: '2 10' }).bindTooltip('Umleitung').addTo(map); }
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(.2)); else if (pts.length) map.setView(pts[0], 16); else map.setView([47.4655, 9.5905], 13);
  }
}
