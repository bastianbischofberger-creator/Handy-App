/* ===== Konfiguration der Atemschutzüberwachung =====
   OHNE Firebase (firebase: null): Die App speichert nur lokal auf jedem Gerät.
   MIT Firebase: Den Block «firebaseConfig» aus der Firebase-Konsole hier einfügen
   (Projekteinstellungen > Allgemein > Meine Apps > Web-App > SDK-Konfiguration).
*/
window.ASUE_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',

  firebase: null

  /* Beispiel – «null» oben ersetzen durch:
  firebase: {
    apiKey: "AIza...",
    authDomain: "fw-rtl-asue.firebaseapp.com",
    projectId: "fw-rtl-asue",
    storageBucket: "fw-rtl-asue.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
  }
  */
};
