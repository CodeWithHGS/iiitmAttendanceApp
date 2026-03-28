import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
const firebaseConfig = {
  apiKey: "AIzaSyA3Tok2ZDTs-JXyfS9ElScymkrZ_RDkeds",
  authDomain: "attendance-website-c7597.firebaseapp.com",
  projectId: "attendance-website-c7597",
  storageBucket: "attendance-website-c7597.firebasestorage.app",
  messagingSenderId: "1087250543870",
  appId: "1:1087250543870:web:35227538cb651d22ea21af"
};

const app = initializeApp(firebaseConfig);
// Use default database if firestoreDatabaseId is missing
export const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId || "(default)");
export const auth = getAuth(app);
export { firebaseConfig };
