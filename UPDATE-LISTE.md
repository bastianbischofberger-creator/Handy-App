# Sammelliste für das nächste Update

Alles hier wird beim nächsten Update gemeinsam aufgeschaltet (Zweig `naechstes-update`).

## Erledigt (liegt im Zweig bereit)

- **ASÜ 3.6.1 – Synchronisation robuster**
  - Hinweis «Neuer Einsatz auf anderem Gerät» mit Knopf «Öffnen»
  - Einsatz von der Startseite wird erst nach Antwort vom Server angelegt (keine doppelten Einsätze)
  - Sofortige Neuverbindung, wenn das iPad zurück in die App kommt
  - Sync-Fehler bleiben sichtbar

## Geplant

- **Neue Kachel «Einsatzpläne» auf der Startseite**
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
  - Routing-Dienst selbst betrieben in der Schweiz (z. B. GraphHopper/OSRM auf OpenStreetMap)
  - Offen: ein Depot oder mehrere (Rheineck, Thal, Lutzenberg)?

- **Neue Kachel «Strassenrettung»**
  - Rettungsdatenblätter: Suche nach Marke/Modell/Jahrgang, Verlinkung auf bestehende Herstellersammlungen (z. B. Euro Rescue)
  - Kurzhinweise alternative Antriebe (E-Auto, Hybrid, Gas, Wasserstoff)
  - Checkliste Ablauf (Sichern, Erkunden, Erstzugang, patientengerechte Rettung, Gerätedepot) mit Zeitstempel, optional ins Einsatzjournal

- **Neue Kachel «Gefahrgut»**
  - Suche nach UN-Nummer / Gefahrnummer (orange Tafel): Stoff, Gefahren, Schutzausrüstung, Erstmassnahmen
  - Absperrradius mit Windrichtung auf der Karte
  - Alarmierung Chemiewehr/Stützpunkt mit Meldeschema
  - Datenquelle mit freien Nutzungsrechten (z. B. ERG), Inhalte mit Chemiewehr-Stützpunkt / FKS abstimmen

- **Offen zum Besprechen:** Tastatur auf dem iPad in der ASÜ (z. B. eigener Ziffernblock bei der Druckkontrolle)

## Grundsatzentscheid

- **Schweizer Datenschutz muss gewährleistet sein** → Daten und Apps zu einem Schweizer Anbieter (Favorit: Infomaniak) statt Firebase/Google und GitHub Pages
  - Ersatz für Login, Sync und Dateispeicher nötig (z. B. eigener kleiner Server mit PocketBase oder Supabase bei Infomaniak)
  - Umbau schrittweise planen, zuerst mit Gemeinde/Kommando abklären, ob es Vorgaben gibt
  - Einsatzpläne erst nach dem Umzug einbauen (sensible Daten)

## Ideen (noch nicht entschieden)

- Lagemonitor für Grossbildschirm im KP (Entwurf vorhanden)
- Startseite-Einsatz über Firebase synchronisieren, damit er auf allen Geräten erscheint
