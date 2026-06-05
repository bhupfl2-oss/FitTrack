import React, { createContext, useContext, useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut as firebaseSignOut, onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      console.log('Auth state changed:', currentUser);
      setUser(currentUser);
      setLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const signIn = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        await GoogleAuth.initialize();
        const googleUser = await GoogleAuth.signIn();
        const credential = GoogleAuthProvider.credential(googleUser.authentication.idToken);
        await signInWithCredential(auth, credential);
      } else {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      }
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  const signOut = async () => {
    try {
      await firebaseSignOut(auth);
      // Redirect to login page after successful sign out
      window.location.href = '/login';
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const value = {
    user,
    loading,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
