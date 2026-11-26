/* RTLWiki – Wissensdatenbank der Feuerwehr RTL.
   Artikel: Firestore «wiki_artikel/{id}» (Titel, Kategorie, Stichwörter, Text in einfacher Markdown-Schreibweise),
   Anhänge in Stücken unter «dateien», Verlauf unter «versionen». Nur Konten. Offline lesbar (Firestore-Cache). */
const VERSION = '1.0.0';
const CFG = window.WIKI_CONFIG || {};
const FBV = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CHUNK = 700000, MAXF = 8 * 1024 * 1024;
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const dt = t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nrm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => m.textContent = '', 4000); }
const START_KAT = ['Einsatztaktik', 'Atemschutz', 'Fahrzeuge', 'Geräte', 'Strassenrettung', 'Gefahrgut', 'Ausbildung', 'Organisation', 'Kontakte'];

/* ---------- Mini-Markdown (zuerst alles maskieren, dann formatieren) ---------- */
function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[\[(.+?)\]\]/g, (m, t) => { const a = S.list.find(x => nrm(x.titel) === nrm(t.replace(/&amp;/g, '&'))); return a ? `<a href="#a=${a.id}">${t}</a>` : `<a class="miss" href="#neu=${encodeURIComponent(t)}" title="Artikel existiert noch nicht – anlegen">${t}</a>`; })
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
function md(src) {
  const L = esc(src || '').split('\n'), out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => '<li>' + inline(i) + '</li>').join('')}</${list.t}>`); list = null; } };
  for (let i = 0; i < L.length; i++) {
    const l = L[i], m = l.match(/^(#{1,3})\s+(.*)/), ul = l.match(/^\s*[-*•]\s+(.*)/), ol = l.match(/^\s*\d+[.)]\s+(.*)/);
    if (!l.trim()) { flushP(); flushL(); continue; }
    if (m) { flushP(); flushL(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^---+$/.test(l.trim())) { flushP(); flushL(); out.push('<hr>'); continue; }
    if (l.startsWith('&gt;')) { flushP(); flushL(); const q = []; while (i < L.length && L[i].startsWith('&gt;')) q.push(L[i++].replace(/^&gt;\s?/, '')); i--; out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>'); continue; }
    if (l.trim().startsWith('|')) { flushP(); flushL(); const rows = []; while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++]); i--;
      out.push('<table>' + rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r, k) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${k ? 'td' : 'th'}>${inline(c.trim())}</${k ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>'); continue; }
    if (ul || ol) { flushP(); const t = ul ? 'ul' : 'ol'; if (list && list.t !== t) flushL(); if (!list) list = { t, items: [] }; list.items.push((ul || ol)[1]); continue; }
    flushL(); para.push(l);
  }
  flushP(); flushL(); return out.join('');
}

/* ---------- Firebase ---------- */
let F, fs, A, auth, W;
const S = { list: [], user: null, err: '', kat: '', q: '', cur: null, off: JSON.parse(localStorage.getItem('wiki-offline') || '{}') };
function sync() { const el = $('#sync'); let c = 'ok', t = 'Synchronisiert'; if (S.err) { c = 'err'; t = S.err; } else if (!navigator.onLine) { c = 'warn'; t = 'Offline'; } else if (!S.user) { c = 'warn'; t = 'Nicht angemeldet'; } el.className = 'sync ' + c; el.textContent = t; }
addEventListener('online', sync); addEventListener('offline', sync);
$('#sync').addEventListener('click', () => { if (F && fs && S.user && window.FWSync) FWSync.open({ F, fs, user: S.user.email, onDone: () => { S.err = ''; sync(); } }); });
const fail = e => { S.err = e && e.code === 'permission-denied' ? 'Kein Zugriff – Regeln «RTLWiki» veröffentlichen' : 'Sync-Fehler: ' + (e && (e.code || e.message)); sync(); msg(S.err); };
async function boot() {
  try {
    const [appM, Au, Fm] = await Promise.all([import(FBV + 'firebase-app.js'), import(FBV + 'firebase-auth.js'), import(FBV + 'firebase-firestore.js')]);
    F = Fm; A = Au;
    const app = appM.getApps().find(x => x.name === '[DEFAULT]') || appM.initializeApp(CFG.firebase);
    auth = Au.getAuth(app); await Au.setPersistence(auth, Au.indexedDBLocalPersistence).catch(() => {});
    try { fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { fs = F.getFirestore(app); }
    W = F.collection(fs, 'wiki_artikel');
  } catch (e) { $('#sync').textContent = 'Keine Verbindung'; msg('Beim ersten Öffnen braucht es Internet.'); return; }
  A.onAuthStateChanged(auth, u => { S.user = u && !u.isAnonymous ? u : null; $('#login').hidden = !!S.user; sync(); if (S.user) start(); });
}
$('#fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#lErr').textContent = '';
  try { await A.signInWithEmailAndPassword(auth, f.email.value.trim(), f.pw.value); f.pw.value = ''; }
  catch (err) { $('#lErr').textContent = !navigator.onLine ? 'Keine Internetverbindung.' : 'E-Mail oder Passwort falsch.'; }
});
let started = false;
function start() {
  if (started) return; started = true;
  F.onSnapshot(W, q => { S.list = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.titel.localeCompare(b.titel, 'de')); S.err = ''; sync(); route(); }, fail);
}

/* ---------- Übersicht ---------- */
const kats = () => [...new Set([...S.list.map(a => a.kat).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'de'));
function hits() {
  const q = nrm(S.q).trim().split(/\s+/).filter(Boolean);
  return S.list.filter(a => (!S.kat || a.kat === S.kat) && q.every(w => nrm(a.titel + ' ' + a.kat + ' ' + (a.tags || []).join(' ') + ' ' + a.text).includes(w)))
    .sort((a, b) => q.length ? (nrm(b.titel).includes(q[0]) - nrm(a.titel).includes(q[0])) || a.titel.localeCompare(b.titel, 'de') : a.titel.localeCompare(b.titel, 'de'));
}
const snippet = a => { const t = String(a.text || '').replace(/[#*>`|[\]]/g, '').replace(/\s+/g, ' ').trim(); const q = nrm(S.q).trim().split(/\s+/)[0]; if (q) { const i = nrm(t).indexOf(q); if (i > 40) return '… ' + t.slice(i - 30, i + 140); } return t.slice(0, 160); };
function renderList() {
  $('#cKat').innerHTML = ['', ...kats()].map(k => `<button type="button" data-k="${esc(k)}" class="${S.kat === k ? 'on' : ''}">${esc(k || 'Alle')}</button>`).join('');
  const l = hits();
  $('#list').innerHTML = l.length ? l.map(a => `<a class="art btn" href="#a=${a.id}"><span class="kat">${esc(a.kat || 'Ohne Kategorie')}</span><b>${esc(a.titel)}</b><span class="snip">${esc(snippet(a))}</span><small>${a.anh && a.anh.length ? '📎 ' + a.anh.length + ' · ' : ''}geändert ${dt(a.upd)}</small></a>`).join('')
    : `<div class="empty">${S.list.length ? 'Keine Treffer.' : (S.user ? 'Das Wiki ist noch leer. Mit «+ Neuer Artikel» den ersten Beitrag schreiben.' : 'Anmelden, um das Wiki zu lesen.')}</div>`;
}
$('#q').addEventListener('input', e => { S.q = e.target.value; renderList(); });
$('#cKat').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { S.kat = b.dataset.k; renderList(); } });

/* ---------- Artikel ---------- */
function route() {
  const h = location.hash, a = h.match(/a=([\w-]+)/), n = h.match(/neu=([^&]+)/);
  if (n) { history.replaceState(null, '', location.pathname); show(null); openEdit(null, decodeURIComponent(n[1])); return; }
  show(a ? a[1] : null);
}
addEventListener('hashchange', route);
function show(id) {
  const a = S.list.find(x => x.id === id); S.cur = a || null;
  $('#vList').hidden = !!a; $('#vArt').hidden = !a;
  if (!a) { renderList(); return; }
  const back = S.list.filter(x => x.id !== a.id && new RegExp('\\[\\[' + a.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]\\]', 'i').test(x.text || ''));
  $('#vArt').innerHTML = `<div class="vhead"><a class="btn" href="#" aria-label="Zurück zur Übersicht">← Übersicht</a><div style="flex:1"></div>
      <button type="button" data-a="edit">Bearbeiten</button><button type="button" data-a="hist">Verlauf</button><button type="button" class="danger" data-a="del">Löschen</button></div>
    <article class="card"><span class="kat">${esc(a.kat || 'Ohne Kategorie')}</span><h2 style="font:700 34px/1.1 'Barlow Condensed',sans-serif;margin:4px 0 4px">${esc(a.titel)}</h2>
    <div class="meta">Zuletzt geändert ${dt(a.upd)} von ${esc(a.by || '–')}${a.tags && a.tags.length ? `<div class="tags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</div>
    <div class="md">${md(a.text) || '<p class="hint">Noch kein Text.</p>'}</div>
    ${a.anh && a.anh.length ? `<h3 style="font:700 20px 'Barlow Condensed',sans-serif;margin:16px 0 6px">Anhänge</h3><ul class="att">${a.anh.map(f => `<li><span>${f.type === 'application/pdf' ? '📄' : '🖼'} ${esc(f.name)} <small>${Math.round(f.size / 1024)} KB</small></span><button type="button" data-open="${f.id}">Öffnen</button></li>`).join('')}</ul>` : ''}
    ${back.length ? `<p class="hint" style="margin-top:16px">Verlinkt von: ${back.map(x => `<a href="#a=${x.id}" style="color:var(--link);font-weight:600">${esc(x.titel)}</a>`).join(', ')}</p>` : ''}
    <div id="hist"></div></article>`;
  scrollTo(0, 0);
}
$('#vArt').addEventListener('click', async e => {
  const a = S.cur; if (!a) return;
  const b = e.target.closest('[data-a]'), o = e.target.closest('[data-open]'), r = e.target.closest('[data-rest]');
  if (o) openFile(a, a.anh.find(f => f.id === o.dataset.open));
  if (r) { if (!confirm('Diese ältere Version wiederherstellen? Die aktuelle Fassung bleibt im Verlauf.')) return;
    const v = (await F.getDoc(F.doc(W, a.id, 'versionen', r.dataset.rest))).data(); await saveArticle(a, { titel: v.titel, kat: v.kat, tags: v.tags || [], text: v.text }, []); msg('Version wiederhergestellt'); }
  if (!b) return;
  if (b.dataset.a === 'edit') openEdit(a);
  if (b.dataset.a === 'del') {
    if (!confirm(`Artikel «${a.titel}» mit Anhängen und Verlauf endgültig löschen?`)) return;
    try { for (const sub of ['dateien', 'versionen']) { const q = await F.getDocs(F.collection(W, a.id, sub)); await Promise.all(q.docs.map(d => F.deleteDoc(d.ref))); }
      await F.deleteDoc(F.doc(W, a.id)); location.hash = ''; msg('Gelöscht'); } catch (err) { fail(err); }
  }
  if (b.dataset.a === 'hist') {
    try { const q = await F.getDocs(F.query(F.collection(W, a.id, 'versionen'), F.orderBy('upd', 'desc'), F.limit(30)));
      $('#hist').innerHTML = `<h3 style="font:700 20px 'Barlow Condensed',sans-serif;margin:18px 0 6px">Verlauf</h3>` + (q.empty ? '<p class="hint">Noch keine früheren Versionen.</p>'
        : '<ul class="att">' + q.docs.map(d => { const v = d.data(); return `<li><span>${dt(v.upd)} · ${esc(v.by || '–')}<br><small>${esc(v.titel)} · ${String(v.text || '').length} Zeichen</small></span><button type="button" data-rest="${d.id}">Wiederherstellen</button></li>`; }).join('') + '</ul>');
    } catch (err) { fail(err); }
  }
});

/* ---------- Anhänge ---------- */
async function loadFile(a, f, cache) {
  const get = cache ? F.getDocsFromCache : F.getDocs;
  const q = await get(F.query(F.collection(W, a.id, 'dateien'), F.where('f', '==', f.id)));
  if (q.size < f.n) throw new Error('unvollständig');
  const b64 = q.docs.map(d => d.data()).sort((x, y) => x.i - y.i).map(x => x.d).join(''), bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: f.type });
}
async function openFile(a, f) {
  if (!f) return; const w = window.open('', '_blank'); msg('Anhang wird geladen …');
  try { let b; try { b = await loadFile(a, f, true); } catch (e) { b = await loadFile(a, f, false); } const u = URL.createObjectURL(b); if (w) w.location.href = u; else location.href = u; msg(''); }
  catch (e) { if (w) w.close(); msg(!navigator.onLine ? 'Anhang ist auf diesem Gerät noch nicht offline verfügbar.' : 'Anhang konnte nicht geladen werden.'); }
}
$('#bOff').onclick = async () => {
  if (!S.user || !navigator.onLine) return msg(S.user ? 'Dafür braucht es Internet' : 'Zuerst anmelden');
  let n = 0; for (const a of S.list) for (const f of a.anh || []) { msg(`Lade Anhang ${++n} …`); try { await loadFile(a, f, false); } catch (e) {} }
  msg(`${S.list.length} Artikel und ${n} Anhänge offline verfügbar`);
};

/* ---------- Editor ---------- */
let edit = null, newFiles = [], keepAnh = [];
const fE = $('#fE');
function renderAtt() {
  $('#eAtt').innerHTML = [...keepAnh.map(f => ({ ...f, alt: true })), ...newFiles.map((f, i) => ({ name: f.name, size: f.size, i }))]
    .map(f => `<li><span>${esc(f.name)} <small>${Math.round(f.size / 1024)} KB${f.alt ? '' : ' · neu'}</small></span><button type="button" class="danger" ${f.alt ? `data-ra="${f.id}"` : `data-rn="${f.i}"`}>Entfernen</button></li>`).join('');
}
$('#eAtt').addEventListener('click', e => { const a = e.target.closest('[data-ra]'), n = e.target.closest('[data-rn]'); if (a) keepAnh = keepAnh.filter(f => f.id !== a.dataset.ra); if (n) newFiles.splice(+n.dataset.rn, 1); renderAtt(); });
$('#eFile').addEventListener('change', e => { for (const f of e.target.files) { if (f.size > MAXF) { msg(`${f.name} ist grösser als 8 MB`); continue; } newFiles.push(f); } e.target.value = ''; renderAtt(); });
function openEdit(a, titel) {
  if (!S.user) return msg('Zuerst anmelden');
  edit = a; newFiles = []; keepAnh = a ? [...(a.anh || [])] : []; fE.reset(); $('#eErr').textContent = '';
  $('#eT').textContent = a ? 'Artikel bearbeiten' : 'Neuer Artikel';
  $('#katList').innerHTML = [...new Set([...kats(), ...START_KAT])].map(k => `<option value="${esc(k)}">`).join('');
  fE.elements.titel.value = a ? a.titel : (titel || ''); fE.elements.kat.value = a ? a.kat || '' : (S.kat || ''); fE.elements.tags.value = a ? (a.tags || []).join(', ') : ''; fE.elements.text.value = a ? a.text || '' : '';
  $('#ePrev').hidden = true; $('#eText').hidden = false; $('#bPrev').textContent = 'Vorschau'; renderAtt(); $('#dE').showModal();
}
$('#bNew').onclick = () => openEdit(null);
$('#bPrev').onclick = () => { const p = $('#ePrev').hidden; $('#ePrev').innerHTML = md($('#eText').value); $('#ePrev').hidden = !p; $('#eText').hidden = p; $('#bPrev').textContent = p ? 'Bearbeiten' : 'Vorschau'; };
$('#tb').addEventListener('click', e => {
  const b = e.target.closest('[data-md]'); if (!b) return; const t = $('#eText'), s = t.selectionStart, en = t.selectionEnd, sel = t.value.slice(s, en);
  const lines = x => x.split('\n');
  const map = { h2: () => '\n## ' + (sel || 'Titel') + '\n', b: () => '**' + (sel || 'fett') + '**', ul: () => lines(sel || 'Punkt').map(l => '- ' + l).join('\n'), ol: () => lines(sel || 'Schritt').map((l, i) => (i + 1) + '. ' + l).join('\n'),
    q: () => '> ' + (sel || 'Wichtiger Hinweis'), wl: () => '[[' + (sel || 'Artikelname') + ']]', a: () => '[' + (sel || 'Linktext') + '](https://)' };
  const ins = map[b.dataset.md](); t.setRangeText(ins, s, en, 'end'); t.focus();
});
const toB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(f); });
async function saveArticle(a, d, files) {
  const id = a ? a.id : uid(), now = Date.now(), anh = a && d.anh === undefined ? (a.anh || []) : (d.anh || []);
  if (a) await F.setDoc(F.doc(W, id, 'versionen', String(a.upd || now)), { titel: a.titel, kat: a.kat || '', tags: a.tags || [], text: a.text || '', upd: a.upd || now, by: a.by || '' }); // alte Fassung in den Verlauf
  if (a) for (const f of (a.anh || []).filter(f => !anh.some(k => k.id === f.id))) { const q = await F.getDocs(F.query(F.collection(W, id, 'dateien'), F.where('f', '==', f.id))); await Promise.all(q.docs.map(x => F.deleteDoc(x.ref))); }
  const all = [...anh];
  for (const file of files) {
    const fid = uid(), b64 = await toB64(file), n = Math.ceil(b64.length / CHUNK) || 1;
    for (let i = 0; i < n; i++) { $('#eErr').textContent = `Lade «${file.name}» hoch … ${i + 1}/${n}`; await F.setDoc(F.doc(W, id, 'dateien', fid + '_' + String(i).padStart(3, '0')), { f: fid, i, d: b64.slice(i * CHUNK, (i + 1) * CHUNK) }); }
    all.push({ id: fid, name: file.name, type: file.type || 'application/octet-stream', size: file.size, n });
  }
  await F.setDoc(F.doc(W, id), { titel: d.titel, kat: d.kat, tags: d.tags, text: d.text, anh: all, upd: now, by: S.user.email, created: a ? (a.created || now) : now });
  return id;
}
fE.addEventListener('submit', async e => {
  if (!e.submitter || e.submitter.value !== 'ok') return; e.preventDefault();
  const titel = fE.elements.titel.value.trim(); if (!titel) { $('#eErr').textContent = 'Titel fehlt.'; return; }
  if (S.list.some(x => x.id !== (edit && edit.id) && nrm(x.titel) === nrm(titel))) { $('#eErr').textContent = 'Es gibt bereits einen Artikel mit diesem Titel.'; return; }
  const d = { titel, kat: fE.elements.kat.value.trim(), tags: fE.elements.tags.value.split(',').map(s => s.trim()).filter(Boolean), text: fE.elements.text.value, anh: keepAnh };
  $('#eSave').disabled = true;
  try { const id = await saveArticle(edit, d, newFiles); $('#dE').close(); location.hash = 'a=' + id; msg('Gespeichert'); }
  catch (err) { $('#eErr').textContent = err && err.code === 'permission-denied' ? 'Kein Zugriff: In der Firebase-Konsole die Regeln (Abschnitt «RTLWiki») veröffentlichen.' : 'Speichern fehlgeschlagen: ' + (err.code || err.message); }
  $('#eSave').disabled = false;
});

renderList(); boot();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.WIKI_VERSION = VERSION;
