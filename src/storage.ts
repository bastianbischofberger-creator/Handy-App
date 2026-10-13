import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Drawing } from './types';

const KEY = 'einsatzkarte.zeichnung.v1';

export const EMPTY_DRAWING: Drawing = { symbols: [], lines: [] };

export async function loadDrawing(): Promise<Drawing> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_DRAWING;
    const parsed = JSON.parse(raw) as Partial<Drawing>;
    return {
      symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
    };
  } catch {
    return EMPTY_DRAWING;
  }
}

export async function saveDrawing(drawing: Drawing): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(drawing));
  } catch {
    // Speichern ist nicht kritisch – die Karte funktioniert auch ohne.
  }
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
