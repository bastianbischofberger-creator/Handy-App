/* Gemeinsame Hilfen für Planer und Eintragsseite */
(function () {
const pad = n => String(n).padStart(2, '0');
const TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const SP = window.SP = {
  pad,
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  hm: t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
  dm: t => { const d = new Date(t); return `${TAGE[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; },
  dmy: t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; },
  dayKey: t => { const d = new Date(t); return d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate(); },
  dur: min => { const h = Math.floor(min / 60), m = min % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; },
  MAX_SLOTS: 200,
  /* Schichten berechnen: ab Start alle «len» Minuten, die letzte endet genau bei Ende */
  slots(p) {
    const out = []; if (!p || !(p.end > p.start) || !(p.len > 0)) return out;
    for (let a = p.start; a < p.end && out.length < SP.MAX_SLOTS; a += p.len * 60000) out.push({ a, b: Math.min(a + p.len * 60000, p.end) });
    return out;
  },
  key: (slotA, pos) => `${slotA}_${pos}`
};
})();
