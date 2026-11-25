/* Gemeinsame Bildfunktionen für Einsatzbilder (KP und Handy der AdF) */
(function () {
const pad = n => String(n).padStart(2, '0');
const BI = window.BI = {
  CHUNK: 700000, MAX: 1920, THUMB: 320,
  pad,
  hm: t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },
  dmy: t => { const d = new Date(t); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  /* Foto laden, drehen gemäss Kamera, verkleinern → { full: base64-JPEG, thumb: dataURL, w, h } */
  async prepare(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
    const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
    const draw = (max, q) => { const s = Math.min(1, max / Math.max(W, H)), c = document.createElement('canvas');
      c.width = Math.round(W * s); c.height = Math.round(H * s); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return { url: c.toDataURL('image/jpeg', q), w: c.width, h: c.height }; };
    let full = draw(BI.MAX, 0.82); if (full.url.length > 2600000) full = draw(1600, 0.75);
    let th = draw(BI.THUMB, 0.6); if (th.url.length > 55000) th = draw(220, 0.5);
    return { full: full.url.split(',')[1], thumb: th.url, w: full.w, h: full.h };
  },
  parts: b64 => { const p = []; for (let i = 0; i < b64.length; i += BI.CHUNK) p.push(b64.slice(i, i + BI.CHUNK)); return p; },
  stamp: t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
};
})();
