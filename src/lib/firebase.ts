import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const dbId = (firebaseConfig as any).firestoreDatabaseId;
export const db = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);

// Helper for anonymous sign-in
export const ensureAuth = async () => {
  if (auth.currentUser) return auth.currentUser;
  try {
    const userCredential = await signInAnonymously(auth);
    console.log("Anonymous auth successful:", userCredential.user.uid);
    return userCredential.user;
  } catch (err) {
    console.error('Anonymous auth error:', err);
    return null;
  }
};
