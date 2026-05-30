import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Call this whenever the user saves meaningful data:
 * - workout logged
 * - profile updated
 * - body stats saved
 * - labs uploaded
 *
 * Home.tsx compares this timestamp against aiInsights.generatedAt
 * and forces a cache refresh if data is newer than the last insight.
 */
export async function bumpDataVersion(uid: string): Promise<void> {
  try {
    await setDoc(
      doc(db, 'users', uid, 'meta', 'dataVersion'),
      { updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (e) {
    // Non-critical — fail silently
    console.warn('bumpDataVersion failed:', e);
  }
}

export async function getDataVersion(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'meta', 'dataVersion'));
    return snap.exists() ? (snap.data().updatedAt as string) : null;
  } catch {
    return null;
  }
}