/* ===== Konfiguration Schadenmeldung ===== */
window.SM_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',
  /* Empfänger der Schadenmeldungen (mehrere mit Komma trennen) */
  empfaenger: 'bastian.bischofberger@bluewin.ch',
  /* Vorschläge im Feld «Fahrzeug» – Liste nach Belieben anpassen */
  fahrzeuge: [],
  /* Später: Adresse der Server-Lösung. Ist sie gesetzt, wird die Meldung samt Fotos direkt
     dorthin geschickt (POST, JSON) statt über die Mail-App. Bis dahin: null */
  sendUrl: null
};
