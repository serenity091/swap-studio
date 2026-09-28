import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import webConfig from '../../firebase/web-config.json';
let config: FirebaseOptions | undefined;
let configError = '';
try {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG || JSON.stringify(webConfig);
  if (raw) {
    config = JSON.parse(raw);
    if (!config?.apiKey || !config.authDomain || !config.projectId || !config.storageBucket || !config.appId) {
      config = undefined;
      configError = 'The Firebase web configuration is incomplete.';
    }
  }
} catch { configError = 'The Firebase web configuration must be valid JSON.'; }
const app = config ? initializeApp(config) : undefined;
export const auth = app ? getAuth(app) : undefined;
export const db = app ? getFirestore(app) : undefined;
export const storage = app ? getStorage(app) : undefined;
export { configError };
// Preview is development-only. Production builds always require Firebase authentication.
export const isPreview = import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === '1';
