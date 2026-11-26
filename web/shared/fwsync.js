/* Gemeinsam für alle FW-RTL-Apps: Sync-Status antippen = jetzt synchronisieren.
   Baut die Verbindung zu Firebase neu auf, wartet bis der Server alle Änderungen bestätigt hat
   und zeigt das Ergebnis in einem kleinen Fenster.
   Aufruf: FWSync.open({ F, fs, user: 'mail@…' })   (F = firebase-firestore-Modul, fs = Firestore-Instanz) */
(function () {
'use strict';
const CSS = `
.fws{border:0;border-radius:14px;padding:18px 20px;width:min(440px,94vw);background:var(--card,#fff);color:var(--ink,#16181a);box-shadow:0 20px 60px rgba(0,0,0,.4);font:16px/1.45 Barlow,system-ui,sans-serif}
#sync{cursor:pointer}
.fws::backdrop{background:rgba(0,0,0,.55)}
.fws h3{font:600 26px/1.1 "Barlow Condensed",Barlow,sans-serif;margin:0 0 10px}
.fws .res{font-size:20px;font-weight:700;margin:4px 0 12px}.fws .res.ok{color:#1d7a46}.fws .res.err{color:#c8102e}
.fws dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0 0 12px}.fws dt{opacity:.7}.fws dd{margin:0;font-weight:600}
.fws .bt{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.fws button{font:600 16px Barlow,sans-serif;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #d8d4ce;background:#f7f6f4;color:#16181a;cursor:pointer}
.fws button.pri{background:#c8102e;border-color:#c8102e;color:#fff}`;
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const hms = t => hm(t) + ':' + pad(new Date(t).getSeconds());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function errText(e) {
  const c = e && e.code;
  if (e && e.message === 'timeout') return 'Server antwortet nicht. Internet prüfen und nochmals versuchen.';
  if (c === 'permission-denied') return 'Kein Zugriff (Konto nicht freigegeben)';
  if (c === 'resource-exhausted') return 'Tageslimit von Firebase erreicht';
  if (c === 'unavailable') return 'Server nicht erreichbar';
  return 'Sync-Fehler: ' + (e && (c || e.message));
}
let dlg = null, ctx = null, busy = false, lastOk = 0;
function ui() {
  if (dlg) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  dlg = document.createElement('dialog'); dlg.className = 'fws';
  dlg.innerHTML = '<h3>Synchronisation</h3><p class="res"></p><dl></dl><div class="bt"><button type="button" data-a="again">Nochmals synchronisieren</button><button type="button" class="pri" data-a="close">Schliessen</button></div>';
  document.body.appendChild(dlg);
  dlg.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'close') dlg.close(); else if (ctx && ctx.all) runAll(ctx.all); else run(); });
}
function set(t, c) {
  const r = dlg.querySelector('.res'); r.textContent = t; r.className = 'res' + (c ? ' ' + c : '');
  dlg.querySelector('dl').innerHTML = `<dt>Letzte Bestätigung</dt><dd>${lastOk ? hms(lastOk) : '–'}</dd><dt>Internet</dt><dd>${navigator.onLine ? 'verbunden' : 'keine Verbindung'}</dd><dt>Konto</dt><dd>${esc(ctx.user || '–')}</dd>`;
}
async function run() {
  if (!navigator.onLine) return set('Kein Internet – die Änderungen werden abgeglichen, sobald wieder Netz da ist.', 'err');
  if (busy) return; busy = true; set('Synchronisiere …');
  const { F, fs } = ctx;
  try {
    await F.disableNetwork(fs); await F.enableNetwork(fs);
    await Promise.race([F.waitForPendingWrites(fs), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]);
    lastOk = Date.now(); set('✓ Synchronisiert ' + hm(lastOk), 'ok');
    if (ctx.onDone) try { ctx.onDone(); } catch (x) {}
  } catch (e) { set(errText(e), 'err'); }
  busy = false;
}
/* Startseite: alle Apps dieses Geräts auf einmal synchronisieren.
   Jede App hat ihren eigenen Firebase-Speicher (Name) – hier wird jeder kurz geöffnet und abgeglichen. */
const APPS = [['[DEFAULT]', 'ASÜ, Einsatzbilder, Einsatzpläne'], ['journal', 'Einsatzjournal'], ['mehrfach', 'Mehrfachereignisse'], ['schicht', 'Schichtplanung']];
let allBusy = false;
async function runAll(cfg) {
  const res = dlg.querySelector('.res'), dl = dlg.querySelector('dl');
  const rows = APPS.map(a => ({ n: a[1], t: '…' }));
  const show = () => { dl.innerHTML = rows.map(r => `<dt>${esc(r.n)}</dt><dd>${esc(r.t)}</dd>`).join(''); };
  if (!navigator.onLine) { res.textContent = 'Kein Internet – die Apps gleichen ab, sobald wieder Netz da ist.'; res.className = 'res err'; rows.forEach(r => r.t = '–'); show(); return; }
  if (allBusy) return; allBusy = true; res.textContent = 'Synchronisiere alle Apps …'; res.className = 'res'; show();
  let M;
  try {
    const B = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [appM, Au, F] = await Promise.all([import(B + 'firebase-app.js'), import(B + 'firebase-auth.js'), import(B + 'firebase-firestore.js')]);
    M = { appM, Au, F };
  } catch (e) { res.textContent = 'Firebase nicht erreichbar.'; res.className = 'res err'; allBusy = false; return; }
  const { appM, Au, F } = M; let ok = 0, err = 0;
  await Promise.all(APPS.map(async ([name], i) => {
    try {
      const app = appM.getApps().find(x => x.name === name) || (name === '[DEFAULT]' ? appM.initializeApp(cfg) : appM.initializeApp(cfg, name));
      const auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
      const user = await new Promise(r => { const u = Au.onAuthStateChanged(auth, x => { u(); r(x); }); });
      if (!user || user.isAnonymous) { rows[i].t = 'nicht angemeldet'; show(); return; }
      let fs; try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
      await F.disableNetwork(fs); await F.enableNetwork(fs);
      await Promise.race([F.waitForPendingWrites(fs), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))]);
      if (name === '[DEFAULT]') { // Index der Einsatzpläne für den Hinweis auf der Startseite auffrischen
        try { const q = await F.getDocs(F.collection(fs, 'pl_objekte'));
          const list = q.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.lat != null).map(o => ({ id: o.id, name: o.name, adr: o.adr || '', lat: o.lat, lng: o.lng, radius: o.radius || 100, stand: o.stand || '', tags: o.tags || [] }));
          localStorage.setItem('fw-plaene', JSON.stringify({ t: Date.now(), list })); } catch (x) {}
      }
      rows[i].t = '✓ ' + hm(Date.now()); ok++; show();
    } catch (e) { rows[i].t = errText(e); err++; show(); }
  }));
  lastOk = Date.now();
  res.textContent = err ? `${ok} synchronisiert, ${err} mit Fehler` : (ok ? '✓ Alle Apps synchronisiert ' + hm(lastOk) : 'Auf diesem Gerät ist noch keine App angemeldet.');
  res.className = 'res ' + (err ? 'err' : ok ? 'ok' : '');
  allBusy = false;
  if (ctx && ctx.onDone) try { ctx.onDone(); } catch (x) {}
}
window.FWSync = {
  open(o) { ctx = o; ui(); if (!dlg.open) dlg.showModal(); run(); },
  openAll(cfg, onDone) { ctx = { all: cfg, onDone }; ui(); if (!dlg.open) dlg.showModal(); runAll(cfg); }
};
})();
