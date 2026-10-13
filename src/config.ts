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

export const SYMBOL_TYPES: SymbolType[] = [
  { id: 'absprachepunkt', name: 'Absprachepunkt', short: 'AP', color: '#1565C0' },
  { id: 'feuerwehrauto', name: 'Feuerwehrauto', short: '🚒', color: '#FFCDD2' },
  { id: 'kommandoposten', name: 'Kommandoposten', short: 'KP', color: '#6A1B9A' },
  { id: 'sammelplatz', name: 'Sammelplatz', short: 'SP', color: '#2E7D32' },
  { id: 'patientensammelstelle', name: 'Patientensammelstelle', short: 'PS', color: '#C62828' },
  { id: 'helilandeplatz', name: 'Helilandeplatz', short: 'H', color: '#00838F' },
  { id: 'wasserbezug', name: 'Wasserbezug', short: 'W', color: '#0277BD' },
  { id: 'gefahr', name: 'Gefahr', short: '!', color: '#EF6C00' },
  { id: 'materialdepot', name: 'Materialdepot', short: 'MD', color: '#5D4037' },
];

export const LINE_TYPES: LineType[] = [
  { id: 'rettungsachse', name: 'Rettungsachse', color: '#2E7D32', width: 6, closed: false },
  { id: 'sperrzone', name: 'Sperrzone', color: '#D32F2F', width: 4, closed: true, dashed: true },
  { id: 'verkehrsumleitung', name: 'Verkehrsumleitzone', color: '#F57C00', width: 5, closed: false, dashed: true },
];

export const findSymbolType = (id: string) => SYMBOL_TYPES.find((s) => s.id === id) ?? SYMBOL_TYPES[0];
export const findLineType = (id: string) => LINE_TYPES.find((l) => l.id === id) ?? LINE_TYPES[0];
