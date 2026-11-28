#!/bin/sh
# Erzeugt web/privat/index.html aus web/index.html («Lagekarte Privat» (private Zweit-App)).
# Gleicher Code wie die Lagekarte, aber eigener Name, eigenes Symbol und eigener Speicher (Präfix «privatkarte.»),
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
# Alle relativen Pfade (vendor/, shared/, ...) zeigen weiter auf den Hauptordner
rep('<head>\n', '<head>\n  <!-- automatisch erzeugt aus web/index.html durch tools/build-privat.sh, nicht von Hand ändern -->\n  <base href="../" />\n  <script>window.LAGE_CFG = { prefix: \'privatkarte.\', privat: true, name: \'Lagekarte Privat\' };</script>\n')
rep('<title>Lagekarte</title>', '<title>Lagekarte Privat</title>')
rep('content="Lagekarte" />', 'content="Karte Privat" />')
rep('href="icon-180.png"', 'href="privat/icon-180.png"')
rep('href="favicon.png"', 'href="privat/favicon.png"')
rep('href="manifest.webmanifest"', 'href="privat/manifest.webmanifest"')
src = src.replace('src="logo.png"', 'src="privat/logo.png"')
open('privat/index.html', 'w', encoding='utf-8').write(src)
print('web/privat/index.html erzeugt')
PY
