/* ============================================
   SOFTBALL +40 — Firebase Configuration
   Realtime Database integration
   ============================================ */

const firebaseConfig = {
    apiKey: "AIzaSyCh05K1cxlegzcuSWDbHefRlrDeZndiCR0",
    authDomain: "carnet-softball.firebaseapp.com",
    databaseURL: "https://carnet-softball-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "carnet-softball",
    storageBucket: "carnet-softball.firebasestorage.app",
    messagingSenderId: "95174290853",
    appId: "1:95174290853:web:ac34ae2f090235125d8c4c"
};

firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();
const firebaseAuth = firebase.auth();

// Shared Firebase Auth account used to authorize writes.
// Fill in the email and password you created in Firebase Console
// (Authentication → Users → Add user).
const FB_AUTH_EMAIL    = 'admin@softball.app';
const FB_AUTH_PASSWORD = 'Caracas26?';

console.log('[Firebase] Initialized');
