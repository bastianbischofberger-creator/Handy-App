export type Coordinate = { latitude: number; longitude: number };

export type SymbolType = {
  id: string;
  name: string;
  short: string;
  color: string;
};

export type LineType = {
  id: string;
  name: string;
  color: string;
  width: number;
  // true = geschlossene Fläche (z. B. Sperrzone), false = offene Linie
  closed: boolean;
  dashed?: boolean;
};

export type PlacedSymbol = {
  id: string;
  typeId: string;
  coordinate: Coordinate;
};

export type DrawnLine = {
  id: string;
  typeId: string;
  points: Coordinate[];
};

export type Drawing = {
  symbols: PlacedSymbol[];
  lines: DrawnLine[];
};

export type Mode =
  | { kind: 'ansehen' }
  | { kind: 'symbol'; typeId: string | null }
  | { kind: 'linie'; typeId: string | null; points: Coordinate[] };
