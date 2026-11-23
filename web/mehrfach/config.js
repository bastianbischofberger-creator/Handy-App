/* ===== Konfiguration Mehrfachereignisse =====
   OHNE Firebase (firebase: null): Die App speichert nur lokal auf jedem Gerät.
   MIT Firebase: Den Block unten aktivieren. Es kann das gleiche Firebase-Projekt wie
   die ASÜ-App sein. Dann in den Firestore-Regeln zusätzlich die Sammlung
   «mf_ereignisse» (inkl. Unterordner) und das Dokument «config/mf_settings» freigeben,
   sonst werden die Daten nicht gespeichert.
*/
window.MF_CONFIG = {
  feuerwehr: 'Feuerwehr Rheineck-Thal-Lutzenberg',

  /* Startpunkt der Karte (Rheineck) */
  karte: { lat: 47.4655, lng: 9.5905, zoom: 13 },

  firebase: null

  /* Zum Aktivieren «null» oben ersetzen durch (gleiches Projekt wie ASÜ):
  firebase: {
    apiKey: "AIzaSyAUV3mBtsPkXjf4by7VXVARBoCIZffsjHw",
    authDomain: "asue-e0f21.firebaseapp.com",
    projectId: "asue-e0f21",
    storageBucket: "asue-e0f21.firebasestorage.app",
    messagingSenderId: "699558716705",
    appId: "1:699558716705:web:71049c0b29ef0d4b160a60"
  }
  */
};
