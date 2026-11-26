/* ===== Konfiguration Route & Sperren =====
   Depots, Sperren, Umleitungen und Bahnübergänge werden im Firestore-Dokument config/routing gespeichert (nur Konten).
   TESTAUFBAU: Routenberechnung über den öffentlichen Dienst valhalla1.openstreetmap.de (FOSSGIS, Deutschland). */
window.RT_CONFIG = {
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
