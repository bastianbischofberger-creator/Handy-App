/* ===== Konfiguration Einsatzpläne =====
   PDF-Pläne werden in Firestore gespeichert (in Stücke aufgeteilt). Nur Konten (staff) haben Zugriff.
   TESTPHASE: nur Testdaten – echte Einsatzpläne erst nach dem Umzug auf einen Schweizer Server.
   Firestore-Regeln: Abschnitt «Einsatzpläne» in firebase/firestore.rules. */
window.PL_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',
  firebase: {
    apiKey: "AIzaSyAUV3mBtsPkXjf4by7VXVARBoCIZffsjHw",
    authDomain: "asue-e0f21.firebaseapp.com",
    projectId: "asue-e0f21",
    storageBucket: "asue-e0f21.firebasestorage.app",
    messagingSenderId: "699558716705",
    appId: "1:699558716705:web:71049c0b29ef0d4b160a60"
  }
};
