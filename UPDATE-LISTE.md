# Sammelliste für das nächste Update

Alles hier wird beim nächsten Update gemeinsam aufgeschaltet (Zweig `naechstes-update`).

## Aufgeschaltet am 26.11.2026 (ASÜ 3.7.0)

- **ASÜ 3.6.1 – Synchronisation robuster**
  - Hinweis «Neuer Einsatz auf anderem Gerät» mit Knopf «Öffnen»
  - Einsatz von der Startseite wird erst nach Antwort vom Server angelegt (keine doppelten Einsätze)
  - Sofortige Neuverbindung, wenn das iPad zurück in die App kommt
  - Sync-Fehler bleiben sichtbar

## Geplant

- **Neue Kachel «Einsatzpläne» auf der Startseite** – Testversion aufgeschaltet 26.11. ✓ (nur Testdaten; Firestore-Regeln «Einsatzpläne» müssen in der Konsole veröffentlicht werden)
  - Liste aller Pläne mit Suche (Objekt, Adresse, Strasse)
  - Karte der Gemeinde mit allen Objekten, Tipp öffnet den Plan
  - Erfassungsmaske (nur Kader-Konten): Objekt, Typ, Adresse, PDF hochladen/ersetzen, Stand + nächste Überprüfung, Merkmale (BMA, Schlüsseldepot, Gefahrstoffe …), Bemerkung, Standort auf Karte + Radius
  - Offline auf den Geräten verfügbar
  - Automatischer Hinweis «Einsatzplan vorhanden», wenn die Einsatzadresse im Radius eines Objekts liegt (Radius pro Objekt einstellbar)
  - Pläne nur in Firebase hinter dem Login, nie im öffentlichen Repo
  - Pläne liegen als PDF vor (Plansammlung noch im Aufbau, keine Eile)

- **Einsatzmaske (Hauptmaske der Startseite)**
  - Einsatz leuchtet auf: Stichwort, Adresse, Alarmzeit, Hinweis «Einsatzplan vorhanden» + wichtigste Merkmale
  - Route ab Depot zum Objekt (Fahrzeit, Distanz) in der App
  - Gesperrte Strassen erfassen (Grund, von–bis), Route umfährt sie, abgelaufene Sperrungen verschwinden
  - Anfahrtsvorgaben pro Objekt (Zufahrt, Aufstellfläche, Sammelplatz) aus der Erfassungsmaske, auf Karte eingezeichnet und im Routing berücksichtigt
  - Optional: Gewicht/Höhe der Fahrzeuge (TLF, ADL) berücksichtigen
  - **Strassensperren** mit Datum/Zeit von–bis auf der Karte einzeichnen (Strecke oder Gebiet), Route umfährt sie, abgelaufene verschwinden automatisch
  - **Umleitungen** einzeichnen: bei aktiver Sperre führt die Route über die vorgegebene Umleitung
  - **Vorgaben pro Einsatzgebiet**, z. B. «keine Bahnübergänge»: Bahnübergänge aus OpenStreetMap übernehmen, einzeln ein-/ausschaltbar, Route meidet sie
  - Hinweis in der App, wenn Apple/Google-Navi die Sperre nicht kennt; eigene Routenanzeige ist massgebend
  - GPS-Tracker mit SIM in den Fahrzeugen vorhanden → Positionen via Traccar (Schweizer Server) für Live-Karte, Status, Ankunftszeit (Modell/Anzahl offen)
  - Routing-Dienst selbst betrieben in der Schweiz (z. B. GraphHopper/OSRM auf OpenStreetMap)
  - Offen: ein Depot oder mehrere (Rheineck, Thal, Lutzenberg)?

- **Neue Kachel «Strassenrettung»** – erste Version aufgeschaltet 26.11. ✓ (Checkliste, Antriebe, RDB-Suche; offen: direkt ins Einsatzjournal)
  - Rettungsdatenblätter: Suche nach Marke/Modell/Jahrgang, Verlinkung auf bestehende Herstellersammlungen (z. B. Euro Rescue)
  - Kurzhinweise alternative Antriebe (E-Auto, Hybrid, Gas, Wasserstoff)
  - Checkliste Ablauf (Sichern, Erkunden, Erstzugang, patientengerechte Rettung, Gerätedepot) mit Zeitstempel, optional ins Einsatzjournal

- **Neue Kachel «Gefahrgut»** – erste Version aufgeschaltet 26.11. ✓ (Gefahrnummer, Karte, Meldung; offen: Stoffdatenbank mit geklärter Lizenz)
  - Suche nach UN-Nummer / Gefahrnummer (orange Tafel): Stoff, Gefahren, Schutzausrüstung, Erstmassnahmen
  - Absperrradius mit Windrichtung auf der Karte
  - Alarmierung Chemiewehr/Stützpunkt mit Meldeschema
  - Datenquelle mit freien Nutzungsrechten (z. B. ERG), Inhalte mit Chemiewehr-Stützpunkt / FKS abstimmen

- **ASÜ 3.7.0 – Sync-Status antippen = jetzt synchronisieren** ✓
  - Verbindung neu aufbauen, ausstehende Änderungen senden, Ergebnis anzeigen («Synchronisiert 12:41» oder Fehler im Klartext)
  - Details: Zeit der letzten erfolgreichen Synchronisation, Anzahl offener Änderungen

- **ASÜ 3.7.0 – keine iPad-Tastatur auf dem Einsatztableau** ✓ (Entwurf «ASÜ Druckkontrolle mit Ziffernblock»)
  - Druckkontrolle mit eigenem Ziffernblock, kein automatischer Cursor, nach 3 Ziffern zur nächsten Person
  - Trupp anlegen: Trupp-Nr. automatisch, Namen per Auswahl aus Personal (A–Z-Leiste, aktive ausgegraut) oder QR, Anfangsdruck per Ziffernblock
  - Normale Tastatur nur bei «Andere Person …» / Freitext und auf den übrigen Seiten

- **Offen zum Besprechen:** Alarmstufenerhöhungen bzw. Abschnittsbildung (Einsatzabschnitte) – wie in den Apps abbilden (Mehrfachereignisse, Journal, Lagemonitor, Teilen)?

## Grundsatzentscheid

- **Schweizer Datenschutz muss gewährleistet sein** → Daten und Apps zu einem Schweizer Anbieter (Favorit: Infomaniak) statt Firebase/Google und GitHub Pages
  - Ersatz für Login, Sync und Dateispeicher nötig (z. B. eigener kleiner Server mit PocketBase oder Supabase bei Infomaniak)
  - Umbau schrittweise planen, zuerst mit Gemeinde/Kommando abklären, ob es Vorgaben gibt
  - Einsatzpläne erst nach dem Umzug einbauen (sensible Daten)

## Ideen (noch nicht entschieden)

- Lagemonitor für Grossbildschirm im KP (Entwurf vorhanden)
- Startseite-Einsatz über Firebase synchronisieren, damit er auf allen Geräten erscheint

## Aufgeschaltet am 26.11.2026 (Nachmittag)

- Sync-Status antippen = jetzt synchronisieren in allen Apps mit Synchronisation (gemeinsames Fenster `shared/fwsync.js`)
- Startseite v1.9 mit Kacheln Strassenrettung, Gefahrgut, Einsatzpläne (in Vorbereitung)
- Einsatzpläne Testversion mit Hinweis «Einsatzplan vorhanden» auf der Startseite (v1.10)
- iPad: Hintergrund scrollt nicht mehr mit, wenn ein Fenster offen ist; schnellere Touch-Reaktion (`shared/fwui.js`, ASÜ 3.7.1)
- Startseite v1.11: «Online» antippen = alle Apps auf diesem Gerät synchronisieren (inkl. Index Einsatzpläne)
- Route & Sperren (Testaufbau, Valhalla/Overpass): Depots, Sperren von/bis mit Umleitung, Bahnübergänge meiden; Startseite v1.12 mit Kachel und Link «Route ab Depot»
- Einsatzpläne 1.1: Bereich als Punkt, Strecke (z. B. Autobahn-Abschnitt mit Band links/rechts) oder Fläche/Sektor; Startseite v1.13: Einsatzort auch per Karte setzen (Autobahn ohne Adresse); Route 1.0.1: Speicherfehler behoben
- Einsatzdaten teilen (Test): Freigaben live/Momentaufnahme, Feldauswahl, gültig bis Einsatzende/Dauer/Uhrzeit, QR/Link, Empfängeransicht; Firestore-Regeln «Einsatzdaten teilen» neu (Startseite v1.14)
- RTLWiki (Test): Artikel mit Kategorien, Suche, Formatierung, [[Wiki-Links]], Anhänge, Verlauf, offline; Regeln «RTLWiki» neu (Startseite v1.15)
- Code-Review 27.11.: Teilen nur vom erstellenden Gerät live/beenden, ASÜ leere Trupp-Nr. abgefangen, Route begrenzt Bahnübergänge auf Umkreis, Einsatzpläne PDF-Ersatz sicher, Startseite Adresse nach Kartentipp wieder suchbar, Wischen am Fensterrand
- Route 1.0.3: Bahnübergänge über mehrere OpenStreetMap-Server mit Zeitlimit, zusätzlich von Hand setzen/löschen
- Route 1.1.0: Bahnübergänge mit Zustand gesperrt (immer umfahren) / meiden / erlaubt, Bezeichnung, Warnung wenn gesperrter Übergang unvermeidbar
- Route 1.2.0: Navigation in der App (folgt der berechneten Route mit Sperren/Umleitungen/Bahnübergängen, Sprachansage, Neuberechnung bei Abweichung, Bildschirm bleibt an), Google Maps mit Zwischenzielen
- Alarmdisplay (Test): Verwaltung (Bildschirme koppeln per Code, Ansicht pro TV, Alarm von Hand / aus Startseite, Test-Alarm, Ruheanzeige mit Terminen, Laufschrift, Sperren), TV-Anzeige mit Karte, Route ab Depot, Einsatzplan-Hinweis, Alarmton; Regeln «Alarmdisplay» neu; shared/fwroute.js; Startseite v1.17. Offen: automatische Auslösung per Alarm-E-Mail (Schweizer Server)
- Alarmdisplay 1.1: Bildergalerie in der Ruheanzeige (linke Hälfte, Überblenden, Takt einstellbar, Upload mit Verkleinerung); Regeln: ad_bilder

- [x] Alarmdisplay 1.3.0: SRF-News («Das Neueste») als wechselnde Schlagzeile; Feed holt GitHub Action alle 15 Min. in Branch «news». Schriftliche Zusage SRF liegt bei den Akten (OneDrive) von Bastian.
- [x] ASÜ 3.8.0: Ansicht «Mini» (4–5 Trupps pro Zeile auf dem iPad quer), Schnellumschalter «▦» in der Leiste: Kompakt → Mini → Gross
