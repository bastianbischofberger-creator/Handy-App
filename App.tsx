import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import MapView, { Marker, Polygon, Polyline, UrlTile, type MapPressEvent } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BASE_MAPS,
  LINE_TYPES,
  MAX_ZOOM,
  SWITZERLAND_REGION,
  SYMBOL_TYPES,
  findLineType,
  findSymbolType,
  type BaseMapKey,
} from './src/config';
import { EMPTY_DRAWING, loadDrawing, newId, saveDrawing } from './src/storage';
import { SymbolBadge } from './src/components/SymbolBadge';
import type { Coordinate, Drawing, DrawnLine, LineType, Mode } from './src/types';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Einsatzkarte />
    </SafeAreaProvider>
  );
}

function Einsatzkarte() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [baseMap, setBaseMap] = useState<BaseMapKey>('karte');
  const [mode, setMode] = useState<Mode>({ kind: 'ansehen' });
  const [drawing, setDrawing] = useState<Drawing>(EMPTY_DRAWING);
  const [loaded, setLoaded] = useState(false);
  const [panelHeight, setPanelHeight] = useState(170);

  // Gespeicherte Zeichnung beim Start laden …
  useEffect(() => {
    loadDrawing().then((d) => {
      setDrawing(d);
      setLoaded(true);
    });
  }, []);

  // … und bei jeder Änderung wieder speichern.
  useEffect(() => {
    if (loaded) saveDrawing(drawing);
  }, [drawing, loaded]);

  const flyTo = (c: Coordinate) => {
    mapRef.current?.animateToRegion(
      { latitude: c.latitude, longitude: c.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      700,
    );
  };

  const goToMyLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Kein Standort',
        'Bitte erlaube den Zugriff auf deinen Standort in den Einstellungen, damit die Karte zu dir springen kann.',
      );
      return;
    }
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) flyTo(last.coords);
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      flyTo(current.coords);
    } catch {
      Alert.alert('Kein Standort', 'Dein Standort konnte gerade nicht bestimmt werden.');
    }
  }, []);

  // Beim Öffnen der App direkt zum eigenen Standort springen.
  useEffect(() => {
    goToMyLocation();
  }, [goToMyLocation]);

  const onMapPress = (e: MapPressEvent) => {
    // Tipp auf ein bestehendes Symbol – das behandelt das Symbol selbst.
    if ((e.nativeEvent as { action?: string }).action === 'marker-press') return;
    const coordinate = e.nativeEvent.coordinate;

    if (mode.kind === 'symbol' && mode.typeId) {
      const typeId = mode.typeId;
      setDrawing((d) => ({ ...d, symbols: [...d.symbols, { id: newId(), typeId, coordinate }] }));
    } else if (mode.kind === 'linie' && mode.typeId) {
      setMode({ ...mode, points: [...mode.points, coordinate] });
    }
  };

  const finishLine = () => {
    if (mode.kind !== 'linie' || !mode.typeId) return;
    const type = findLineType(mode.typeId);
    const needed = type.closed ? 3 : 2;
    if (mode.points.length < needed) {
      Alert.alert('Zu wenig Punkte', `Für eine ${type.name} braucht es mindestens ${needed} Punkte.`);
      return;
    }
    const line: DrawnLine = { id: newId(), typeId: type.id, points: mode.points };
    setDrawing((d) => ({ ...d, lines: [...d.lines, line] }));
    setMode({ kind: 'linie', typeId: null, points: [] });
  };

  const askDeleteSymbol = (id: string, name: string) => {
    Alert.alert(name, 'Was möchtest du machen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => setDrawing((d) => ({ ...d, symbols: d.symbols.filter((s) => s.id !== id) })),
      },
    ]);
  };

  const askDeleteLine = (id: string, name: string) => {
    if (mode.kind !== 'ansehen') return;
    Alert.alert(name, 'Möchtest du diese Linie löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => setDrawing((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) })),
      },
    ]);
  };

  const askClearAll = () => {
    if (drawing.symbols.length === 0 && drawing.lines.length === 0) return;
    Alert.alert('Alles löschen?', 'Alle Symbole und Linien werden entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Alles löschen', style: 'destructive', onPress: () => setDrawing(EMPTY_DRAWING) },
    ]);
  };

  const draftType = mode.kind === 'linie' && mode.typeId ? findLineType(mode.typeId) : null;
  const draftPoints = mode.kind === 'linie' ? mode.points : [];

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={SWITZERLAND_REGION}
        mapType="none"
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        maxZoomLevel={MAX_ZOOM}
        onPress={onMapPress}
      >
        <UrlTile
          key={baseMap}
          urlTemplate={BASE_MAPS[baseMap].url}
          maximumZ={MAX_ZOOM}
          shouldReplaceMapContent
          zIndex={-1}
        />

        {drawing.lines.map((line) => (
          <LineShape
            key={line.id}
            type={findLineType(line.typeId)}
            points={line.points}
            tappable={mode.kind === 'ansehen'}
            onPress={() => askDeleteLine(line.id, findLineType(line.typeId).name)}
          />
        ))}

        {drawing.symbols.map((s) => {
          const type = findSymbolType(s.typeId);
          return (
            <Marker
              key={s.id}
              coordinate={s.coordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              draggable
              onDragEnd={(e) => {
                const coordinate = e.nativeEvent.coordinate;
                setDrawing((d) => ({
                  ...d,
                  symbols: d.symbols.map((x) => (x.id === s.id ? { ...x, coordinate } : x)),
                }));
              }}
              onPress={() => {
                if (mode.kind === 'ansehen') askDeleteSymbol(s.id, type.name);
              }}
            >
              <SymbolBadge type={type} />
            </Marker>
          );
        })}

        {draftType && draftPoints.length > 0 && (
          <>
            <LineShape type={draftType} points={draftPoints} tappable={false} />
            {draftPoints.map((p, i) => (
              <Marker key={`draft-${i}`} coordinate={p} anchor={{ x: 0.5, y: 0.5 }} tappable={false}>
                <View style={[styles.draftDot, { borderColor: draftType.color }]} />
              </Marker>
            ))}
          </>
        )}
      </MapView>

      {/* Oben: Hinweis und Wahl Karte / Luftbild */}
      <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.segment}>
            {(Object.keys(BASE_MAPS) as BaseMapKey[]).map((key) => (
              <Pressable
                key={key}
                onPress={() => setBaseMap(key)}
                style={[styles.segmentItem, baseMap === key && styles.segmentItemActive]}
              >
                <Text style={[styles.segmentText, baseMap === key && styles.segmentTextActive]}>
                  {BASE_MAPS[key].label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Image source={require('./assets/logo.png')} style={styles.logo} accessibilityLabel="Logo" />
        </View>
        <HintText mode={mode} />
      </View>

      {/* Rechts: Standort-Knopf */}
      <Pressable
        style={[styles.roundButton, { bottom: panelHeight + 14 }]}
        onPress={goToMyLocation}
        accessibilityLabel="Zu meinem Standort"
      >
        <Text style={styles.roundButtonText}>◎</Text>
      </Pressable>

      <Text style={[styles.attribution, { bottom: panelHeight + 6 }]}>© swisstopo</Text>

      {/* Unten: Werkzeuge */}
      <View
        style={[styles.panel, { paddingBottom: insets.bottom + 10 }]}
        onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
      >
        {mode.kind === 'ansehen' && (
          <View style={styles.row}>
            <ToolButton label="Symbol setzen" onPress={() => setMode({ kind: 'symbol', typeId: null })} />
            <ToolButton
              label="Linie zeichnen"
              onPress={() => setMode({ kind: 'linie', typeId: null, points: [] })}
            />
            <ToolButton label="Alles löschen" danger onPress={askClearAll} />
          </View>
        )}

        {mode.kind === 'symbol' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette}>
              {SYMBOL_TYPES.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => setMode({ kind: 'symbol', typeId: t.id })}
                  style={[styles.paletteItem, mode.typeId === t.id && styles.paletteItemActive]}
                >
                  <SymbolBadge type={t} size={40} />
                  <Text style={styles.paletteLabel} numberOfLines={2}>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.row}>
              <ToolButton label="Fertig" primary onPress={() => setMode({ kind: 'ansehen' })} />
            </View>
          </>
        )}

        {mode.kind === 'linie' && (
          <>
            <View style={styles.row}>
              {LINE_TYPES.map((t) => (
                <Pressable
                  key={t.id}
                  disabled={mode.points.length > 0}
                  onPress={() => setMode({ kind: 'linie', typeId: t.id, points: [] })}
                  style={[
                    styles.lineChoice,
                    mode.typeId === t.id && { borderColor: t.color, backgroundColor: t.color + '22' },
                    mode.points.length > 0 && mode.typeId !== t.id && styles.disabled,
                  ]}
                >
                  <LineSample type={t} />
                  <Text style={styles.lineChoiceText} numberOfLines={1} adjustsFontSizeToFit>
                    {t.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              {mode.points.length > 0 ? (
                <>
                  <ToolButton
                    label="Punkt zurück"
                    onPress={() => setMode({ ...mode, points: mode.points.slice(0, -1) })}
                  />
                  <ToolButton
                    label="Verwerfen"
                    danger
                    onPress={() => setMode({ ...mode, points: [] })}
                  />
                  <ToolButton label="Linie fertig" primary onPress={finishLine} />
                </>
              ) : (
                <ToolButton label="Fertig" primary onPress={() => setMode({ kind: 'ansehen' })} />
              )}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function LineShape({
  type,
  points,
  tappable,
  onPress,
}: {
  type: LineType;
  points: Coordinate[];
  tappable: boolean;
  onPress?: () => void;
}) {
  const dash = type.dashed ? [12, 8] : undefined;
  if (type.closed && points.length >= 3) {
    return (
      <Polygon
        coordinates={points}
        strokeColor={type.color}
        strokeWidth={type.width}
        fillColor={type.color + '33'}
        lineDashPattern={dash}
        tappable={tappable}
        onPress={onPress}
      />
    );
  }
  return (
    <Polyline
      coordinates={points}
      strokeColor={type.color}
      strokeWidth={type.width}
      lineDashPattern={dash}
      lineCap="round"
      lineJoin="round"
      tappable={tappable}
      onPress={onPress}
    />
  );
}

function LineSample({ type }: { type: LineType }) {
  return (
    <View style={styles.lineSample}>
      {type.dashed ? (
        [0, 1, 2].map((i) => (
          <View key={i} style={{ width: 10, height: 4, marginRight: 4, backgroundColor: type.color }} />
        ))
      ) : (
        <View style={{ width: 38, height: 5, backgroundColor: type.color, borderRadius: 3 }} />
      )}
    </View>
  );
}

function HintText({ mode }: { mode: Mode }) {
  let text: string | null = null;
  if (mode.kind === 'symbol') {
    text = mode.typeId
      ? `Tippe auf die Karte, um «${findSymbolType(mode.typeId).name}» zu setzen.`
      : 'Wähle unten ein Symbol aus.';
  } else if (mode.kind === 'linie') {
    if (!mode.typeId) text = 'Wähle unten die Art der Linie.';
    else {
      const t = findLineType(mode.typeId);
      text =
        mode.points.length === 0
          ? `Tippe Punkt für Punkt auf die Karte, um die ${t.name} zu zeichnen.`
          : `${mode.points.length} Punkt(e) gesetzt. Weiter tippen oder «Linie fertig» drücken.`;
    }
  } else {
    text = 'Tippe auf ein Symbol oder eine Linie, um es zu löschen. Symbole lange drücken zum Verschieben.';
  }
  return (
    <View style={styles.hint}>
      <Text style={styles.hintText}>{text}</Text>
    </View>
  );
}

function ToolButton({
  label,
  onPress,
  primary,
  danger,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.toolButton,
        primary && styles.toolButtonPrimary,
        danger && styles.toolButtonDanger,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[styles.toolButtonText, (primary || danger) && { color: 'white' }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#e8e8e8' },
  topBar: { position: 'absolute', left: 12, right: 12, gap: 8 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 46, height: 48, resizeMode: 'contain' },
  segment: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  segmentItem: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8 },
  segmentItemActive: { backgroundColor: '#D32F2F' },
  segmentText: { fontWeight: '600', color: '#333' },
  segmentTextActive: { color: 'white' },
  hint: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  hintText: { color: 'white', fontSize: 14 },
  roundButton: {
    position: 'absolute',
    right: 14,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  roundButtonText: { fontSize: 28, color: '#1565C0', marginTop: -2 },
  attribution: {
    position: 'absolute',
    left: 8,
    fontSize: 11,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 12,
    paddingHorizontal: 12,
    gap: 10,
    justifyContent: 'flex-end',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  row: { flexDirection: 'row', gap: 8 },
  toolButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#eee',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  toolButtonPrimary: { backgroundColor: '#1565C0' },
  toolButtonDanger: { backgroundColor: '#C62828' },
  toolButtonText: { fontSize: 16, fontWeight: '600', color: '#222' },
  palette: { gap: 8, paddingRight: 8 },
  paletteItem: {
    width: 84,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#f4f4f4',
  },
  paletteItemActive: { borderColor: '#1565C0', backgroundColor: '#E3F2FD' },
  paletteLabel: { fontSize: 11, textAlign: 'center', marginTop: 4, color: '#222' },
  lineChoice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  lineChoiceText: { fontSize: 13, fontWeight: '600', color: '#222', marginTop: 6 },
  lineSample: { flexDirection: 'row', alignItems: 'center', height: 8 },
  disabled: { opacity: 0.35 },
  draftDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'white',
    borderWidth: 3,
  },
});
