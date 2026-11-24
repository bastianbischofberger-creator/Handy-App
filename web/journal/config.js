/* ===== Konfiguration Einsatzjournal =====
   Synchronisation über Firebase – gleiches Projekt und gleiche Konten wie ASÜ und Mehrfachereignisse.
   Damit es funktioniert: Firestore-Regeln aus firebase/firestore.rules übernehmen
   (Firebase-Konsole > Firestore > Regeln > einfügen > «Veröffentlichen»).
   Ohne Synchronisation: «firebase: null» setzen – dann speichert jedes Gerät nur für sich.
*/
window.JR_CONFIG = {
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
