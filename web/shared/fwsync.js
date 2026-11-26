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
  dlg.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'close') dlg.close(); else run(); });
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
window.FWSync = {
  open(o) { ctx = o; ui(); if (!dlg.open) dlg.showModal(); run(); }
};
})();
