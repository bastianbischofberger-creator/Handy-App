/* Wassertransport – Rechenkern (ohne Oberfläche), damit er sich separat prüfen lässt */
(function (root) {
'use strict';

/* ---------- Standard-Parameter (in der App unter «Parameter» änderbar) ---------- */
const DEFAULTS = {
  schlauch: { name: '75 mm', laenge: 20, refQ: 800, refVerlust: 1.0 }, // Reibungsverlust bar pro 100 m bei refQ l/min
  pumpen: [
    { id: 'ms', name: 'Motorspritze mit Ausgleichsbecken', druck: 8, leistung: 1000 },
    { id: 'unimog', name: 'Unimog', druck: 8, leistung: 1500 },
    { id: 'tlf', name: 'TLF', druck: 8, leistung: 2000 }
  ],
  minDruck: 1.5,     // bar, mindestens am Ende jeder Teilstrecke (Einspeisung ins Ausgleichsbecken)
  zielDruck: 1.5,    // bar, am Ziel benötigt (Vorschlag, pro Berechnung änderbar)
  maxDruck: 12,      // bar, höchster zulässiger Druck in der Leitung (Gefälle!)
  reserve: 10,       // % Schlauchreserve
  hoehe: 0.1,        // bar pro Meter Höhenunterschied
  pendel: { tank: 2400, fuellen: 1000, entleeren: 1500, tempo: 30, ruest: 2 }
};

/* ---------- Koordinaten WGS84 <-> LV95 (Näherungsformeln swisstopo, Genauigkeit ~1 m) ---------- */
function toLV95(lat, lng) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lng * 3600 - 26782.5) / 10000;
  return {
    e: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
    n: 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p * p * p
  };
}
function toWGS(e, n) {
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  const l = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const p = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.0140 * x * x * x;
  return { lat: p * 100 / 36, lng: l * 100 / 36 };
}

/* ---------- Profil auf 5-m-Schritte verdichten, Länge entlang Gelände (3D) ---------- */
function resample(prof, step) {
  // prof: [{d (horizontal m), h, e, n}] aufsteigend
  step = step || 5;
  const out = []; const total = prof[prof.length - 1].d;
  let k = 0;
  for (let d = 0; ; d = Math.min(d + step, total)) {
    while (k < prof.length - 2 && prof[k + 1].d < d) k++;
    const a = prof[k], b = prof[Math.min(k + 1, prof.length - 1)], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
    out.push({ dh: d, h: a.h + (b.h - a.h) * t, e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t });
    if (d >= total) break;
  }
  let s = 0; out[0].d = 0;
  for (let i = 1; i < out.length; i++) { s += Math.hypot(out[i].dh - out[i - 1].dh, out[i].h - out[i - 1].h); out[i].d = s; }
  return out;
}

/* ---------- Relaisleitung berechnen ----------
   inp: { q (l/min total), leitungen, quelle (Pumpen-ID), relais (Pumpen-ID), zielDruck }
   Rückgabe: Pumpenstandorte, Teilstrecken, Druckverlauf, Schläuche, Warnungen */
function compute(pts, P, inp) {
  const pump = id => P.pumpen.find(p => p.id === id) || P.pumpen[0];
  const src = pump(inp.quelle), rel = pump(inp.relais);
  const qLine = inp.q / Math.max(1, inp.leitungen);
  const fr = P.schlauch.refVerlust * Math.pow(qLine / P.schlauch.refQ, 2) / 100; // bar pro m Schlauch
  const g = P.hoehe, last = pts.length - 1, pMin = P.minDruck, pZiel = inp.zielDruck;
  const pAt = (i, j, P0) => P0 - fr * (pts[j].d - pts[i].d) - g * (pts[j].h - pts[i].h);
  const warn = [], pumps = [{ i: 0, pump: src }], press = new Array(pts.length).fill(null);
  let i = 0, guard = 0, ok = true;
  while (guard++ < 200) {
    const P0 = pumps[pumps.length - 1].pump.druck;
    let j = i + 1, broke = -1;
    for (; j <= last; j++) { const p = pAt(i, j, P0); press[j] = p; if (p < pMin) { broke = j; break; } }
    press[i] = P0;
    if (broke < 0 && pAt(i, last, P0) >= pZiel) break; // Ziel erreicht
    let k;
    if (broke < 0) {
      // Ziel mit Mindestdruck erreicht, aber nicht mit Zieldruck: letzte Pumpe so früh setzen, dass am Ziel der Zieldruck ankommt
      k = -1;
      for (let m = i + 1; m < last; m++) if (pAt(i, m, P0) >= pMin && rel.druck - fr * (pts[last].d - pts[m].d) - g * (pts[last].h - pts[m].h) >= pZiel) { k = m; break; }
      if (k < 0) { ok = false; warn.push(`Der Zieldruck von ${pZiel} bar ist mit ${rel.druck} bar Pumpendruck am Ziel nicht erreichbar.`); break; }
    } else {
      k = broke - 1;
      if (k <= i) { ok = false; warn.push('Die Strecke ist an einer Stelle zu steil – mit diesem Pumpendruck nicht machbar.'); break; }
    }
    for (let m = k + 1; m <= last; m++) press[m] = null;
    pumps.push({ i: k, pump: rel }); i = k;
  }
  // Teilstrecken
  const segs = pumps.map((p, n) => {
    const a = p.i, b = n + 1 < pumps.length ? pumps[n + 1].i : last;
    let pmax = -Infinity, pminSeg = Infinity, at = a;
    for (let m = a; m <= b; m++) { const v = pAt(a, m, p.pump.druck); if (v > pmax) { pmax = v; } if (m > a && v < pminSeg) { pminSeg = v; at = m; } }
    const len = pts[b].d - pts[a].d;
    return { von: a, bis: b, laenge: len, dh: pts[b].h - pts[a].h, pEnde: pAt(a, b, p.pump.druck), pMax: pmax, pumpe: p.pump.name,
      schlaeuche: Math.ceil(len * (1 + P.reserve / 100) / P.schlauch.laenge) * Math.max(1, inp.leitungen) };
  });
  for (const s of segs) if (s.pMax > P.maxDruck + 1e-9) warn.push(`Ab Pumpe ${segs.indexOf(s) + 1}: Druck steigt im Gefälle bis ${s.pMax.toFixed(1)} bar (max. ${P.maxDruck} bar) – Pumpendruck reduzieren oder Druckbegrenzung.`);
  for (const p of [src, rel]) if (inp.q > p.leistung) warn.push(`${p.name}: Fördermenge ${inp.q} l/min liegt über der Leistung (${p.leistung} l/min).`);
  // Druckverlauf vollständig für Grafik
  const pr = new Array(pts.length);
  segs.forEach((s, n) => { for (let m = s.von; m <= s.bis; m++) if (n === segs.length - 1 || m < s.bis) pr[m] = pAt(s.von, m, pumps[n].pump.druck); });
  const hs = pts.map(p => p.h);
  return {
    ok, warn, fr: fr * 100, qLine, pumps: pumps.map(p => ({ ...pts[p.i], pump: p.pump })), segs, druck: pr,
    laenge: pts[last].d, laengeH: pts[last].dh, hStart: pts[0].h, hZiel: pts[last].h, hMax: Math.max(...hs), hMin: Math.min(...hs),
    schlaeuche: segs.reduce((s, x) => s + x.schlaeuche, 0), pZiel: pr[last]
  };
}

/* ---------- Pendelverkehr ---------- */
function pendel(inp) {
  // inp: { bedarf l/min, tank l, km (einfach), tempo km/h, fuellen l/min, entleeren l/min, ruest min, fahrzeuge }
  const fahrt = inp.km / inp.tempo * 60 * 2, fuell = inp.tank / inp.fuellen, leer = inp.tank / inp.entleeren;
  const umlauf = fahrt + fuell + leer + inp.ruest * 2;
  const proFz = inp.tank / umlauf;
  return { fahrt, fuell, leer, umlauf, proFz, noetig: Math.ceil(inp.bedarf / proFz - 1e-9), total: proFz * (inp.fahrzeuge || 0) };
}

root.WT = { DEFAULTS, toLV95, toWGS, resample, compute, pendel };
})(typeof window !== 'undefined' ? window : globalThis);
