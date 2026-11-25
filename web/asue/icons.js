/* Auftrags-Symbole für die Trupps im Gebäude (Tableau und geteilte Lage). Erkennung über Stichworte im Auftrag. */
(function () {
const S = p => `<svg class="ai" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const LIST = [
  { k: 'brand', l: 'Brandbekämpfung', re: /brand|lösch|loesch/i, svg: S('<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/>') },
  { k: 'rett', l: 'Rettung', re: /rett|bergung|menschen/i, svg: S('<path d="M2 15h20M5 15v4M19 15v4"/><circle cx="7" cy="11" r="2"/><path d="M10.5 12h9"/>') },
  { k: 'such', l: 'Absuchen', re: /such/i, svg: S('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>') },
  { k: 'luft', l: 'Belüftung', re: /l(ü|ue)ft|rauch/i, svg: S('<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C11 6 13 3.5 15.8 4.4s1.6 4.6-2.4 6.6M13.5 12.6c3.9 1.6 4.9 4.6 2.9 6.2s-4.3-.6-4.7-4.8M10.5 12.3c-3.4 2.5-6.2 2.1-6.6-.4s3.1-3.6 6.9-2.1"/>') }
];
window.ASUE_ICONS = {
  LIST,
  keys: (text, max = 2) => { const t = String(text || '').replace(/rettungstrupp|sicherungstrupp/gi, ''); return LIST.filter(x => x.re.test(t)).slice(0, max).map(x => x.k); },
  html: keys => (keys || []).map(k => { const x = LIST.find(i => i.k === k); return x ? x.svg.replace('<svg ', `<svg title="${x.l}" `) : ''; }).join('')
};
})();
