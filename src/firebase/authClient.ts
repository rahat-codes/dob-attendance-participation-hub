import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

try {
  auth.useDeviceLanguage();
} catch {
  // Gracefully fallback if navigator.language is inaccessible
}

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});
