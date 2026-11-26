/* ===== Konfiguration Einsatzdaten teilen =====
   Freigaben liegen in Firestore «sh_freigaben» (Dokument-ID = geheimer Schlüssel im Link).
   Empfänger öffnen ansicht.html?k=… und melden sich dabei anonym an (nur Lesen der eigenen Freigabe, solange gültig). */
window.SH_CONFIG = {
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
