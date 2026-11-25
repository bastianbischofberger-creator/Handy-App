/* Gesamtjournal: Einträge dieses Journals plus die Protokolle der anderen Apps zum selben Einsatz (Startseite),
   farblich nach Programm unterschieden. Liest nur – schreibt nichts in die anderen Apps. */
(function () {
'use strict';
const J = window.__JR; if (!J) return;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

const SRC = {
  j: { l: 'Journal', c: '#7a3db8' },
  asue: { l: 'Atemschutz', c: '#c8102e' },
  mf: { l: 'Mehrfachereignisse', c: '#1557c0' },
  lage: { l: 'Lagekarte', c: '#1d7a46' },
  bild: { l: 'Einsatzbilder', c: '#b8860b' }
};
const ON = { j: true, asue: true, mf: true, lage: true, bild: true };
let rows = [], note = '', loading = false;

/* ---------- Daten sammeln ---------- */
async function collect() {
  const S = J.S, key = S.meta && S.meta.fw, out = [];
  (S.entries || []).forEach(e => out.push({ t: e.t, src: 'j', text: e.text, by: e.who }));
  note = '';
  if (!key) { note = 'Dieses Journal gehört zu keinem Einsatz von der Startseite – darum nur die Journal-Einträge.'; rows = out; return; }
  // auf diesem Gerät gespeichert
  const a = ls('asue-db-v1');
  if (a && a.einsaetze) for (const e of Object.values(a.einsaetze)) if (e.meta && e.meta.fw === key) for (const l of Object.values(e.log || {})) out.push({ t: l.t, src: 'asue', text: l.text, by: l.dev });
  const m = ls('mf-db-v1');
  if (m && m.ereignisse) for (const e of Object.values(m.ereignisse)) if (e.meta && e.meta.fw === key) for (const l of Object.values(e.log || {})) out.push({ t: l.t, src: 'mf', text: l.text, by: l.dev });
  const sk = ls('einsatzkarte.skizzen.v1');
  if (Array.isArray(sk)) for (const x of sk) if (x.fw === key) {
    out.push({ t: x.created, src: 'lage', text: `Lageskizze «${x.name}» erstellt` });
    if (x.updated > x.created + 60000) out.push({ t: x.updated, src: 'lage', text: `Lageskizze «${x.name}» zuletzt geändert (${x.n} Einträge)` });
  }
  // synchronisierte Daten (ASÜ und Mehrfachereignisse laufen über Firebase)
  try { out.push(...await cloud(key)); } catch (e) { note = cloudMsg(e); }
  const seen = new Set();
  rows = out.filter(r => r.t && r.text).filter(r => { const k = r.src + r.t + r.text; if (seen.has(k)) return false; seen.add(k); return true; });
}
const cloudMsg = e => e && e.message === 'login' ? 'Einträge von anderen Geräten fehlen: Dieses Gerät ist nicht angemeldet. Einmal in der ASÜ oder den Mehrfachereignissen anmelden, dann erscheinen sie hier.'
  : e && e.message === 'nofb' ? '' : !navigator.onLine ? 'Offline – es werden nur die Daten dieses Geräts angezeigt.' : 'Einträge von anderen Geräten konnten nicht geladen werden.';
let FB = null;
async function cloud(key) {
  const C = window.JR_CONFIG || {}, cfg = C.firebase || C.firebaseSync;
  if (!cfg || !cfg.apiKey) throw new Error('nofb');
  if (!FB) {
    const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [appM, A, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    // gleiche App wie ASÜ/Mehrfachereignisse → gleiche Anmeldung auf diesem Gerät
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(cfg);
    const auth = A.getAuth(app);
    const user = await new Promise(r => { const u = A.onAuthStateChanged(auth, x => { u(); r(x); }); });
    FB = { F, fs: F.getFirestore(app), user };
  }
  if (!FB.user || FB.user.isAnonymous) throw new Error('login');
  const { F, fs } = FB, out = [];
  const grab = async (coll, src) => {
    const q = await F.getDocs(F.query(F.collection(fs, coll), F.where('fw', '==', key)));
    for (const d of q.docs) { const l = await F.getDocs(F.collection(fs, coll, d.id, 'log')); l.docs.forEach(x => { const v = x.data(); out.push({ t: v.t, src, text: v.text, by: v.dev }); }); }
  };
  const fotos = async () => {
    const q = await F.getDocs(F.query(F.collection(fs, 'bi_einsaetze'), F.where('fw', '==', key)));
    for (const d of q.docs) { const l = await F.getDocs(F.collection(fs, 'bi_einsaetze', d.id, 'fotos')); l.docs.forEach(x => { const v = x.data(); out.push({ t: v.t, src: 'bild', text: `Foto «${v.name}»${v.src === 'qr' ? ' (per QR)' : ''}`, by: v.by }); }); }
  };
  await Promise.race([Promise.all([grab('einsaetze', 'asue'), grab('mf_ereignisse', 'mf'), fotos()]), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000))]);
  return out;
}

/* ---------- Anzeige ---------- */
function render() {
  const S = J.S, m = S.meta || {};
  $('#gTitle').textContent = m.title || 'Gesamtjournal';
  $('#gLeg').innerHTML = Object.entries(SRC).map(([k, s]) => {
    const n = rows.filter(r => r.src === k).length;
    return `<button class="leg${ON[k] ? ' on' : ''}" data-k="${k}" style="--c:${s.c}" aria-pressed="${ON[k]}"><i></i>${s.l} <span>${n}</span></button>`;
  }).join('');
  const vis = rows.filter(r => ON[r.src]).sort((a, b) => b.t - a.t);
  let last = null;
  $('#gList').innerHTML = loading ? '<li class="empty">Wird geladen …</li>' : vis.length ? vis.map(r => {
    const day = dmy(r.t), head = day !== last ? `<li class="gday">${day}</li>` : ''; last = day;
    return head + `<li class="g" style="--c:${SRC[r.src].c}"><div class="t">${hm(r.t)}<small>:${pad(new Date(r.t).getSeconds())}</small></div>
      <div class="x"><span class="gb">${SRC[r.src].l}</span>${esc(r.text)}</div><div class="by">${esc(r.by || '')}</div></li>`;
  }).join('') : '<li class="empty">Keine Einträge.</li>';
  $('#gNote').textContent = note; $('#gNote').hidden = !note;
}
$('#gLeg').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; ON[b.dataset.k] = !ON[b.dataset.k]; render(); });
async function open() {
  if (!J.S.meta) return;
  J.show('vAll'); loading = true; render();
  try { await collect(); } catch (e) { note = 'Fehler beim Laden.'; }
  loading = false; render();
}
$('#bAll').onclick = open;
$('#bAllRe').onclick = open;
$('#bAllBack').onclick = () => J.renderJ();
})();
