/* eslint-disable react-refresh/only-export-components -- provider and hook share one public module */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchMe,
  getStoredAuthToken,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  setStoredAuthToken,
} from '../api/client';
import type { AuthCredentials, RegisterPayload, User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string;
  initializing: boolean;
  login: (payload: AuthCredentials) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => getStoredAuthToken());
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(Boolean(token));

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      return;
    }

    fetchMe()
      .then(currentUser => {
        if (!cancelled) setUser(currentUser);
      })
      .catch(() => {
        if (!cancelled) {
          setStoredAuthToken('');
          setToken('');
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    token,
    initializing,
    async login(payload) {
      const response = await loginRequest(payload);
      setStoredAuthToken(response.access_token);
      setToken(response.access_token);
      setUser(response.user);
      queryClient.clear();
    },
    async register(payload) {
      const response = await registerRequest(payload);
      setStoredAuthToken(response.access_token);
      setToken(response.access_token);
      setUser(response.user);
      queryClient.clear();
    },
    async logout() {
      try {
        await logoutRequest();
      } catch {
        // Local logout still succeeds if the server session is already gone.
      }
      setStoredAuthToken('');
      setToken('');
      setUser(null);
      queryClient.clear();
    },
  }), [initializing, queryClient, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
