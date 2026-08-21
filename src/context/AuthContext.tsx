"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  authSignUp,
  authSignIn,
  authGetMe,
  authSignOut,
  type AuthUser,
} from '@/utils/authClient';

type Session = {
  access_token: string;
  user: AuthUser;
};

type AuthContextType = {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const getInitialSession = async () => {
      setIsLoading(true);
      try {
        const me = await authGetMe();
        if (me) {
          // Retrieve token from localStorage to build session
          const { getToken } = await import('@/utils/authClient');
          const token = getToken();
          if (token) {
            setUser(me);
            setSession({ access_token: token, user: me });
          }
        }
      } catch (error) {
        console.error('Error getting initial session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    getInitialSession();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user: u } = await authSignIn(email, password);
    setUser(u);
    setSession({ access_token: token, user: u });
  };

  const signUp = async (email: string, password: string) => {
    await authSignUp(email, password);
  };

  const signOut = async () => {
    authSignOut();
    setUser(null);
    setSession(null);
  };

  const resetPassword = async (_email: string) => {
    throw new Error('Password reset is not supported. Contact support.');
  };

  const value = {
    user,
    session,
    isLoading,
    signIn,
    signUp,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
