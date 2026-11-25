/* Gemeinsames Fenster «Neuer Einsatz» für alle FW-RTL-Apps – gleich wie auf der Startseite:
   Einsatzbezeichnung, Adresse (amtliches Adressverzeichnis swisstopo, mit Koordinaten), Einsatzleiter, Kartenausschnitt.
   Läuft noch kein aktiver Einsatz, wird der neue Einsatz zum aktiven Einsatz für alle Apps (localStorage «fw-einsatz»).
   Aufruf: const r = await FWForm.open({ app: 'ASÜ', ok: 'Einsatz eröffnen' });
   Ergebnis: null (abgebrochen) oder { bez, adr, el, lat, lng, fw ('fw-…' oder null), t } */
(function () {
'use strict';
const BASE = new URL('.', document.currentScript.src).href; // …/web/shared/
const KEY = 'fw-einsatz';
const read = () => { try { const e = JSON.parse(localStorage.getItem(KEY)); return e && e.bez ? e : null; } catch (e) { return null; } };
const write = e => { try { localStorage.setItem(KEY, JSON.stringify(e)); } catch (x) {} };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
.fwf{border:0;padding:0;width:min(860px,96vw);max-height:94vh;border-radius:16px;background:transparent;color:#fff;font:16px/1.45 Barlow,system-ui,sans-serif}
.fwf::backdrop{background:rgba(0,0,0,.55)}
.fwf .box{border:10px solid transparent;border-radius:16px;padding:18px 20px;background:linear-gradient(#c8102e,#c8102e) padding-box,repeating-linear-gradient(-45deg,#f2b705 0 16px,#16181a 16px 32px) border-box}
.fwf h2{font:700 26px/1.05 "Barlow Condensed",Barlow,sans-serif;margin:0 0 12px;color:#fff}
.fwf .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:700px){.fwf .cols{grid-template-columns:1fr}.fwf .mapbox{min-height:180px}}
.fwf label{display:block;font-size:14px;font-weight:600;margin-bottom:10px;color:rgba(255,255,255,.92)}
.fwf input{display:block;width:100%;box-sizing:border-box;margin-top:4px;font:17px Barlow,system-ui,sans-serif;color:#16181a;background:#fff;border:0;border-radius:8px;padding:10px 12px;min-height:48px}
.fwf .addr{position:relative}
.fwf .sug{position:absolute;left:0;right:0;top:100%;z-index:1100;background:#fff;color:#16181a;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.3);margin-top:2px;max-height:240px;overflow:auto}
.fwf .sug button{display:block;width:100%;text-align:left;background:#fff;color:#16181a;border:0;border-bottom:1px solid #eee;border-radius:0;font:500 16px Barlow,system-ui,sans-serif;min-height:44px;padding:8px 12px;cursor:pointer}
.fwf .sug button:hover,.fwf .sug button.act{background:#fdecef}
.fwf .ok{font-size:13px;font-weight:600;margin:4px 0 0;color:rgba(255,255,255,.92)}
.fwf .mapbox{position:relative;min-height:240px;border-radius:10px;overflow:hidden;background:#e8e8e8;border:2px solid rgba(255,255,255,.85)}
.fwf .map{position:absolute;inset:0}
.fwf .mapempty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:16px;color:#5b6166;font-weight:600;z-index:500;pointer-events:none;background:rgba(255,255,255,.55)}
.fwf .pin{width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c8102e;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)}
.fwf .take{width:100%;text-align:left;margin:0 0 12px;min-height:46px;border-radius:8px;border:2px solid #f2b705;background:#fff8e1;color:#16181a;font:600 15px Barlow,system-ui,sans-serif;padding:8px 12px;cursor:pointer}
.fwf .chk{display:flex;gap:8px;align-items:flex-start;font-size:14px;font-weight:600;margin:4px 0 10px;color:#fff}
.fwf .chk input{width:22px;height:22px;min-height:0;margin:0;flex:none}
.fwf .err{font-weight:600;background:#fff;color:#c8102e;border-radius:6px;padding:4px 10px;display:inline-block;margin:0 0 10px}
.fwf .err:empty{display:none}
.fwf .bt{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
.fwf .bt button{font:600 17px Barlow,system-ui,sans-serif;min-height:48px;padding:8px 18px;border-radius:8px;border:0;background:#fff;color:#c8102e;cursor:pointer}
.fwf .bt button.sec{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}
.fwf [hidden]{display:none !important}`;

let dlg, map, pin, pos, res = [], act = -1, sT, resolver, opts = {}, taken = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise(r => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = BASE + '../vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = BASE + '../vendor/leaflet/leaflet.js'; js.onload = r; js.onerror = r; document.head.appendChild(js);
  });
}
function build() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  dlg = document.createElement('dialog'); dlg.className = 'fwf';
  dlg.innerHTML = `<form class="box" autocomplete="off" novalidate>
    <h2 class="ttl">Neuer Einsatz</h2>
    <div class="cols"><div>
      <button type="button" class="take" hidden></button>
      <label>Einsatzbezeichnung<input name="bez" placeholder="z. B. Brand EFH"></label>
      <label class="addr">Adresse<input name="adr" placeholder="Strasse Nr. oder Ort eintippen …" role="combobox" aria-autocomplete="list"><div class="sug" role="listbox" hidden></div><p class="ok"></p></label>
      <label>Einsatzleiter<input name="el" placeholder="Name Vorname" autocomplete="name"></label>
      <label class="chk" hidden><input type="checkbox" name="act"><span class="chkt"></span></label>
      <p class="err"></p>
      <div class="bt"><button type="submit" class="go">Einsatz eröffnen</button><button type="button" class="sec x">Abbrechen</button></div>
    </div>
    <div class="mapbox"><div class="map"></div><div class="mapempty">Adresse wählen – der Kartenausschnitt erscheint hier</div></div></div>
  </form>`;
  document.body.appendChild(dlg);
  const f = dlg.querySelector('form'), q = s => dlg.querySelector(s), I = n => f.elements[n];
  const clean = l => l.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const fmt = l => { const t = clean(l), m = t.match(/^(.*?)\s(\d{4}\s.+)$/); return m ? m[1] + ', ' + m[2] : t; };
  const sug = () => { q('.sug').innerHTML = res.map((a, i) => `<button type="button" data-i="${i}" class="${i === act ? 'act' : ''}">${esc(fmt(a.label))}</button>`).join(''); q('.sug').hidden = !res.length; };
  const pick = i => { const a = res[i]; if (!a) return; I('adr').value = fmt(a.label); pos = { lat: a.lat, lng: a.lon }; res = []; sug(); q('.ok').textContent = '✓ Adresse gefunden'; showPos(); };
  I('adr').addEventListener('input', () => {
    pos = null; q('.ok').textContent = ''; showPos(); clearTimeout(sT); taken = null;
    const s = I('adr').value.trim(); if (s.length < 3) { res = []; sug(); return; }
    sT = setTimeout(async () => {
      try { const r = await fetch('https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&origins=address&sr=4326&limit=8&searchText=' + encodeURIComponent(s)).then(r => r.json());
        res = (r.results || []).map(x => x.attrs).filter(a => a && a.lat); act = -1; sug(); } catch (e) { res = []; sug(); }
    }, 250);
  });
  I('adr').addEventListener('keydown', e => {
    if (q('.sug').hidden) return;
    if (e.key === 'ArrowDown') { act = Math.min(res.length - 1, act + 1); sug(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); sug(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(act >= 0 ? act : 0); e.preventDefault(); }
    else if (e.key === 'Escape') { res = []; sug(); e.stopPropagation(); }
  });
  q('.sug').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  f.addEventListener('click', e => { if (!e.target.closest('.addr')) { res = []; sug(); } });
  ['bez', 'el'].forEach(n => I(n).addEventListener('input', () => { taken = null; }));
  q('.take').onclick = () => { const A = read(); if (!A) return; I('bez').value = A.bez; I('adr').value = A.adr || ''; I('el').value = A.el || ''; pos = A.lat != null ? { lat: A.lat, lng: A.lng } : null; q('.ok').textContent = pos ? '✓ Adresse gefunden' : ''; taken = A; showPos(); };
  q('.x').onclick = () => done(null);
  dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (!q('.sug').hidden && res.length && !pos) { pick(act >= 0 ? act : 0); return; }
    const bez = I('bez').value.trim(), adr = I('adr').value.trim(), el = I('el').value.trim();
    const miss = [!bez && 'Einsatzbezeichnung', !adr && opts.adrPflicht !== false && 'Adresse', !el && opts.elPflicht !== false && 'Einsatzleiter'].filter(Boolean);
    q('.err').textContent = miss.length ? 'Bitte ausfüllen: ' + miss.join(', ') : ''; if (miss.length) return;
    let fw = null, t = Date.now();
    if (taken && taken.bez === bez) { fw = 'fw-' + taken.t; t = taken.t; }
    else if (!read() || I('act').checked) { write({ bez, adr, el, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, t, quelle: opts.app || '' }); fw = 'fw-' + t; }
    done({ bez, adr, el, lat: pos ? pos.lat : null, lng: pos ? pos.lng : null, fw, t });
  });
}
function showPos() {
  const q = s => dlg.querySelector(s); q('.mapempty').hidden = !!pos;
  if (!window.L) return;
  if (!map) { map = L.map(q('.map'), { zoomControl: true, attributionControl: true }).setView([47.4655, 9.5905], 14);
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', { maxZoom: 19, maxNativeZoom: 18, attribution: '© swisstopo' }).addTo(map); }
  if (pos) { if (pin) pin.setLatLng([pos.lat, pos.lng]); else pin = L.marker([pos.lat, pos.lng], { icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(map); map.setView([pos.lat, pos.lng], 17); }
  else { if (pin) { map.removeLayer(pin); pin = null; } }
  setTimeout(() => map.invalidateSize(), 60);
}
function done(r) { if (dlg.open) dlg.close(); const f = resolver; resolver = null; if (f) f(r); }

window.FWForm = {
  read, write,
  async open(o) {
    opts = o || {}; if (!dlg) build();
    const f = dlg.querySelector('form'), q = s => dlg.querySelector(s), A = read();
    f.reset(); pos = null; res = []; taken = null; q('.sug').hidden = true; q('.ok').textContent = ''; q('.err').textContent = '';
    q('.ttl').textContent = opts.title || 'Neuer Einsatz'; q('.go').textContent = opts.ok || 'Einsatz eröffnen';
    q('.take').hidden = !A || opts.noTake;
    if (A) q('.take').innerHTML = `⚠️ Aktiven Einsatz übernehmen: <b>${esc(A.bez)}</b>${A.adr ? ' · ' + esc(A.adr) : ''}`;
    q('.chk').hidden = !A; if (A) q('.chkt').textContent = `Als aktiven Einsatz für alle Apps setzen (statt «${A.bez}»)`;
    if (opts.prefill) { const P = opts.prefill; if (P.bez) f.elements.bez.value = P.bez; if (P.adr) f.elements.adr.value = P.adr; if (P.el) f.elements.el.value = P.el; }
    dlg.showModal(); setTimeout(() => f.elements[opts.prefill && opts.prefill.bez ? 'adr' : 'bez'].focus(), 50);
    await loadLeaflet(); showPos();
    return new Promise(r => { resolver = r; });
  }
};
})();
