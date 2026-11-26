/* Strassenrettung – Feuerwehr RTL. Ablauf-Checkliste mit Zeitstempeln, Kurzhinweise Antriebe, Suche Rettungsdatenblatt. */
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

const DEFAULT = [
  'Unfallstelle absichern (Warnung, Fahrzeugaufstellung, Beleuchtung)',
  'Erkundung: Fahrzeuge, Personen, eingeklemmt?, Antrieb erkennen',
  'Brandschutz sichergestellt',
  'Gerätedepot / Materialablage eingerichtet',
  'Fahrzeug stabilisiert',
  'Antrieb deaktiviert gemäss Rettungsdatenblatt',
  'Erstzugang – Patient betreut',
  'Glasmanagement',
  'Rettungsöffnung mit Rettungsdienst abgesprochen',
  'Rettungsöffnung geschaffen',
  'Patient gerettet / übergeben',
  'Übergabe Unfallstelle an Polizei'
];
const steps = () => load('sr-steps', DEFAULT);
let st = load('sr-state', { t0: null, done: {} });   // done: { index: timestamp }
const persist = () => save('sr-state', st);

/* gemeinsamer Einsatz von der Startseite */
const fw = () => { try { const e = JSON.parse(localStorage.getItem('fw-einsatz')); return e && e.bez ? e : null; } catch (e) { return null; } };

function render() {
  const F = fw();
  $('#fwInfo').textContent = F ? `${F.bez} · ${F.adr || ''}` : 'Kein aktiver Einsatz auf der Startseite';
  $('#bStart').hidden = !!st.t0;
  $('#steps').innerHTML = steps().map((s, i) => {
    const t = st.done[i];
    return `<li><button type="button" data-i="${i}" class="${t ? 'done' : ''}"><span class="ck">${t ? '✓' : ''}</span><span class="tx">${esc(s)}</span><span class="tm">${t ? hm(t) + (st.t0 ? ' · +' + Math.round((t - st.t0) / 60000) + "'" : '') : ''}</span></button></li>`;
  }).join('');
  tick();
}
function tick() {
  $('#clock').textContent = hm(Date.now());
  if (st.t0) { const s = Math.floor((Date.now() - st.t0) / 1000); $('#since').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60); $('#sinceL').textContent = 'seit Start ' + hm(st.t0); }
  else { $('#since').textContent = '--:--'; $('#sinceL').textContent = 'Zeit seit Start'; }
}
setInterval(tick, 1000);

$('#bStart').onclick = () => { st.t0 = Date.now(); persist(); render(); };
$('#steps').addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return; const i = b.dataset.i;
  if (st.done[i]) { if (!confirm('Schritt zurücksetzen?')) return; delete st.done[i]; }
  else { st.done[i] = Date.now(); if (!st.t0) st.t0 = st.done[i]; }
  persist(); render();
});
$('#bReset').onclick = () => { if (!confirm('Ablauf neu beginnen? Alle Häkchen werden gelöscht.')) return; st = { t0: null, done: {} }; persist(); render(); };
$('#bCopy').onclick = async () => {
  const F = fw();
  const lines = [`Strassenrettung${F ? ' – ' + F.bez + ', ' + (F.adr || '') : ''}`, st.t0 ? `Start ${hm(st.t0)}` : 'Kein Start erfasst'];
  steps().forEach((s, i) => { if (st.done[i]) lines.push(`${hm(st.done[i])}  ${s}`); });
  const open = steps().filter((s, i) => !st.done[i]); if (open.length) lines.push('Offen: ' + open.join('; '));
  try { await navigator.clipboard.writeText(lines.join('\n')); msg('Protokoll kopiert – z. B. ins Einsatzjournal einfügen'); } catch (e) { msg('Kopieren nicht möglich'); }
};

/* Tabs */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  for (const t of ['ablauf', 'antriebe', 'rdb', 'setup']) $('#t-' + t).hidden = t !== b.dataset.t;
  if (b.dataset.t === 'setup') $('#setSteps').value = steps().join('\n');
});

/* Rettungsdatenblatt */
$('#bRdb').onclick = () => {
  const q = ['Rettungsdatenblatt', $('#rMarke').value, $('#rModell').value, $('#rJahr').value].map(x => x.trim()).filter(Boolean).join(' ');
  if (q === 'Rettungsdatenblatt') return msg('Bitte mindestens Marke oder Modell eingeben');
  window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener');
};

/* Checkliste anpassen */
$('#bSave').onclick = () => {
  const l = $('#setSteps').value.split('\n').map(x => x.trim()).filter(Boolean);
  if (!l.length) return msg('Mindestens ein Schritt nötig');
  save('sr-steps', l); st.done = {}; persist(); render(); msg('Checkliste gespeichert');
};
$('#bDefault').onclick = () => { $('#setSteps').value = DEFAULT.join('\n'); };

render();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.SR_VERSION = VERSION;
})();
