/* ===== Konfiguration Mehrfachereignisse =====
   Synchronisation über Firebase – gleiches Projekt wie die ASÜ-App.
   Damit es funktioniert (Details in README.md, Abschnitt «Mehrfachereignisse»):
   1. Firestore-Regeln aus firebase/firestore.rules übernehmen (Firebase-Konsole > Firestore > Regeln).
   2. Erst DANACH: Authentication > Anmeldemethoden > «Anonym» aktivieren (für die Anmeldung im Depot per QR-Code).
   Ohne Synchronisation: «firebase: null» setzen – dann speichert jedes Gerät nur für sich.
*/
window.MF_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',

  /* Startpunkt der Karte (Rheineck) */
  karte: { lat: 47.4655, lng: 9.5905, zoom: 13 },

  firebase: {
    apiKey: "AIzaSyAUV3mBtsPkXjf4by7VXVARBoCIZffsjHw",
    authDomain: "asue-e0f21.firebaseapp.com",
    projectId: "asue-e0f21",
    storageBucket: "asue-e0f21.firebasestorage.app",
    messagingSenderId: "699558716705",
    appId: "1:699558716705:web:71049c0b29ef0d4b160a60"
  }
};
