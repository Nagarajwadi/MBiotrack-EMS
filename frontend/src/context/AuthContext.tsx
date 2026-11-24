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

export const AUTH_STORAGE_KEY = 'mbiotrack_access_token';

function getStoredToken(): string | null {
  try {
    const raw = window.sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  try {
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, token);
  } catch {
    // Gracefully handle storage quota or privacy mode errors
  }
}

function removeStoredToken(): void {
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Gracefully handle storage access errors
  }
}

export interface AuthProviderProps {
  children: ReactNode;
  onSessionExpired?: () => void;
}

export function AuthProvider({ children, onSessionExpired }: AuthProviderProps) {
  // Session storage token backed state
  const initialToken = getStoredToken();
  const [, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    initialToken ? 'restoring' : 'unauthenticated'
  );
  const [sessionEpoch, setSessionEpoch] = useState<number>(0);
  const [restorationError, setRestorationError] = useState<string | null>(null);

  // Synchronous refs to prevent stale closure reads in callbacks and API client
  const tokenRef = useRef<string | null>(initialToken);
  const sessionEpochRef = useRef<number>(0);
  const isAuthenticatingRef = useRef<boolean>(false);
  const isRestoringRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const onSessionExpiredRef = useRef<(() => void) | undefined>(onSessionExpired);

  useEffect(() => {
    onSessionExpiredRef.current = onSessionExpired;
  }, [onSessionExpired]);

  // Session expiration handler triggered when an authenticated request returns 401
  const handleSessionExpired = useCallback((requestEpoch?: number) => {
    if (requestEpoch !== undefined && requestEpoch !== sessionEpochRef.current) {
      return;
    }
    removeStoredToken();
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    setRestorationError(null);
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

  // Restore existing session from sessionStorage
  const restoreSession = useCallback(async (): Promise<void> => {
    const savedToken = getStoredToken();
    if (!savedToken) {
      tokenRef.current = null;
      setToken(null);
      setUser(null);
      setStatus('unauthenticated');
      setRestorationError(null);
      return;
    }

    if (isRestoringRef.current || isAuthenticatingRef.current) {
      return;
    }
    isRestoringRef.current = true;
    setStatus('restoring');
    setRestorationError(null);

    try {
      const userProfile = await authApi.getCurrentUser(savedToken);

      if (!isMountedRef.current || !getStoredToken()) {
        return;
      }

      if (!userProfile.is_active) {
        removeStoredToken();
        tokenRef.current = null;
        setToken(null);
        setUser(null);
        setStatus('unauthenticated');
        setRestorationError(null);
        return;
      }

      // Valid token and active user
      tokenRef.current = savedToken;
      setToken(savedToken);
      setUser(userProfile);
      setStatus('authenticated');
      setRestorationError(null);
      sessionEpochRef.current += 1;
      setSessionEpoch(sessionEpochRef.current);
    } catch (err: unknown) {
      if (!isMountedRef.current || !getStoredToken()) {
        return;
      }

      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // Confirmed session expiration or invalid/revoked token
        removeStoredToken();
        tokenRef.current = null;
        setToken(null);
        setUser(null);
        setStatus('unauthenticated');
        setRestorationError(null);
        return;
      }

      // Network error or temporary server unavailability: do NOT clear stored token
      const message =
        err instanceof ApiError
          ? err.message
          : 'Unable to verify session due to a network connection issue.';
      setRestorationError(message);
      setStatus('restoring');
    } finally {
      isRestoringRef.current = false;
    }
  }, []);

  // Auto-restore session on mount if token is present
  useEffect(() => {
    isMountedRef.current = true;
    if (getStoredToken()) {
      // oxlint-disable-next-line react/set-state-in-effect
      void restoreSession();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [restoreSession]);

  // Atomic login sequence
  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    if (isAuthenticatingRef.current) {
      return;
    }
    isAuthenticatingRef.current = true;
    setStatus('authenticating');
    setRestorationError(null);

    try {
      // Step 1: Call login endpoint (unauthenticated)
      const tokenResp = await authApi.login(credentials);
      const rawToken = tokenResp.access_token;

      // Step 2: Validate token immediately against /auth/me before committing state
      // Pass the new token explicitly; token has NOT been committed to React state yet
      const userProfile = await authApi.getCurrentUser(rawToken);

      if (!isMountedRef.current) {
        return;
      }

      if (!userProfile.is_active) {
        throw new ApiError(403, 'User account is inactive.');
      }

      // Step 3: Atomic commit: only commit token and user together after full verification
      setStoredToken(rawToken);
      tokenRef.current = rawToken;
      setToken(rawToken);
      setUser(userProfile);
      setStatus('authenticated');
      sessionEpochRef.current += 1;
      setSessionEpoch(sessionEpochRef.current);
    } catch (err) {
      // Invalidate any partial state
      removeStoredToken();
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
    removeStoredToken();
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setStatus('unauthenticated');
    setRestorationError(null);
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
      restorationError,
      retryRestoration: restoreSession,
    }),
    [user, status, sessionEpoch, login, logout, restorationError, restoreSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
