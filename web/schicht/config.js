/* ===== Konfiguration Schichtplanung =====
   Planen, Bearbeiten, Drucken und Teilen als Text funktionieren auch ohne Firebase (nur dieses Gerät).
   Firebase braucht es nur für den QR-Code, mit dem sich AdF selbst in einen Slot eintragen.
   Dafür: Firestore-Regeln aus firebase/firestore.rules veröffentlichen (Abschnitt «Schichtplanung»)
   und in Firebase > Authentication die anonyme Anmeldung einschalten (wie bei Mehrfachereignissen).
   Ganz ohne QR-Funktion: «firebase: null» setzen.
*/
window.SP_CONFIG = {
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
