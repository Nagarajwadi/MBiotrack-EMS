import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as authApi from '../api/authApi';
import { configureApiClient } from '../api/client';
import { ApiError } from '../api/apiError';
import { AuthContext } from './authContextDef';
import type {
  AuthContextValue,
  AuthStatus,
  LoginCredentials,
  User,
} from '../types/auth';

export interface AuthProviderProps {
  children: ReactNode;
  onSessionExpired?: () => void;
}

export function AuthProvider({ children, onSessionExpired }: AuthProviderProps) {
  // Pure in-memory state: Never persisted to localStorage/sessionStorage/cookies
  const [, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('unauthenticated');
  const [sessionEpoch, setSessionEpoch] = useState<number>(0);

  // Synchronous refs to prevent stale closure reads in callbacks and API client
  const tokenRef = useRef<string | null>(null);
  const sessionEpochRef = useRef<number>(0);
  const isAuthenticatingRef = useRef<boolean>(false);
  const onSessionExpiredRef = useRef<(() => void) | undefined>(onSessionExpired);

  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  // Session expiration handler triggered when an authenticated request returns 401
  const handleSessionExpired = useCallback((requestEpoch?: number) => {
    if (requestEpoch !== undefined && requestEpoch !== sessionEpochRef.current) {
      return;
    }
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    sessionEpochRef.current += 1;
    setSessionEpoch(sessionEpochRef.current);

    if (onSessionExpiredRef.current) {
      onSessionExpiredRef.current();
    }
  }, []);

  // Register client hooks once on provider mount
  useEffect(() => {
    configureApiClient({
      getToken: () => tokenRef.current,
      onUnauthorized: (requestEpoch?: number) => {
        handleSessionExpired(requestEpoch);
      },
      getEpoch: () => sessionEpochRef.current,
    });
  }, [handleSessionExpired]);

  // Atomic login sequence
  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    if (isAuthenticatingRef.current) {
      return;
    }
    isAuthenticatingRef.current = true;
    setStatus('authenticating');

    try {
      // Step 1: Call login endpoint (unauthenticated)
      const tokenResp = await authApi.login(credentials);
      const rawToken = tokenResp.access_token;

      // Step 2: Validate token immediately against /auth/me before committing state
      // Pass the new token explicitly; token has NOT been committed to React state yet
      const userProfile = await authApi.getCurrentUser(rawToken);

      if (!userProfile.is_active) {
        throw new ApiError(403, 'User account is inactive.');
      }

      // Step 3: Atomic commit: only commit token and user together after full verification
      tokenRef.current = rawToken;
      setToken(rawToken);
      setUser(userProfile);
      setStatus('authenticated');
      sessionEpochRef.current += 1;
      setSessionEpoch(sessionEpochRef.current);
    } catch (err) {
      // Invalidate any partial state
      tokenRef.current = null;
      setToken(null);
      setUser(null);
      setStatus('unauthenticated');
      throw err;
    } finally {
      isAuthenticatingRef.current = false;
    }
  }, []);

  // Stateless logout
  const logout = useCallback(async (): Promise<void> => {
    const currentToken = tokenRef.current;

    // Invalidate local session state immediately and unconditionally
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    sessionEpochRef.current += 1;
    setSessionEpoch(sessionEpochRef.current);

    // Best-effort backend notification with captured token
    if (currentToken) {
      try {
        await authApi.logout(currentToken);
      } catch {
        // Silently swallow errors; client state is already destroyed
      }
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated' && user !== null,
      sessionEpoch,
      login,
      logout,
    }),
    [user, status, sessionEpoch, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
