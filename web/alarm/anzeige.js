/* Alarmdisplay – Anzeige auf dem TV. Meldet sich anonym an, zeigt bis zur Kopplung einen Code.
   Danach Ruheanzeige (Uhr, Termine, Sperren, Laufschrift) bzw. bei Alarm Stichwort, Adresse, Karte und Route ab Depot.
   ?vorschau=1 auf einem Gerät mit Konto: Anzeige ohne Kopplung. */
const CFG = window.AD_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const TILE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg';
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VORSCHAU = new URLSearchParams(location.search).has('vorschau');
const S = { scr: null, cur: null, ruhe: {}, staff: false, lastAlarm: 0 };
const show = id => ['vPair', 'vRuhe', 'vAlarm'].forEach(v => $('#' + v).hidden = v !== id);

/* ---------- Ton (TV-Browser erlauben Ton erst nach einer Bedienung) ---------- */
let ac = null;
function gong() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const t0 = ac.currentTime;
  [0, .5, 1, 1.5, 2, 2.5].forEach((d, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = i % 2 ? 660 : 880; g.gain.setValueAtTime(.0001, t0 + d); g.gain.exponentialRampToValueAtTime(.25, t0 + d + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + d + .45); o.connect(g).connect(ac.destination); o.start(t0 + d); o.stop(t0 + d + .5); }); } catch (e) {} }
$('#tap').onclick = () => { $('#tap').hidden = true; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) {} try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch (e) {} };
addEventListener('keydown', () => $('#tap').onclick()); addEventListener('click', () => $('#tap').onclick());

/* ---------- Uhr & Ruheanzeige ---------- */
const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
function tick() {
  const n = new Date(); $('#clock').textContent = hm(n); $('#date').textContent = `${WT[n.getDay()]}, ${n.getDate()}.${n.getMonth() + 1}.${n.getFullYear()}`;
  if (S.cur && S.cur.aktiv) { const s = Math.max(0, Math.floor((Date.now() - S.cur.t) / 1000)); $('#aSince').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
  route();
}
setInterval(tick, 1000);
// gegen Einbrennen: Ruheanzeige verschiebt sich langsam um wenige Pixel
let sh = 0; setInterval(() => { sh = (sh + 1) % 4; $('#ruheIn').style.transform = `translate(${[0, 8, 8, 0][sh]}px,${[0, 0, 8, 8][sh]}px)`; }, 120000);
function renderRuhe() {
  const R = S.ruhe || {}, today = new Date().toISOString().slice(0, 10);
  const t = (R.termine || []).filter(x => x.d >= today).sort((a, b) => a.d.localeCompare(b.d)).slice(0, 6);
  $('#termine').innerHTML = t.length ? t.map(x => `<li><b>${esc(x.d.split('-').reverse().slice(0, 2).join('.'))}.</b><span>${esc(x.text)}</span></li>`).join('') : '<li style="color:#9aa7b4">Keine Termine eingetragen</li>';
  const now = Date.now(), sp = (R.sperren || []).filter(s => (!s.bis || +new Date(s.bis) > now));
  $('#spBox').hidden = R.showSp === false;
  $('#sperren').innerHTML = sp.length ? sp.map(s => { const akt = !s.von || +new Date(s.von) <= now; return `<li><b style="color:${akt ? '#ff6b6b' : '#f2b705'}">${akt ? 'AKTIV' : 'ab ' + new Date(s.von).getDate() + '.' + (new Date(s.von).getMonth() + 1) + '.'}</b><span>${esc(s.name)}${s.bis ? ' – bis ' + new Date(s.bis).getDate() + '.' + (new Date(s.bis).getMonth() + 1) + '.' : ''}</span></li>`; }).join('') : '<li style="color:#9aa7b4">Keine Sperren</li>';
  $('#marq').hidden = !R.info; $('#marqT').textContent = R.info || '';
}

/* ---------- Alarm ---------- */
let map = null, lay = null, mapKey = '';
function renderAlarm() {
  const c = S.cur, layout = (S.scr && S.scr.layout) || 'karte';
  $('#aStw').textContent = c.stw; $('#aStufe').textContent = c.stufe || ''; $('#aStufe').hidden = !c.stufe; $('#aZeit').textContent = 'Alarm ' + hm(c.t);
  $('#testMark').hidden = !c.test; $('#aBody').className = 'abody' + (layout === 'text' ? ' text' : '');
  const r = c.route;
  $('#aInfo').innerHTML = `<div class="adr">${esc(c.adr || 'Ort folgt')}</div>
    ${c.bem ? `<div class="bem">${esc(c.bem)}</div>` : ''}
    ${r ? `<div class="kv"><div><small>FAHRZEIT AB ${esc(String(r.dep).toUpperCase())}</small><b>${Math.max(1, Math.round(r.min))} Min.</b></div><div><small>DISTANZ</small><b>${r.km.toFixed(1)} km</b></div></div>` : (c.lat != null && !c.test ? '<div style="color:#9aa7b4;font-size:2.6vh">Route wird berechnet …</div>' : '')}
    ${r && r.sperrBahn ? '<div class="warnb">ACHTUNG: Route über gesperrten Bahnübergang</div>' : ''}
    ${(c.plaene || []).map(p => `<div class="plan"><b>Einsatzplan: ${esc(p.name)}</b><span>${esc((p.tags || []).join(' · '))}</span></div>`).join('')}`;
  // Karte nur neu zeichnen, wenn sich Ort oder Route ändern
  const k = [c.t, c.lat, c.lng, r ? r.path.length : 0, layout].join('|'); if (k === mapKey && map) return; mapKey = k;
  if (!map) { L.Control.Attribution.prototype.options.prefix = false; map = L.map('aMap', { zoomControl: false, attributionControl: true }); L.tileLayer(TILE, { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(map); lay = L.layerGroup().addTo(map); }
  setTimeout(() => map.invalidateSize(), 50);
  lay.clearLayers(); const pts = [];
  if (r && window.FWRoute) { const P = FWRoute.unpackPath(r.path); if (P.length > 1) { L.polyline(P, { color: '#fff', weight: 14, opacity: .9 }).addTo(lay); L.polyline(P, { color: '#1565c0', weight: 8 }).addTo(lay); pts.push(...P); }
    if (r.depPos) L.circleMarker([r.depPos.la, r.depPos.lo], { radius: 12, color: '#fff', weight: 4, fillColor: '#16181a', fillOpacity: 1 }).bindTooltip(esc(r.dep), { permanent: true, direction: 'right' }).addTo(lay); }
  for (const s of (S.ruhe.sperren || [])) { const P = window.FWRoute ? FWRoute.unpackPath(s.pts) : []; const now = Date.now(); if (P.length > 1 && (!s.von || +new Date(s.von) <= now) && (!s.bis || +new Date(s.bis) > now)) L.polyline(P, { color: '#ff3b3b', weight: 10, opacity: .85 }).addTo(lay); }
  if (c.lat != null) { L.circleMarker([c.lat, c.lng], { radius: 18, color: '#fff', weight: 5, fillColor: '#c8102e', fillOpacity: 1 }).addTo(lay); pts.push([c.lat, c.lng]); }
  if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(.12)); else if (pts.length) map.setView(pts[0], 16); else map.setView([47.4655, 9.5905], 13);
}

/* ---------- Was wird angezeigt? ---------- */
function route() {
  if (!S.staff && !(S.scr && S.scr.paired)) { show('vPair'); return; }
  const c = S.cur, on = c && c.aktiv && Date.now() < c.bis && (!S.scr || S.scr.layout !== 'ruhe');
  if (on) { if ($('#vAlarm').hidden) { show('vAlarm'); renderAlarm(); } if (c.t !== S.lastAlarm) { S.lastAlarm = c.t; renderAlarm(); gong(); } }
  else if ($('#vRuhe').hidden) { show('vRuhe'); renderRuhe(); }
}

/* ---------- Firebase ---------- */
async function boot() {
  let appM, Au, F;
  try { [appM, Au, F] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]); }
  catch (e) { $('#off').hidden = false; setTimeout(() => location.reload(), 60000); return; }
  // Vorschau auf einem Gerät mit Konto: Standard-App (gleiches Login wie die Verwaltung); TV: eigene anonyme App-Instanz
  const app = VORSCHAU ? (appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase)) : appM.initializeApp(CFG.firebase, 'alarmdisplay');
  const auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
  const fs = F.getFirestore(app);
  let user = await new Promise(r => { const u = Au.onAuthStateChanged(auth, x => { u(); r(x); }); });
  if (VORSCHAU && user && !user.isAnonymous) S.staff = true;
  else { if (!user) user = (await Au.signInAnonymously(auth)).user;
    const ref = F.doc(fs, 'ad_screens', user.uid);
    let snap = null; try { snap = await F.getDoc(ref); } catch (e) {}
    if (!snap || !snap.exists()) { const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      await F.setDoc(ref, { code, t: Date.now(), seen: Date.now(), ua: navigator.userAgent.slice(0, 120) }).catch(() => {}); }
    let lastReload = null;
    F.onSnapshot(ref, d => {
      if (!d.exists()) { location.reload(); return; }          // entfernt → neu anmelden, neuer Code
      const v = d.data(); const was = S.scr && S.scr.paired; S.scr = v; $('#code').textContent = v.code || '······';
      if (lastReload === null) lastReload = v.reload || 0; else if (v.reload && v.reload !== lastReload) location.reload();
      if (v.paired && !was) { listen(); $('#tap').hidden = false; }
      if (S.cur) { mapKey = ''; if (!$('#vAlarm').hidden) renderAlarm(); }
      route();
    }, () => {});
    setInterval(() => F.updateDoc(ref, { seen: Date.now() }).catch(() => {}), 60000);
    F.updateDoc(ref, { seen: Date.now() }).catch(() => {});
  }
  function listen() {
    if (listen.on) return; listen.on = true;
    F.onSnapshot(F.doc(fs, 'ad_state', 'current'), d => { S.cur = d.exists() ? d.data() : null; $('#off').hidden = true; if (S.cur && !$('#vAlarm').hidden) renderAlarm(); route(); }, () => { $('#off').hidden = false; });
    F.onSnapshot(F.doc(fs, 'ad_state', 'ruhe'), d => { S.ruhe = d.exists() ? d.data() : {}; renderRuhe(); }, () => {});
  }
  if (S.staff) { listen(); $('#tap').hidden = false; }
  route();
}
addEventListener('online', () => $('#off').hidden = true); addEventListener('offline', () => $('#off').hidden = false);
setTimeout(() => location.reload(), 6 * 3600000 + Math.random() * 600000); // alle ~6 Std. frisch laden (Speicher, Updates)
tick(); boot();
window.AD_TEST = { S, route, renderAlarm, renderRuhe };  // nur für automatische Tests
