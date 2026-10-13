# Einsatzkarte

Eine iPhone-App mit der swisstopo-Landeskarte. Die Karte springt beim Öffnen auf deinen Standort.
Du kannst Symbole (z. B. Absprachepunkte) setzen und Linien zeichnen: Rettungsachse, Sperrzone und Verkehrsumleitzone.
Alles wird automatisch auf dem Handy gespeichert.

## Auf dem iPhone ausprobieren (mit Expo Go)

1. Installiere die kostenlose App **Expo Go** aus dem App Store.
2. Auf einem Computer mit [Node.js](https://nodejs.org): Projekt herunterladen, dann im Projektordner
   `npm install` und danach `npx expo start` ausführen.
3. Es erscheint ein QR-Code. Scanne ihn mit der Kamera des iPhones und öffne den Link in Expo Go.
4. Erlaube den Zugriff auf deinen Standort.

iPhone und Computer müssen im gleichen WLAN sein. Klappt das nicht, `npx expo start --tunnel` verwenden.

## Bedienung

- **Symbol setzen**: Symbol unten auswählen, dann auf die Karte tippen. Mehrere hintereinander sind möglich.
- **Linie zeichnen**: Art der Linie wählen, dann Punkt für Punkt auf die Karte tippen und «Linie fertig» drücken.
  Die Sperrzone wird als geschlossene Fläche gezeichnet.
- **Löschen**: Auf ein Symbol oder eine Linie tippen.
- **Verschieben**: Symbol lange drücken und ziehen.
- **◎**: Zurück zum eigenen Standort.
- Oben kannst du zwischen **Karte** und **Luftbild** wechseln.

Kartendaten: © swisstopo (geo.admin.ch).

## Für Entwickler

- Expo (React Native) mit TypeScript, Karte mit `react-native-maps` und swisstopo-Kacheln (WMTS, EPSG:3857).
- Symbole und Linienarten anpassen: `src/config.ts`.
- Prüfen: `npx tsc --noEmit`
