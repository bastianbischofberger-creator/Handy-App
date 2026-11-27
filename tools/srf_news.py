"""Holt den SRF-Feed «Das Neueste» und schreibt news.json (nur Titel, Kurztext, Zeit, Link).
Nutzung mit schriftlicher Zusage von SRF; Anzeige im Alarmdisplay mit Quellenangabe."""
import json, re, html, sys, urllib.request, xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
URL = 'https://www.srf.ch/news/bnf/rss/19032223'
req = urllib.request.Request(URL, headers={'User-Agent': 'FW-RTL-Alarmdisplay/1.0'})
root = ET.fromstring(urllib.request.urlopen(req, timeout=30).read())
items = []
for it in root.iter('item'):
    t = (it.findtext('title') or '').strip()
    d = html.unescape(it.findtext('description') or '')
    d = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', d)).strip()
    try: ts = int(parsedate_to_datetime(it.findtext('pubDate')).timestamp() * 1000)
    except Exception: ts = 0
    if t: items.append({'t': t, 'd': d[:220], 'ts': ts, 'l': (it.findtext('link') or '').strip()})
items.sort(key=lambda x: -x['ts'])
json.dump({'quelle': 'SRF', 'feed': URL, 'stand': max([i['ts'] for i in items] or [0]), 'items': items[:20]},
          open(sys.argv[1] if len(sys.argv) > 1 else 'news.json', 'w'), ensure_ascii=False)
print(len(items), 'Meldungen')
