import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

export interface CompletenessState {
  workouts: boolean;
  body: boolean;
  labs: boolean;
  totalComplete: number;
  completenessBarDismissed: boolean;
}

export function useCompleteness() {
  const { user } = useAuth();
  const [state, setState] = useState<CompletenessState>({
    workouts: false,
    body: false,
    labs: false,
    totalComplete: 0,
    completenessBarDismissed: false,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchCompleteness = async () => {
      try {
        const [workoutsSnap, bodySnap, labsSnap, uiStateSnap] = await Promise.all([
          getDocs(collection(db, 'users', user.uid, 'workoutSessions')),
          getDocs(collection(db, 'users', user.uid, 'bodyComp')),
          getDocs(collection(db, 'users', user.uid, 'labs')),
          getDoc(doc(db, 'users', user.uid, 'uiState', 'home')),
        ]);

        const workouts = !workoutsSnap.empty;
        const body = !bodySnap.empty;
        const labs = !labsSnap.empty;
        const totalComplete = [workouts, body, labs].filter(Boolean).length;

        const uiData = uiStateSnap.exists() ? uiStateSnap.data() : {};
        const completenessBarDismissed = uiData.completenessBarDismissed ?? false;
        const modulesWithData = { workouts, body, labs };

        await setDoc(
          doc(db, 'users', user.uid, 'uiState', 'home'),
          { modulesWithData, completenessBarDismissed },
          { merge: true }
        );

        setState({
          workouts,
          body,
          labs,
          totalComplete,
          completenessBarDismissed,
        });
      } catch (e) {
        console.error('Error fetching completeness:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchCompleteness();
  }, [user]);

  const dismissCompletenessBar = async () => {
    if (!user) return;
    await setDoc(
      doc(db, 'users', user.uid, 'uiState', 'home'),
      { completenessBarDismissed: true },
      { merge: true }
    );
    setState((prev) => ({ ...prev, completenessBarDismissed: true }));
  };

  return { ...state, loading, dismissCompletenessBar };
}
