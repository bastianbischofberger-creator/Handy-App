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

## Grundsatzentscheid

- **Schweizer Datenschutz muss gewährleistet sein** → Daten und Apps zu einem Schweizer Anbieter (Favorit: Infomaniak) statt Firebase/Google und GitHub Pages
  - Ersatz für Login, Sync und Dateispeicher nötig (z. B. eigener kleiner Server mit PocketBase oder Supabase bei Infomaniak)
  - Umbau schrittweise planen, zuerst mit Gemeinde/Kommando abklären, ob es Vorgaben gibt
  - Einsatzpläne erst nach dem Umzug einbauen (sensible Daten)

## Ideen (noch nicht entschieden)

- Lagemonitor für Grossbildschirm im KP (Entwurf vorhanden)
- Startseite-Einsatz über Firebase synchronisieren, damit er auf allen Geräten erscheint
