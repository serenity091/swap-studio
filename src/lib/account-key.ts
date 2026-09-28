import { deleteDoc, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { db, isPreview } from './firebase';
// Separate from shared records. Rules permit only this Firebase user to read/write.
export async function getAccountKey(uid: string): Promise<string> {
  if (isPreview) return '';
  if (!db) throw new Error('Firebase is not configured.');
  const snapshot = await getDocFromServer(doc(db, 'privateKeys', uid));
  return snapshot.exists() ? snapshot.data().key as string : '';
}
export async function saveAccountKey(uid: string, key: string): Promise<void> {
  if (isPreview) return;
  if (!db) throw new Error('Firebase is not configured.');
  try {
    if (key) await setDoc(doc(db, 'privateKeys', uid), { key, updatedAt: Date.now() });
    else await deleteDoc(doc(db, 'privateKeys', uid));
  } catch { throw new Error('Could not update your account key. Check your connection and try again.'); }
}
