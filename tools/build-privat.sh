#!/bin/sh
# Erzeugt web/privat/index.html aus web/index.html («Polizei Lagekarte»: Zweit-App mit Polizei-Symbol).
# Gleicher Code wie die Lagekarte, aber eigenes Symbol, nur eine Skizze und eigener Speicher (Präfix «privatkarte.»),
# damit die privaten Skizzen nie mit den Feuerwehr-Skizzen gemischt werden.
# Läuft automatisch beim Veröffentlichen (.github/workflows/pages.yml). Zum lokalen Testen von Hand starten.
set -e
cd "$(dirname "$0")/../web"
python3 - <<'PY'
src = open('index.html', encoding='utf-8').read()
def rep(a, b):
    global src
    if a not in src:
        raise SystemExit('build-privat: nicht gefunden: ' + a)
    src = src.replace(a, b)
# Name im Seitentitel und auf dem Home-Bildschirm
rep('<title>Lagekarte</title>', '<title>Polizei Lagekarte</title>')
rep('name="apple-mobile-web-app-title" content="Lagekarte"', 'name="apple-mobile-web-app-title" content="Polizei Lagekarte"')
# Alle relativen Pfade (vendor/, shared/, ...) zeigen weiter auf den Hauptordner
rep('<head>\n', '<head>\n  <!-- automatisch erzeugt aus web/index.html durch tools/build-privat.sh, nicht von Hand ändern -->\n  <base href="../" />\n  <script>window.LAGE_CFG = { prefix: \'privatkarte.\', privat: true, name: \'Polizei Lagekarte\' };</script>\n')
# ?v=<Prüfsumme>: neues Bild = neue Adresse, damit Handys kein altes Logo aus dem Zwischenspeicher zeigen
import hashlib
v = lambda f: f + '?v=' + hashlib.md5(open(f, 'rb').read()).hexdigest()[:8]
rep('href="icon-180.png"', 'href="' + v('privat/icon-180.png') + '"')
rep('href="favicon.png"', 'href="' + v('privat/favicon.png') + '"')
rep('href="manifest.webmanifest"', 'href="' + v('privat/manifest.webmanifest') + '"')
src = src.replace('src="logo.png"', 'src="' + v('privat/logo.png') + '"')
open('privat/index.html', 'w', encoding='utf-8').write(src)
# auch im Manifest (Home-Bildschirm-Symbol) die Prüfsumme anhängen
import json
m = json.load(open('privat/manifest.webmanifest', encoding='utf-8'))
for ic in m['icons']:
    ic['src'] = v('privat/' + ic['src'].split('?')[0])[len('privat/'):]
json.dump(m, open('privat/manifest.webmanifest', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print('web/privat/index.html erzeugt')
PY
