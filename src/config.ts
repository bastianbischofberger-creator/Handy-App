import type { LineType, SymbolType } from './types';

// Kostenlose Kartenkacheln von swisstopo (geo.admin.ch), im Web-Mercator-Raster (3857).
export const BASE_MAPS = {
  karte: {
    label: 'Karte',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  },
  luftbild: {
    label: 'Luftbild',
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
  },
} as const;

export type BaseMapKey = keyof typeof BASE_MAPS;

export const MAX_ZOOM = 18;

// Startausschnitt, falls der Standort (noch) nicht bekannt ist: ganze Schweiz.
export const SWITZERLAND_REGION = {
  latitude: 46.8,
  longitude: 8.23,
  latitudeDelta: 3.2,
  longitudeDelta: 4.5,
};

// Absprachepunkte nach FKS. Die Web-App (web/index.html) zeichnet die echten FKS-Symbole;
// hier stehen Kürzel. Nr. 3 (Rettungsachse) ist eine Zone, siehe LINE_TYPES.
export const SYMBOL_TYPES: SymbolType[] = [
  { id: 'patientensammelstelle', name: '1 Patientensammelstelle', short: 'PS', color: '#2F6DB5' },
  { id: 'sanhist', name: '2 San Hist', short: 'SH', color: '#2F6DB5' },
  { id: 'einsatzleitung', name: '4 Einsatzleitung', short: 'EL', color: '#2F6DB5' },
  { id: 'sammelstelle', name: '5 Sammelstelle Unverletzte', short: 'SU', color: '#2F6DB5' },
  { id: 'warteraum', name: '6 Warteraum', short: 'W', color: '#2F6DB5' },
];

export const LINE_TYPES: LineType[] = [
  { id: 'rettungsachse', name: 'Rettungsachse', color: '#2F6DB5', width: 4, closed: false, dashed: true },
  { id: 'sperrzone', name: 'Sperrzone', color: '#D32F2F', width: 4, closed: true, dashed: true },
  { id: 'verkehrsumleitung', name: 'Verkehrsumleitzone', color: '#F57C00', width: 5, closed: false, dashed: true },
];

export const findSymbolType = (id: string) => SYMBOL_TYPES.find((s) => s.id === id) ?? SYMBOL_TYPES[0];
export const findLineType = (id: string) => LINE_TYPES.find((l) => l.id === id) ?? LINE_TYPES[0];
