/* ===== Konfiguration der Atemschutzüberwachung =====
   OHNE Firebase (firebase: null): Die App speichert nur lokal auf jedem Gerät.
   MIT Firebase: Den Block «firebaseConfig» aus der Firebase-Konsole hier einfügen
   (Projekteinstellungen > Allgemein > Meine Apps > Web-App > SDK-Konfiguration).
*/
window.ASUE_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',

  firebase: {
    apiKey: "AIzaSyAUV3mBtsPkXjf4by7VXVARBoCIZffsjHw",
    authDomain: "asue-e0f21.firebaseapp.com",
    projectId: "asue-e0f21",
    storageBucket: "asue-e0f21.firebasestorage.app",
    messagingSenderId: "699558716705",
    appId: "1:699558716705:web:71049c0b29ef0d4b160a60"
  }

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
