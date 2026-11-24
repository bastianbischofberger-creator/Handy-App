# Lagekarte

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

## Atemschutzüberwachung (Web-App)

Im Ordner `web/asue` liegt eine zweite Web-App: die **Atemschutzüberwachung** der Feuerwehr RTL.
Adresse: https://bastianbischofberger-creator.github.io/Handy-App/asue/

- Einmal mit Internet öffnen, dann auf dem iPad in Safari «Teilen» → «Zum Home-Bildschirm».
  Danach läuft sie auch ohne Internet. Die Daten bleiben auf dem jeweiligen Gerät.
- Unter «Einsätze» lassen sich alle Daten als Datei sichern und auf einem anderen Gerät wieder laden.
- Nach einer Änderung an den Dateien in `web/asue/sw.js` die Versionsnummer (`CACHE`) erhöhen,
  damit die Geräte die neue Version laden.

## Mehrfachereignisse (Web-App, Testversion)

Im Ordner `web/mehrfach` liegt die App für **Mehrfachereignisse** der Feuerwehr RTL.
Adresse: https://bastianbischofberger-creator.github.io/Handy-App/mehrfach/

- Ablauf: Ereignis eröffnen → Dashboard → Auftragserfassung, Ereignisbewältigung (Spalten Offen / Reko / Pendent /
  In Bewältigung / Abgeschlossen oder Karte) und Personal & Mittel.
- Zum Ausprobieren auf dem Startbildschirm «Demo-Ereignis» wählen.
- Personal, Fahrzeuge und Auftragsarten: Zahnrad → «Stammdaten bearbeiten» (zuerst sind Musterdaten drin).
- Synchronisation über Firebase (gleiches Projekt wie ASÜ, gleiche Konten). Anhänge (PDF, Fotos) bleiben
  immer auf dem Gerät, auf dem sie erfasst wurden.
- **Anmeldung im Depot per QR-Code:** Dashboard → «QR-Code» → Drucken und im Depot aufhängen (bleibt immer gleich).
  Die Leute scannen, wählen ihren Namen, hinterlegen Handynummer und Qualifikationen und tippen den 4-stelligen
  Code vom Dashboard ein (neu bei jedem Ereignis). Sie erscheinen dann unter «Personal & Mittel» als verfügbar.
- **Einmalig in der Firebase-Konsole (Reihenfolge einhalten!):**
  1. Firestore → Regeln: Inhalt von `firebase/firestore.rules` einfügen → Veröffentlichen.
  2. Erst danach: Authentication → Sign-in method → «Anonymous» aktivieren.
- Nach Änderungen in `web/mehrfach/sw.js` die Versionsnummer (`CACHE`) erhöhen.

## Startseite (alle Apps)

Im Ordner `web/start` liegt die gemeinsame Startseite **FW RTL Einsatz** mit Kacheln für ASÜ, Mehrfachereignisse und Lagekarte.
Adresse: https://bastianbischofberger-creator.github.io/Handy-App/start/

- Lässt sich wie die anderen Apps auf dem Home-Bildschirm installieren und läuft auch offline.
- Nach einer Änderung in `web/start/sw.js` die Versionsnummer (`CACHE`) erhöhen.
