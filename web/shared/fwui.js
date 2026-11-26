/* Gemeinsam für alle FW-RTL-Apps: bessere Touch-Bedienung auf iPad/iPhone.
   - Solange ein Fenster (dialog) offen ist, bleibt die Seite dahinter fix – nur das Fenster scrollt.
   - Kein Doppeltipp-Zoom / keine Verzögerung bei Knöpfen, sichtbares Feedback beim Antippen. */
(function () {
'use strict';
const st = document.createElement('style');
st.textContent = `
html{-webkit-tap-highlight-color:transparent}
button,a,input,select,textarea,label,summary,[data-a],[data-i],[data-k]{touch-action:manipulation}
button:not(:disabled):active,.btn:active{transform:scale(.97);filter:brightness(.93)}
dialog{max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
dialog::backdrop{touch-action:none}`;
document.head.appendChild(st);

let y = 0, locked = false;
function upd() {
  const open = !!document.querySelector('dialog[open]');
  const b = document.body.style;
  if (open && !locked) {
    y = window.scrollY; locked = true;
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
  } else if (!open && locked) {
    locked = false; b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
    window.scrollTo(0, y);
  }
}
const start = () => new MutationObserver(upd).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
// Wischen auf dem abgedunkelten Hintergrund nie an die Seite weitergeben
document.addEventListener('touchmove', e => {
  const d = document.querySelector('dialog[open]');
  if (d && (e.target === d || !d.contains(e.target))) e.preventDefault();
}, { passive: false });
})();
