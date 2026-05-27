import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

export interface OnboardingProfile {
  name: string;
  age: number;
  gender: string;
  heightCm: number;
  targetWeightKg: number;
  goal: string;
}

export function useOnboarding() {
  const { user } = useAuth();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setOnboardingComplete(null);
      setLoading(false);
      return;
    }

    const fetchOnboarding = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          setOnboardingComplete(snap.data().onboardingComplete ?? false);
        } else {
          await setDoc(doc(db, 'users', user.uid), {
            onboardingComplete: false,
          });
          setOnboardingComplete(false);
        }
      } catch (e) {
        console.error('Error fetching onboarding state:', e);
        setOnboardingComplete(false);
      } finally {
        setLoading(false);
      }
    };

    fetchOnboarding();
  }, [user]);

  const saveProfile = async (profileData: OnboardingProfile) => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { profile: profileData }, { merge: true });
  };

  const completeOnboarding = async () => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { onboardingComplete: true }, { merge: true });
    setOnboardingComplete(true);
  };

  return { onboardingComplete, loading, saveProfile, completeOnboarding };
}
